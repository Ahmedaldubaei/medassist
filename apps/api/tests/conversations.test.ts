import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/db.js';

async function cleanDb() {
  await prisma.safetyReview.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.knowledgeChunk.deleteMany();
  await prisma.knowledgeDocument.deleteMany();
  await prisma.user.deleteMany();
}

async function registerAndLogin(app: ReturnType<typeof buildApp>, email: string) {
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, name: 'Test', password: 'secret123' },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'secret123' },
  });
  return login.json().token as string;
}

async function seedConversation(userId: string, title: string, msgCount: number) {
  const conv = await prisma.conversation.create({ data: { userId, title } });
  for (let i = 0; i < msgCount; i++) {
    await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: i % 2 === 0 ? 'USER' : 'ASSISTANT',
        content: `message ${i} of ${title}`,
      },
    });
  }
  return conv;
}

describe('conversation history endpoints', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(async () => {
    await cleanDb();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('rejects unauthenticated access with 401', async () => {
    expect((await app.inject({ method: 'GET', url: '/api/v1/conversations' })).statusCode).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: '/api/v1/conversations/ckq1abc/messages' })).statusCode,
    ).toBe(401);
  });

  it('returns an empty list when the user has no conversations', async () => {
    const token = await registerAndLogin(app, 'empty@example.com');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ conversations: [], nextCursor: null });
  });

  it('lists conversations newest-first with messageCount and lastMessage', async () => {
    const token = await registerAndLogin(app, 'list@example.com');
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    const userId = me.json().user.id as string;
    await seedConversation(userId, 'older chat', 2);
    await seedConversation(userId, 'newer chat', 3);

    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.conversations).toHaveLength(2);
    expect(body.conversations[0].title).toBe('newer chat');
    expect(body.conversations[0].messageCount).toBe(3);
    expect(body.conversations[0].lastMessage.role).toBe('USER');
    expect(body.conversations[0].lastMessage.preview).toContain('message 2 of newer chat');
    expect(body.nextCursor).toBeNull();
  });

  it('paginates with limit/cursor', async () => {
    const token = await registerAndLogin(app, 'page@example.com');
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    const userId = me.json().user.id as string;
    for (const t of ['c1', 'c2', 'c3']) await seedConversation(userId, t, 1);

    const p1 = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations?limit=2',
      headers: { authorization: `Bearer ${token}` },
    });
    const b1 = p1.json();
    expect(b1.conversations).toHaveLength(2);
    expect(b1.nextCursor).toBeTruthy();

    const p2 = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations?limit=2&cursor=${b1.nextCursor}`,
      headers: { authorization: `Bearer ${token}` },
    });
    const b2 = p2.json();
    expect(b2.conversations).toHaveLength(1);
    expect(b2.nextCursor).toBeNull();
    // No duplicates across pages.
    const ids = [...b1.conversations, ...b2.conversations].map((c: { id: string }) => c.id);
    expect(new Set(ids).size).toBe(3);
  });

  it('isolates conversations per user (no cross-user visibility)', async () => {
    const tokenA = await registerAndLogin(app, 'a@example.com');
    const tokenB = await registerAndLogin(app, 'b@example.com');
    const meA = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const convA = await seedConversation(meA.json().user.id, 'A private', 1);

    // B's list is empty; B cannot read A's conversation.
    const listB = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations',
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(listB.json().conversations).toHaveLength(0);

    const peek = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${convA.id}/messages`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(peek.statusCode).toBe(404);
  });

  it('returns messages oldest-first for the owner', async () => {
    const token = await registerAndLogin(app, 'msgs@example.com');
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    const conv = await seedConversation(me.json().user.id, 'thread', 4);

    const res = await app.inject({
      method: 'GET',
      url: `/api/v1/conversations/${conv.id}/messages`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.conversationId).toBe(conv.id);
    expect(body.messages).toHaveLength(4);
    expect(body.messages.map((m: { content: string }) => m.content)).toEqual([
      'message 0 of thread',
      'message 1 of thread',
      'message 2 of thread',
      'message 3 of thread',
    ]);
    expect(body.messages[0]).toHaveProperty('role', 'USER');
  });

  it('returns 404 for a nonexistent conversation id', async () => {
    const token = await registerAndLogin(app, 'nope@example.com');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations/cl000000000000000000000000/messages',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects invalid pagination params with 400', async () => {
    const token = await registerAndLogin(app, 'bad@example.com');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations?limit=999',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });

  it('deletes an owned conversation with its messages and writes an audit log', async () => {
    const token = await registerAndLogin(app, 'del@example.com');
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    const userId = me.json().user.id as string;
    const conv = await seedConversation(userId, 'to delete', 3);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/conversations/${conv.id}`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    expect(await prisma.conversation.findUnique({ where: { id: conv.id } })).toBeNull();
    expect(await prisma.message.count({ where: { conversationId: conv.id } })).toBe(0);
    const audit = await prisma.auditLog.findFirst({
      where: { userId, action: 'conversation.delete' },
    });
    expect(audit).not.toBeNull();
  });

  it('returns 404 when deleting another user\u2019s conversation', async () => {
    const tokenA = await registerAndLogin(app, 'delA@example.com');
    const tokenB = await registerAndLogin(app, 'delB@example.com');
    const meA = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${tokenA}` },
    });
    const conv = await seedConversation(meA.json().user.id as string, 'private', 1);

    const res = await app.inject({
      method: 'DELETE',
      url: `/api/v1/conversations/${conv.id}`,
      headers: { authorization: `Bearer ${tokenB}` },
    });
    expect(res.statusCode).toBe(404);
    // Still intact for the owner.
    expect(await prisma.conversation.findUnique({ where: { id: conv.id } })).not.toBeNull();
  });

  it('returns 404 when deleting a nonexistent conversation', async () => {
    const token = await registerAndLogin(app, 'delNone@example.com');
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/conversations/cl000000000000000000000000',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects unauthenticated delete with 401', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/conversations/cl000000000000000000000000',
    });
    expect(res.statusCode).toBe(401);
  });
});
