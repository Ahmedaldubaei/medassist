import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';

vi.mock('../src/agents/pipeline.js', () => ({
  runChat: vi.fn(async () => ({
    answer:
      'هذا رد تجريبي طويل بما يكفي ليتجزأ إلى عدة مقاطع عند البث عبر خادم الأحداث ' +
      'للتأكد من أن التجزئة تعمل بشكل صحيح ومتتابع.',
    citations: [{ n: 1, title: 'Test doc', source: 'test', license: 'test' }],
    confidence: 0.87,
    disclaimer: 'تعليمي فقط',
    agentUsed: 'knowledge',
    safetyVerdict: 'PASS',
    conversationId: 'cl000000000000000000000001',
    escalated: false,
    checks: [],
  })),
}));

import { buildApp } from '../src/index.js';
import { prisma } from '../src/db.js';

describe('POST /api/v1/chat/stream (SSE)', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(async () => {
    await prisma.auditLog.deleteMany();
    await prisma.user.deleteMany();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  async function token(): Promise<string> {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'stream@example.com', name: 'Stream', password: 'secret123' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'stream@example.com', password: 'secret123' },
    });
    return login.json().token as string;
  }

  it('requires authentication', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/stream',
      payload: { message: 'hello' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('streams token events, then meta, then done', async () => {
    const t = await token();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/stream',
      headers: { authorization: `Bearer ${t}` },
      payload: { message: 'ما هو البروبوفول؟' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/event-stream');

    const payload = res.payload;
    const events = payload.split('\n\n').filter(Boolean);
    const types = events.map((e) => e.match(/^event: (\w+)/)?.[1]);
    expect(types[0]).toBe('token');
    expect(types.filter((x) => x === 'token').length).toBeGreaterThan(1);
    expect(types[types.length - 2]).toBe('meta');
    expect(types[types.length - 1]).toBe('done');

    // Token chunks concatenate back to the full answer exactly.
    const streamed = events
      .filter((e) => e.startsWith('event: token'))
      .map((e) => JSON.parse(e.split('\ndata: ')[1]).text)
      .join('');
    expect(streamed).toContain('هذا رد تجريبي طويل');

    const meta = JSON.parse(
      events.find((e) => e.startsWith('event: meta'))!.split('\ndata: ')[1],
    );
    expect(meta.confidence).toBe(0.87);
    expect(meta.safetyVerdict).toBe('PASS');
    expect(meta.citations).toHaveLength(1);
    expect(meta.conversationId).toBe('cl000000000000000000000001');
  });

  it('rejects an empty message with 400', async () => {
    const t = await token();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/chat/stream',
      headers: { authorization: `Bearer ${t}` },
      payload: { message: '' },
    });
    expect(res.statusCode).toBe(400);
  });
});
