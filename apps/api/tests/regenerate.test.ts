import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/db.js';
import { __setEmbedProvider, type EmbedProvider, type EmbedKind } from '../src/rag/embeddings.js';
import { __setLlmProvider, MockProvider } from '../src/llm/index.js';

/** Deterministic fake embeddings (no model download). */
class FakeEmbed implements EmbedProvider {
  readonly name = 'fake';
  readonly dim = 384;
  async embed(texts: string[], _kind: EmbedKind): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(384).fill(0);
      const low = t.toLowerCase();
      const words = ['dantrolene', 'malignant', 'hyperthermia'];
      words.forEach((w, i) => {
        if (low.includes(w)) v[i] = 1;
      });
      v[100] = 0.01;
      const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
      return v.map((x) => x / n);
    });
  }
}

const mock = new MockProvider([], 'Regenerated mock answer.');

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

describe('regenerate endpoint', () => {
  const app = buildApp();

  beforeAll(async () => {
    __setEmbedProvider(new FakeEmbed());
    __setLlmProvider(mock);
    await app.ready();
  });

  beforeEach(async () => {
    await cleanDb();
  });

  afterAll(async () => {
    __setEmbedProvider(null);
    __setLlmProvider(null);
    await app.close();
    await prisma.$disconnect();
  });

  it('rejects unauthenticated access with 401', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/v1/conversations/xyz/regenerate' });
    expect(res.statusCode).toBe(401);
  });

  it('regenerates without duplicating the user message', async () => {
    const { token, userId } = await registerAndLogin(app, 'rg@test.dev');

    // Seed a conversation with 1 user + 1 assistant message.
    const conv = await prisma.conversation.create({ data: { userId, title: 'regen test' } });
    await prisma.message.create({
      data: { conversationId: conv.id, role: 'USER', content: 'hello world test message' },
    });
    await prisma.message.create({
      data: { conversationId: conv.id, role: 'ASSISTANT', content: 'old answer' },
    });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conv.id}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().answer).toBeTruthy();

    const messages = await prisma.message.findMany({
      where: { conversationId: conv.id },
      orderBy: { createdAt: 'asc' },
    });
    // Exactly 1 USER message (no duplicate) + 1 fresh ASSISTANT message.
    expect(messages.filter((m) => m.role === 'USER')).toHaveLength(1);
    expect(messages.filter((m) => m.role === 'ASSISTANT')).toHaveLength(1);
    expect(messages.find((m) => m.role === 'ASSISTANT')!.content).not.toBe('old answer');
  });

  it('returns 404 for another user\'s conversation', async () => {
    const a = await registerAndLogin(app, 'rg2a@test.dev');
    const b = await registerAndLogin(app, 'rg2b@test.dev');
    const conv = await prisma.conversation.create({ data: { userId: a.userId, title: 'A' } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conv.id}/regenerate`,
      headers: { authorization: `Bearer ${b.token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 400 when there is no user message', async () => {
    const { token, userId } = await registerAndLogin(app, 'rg3@test.dev');
    const conv = await prisma.conversation.create({ data: { userId, title: 'empty' } });

    const res = await app.inject({
      method: 'POST',
      url: `/api/v1/conversations/${conv.id}/regenerate`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(400);
  });
});
