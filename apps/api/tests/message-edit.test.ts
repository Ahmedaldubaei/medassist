import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/db.js';

async function cleanDb() {
  await prisma.safetyReview.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
}

async function registerAndLogin(app: ReturnType<typeof buildApp>, email: string) {
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, name: 'Test', password: 'secret123' },
  });
  const userId = reg.json().user.id as string;
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'secret123' },
  });
  return { token: login.json().token as string, userId };
}

describe('message edit', () => {
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

  it('edits a user message and deletes subsequent messages', async () => {
    const a = await registerAndLogin(app, 'me1@test.dev');
    const conv = await prisma.conversation.create({ data: { userId: a.userId, title: 'T' } });
    const u1 = await prisma.message.create({
      data: { conversationId: conv.id, role: 'USER', content: 'original question' },
    });
    await prisma.message.create({
      data: { conversationId: conv.id, role: 'ASSISTANT', content: 'old answer' },
    });
    const u2 = await prisma.message.create({
      data: { conversationId: conv.id, role: 'USER', content: 'follow up' },
    });
    await prisma.message.create({
      data: { conversationId: conv.id, role: 'ASSISTANT', content: 'second answer' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${u1.id}`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { content: 'edited question' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.id).toBe(u1.id);
    expect(body.content).toBe('edited question');
    expect(body.deletedCount).toBe(3);

    const remaining = await prisma.message.findMany({
      where: { conversationId: conv.id },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.id).toBe(u1.id);
    expect(remaining[0]!.content).toBe('edited question');

    const untouched = await prisma.message.findUnique({ where: { id: u2.id } });
    expect(untouched).toBeNull();

    const audit = await prisma.auditLog.findFirst({
      where: { userId: a.userId, action: 'message.edit' },
    });
    expect(audit).toBeTruthy();
  });

  it('rejects editing an assistant message with 400 NOT_EDITABLE', async () => {
    const a = await registerAndLogin(app, 'me2@test.dev');
    const conv = await prisma.conversation.create({ data: { userId: a.userId, title: 'T' } });
    const asst = await prisma.message.create({
      data: { conversationId: conv.id, role: 'ASSISTANT', content: 'answer' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${asst.id}`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { content: 'hacked' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('NOT_EDITABLE');
  });

  it('returns 404 for another user\'s message', async () => {
    const a = await registerAndLogin(app, 'me3a@test.dev');
    const b = await registerAndLogin(app, 'me3b@test.dev');
    const conv = await prisma.conversation.create({ data: { userId: a.userId, title: 'T' } });
    const u = await prisma.message.create({
      data: { conversationId: conv.id, role: 'USER', content: 'private' },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${u.id}`,
      headers: { authorization: `Bearer ${b.token}` },
      payload: { content: 'intruder' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('refuses with 409 PINNED_AFTER when a pinned message exists after the target', async () => {
    const a = await registerAndLogin(app, 'me4@test.dev');
    const conv = await prisma.conversation.create({ data: { userId: a.userId, title: 'T' } });
    const u1 = await prisma.message.create({
      data: { conversationId: conv.id, role: 'USER', content: 'q' },
    });
    await prisma.message.create({
      data: { conversationId: conv.id, role: 'ASSISTANT', content: 'saved answer', pinned: true },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${u1.id}`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { content: 'changed' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe('PINNED_AFTER');

    // Nothing was touched.
    const untouched = await prisma.message.findUnique({ where: { id: u1.id } });
    expect(untouched!.content).toBe('q');
    expect(await prisma.message.count({ where: { conversationId: conv.id } })).toBe(2);
  });

  it('rejects empty and too-long content with 400', async () => {
    const a = await registerAndLogin(app, 'me5@test.dev');
    const conv = await prisma.conversation.create({ data: { userId: a.userId, title: 'T' } });
    const u = await prisma.message.create({
      data: { conversationId: conv.id, role: 'USER', content: 'q' },
    });

    const empty = await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${u.id}`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { content: '   ' },
    });
    expect(empty.statusCode).toBe(400);

    const long = await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${u.id}`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { content: 'x'.repeat(4001) },
    });
    expect(long.statusCode).toBe(400);
  });

  it('keeps the pin on the edited message itself', async () => {
    const a = await registerAndLogin(app, 'me6@test.dev');
    const conv = await prisma.conversation.create({ data: { userId: a.userId, title: 'T' } });
    const u = await prisma.message.create({
      data: { conversationId: conv.id, role: 'USER', content: 'q', pinned: true },
    });

    const res = await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${u.id}`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { content: 'q2' },
    });
    expect(res.statusCode).toBe(200);

    const after = await prisma.message.findUnique({ where: { id: u.id } });
    expect(after!.content).toBe('q2');
    expect(after!.pinned).toBe(true);
  });
});
