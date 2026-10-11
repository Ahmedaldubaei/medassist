import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(50).default(20),
  cursor: z.string().cuid().optional(),
});

const messagesQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(50),
  cursor: z.string().cuid().optional(),
});

const conversationIdParam = z.object({
  id: z.string().cuid(),
});

function preview(content: string, max = 200): string {
  return content.length > max ? content.slice(0, max) + '…' : content;
}

export async function conversationRoutes(app: FastifyInstance): Promise<void> {
  // Paginated conversation history for the signed-in user (newest first).
  app.get(
    '/api/v1/conversations',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const query = listQuerySchema.parse(request.query);
      const userId = request.user!.sub;

      const conversations = await prisma.conversation.findMany({
        where: { userId },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
        include: {
          _count: { select: { messages: true } },
          messages: { orderBy: { createdAt: 'desc' }, take: 1 },
        },
      });

      const hasMore = conversations.length > query.limit;
      const page = hasMore ? conversations.slice(0, query.limit) : conversations;

      return reply.send({
        conversations: page.map((c) => ({
          id: c.id,
          title: c.title,
          createdAt: c.createdAt.toISOString(),
          messageCount: c._count.messages,
          lastMessage: c.messages[0]
            ? {
                role: c.messages[0].role,
                preview: preview(c.messages[0].content),
                createdAt: c.messages[0].createdAt.toISOString(),
              }
            : null,
        })),
        nextCursor: hasMore ? page[page.length - 1]!.id : null,
      });
    },
  );

  // Messages of one conversation — strictly scoped to the caller's own conversations.
  app.get(
    '/api/v1/conversations/:id/messages',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 120, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const params = conversationIdParam.parse(request.params);
      const query = messagesQuerySchema.parse(request.query);
      const userId = request.user!.sub;

      const conversation = await prisma.conversation.findFirst({
        where: { id: params.id, userId },
        select: { id: true },
      });
      if (!conversation) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Conversation not found' },
        });
      }

      const messages = await prisma.message.findMany({
        where: { conversationId: params.id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      });

      const hasMore = messages.length > query.limit;
      const page = hasMore ? messages.slice(0, query.limit) : messages;

      return reply.send({
        conversationId: params.id,
        messages: page.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          agentUsed: m.agentUsed,
          citations: m.citationsJson ?? [],
          confidence: m.confidence,
          createdAt: m.createdAt.toISOString(),
        })),
        nextCursor: hasMore ? page[page.length - 1]!.id : null,
      });
    },
  );

  // Delete a conversation — strictly scoped to the caller's own conversations.
  // Messages, agent runs and safety reviews cascade via the schema.
  app.delete(
    '/api/v1/conversations/:id',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const params = conversationIdParam.parse(request.params);
      const userId = request.user!.sub;

      const conversation = await prisma.conversation.findFirst({
        where: { id: params.id, userId },
        select: { id: true },
      });
      if (!conversation) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Conversation not found' },
        });
      }

      await prisma.$transaction([
        prisma.conversation.delete({ where: { id: params.id } }),
        prisma.auditLog.create({
          data: { userId, action: 'conversation.delete', detailsJson: { conversationId: params.id } },
        }),
      ]);

      return reply.send({ ok: true });
    },
  );
}
