import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/db.js';

async function cleanDb() {
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
}

describe('forgot/reset password', () => {
  const app = buildApp();

  async function register(email: string) {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, name: 'Reset Test', password: 'oldpassword123' },
    });
  }

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

  it('returns 200 for an unknown email (no user enumeration)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'nobody@example.com' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });
  });

  it('creates a single-use token with ~1h expiry for a password user', async () => {
    await register('reset@example.com');
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'reset@example.com' },
    });
    expect(res.statusCode).toBe(200);
    const user = await prisma.user.findUnique({ where: { email: 'reset@example.com' } });
    expect(user?.resetToken).toBeTruthy();
    const ttl = (user!.resetTokenExpiry!.getTime() - Date.now()) / 1000;
    expect(ttl).toBeGreaterThan(3500);
    expect(ttl).toBeLessThanOrEqual(3600);
  });

  it('resets the password with a valid token and clears it (single-use)', async () => {
    await register('single@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'single@example.com' },
    });
    const token = (await prisma.user.findUnique({ where: { email: 'single@example.com' } }))!
      .resetToken!;

    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, newPassword: 'brandnewpass1' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true });

    // Token cleared — second use fails.
    const again = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, newPassword: 'anotherpass2' },
    });
    expect(again.statusCode).toBe(400);

    // New password works, old one does not.
    const loginNew = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'single@example.com', password: 'brandnewpass1' },
    });
    expect(loginNew.statusCode).toBe(200);
    const loginOld = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'single@example.com', password: 'oldpassword123' },
    });
    expect(loginOld.statusCode).toBe(401);

    const audit = await prisma.auditLog.findFirst({
      where: { action: 'auth.password.reset.completed' },
    });
    expect(audit).not.toBeNull();
  });

  it('rejects an expired token', async () => {
    await register('expired@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'expired@example.com' },
    });
    const user = (await prisma.user.findUnique({ where: { email: 'expired@example.com' } }))!;
    await prisma.user.update({
      where: { id: user.id },
      data: { resetTokenExpiry: new Date(Date.now() - 1000) },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: user.resetToken!, newPassword: 'brandnewpass1' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('rejects an unknown token and a short password', async () => {
    const badToken = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: 'nope', newPassword: 'brandnewpass1' },
    });
    expect(badToken.statusCode).toBe(400);

    await register('short@example.com');
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'short@example.com' },
    });
    const token = (await prisma.user.findUnique({ where: { email: 'short@example.com' } }))!
      .resetToken!;
    const short = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token, newPassword: 'short' },
    });
    expect(short.statusCode).toBe(400);
  });

  it('tells Google-only accounts to sign in with Google', async () => {
    await prisma.user.create({
      data: {
        email: 'googleonly@example.com',
        name: 'Google User',
        passwordHash: 'unusable',
        role: 'USER',
        emailVerified: true,
        hasPassword: false,
      },
    });
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'googleonly@example.com' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe('GOOGLE_ONLY');
  });
});
