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
  app.post(
    '/api/v1/chat/stream',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = chatSchema.parse(request.body);
      let result: Awaited<ReturnType<typeof runChat>>;
      try {
        result = await runChat(request.user!.sub, body.message, body.conversationId);
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

      reply.raw.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      const send = (event: string, data: unknown): void => {
        reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      };

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
