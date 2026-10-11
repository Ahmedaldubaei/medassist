import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../src/db.js';
import { runChat } from '../src/agents/pipeline.js';
import { MockProvider } from '../src/llm/index.js';
import {
  truncateHistory,
  HISTORY_MAX_CHARS,
  type HistoryTurn,
} from '../src/agents/context.js';

/**
 * Conversation history (audit C1) + Conversation.updatedAt touch (audit H4).
 *
 * Uses benign chit-chat messages that route to the assistant agent's LLM
 * path (no greeting/help keywords, no medical terms, no emergency terms),
 * so MockProvider.calls captures exactly what the agents sent.
 */

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
    data: { email, name: 'History Tester', passwordHash: 'x', role: 'USER' },
  });
}

// Messages chosen to hit the assistant agent's conversational LLM path:
// not greetings, not help requests, not medical, not emergencies.
const T1 = 'let us discuss the weather patterns today';
const T2 = 'what did we just discuss';

describe('conversation history (C1)', () => {
  beforeAll(async () => {
    // MockProvider is passed per-call via opts.llm; nothing global to set.
  });

  beforeEach(async () => {
    await cleanDb();
    mock.calls.length = 0;
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('injects prior turns into the assistant LLM input on follow-up', async () => {
    const user = await makeUser('hist1@example.com');
    const r1 = await runChat(user.id, T1, undefined, { llm: mock });
    expect(r1.agentUsed).toBe('assistant');
    expect(r1.escalated).toBe(false);
    const convId = r1.conversationId;

    mock.calls.length = 0;
    const r2 = await runChat(user.id, T2, convId, { llm: mock });
    expect(r2.agentUsed).toBe('assistant');
    expect(mock.calls.length).toBe(1);

    const sent = mock.calls[0];
    // The first turn's raw user message must be present as a history turn…
    const historyUserTurn = sent.find((m) => m.role === 'user' && m.content === T1);
    expect(historyUserTurn).toBeTruthy();
    // …along with the assistant's first reply…
    const historyAssistantTurn = sent.find(
      (m) => m.role === 'assistant' && m.content === 'Mock fallback.',
    );
    expect(historyAssistantTurn).toBeTruthy();
    // …and the current query must still be the last user message.
    const lastUser = [...sent].reverse().find((m) => m.role === 'user');
    expect(lastUser!.content).toContain(T2);
  });

  it('history from conversation A never leaks into conversation B', async () => {
    const user = await makeUser('hist2@example.com');
    const ra = await runChat(user.id, T1, undefined, { llm: mock });

    mock.calls.length = 0;
    const rb = await runChat(user.id, 'i enjoy playing chess on weekends', undefined, {
      llm: mock,
    });
    expect(rb.conversationId).not.toBe(ra.conversationId);

    mock.calls.length = 0;
    await runChat(user.id, 'summarize our chat', rb.conversationId, { llm: mock });
    const sentB = mock.calls[0];
    expect(sentB.some((m) => m.content.includes('weather'))).toBe(false);
    expect(sentB.some((m) => m.content.includes('chess'))).toBe(true);
  });

  it('preCheck sees only the current message: emergency in history does not escalate', async () => {
    const user = await makeUser('hist3@example.com');
    // Seed a conversation whose history *discusses* an emergency as a topic.
    const conv = await prisma.conversation.create({
      data: { userId: user.id, title: 'seeded' },
    });
    await prisma.message.create({
      data: { conversationId: conv.id, role: 'USER', content: 'حدثني عن توقف القلب' },
    });
    await prisma.message.create({
      data: { conversationId: conv.id, role: 'ASSISTANT', content: 'شرح تعليمي سابق' },
    });

    mock.calls.length = 0;
    const r = await runChat(user.id, 'ok tell me more', conv.id, { llm: mock });
    expect(r.escalated).toBe(false);
    expect(r.agentUsed).toBe('assistant');
    expect(mock.calls.length).toBe(1);
    // …but the historical mention is still available as context.
    expect(mock.calls[0].some((m) => m.content.includes('توقف القلب'))).toBe(true);
  });

  it('regenerate: the answered message appears exactly once in the LLM input', async () => {
    const user = await makeUser('hist4@example.com');
    const r1 = await runChat(user.id, T1, undefined, { llm: mock });
    await runChat(user.id, 'and what about tomorrow', r1.conversationId, { llm: mock });

    mock.calls.length = 0;
    const r3 = await runChat(user.id, 'and what about tomorrow', r1.conversationId, {
      llm: mock,
      regenerate: true,
    });
    expect(r3.agentUsed).toBe('assistant');

    const allText = mock.calls[0].map((m) => m.content).join('\n');
    const occurrences = allText.split('and what about tomorrow').length - 1;
    expect(occurrences).toBe(1);
    // Prior turns are still there for context.
    expect(allText).toContain(T1);
  });

  it('touches Conversation.updatedAt on every assistant message (H4)', async () => {
    const user = await makeUser('hist5@example.com');
    const r1 = await runChat(user.id, T1, undefined, { llm: mock });
    const before = (
      await prisma.conversation.findUniqueOrThrow({ where: { id: r1.conversationId } })
    ).updatedAt;

    // Ensure a measurable time gap (SQLite/PG timestamp resolution).
    await new Promise((res) => setTimeout(res, 1100));
    await runChat(user.id, T2, r1.conversationId, { llm: mock });

    const after = (
      await prisma.conversation.findUniqueOrThrow({ where: { id: r1.conversationId } })
    ).updatedAt;
    expect(after.getTime()).toBeGreaterThan(before.getTime());
  });
});

describe('truncateHistory', () => {
  it('drops the oldest turns first to stay within budget', () => {
    const turns: HistoryTurn[] = Array.from({ length: 30 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      content: `turn-${i} ` + 'x'.repeat(500),
    }));
    const out = truncateHistory(turns);
    const total = out.reduce((a, t) => a + t.content.length, 0);
    expect(total).toBeLessThanOrEqual(HISTORY_MAX_CHARS);
    // ~507 chars/turn → ~11 newest turns kept (turns 19..29), oldest first dropped.
    expect(out.length).toBeLessThan(30);
    expect(out[out.length - 1]!.content).toContain('turn-29');
    expect(out[0]!.content).toContain('turn-19');
    // Chronological order preserved.
    const idx = out.map((t) => Number(t.content.match(/turn-(\d+)/)![1]));
    expect([...idx].sort((a, b) => a - b)).toEqual(idx);
  });

  it('cuts a single over-long turn with an ellipsis marker', () => {
    const out = truncateHistory([{ role: 'user', content: 'z'.repeat(HISTORY_MAX_CHARS + 1000) }]);
    expect(out).toHaveLength(1);
    expect(out[0]!.content.length).toBeLessThanOrEqual(HISTORY_MAX_CHARS);
    expect(out[0]!.content.endsWith('…')).toBe(true);
  });

  it('keeps short histories untouched', () => {
    const turns: HistoryTurn[] = [
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
    ];
    expect(truncateHistory(turns)).toEqual(turns);
    expect(truncateHistory([])).toEqual([]);
  });
});
