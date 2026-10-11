import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/db.js';
import { runChat } from '../src/agents/pipeline.js';
import { MockProvider } from '../src/llm/index.js';

const mock = new MockProvider([], 'Mock fallback.');

async function cleanDb() {
  await prisma.safetyReview.deleteMany();
  await prisma.message.deleteMany();
  await prisma.agentRun.deleteMany();
  await prisma.conversation.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
}

async function makeUser(email: string) {
  return prisma.user.create({
    data: { email, name: 'Persist Tester', passwordHash: 'x', role: 'USER' },
  });
}

// Benign chit-chat: assistant agent → LLM → postCheck → persist.
const BENIGN = 'let us discuss the weather patterns today';

describe('disclaimer + verdict persistence (M5)', () => {
  beforeEach(async () => {
    await cleanDb();
    mock.calls.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('persists disclaimer and verdict on the assistant message', async () => {
    const user = await makeUser('m5a@example.com');
    const result = await runChat(user.id, BENIGN, undefined, { llm: mock });
    expect(result.disclaimer.length).toBeGreaterThan(0);

    const msg = await prisma.message.findFirst({
      where: { conversationId: result.conversationId, role: 'ASSISTANT' },
    });
    expect(msg).toBeTruthy();
    expect(msg!.disclaimer).toBe(result.disclaimer);
    expect(msg!.verdict).toBe(result.safetyVerdict);
    expect(['PASS', 'FLAG']).toContain(msg!.verdict);
  });

  it('persists ESCALATE verdict + disclaimer on the emergency path', async () => {
    const user = await makeUser('m5b@example.com');
    const result = await runChat(user.id, 'المريض توقف قلبه الآن', undefined, { llm: mock });
    expect(result.safetyVerdict).toBe('ESCALATE');

    const msg = await prisma.message.findFirst({
      where: { conversationId: result.conversationId, role: 'ASSISTANT' },
    });
    expect(msg!.verdict).toBe('ESCALATE');
    expect(msg!.disclaimer).toBe(result.disclaimer);
  });

  it('messages API returns disclaimer and verdict (no client fabrication needed)', async () => {
    const app = buildApp();
    await app.ready();
    try {
      const user = await makeUser('m5c@example.com');
      const result = await runChat(user.id, BENIGN, undefined, { llm: mock });

      // Mint a token via the real login path would need a password; use the
      // user row directly with signToken instead.
      const { signToken } = await import('../src/lib/jwt.js');
      const token = signToken({ sub: user.id, role: user.role, tv: user.tokenVersion });

      const res = await app.inject({
        method: 'GET',
        url: `/api/v1/conversations/${result.conversationId}/messages`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      const body = res.json() as {
        messages: Array<{ role: string; disclaimer: string | null; verdict: string | null }>;
      };
      const assistant = body.messages.find((m) => m.role === 'ASSISTANT');
      expect(assistant).toBeTruthy();
      expect(assistant!.disclaimer).toBe(result.disclaimer);
      expect(assistant!.verdict).toBe(result.safetyVerdict);
    } finally {
      await app.close();
    }
  });
});
