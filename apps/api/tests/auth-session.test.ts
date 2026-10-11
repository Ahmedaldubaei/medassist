import { beforeAll, beforeEach, afterAll, describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { buildApp } from '../src/index.js';
import { prisma } from '../src/db.js';
import { config } from '../src/config.js';

async function cleanDb() {
  await prisma.auditLog.deleteMany();
  await prisma.user.deleteMany();
}

describe('session invalidation (H5: tokenVersion)', () => {
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

  async function registerAndLogin(email: string, password = 'secret123'): Promise<{ token: string; userId: string }> {
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/register',
      payload: { email, name: 'Session Test', password },
    });
    const login = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email, password },
    });
    expect(login.statusCode).toBe(200);
    const { token, user } = login.json() as { token: string; user: { id: string } };
    return { token, userId: user.id };
  }

  async function authed(token: string) {
    return app.inject({ method: 'GET', url: '/api/v1/auth/me', headers: { authorization: `Bearer ${token}` } });
  }

  it('accepts a freshly minted token (tv matches)', async () => {
    const { token } = await registerAndLogin('fresh@example.com');
    const res = await authed(token);
    expect(res.statusCode).toBe(200);
  });

  it('rejects the old token after a password reset (tokenVersion bumped)', async () => {
    const { token } = await registerAndLogin('reset@example.com');
    expect((await authed(token)).statusCode).toBe(200);

    // Complete a password reset (bypasses email: use the stored token directly).
    await app.inject({
      method: 'POST',
      url: '/api/v1/auth/forgot-password',
      payload: { email: 'reset@example.com' },
    });
    const user = await prisma.user.findUnique({ where: { email: 'reset@example.com' } });
    const reset = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/reset-password',
      payload: { token: user!.resetToken, newPassword: 'newpassword456' },
    });
    expect(reset.statusCode).toBe(200);

    // Old token is now revoked.
    const stale = await authed(token);
    expect(stale.statusCode).toBe(401);
    expect(stale.json().error.code).toBe('TOKEN_REVOKED');

    // A fresh login issues a working token.
    const relogin = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      payload: { email: 'reset@example.com', password: 'newpassword456' },
    });
    expect(relogin.statusCode).toBe(200);
    const { token: fresh } = relogin.json() as { token: string };
    expect((await authed(fresh)).statusCode).toBe(200);
  });

  it('rejects tokens of a deleted account (user lookup fails)', async () => {
    const { token } = await registerAndLogin('gone@example.com');
    expect((await authed(token)).statusCode).toBe(200);
    const del = await app.inject({
      method: 'DELETE',
      url: '/api/v1/auth/me',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(200);
    // The token's subject no longer exists → 401, not a crash.
    const after = await authed(token);
    expect(after.statusCode).toBe(401);
  });

  it('treats pre-H5 tokens without a tv claim as tv=0 (backward compatible)', async () => {
    const { userId } = await registerAndLogin('legacy@example.com');
    const legacy = jwt.sign({ sub: userId, role: 'USER' }, config.JWT_SECRET, { expiresIn: '7d' });
    const res = await authed(legacy);
    expect(res.statusCode).toBe(200);
  });

  it('rejects a forged tv that does not match the user row', async () => {
    const { userId } = await registerAndLogin('forged@example.com');
    const forged = jwt.sign({ sub: userId, role: 'USER', tv: 999 }, config.JWT_SECRET, { expiresIn: '7d' });
    const res = await authed(forged);
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('TOKEN_REVOKED');
  });
});
