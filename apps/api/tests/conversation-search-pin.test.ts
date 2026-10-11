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

describe('conversation search + pin', () => {
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
    const res = await app.inject({ method: 'GET', url: '/api/v1/conversations/search?q=x' });
    expect(res.statusCode).toBe(401);
  });

  it('searches only the caller\'s own messages', async () => {
    const a = await registerAndLogin(app, 'sa@test.dev');
    const b = await registerAndLogin(app, 'sb@test.dev');

    const convA = await prisma.conversation.create({ data: { userId: a.userId, title: 'A' } });
    await prisma.message.create({
      data: { conversationId: convA.id, role: 'USER', content: 'dantrolene protocol question' },
    });
    const convB = await prisma.conversation.create({ data: { userId: b.userId, title: 'B' } });
    await prisma.message.create({
      data: { conversationId: convB.id, role: 'USER', content: 'dantrolene protocol question' },
    });

    const resA = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations/search?q=dantrolene',
      headers: { authorization: `Bearer ${a.token}` },
    });
    expect(resA.statusCode).toBe(200);
    const hitsA = resA.json().messages;
    expect(hitsA).toHaveLength(1);
    expect(hitsA[0].conversationId).toBe(convA.id);

    const resB = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations/search?q=dantrolene',
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(resB.json().messages).toHaveLength(1);
    expect(resB.json().messages[0].conversationId).toBe(convB.id);
  });

  it('pin/unpin is user-scoped; user B cannot pin user A\'s message', async () => {
    const a = await registerAndLogin(app, 'pa@test.dev');
    const b = await registerAndLogin(app, 'pb@test.dev');

    const convA = await prisma.conversation.create({ data: { userId: a.userId, title: 'A' } });
    const msg = await prisma.message.create({
      data: { conversationId: convA.id, role: 'ASSISTANT', content: 'answer to pin' },
    });

    // B tries to pin A's message → 404
    const bad = await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${msg.id}/pin`,
      headers: { authorization: `Bearer ${b.token}` },
      payload: { pinned: true },
    });
    expect(bad.statusCode).toBe(404);

    // A pins it
    const ok = await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${msg.id}/pin`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { pinned: true },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().pinned).toBe(true);

    // Pinned list shows it for A, empty for B
    const pinnedA = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations/pinned',
      headers: { authorization: `Bearer ${a.token}` },
    });
    expect(pinnedA.json().messages).toHaveLength(1);

    const pinnedB = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations/pinned',
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(pinnedB.json().messages).toHaveLength(0);

    // Unpin
    const unpin = await app.inject({
      method: 'PATCH',
      url: `/api/v1/messages/${msg.id}/pin`,
      headers: { authorization: `Bearer ${a.token}` },
      payload: { pinned: false },
    });
    expect(unpin.json().pinned).toBe(false);
    const pinnedA2 = await app.inject({
      method: 'GET',
      url: '/api/v1/conversations/pinned',
      headers: { authorization: `Bearer ${a.token}` },
    });
    expect(pinnedA2.json().messages).toHaveLength(0);
  });
});
