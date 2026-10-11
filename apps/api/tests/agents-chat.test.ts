import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/db.js';
import { ingestDocument } from '../src/rag/ingest.js';
import { __setEmbedProvider, type EmbedProvider, type EmbedKind } from '../src/rag/embeddings.js';
import { __setLlmProvider, MockProvider } from '../src/llm/index.js';
import { runChat, conversationTitle } from '../src/agents/pipeline.js';

/** Deterministic fake embedder (same idea as the RAG e2e test). */
class FakeEmbed implements EmbedProvider {
  readonly name = 'fake';
  readonly dim = 384;
  private vocab = ['malignant', 'hyperthermia', 'dantrolene', 'anesthesia'];

  async embed(texts: string[], _kind: EmbedKind): Promise<number[][]> {
    return texts.map((t) => {
      const v = new Array<number>(384).fill(0);
      const low = t.toLowerCase();
      this.vocab.forEach((w, i) => {
        if (low.includes(w)) v[i] = 1;
      });
      v[100] = 0.01;
      const n = Math.sqrt(v.reduce((a, b) => a + b * b, 0));
      return v.map((x) => x / n);
    });
  }
}

const fake = new FakeEmbed();

const MH_TEXT = (
  'Malignant hyperthermia is a severe reaction to volatile anesthetics. ' +
  'Dantrolene dosing starts at 2.5 mg per kg intravenously and may be repeated. ' +
  'Stop triggers, hyperventilate with 100 percent oxygen, treat acidosis. '
).repeat(10);

const mock = new MockProvider(
  [
    {
      match: /dantrolene/i,
      text:
        '## Documented knowledge\n' +
        'Give dantrolene 2.5 mg/kg IV immediately [1]. Also consider a 100 mg test bolus [1].\n\n' +
        '## Model inference\n' +
        'Early recognition improves outcomes.',
    },
  ],
  'Mock fallback.',
);

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

async function registerAndToken(app: ReturnType<typeof buildApp>, email: string): Promise<string> {
  await app.inject({
    method: 'POST',
    url: '/api/v1/auth/register',
    payload: { email, name: 'Tester', password: 'secret123' },
  });
  const login = await app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password: 'secret123' },
  });
  return login.json().token as string;
}

describe('chat e2e (mock LLM + fake embeddings)', () => {
  const app = buildApp();

  beforeAll(async () => {
    __setEmbedProvider(fake);
    __setLlmProvider(mock);
    await app.ready();
  });

  beforeEach(async () => {
    await cleanDb();
    mock.calls.length = 0;
    await ingestDocument(
      { title: 'MH dantrolene protocol', source: 'test', license: 'test', text: MH_TEXT },
      fake,
    );
  });

  afterAll(async () => {
    __setEmbedProvider(null);
    __setLlmProvider(null);
    await app.close();
    await prisma.$disconnect();
  });

  it('full chat: routes to anesthesiology, grounds doses, persists everything', async () => {
    const token = await registerAndToken(app, 'chat1@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'dantrolene dose malignant hyperthermia' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();

    expect(body.agentUsed).toBe('anesthesiology');
    expect(body.safetyVerdict).toBe('FLAG'); // 100 mg stripped, 2.5 mg/kg kept
    expect(body.answer).toContain('2.5 mg/kg');
    expect(body.answer).not.toContain('100 mg');
    expect(body.citations).toHaveLength(1);
    expect(body.citations[0].title).toBe('MH dantrolene protocol');
    expect(body.disclaimer).toContain('anesthesiologist');
    expect(body.conversationId).toBeTruthy();
    expect(body.escalated).toBe(false);
    expect(mock.calls.length).toBe(1);

    // Persistence: user + assistant messages, run, safety review.
    const messages = await prisma.message.findMany({
      where: { conversationId: body.conversationId },
      orderBy: { createdAt: 'asc' },
    });
    expect(messages).toHaveLength(2);
    expect(messages[1]!.agentUsed).toBe('anesthesiology');
    const review = await prisma.safetyReview.findUnique({
      where: { messageId: messages[1]!.id },
    });
    expect(review).not.toBeNull();
    expect(review!.verdict).toBe('FLAG');
    const runs = await prisma.agentRun.findMany({ where: { conversationId: body.conversationId } });
    expect(runs).toHaveLength(1);
    expect(runs[0]!.agentsInvolved).toContain('anesthesiology');
  });

  it('emergency message escalates immediately without any LLM call', async () => {
    const token = await registerAndToken(app, 'chat2@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: 'المريض توقف عن التنفس' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.escalated).toBe(true);
    expect(body.agentUsed).toBe('safety');
    expect(body.answer).toContain('طوارئ');
    expect(mock.calls.length).toBe(0); // LLM never touched

    const review = await prisma.safetyReview.findFirst({
      where: { message: { conversationId: body.conversationId } },
    });
    expect(review!.escalated).toBe(true);
    // Policy v2.0-draft §9.3: the emergency path now records ESCALATE
    // (was BLOCK). The `escalated` boolean is kept for backward compat.
    expect(review!.verdict).toBe('ESCALATE');
    expect(body.safetyVerdict).toBe('ESCALATE');
  });

  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('validates the payload', async () => {
    const token = await registerAndToken(app, 'chat3@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat',
      headers: { authorization: `Bearer ${token}` },
      payload: { message: '' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('examMode skips emergency escalation but keeps the rest of the gate (eval-only)', async () => {
    const user = await prisma.user.create({
      data: { email: 'exam@example.com', name: 'Exam', passwordHash: 'x', role: 'VIEWER' },
    });
    // Default production behavior: emergency phrase escalates, LLM never touched.
    const def = await runChat(user.id, 'المريض توقف عن التنفس', undefined, {
      llm: mock,
      embedProvider: fake,
    });
    expect(def.escalated).toBe(true);
    expect(def.agentUsed).toBe('safety');

    // Eval exam mode: the same phrase is analyzed by an agent instead.
    const exam = await runChat(user.id, 'المريض توقف عن التنفس', undefined, {
      llm: mock,
      embedProvider: fake,
      examMode: true,
    });
    expect(exam.escalated).toBe(false);
    expect(exam.agentUsed).not.toBe('safety');
    expect(exam.disclaimer.length).toBeGreaterThan(0); // disclaimer stays active
  });
});

describe('conversationTitle (P3 word-boundary)', () => {
  it('backs up to the previous space instead of cutting mid-word', () => {
    // 40-char window ends inside the y-run; must back up to the space at 30.
    const t = conversationTitle('x'.repeat(30) + ' ' + 'y'.repeat(30));
    expect(t).toBe('x'.repeat(30));
  });

  it('falls back to a hard cut for a single long word', () => {
    const t = conversationTitle('a'.repeat(60));
    expect(t).toBe('a'.repeat(40));
  });

  it('keeps short messages intact', () => {
    expect(conversationTitle('مرحبا')).toBe('مرحبا');
  });

  it('handles a real Arabic message without mid-word cuts', () => {
    const t = conversationTitle('اريد مساعدتكم في حاله تحتاج تخدير موضعي للعملية');
    expect(t.length).toBeLessThanOrEqual(40);
    // The cut must land on a word boundary (next char in source is space/end).
    const src = 'اريد مساعدتكم في حاله تحتاج تخدير موضعي للعملية';
    expect([' ', undefined]).toContain(src[t.length]);
  });
});
