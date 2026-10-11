import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { runChat } from '../agents/pipeline.js';
import { LlmNotConfiguredError } from '../llm/index.js';

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
          pinned: m.pinned,
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

  // Search the caller's own messages (ILIKE). Static route first so it wins
  // over the parametric /:id route.
  app.get(
    '/api/v1/conversations/search',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const query = z.object({ q: z.string().min(1).max(200) }).parse(request.query);
      const userId = request.user!.sub;
      const q = query.q.trim();

      const messages = await prisma.message.findMany({
        where: {
          content: { contains: q, mode: 'insensitive' },
          conversation: { userId },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
        include: { conversation: { select: { id: true, title: true } } },
      });

      return reply.send({
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          preview: preview(m.content),
          pinned: m.pinned,
          createdAt: m.createdAt.toISOString(),
          conversationId: m.conversation.id,
          conversationTitle: m.conversation.title,
        })),
      });
    },
  );

  // The caller's pinned messages across their conversations.
  app.get(
    '/api/v1/conversations/pinned',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const userId = request.user!.sub;

      const messages = await prisma.message.findMany({
        where: { pinned: true, conversation: { userId } },
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { conversation: { select: { id: true, title: true } } },
      });

      return reply.send({
        messages: messages.map((m) => ({
          id: m.id,
          role: m.role,
          preview: preview(m.content),
          content: m.content,
          createdAt: m.createdAt.toISOString(),
          conversationId: m.conversation.id,
          conversationTitle: m.conversation.title,
        })),
      });
    },
  );

  // Regenerate the last assistant answer: runs the pipeline on the last user
  // message WITHOUT duplicating it, replacing the previous assistant message(s).
  app.post(
    '/api/v1/conversations/:id/regenerate',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 30, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const params = conversationIdParam.parse(request.params);
      const userId = request.user!.sub;

      const conversation = await prisma.conversation.findFirst({
        where: { id: params.id, userId },
        include: { messages: { orderBy: { createdAt: 'desc' }, take: 20 } },
      });
      if (!conversation) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Conversation not found' },
        });
      }
      const lastUser = conversation.messages.find((m) => m.role === 'USER');
      if (!lastUser) {
        return reply.code(400).send({
          error: { code: 'NO_USER_MESSAGE', message: 'No user message to regenerate from' },
        });
      }

      // Drop the previous assistant answer(s) after the last user message
      // (their safety reviews cascade via the schema).
      await prisma.message.deleteMany({
        where: {
          conversationId: params.id,
          role: 'ASSISTANT',
          createdAt: { gt: lastUser.createdAt },
        },
      });

      try {
        const result = await runChat(userId, lastUser.content, params.id, { regenerate: true });
        await prisma.auditLog.create({
          data: {
            userId,
            action: 'conversation.regenerate',
            detailsJson: { conversationId: params.id },
          },
        });
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

  // Pin / unpin a message — strictly scoped to the caller's own conversations.
  app.patch(
    '/api/v1/messages/:id/pin',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const params = z.object({ id: z.string().cuid() }).parse(request.params);
      const body = z.object({ pinned: z.boolean() }).parse(request.body);
      const userId = request.user!.sub;

      const message = await prisma.message.findFirst({
        where: { id: params.id, conversation: { userId } },
        select: { id: true },
      });
      if (!message) {
        return reply.code(404).send({
          error: { code: 'NOT_FOUND', message: 'Message not found' },
        });
      }

      await prisma.message.update({
        where: { id: params.id },
        data: { pinned: body.pinned },
      });
      return reply.send({ ok: true, pinned: body.pinned });
    },
  );
}
