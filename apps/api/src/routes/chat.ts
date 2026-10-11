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
}
