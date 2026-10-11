import { beforeAll, beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/db.js';
import { verifyGoogleIdToken } from '../src/lib/google.js';

vi.mock('../src/lib/google.js', () => ({
  verifyGoogleIdToken: vi.fn(),
}));

const mockVerify = vi.mocked(verifyGoogleIdToken);

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

describe('google sign-in', () => {
  const app = buildApp();

  beforeAll(async () => {
    await app.ready();
  });

  beforeEach(async () => {
    await cleanDb();
    vi.clearAllMocks();
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('creates a USER account on first Google sign-in and returns a JWT', async () => {
    mockVerify.mockResolvedValue({ email: 'gdoc@example.com', name: 'G Doc' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'valid-google-id-token' },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(typeof body.token).toBe('string');
    expect(body.user.email).toBe('gdoc@example.com');
    expect(body.user.name).toBe('G Doc');
    expect(body.user.role).toBe('USER');
    expect(body.user.emailVerified).toBe(true);
    expect(JSON.stringify(body)).not.toContain('passwordHash');

    const dbUser = await prisma.user.findUnique({ where: { email: 'gdoc@example.com' } });
    expect(dbUser).not.toBeNull();
  });

  it('links an existing email/password account instead of creating a duplicate', async () => {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'linked@example.com', name: 'Linked', password: 'secret123' },
    });
    mockVerify.mockResolvedValue({ email: 'linked@example.com', name: 'Google Name' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'valid-google-id-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.email).toBe('linked@example.com');
    expect(await prisma.user.count()).toBe(1);
  });

  it('never grants ADMIN via Google — bootstrap is password-register only', async () => {
    mockVerify.mockResolvedValue({ email: 'first@example.com', name: 'First' });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'valid-google-id-token' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().user.role).toBe('USER');
  });

  it('rejects invalid ID tokens with 401', async () => {
    mockVerify.mockRejectedValue(new Error('bad token'));
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: { idToken: 'bogus' },
    });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHORIZED');
  });

  it('rejects missing idToken with 400', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/google',
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });
});

describe('email verification', () => {
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

  it('register issues a verify token; verify-email marks verified and is single-use', async () => {
    const reg = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email: 'verify@example.com', name: 'Verify Me', password: 'secret123' },
    });
    expect(reg.statusCode).toBe(201);
    expect(reg.json().user.emailVerified).toBe(false);

    const dbUser = await prisma.user.findUnique({ where: { email: 'verify@example.com' } });
    expect(dbUser?.verifyToken).toBeTruthy();

    const ok = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/verify-email?token=${dbUser!.verifyToken}`,
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().ok).toBe(true);

    const verified = await prisma.user.findUnique({ where: { email: 'verify@example.com' } });
    expect(verified?.emailVerified).toBe(true);
    expect(verified?.verifyToken).toBeNull();

    // Single-use: same token again must fail.
    const reuse = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/verify-email?token=${dbUser!.verifyToken}`,
    });
    expect(reuse.statusCode).toBe(400);
  });

  it('rejects invalid or missing tokens with 400', async () => {
    const bad = await app.inject({ method: 'GET', url: '/api/v1/auth/verify-email?token=nope' });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe('INVALID_TOKEN');

    const missing = await app.inject({ method: 'GET', url: '/api/v1/auth/verify-email' });
    expect(missing.statusCode).toBe(400);
  });
});
