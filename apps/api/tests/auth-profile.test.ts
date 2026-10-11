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

async function registerAndLogin(app: ReturnType<typeof buildApp>, email: string, name = 'Test') {
  const reg = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, name, password: 'secret123' },
  });
  const userId = reg.json().user.id as string;
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'secret123' },
  });
  return { token: login.json().token as string, userId };
}

describe('profile update + account deletion', () => {
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
    expect((await app.inject({ method: 'PATCH', url: '/api/v1/auth/me', payload: {} })).statusCode).toBe(401);
    expect((await app.inject({ method: 'DELETE', url: '/api/v1/auth/me' })).statusCode).toBe(401);
  });

  it('updates name and preferredLang', async () => {
    const { token } = await registerAndLogin(app, 'pf@test.dev', 'Old Name');

    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: { name: 'New Name', preferredLang: 'en' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.name).toBe('New Name');
    expect(res.json().user.preferredLang).toBe('EN');

    // /me reflects the change
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.json().user.name).toBe('New Name');
  });

  it('rejects empty update and invalid lang', async () => {
    const { token } = await registerAndLogin(app, 'pf2@test.dev');
    const empty = await app.inject({
      method: 'PATCH',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
      payload: {},
    });
    expect(empty.statusCode).toBe(400);
  });

  it('deletes the account with cascade + audit trail', async () => {
    const { token, userId } = await registerAndLogin(app, 'del@test.dev');

    // Seed a conversation so we can verify the cascade.
    const conv = await prisma.conversation.create({ data: { userId, title: 'doomed' } });
    await prisma.message.create({
      data: { conversationId: conv.id, role: 'USER', content: 'hi' },
    });

    const res = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().ok).toBe(true);

    // User gone, conversations + messages cascaded.
    expect(await prisma.user.findUnique({ where: { id: userId } })).toBeNull();
    expect(await prisma.conversation.findMany({ where: { userId } })).toHaveLength(0);
    expect(
      await prisma.message.findMany({ where: { conversation: { userId } } }),
    ).toHaveLength(0);
    // Audit trail survives with userId set to null.
    const audits = await prisma.auditLog.findMany({ where: { action: 'auth.account.deleted' } });
    expect(audits.length).toBeGreaterThan(0);
    expect(audits[0]!.userId).toBeNull();

    // Token no longer resolves to a user.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(me.statusCode).toBe(401);
  });
});
