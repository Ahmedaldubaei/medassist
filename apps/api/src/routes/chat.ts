import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { runChat } from '../agents/pipeline.js';
import { LlmNotConfiguredError } from '../llm/index.js';

const chatSchema = z.object({
  message: z.string().min(1, 'message is required').max(2000, 'message too long'),
  conversationId: z.string().cuid().optional(),
});

export async function chatRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/chat',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = chatSchema.parse(request.body);
      try {
        const result = await runChat(request.user!.sub, body.message, body.conversationId);
        return reply.send(result);
      } catch (err) {
        if (err instanceof LlmNotConfiguredError) {
          return reply.code(503).send({
            error: {
              code: 'LLM_NOT_CONFIGURED',
              message:
                'The AI service is not configured yet. The administrator must set ' +
                'GEMINI_API_KEY (primary) and/or CEREBRAS_API_KEY (fallback).',
            },
          });
        }
        throw err;
      }
    },
  );

  // Streaming variant (SSE). SAFETY: the full pipeline — including the
  // deterministic safety post-check, which can rewrite the answer (strip
  // fabricated citations / ungrounded dosages) — runs server-side FIRST.
  // Only the final post-checked answer is streamed to the client in chunks,
  // followed by `event: meta` (citations, confidence, verdict) and `event: done`.
  // True LLM-token streaming is intentionally NOT used: it would deliver text
  // to the client before the safety gate has approved it.
  //
  // M4 perceived-latency: `event: status` phase events (preparing → safety →
  // retrieval → generating → verifying) are emitted as the pipeline advances,
  // so the client can show live progress instead of a silent typing indicator.
  // Headers are flushed BEFORE runChat so status events stream immediately.
  app.post(
    '/api/v1/chat/stream',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = chatSchema.parse(request.body);

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      // P3 SSE resume (lightweight): `retry:` sets the EventSource
      // auto-reconnect delay; every event carries an incrementing `id:`.
      // The server currently ignores `Last-Event-ID` — full resume-from-ID
      // is future work. Clients must NOT re-POST on drop; they reload
      // messages instead (H3 duplicate protection).
      reply.raw.write('retry: 3000\n\n');
      let eventId = 0;
      const send = (event: string, data: unknown): void => {
        if (request.raw.destroyed) return;
        eventId += 1;
        reply.raw.write(`id: ${eventId}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

      let result: Awaited<ReturnType<typeof runChat>>;
      try {
        result = await runChat(request.user!.sub, body.message, body.conversationId, {
          onPhase: (phase) => send('status', { phase }),
        });
      } catch (err) {
        // Headers are already sent — surface the failure as an SSE event so
        // the client can handle it like any other stream error (and check
        // for an already-persisted reply instead of blindly re-sending).
        if (err instanceof LlmNotConfiguredError) {
          send('error', {
            code: 'LLM_NOT_CONFIGURED',
            status: 503,
            message:
              'The AI service is not configured yet. The administrator must set ' +
              'GEMINI_API_KEY (primary) and/or CEREBRAS_API_KEY (fallback).',
          });
        } else {
          request.log.error({ err: String(err) }, 'chat stream pipeline failed');
          send('error', { code: 'INTERNAL', status: 500, message: 'Chat pipeline failed' });
        }
        reply.raw.end();
        return;
      }

      for (const chunk of chunkText(result.answer)) {
        if (request.raw.destroyed) break;
        send('token', { text: chunk });
      }
      send('meta', {
        citations: result.citations,
        confidence: result.confidence,
        disclaimer: result.disclaimer,
        agentUsed: result.agentUsed,
        safetyVerdict: result.safetyVerdict,
        conversationId: result.conversationId,
        escalated: result.escalated,
      });
      send('done', {});
      reply.raw.end();
    },
  );
}

/** Split text into word-boundary chunks; concatenating them reproduces the input exactly. */
function chunkText(text: string, size = 48): string[] {
  const out: string[] = [];
  let rest = text;
  while (rest.length > size) {
    let cut = rest.lastIndexOf(' ', size);
    if (cut <= 0) cut = size;
    out.push(rest.slice(0, cut));
    rest = rest.slice(cut);
  }
  if (rest) out.push(rest);
  return out;
}
