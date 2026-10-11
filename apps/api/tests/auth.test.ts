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

describe('auth routes', () => {
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

  it('register -> login -> me works and never leaks passwordHash', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'doc@example.com', name: 'Dr Test', password: 'secret123' },
    });
    expect(reg.statusCode).toBe(201);
    const regBody = reg.json();
    expect(regBody.user.email).toBe('doc@example.com');
    expect(JSON.stringify(regBody)).not.toContain('passwordHash');
    expect(JSON.stringify(regBody)).not.toContain('secret123');

    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'doc@example.com', password: 'secret123' },
    });
    expect(login.statusCode).toBe(200);
    const loginBody = login.json();
    expect(typeof loginBody.token).toBe('string');
    expect(JSON.stringify(loginBody)).not.toContain('passwordHash');

    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${loginBody.token}` },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json().user.email).toBe('doc@example.com');
    expect(JSON.stringify(me.json())).not.toContain('passwordHash');
  });

  it('rejects duplicate registration with 409', async () => {
    const payload = { email: 'dup@example.com', name: 'Dup', password: 'secret123' };
    expect((await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload })).statusCode).toBe(201);
    const again = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });
    expect(again.statusCode).toBe(409);
  });

  it('rejects wrong password with 401', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'a@example.com', name: 'A', password: 'secret123' },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'a@example.com', password: 'wrongpass' },
    });
    expect(login.statusCode).toBe(401);
  });

  it('rejects invalid token on /me with 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { authorization: 'Bearer invalid.token.here' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('rejects missing token on /me with 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
  });

  it('validates payload: bad email and short password get 400', async () => {    const badEmail = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'not-an-email', name: 'X', password: 'secret123' },
    });
    expect(badEmail.statusCode).toBe(400);

    const shortPw = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'x@example.com', name: 'X', password: 'short' },
    });
    expect(shortPw.statusCode).toBe(400);
  });

  it('first registered user becomes ADMIN (bootstrap)', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'first@example.com', name: 'First', password: 'secret123' },
    });
    expect(reg.statusCode).toBe(201);
    expect(reg.json().user.role).toBe('ADMIN');
  });

  it('concurrent first registrations yield at most one ADMIN (P3 TOCTOU fix)', async () => {
    const results = await Promise.all(
      ['race1@example.com', 'race2@example.com', 'race3@example.com'].map((email) =>
        app.inject({
          method: 'POST',
          url: '/api/v1/auth/register',
          payload: { email, name: 'Race', password: 'secret123' },
        }),
      ),
    );
    for (const r of results) expect(r.statusCode).toBe(201);
    const roles = results.map((r) => (r.json() as { user: { role: string } }).user.role);
    expect(roles.filter((r) => r === 'ADMIN').length).toBe(1);
    expect(roles.filter((r) => r === 'USER').length).toBe(2);
  });

  it('ignores client-supplied role: later users always get USER (P6 privilege-escalation fix)', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'bootstrap@example.com', name: 'B', password: 'secret123' },
    });
    for (const [email, bodyRole] of [
      ['attacker@example.com', 'ADMIN'],
      ['plain@example.com', undefined],
    ] as const) {
      const payload: Record<string, unknown> = { email, name: 'X', password: 'secret123' };
      if (bodyRole) payload.role = bodyRole;
      const reg = await app.inject({ method: 'POST', url: '/api/v1/auth/register', payload });
      expect(reg.statusCode).toBe(201);
      expect(reg.json().user.role).toBe('USER');
    }
    // And the escalated token must not pass the ADMIN gate.
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'attacker@example.com', password: 'secret123' },
    });
    const forbidden = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/ingest',
      headers: { authorization: `Bearer ${login.json().token}` },
      payload: { title: 'x', text: 'y'.repeat(200), source: 's', license: 'l' },
    });
    expect(forbidden.statusCode).toBe(403);
  });
});
