import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { randomBytes, randomUUID } from 'node:crypto';
import { prisma } from '../db.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';
import { verifyGoogleIdToken } from '../lib/google.js';
import { sendPasswordResetEmail, sendVerifyEmail, sendWelcomeEmail } from '../lib/email.js';

const registerSchema = z.object({
  email: z.string().email(),
  name: z.string().min(1).max(120),
  password: z.string().min(8).max(128),
  // NOTE (P6 security fix): `role` is intentionally NOT accepted here.
  // Self-registration must never grant privileges. First user ever -> ADMIN
  // (bootstrap); everyone else -> USER (least privilege).
  preferredLang: z.enum(['AR', 'EN']).optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

function publicUser(user: {
  id: string;
  email: string;
  name: string;
  role: string;
  preferredLang: string;
  emailVerified: boolean;
  createdAt: Date;
}) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    preferredLang: user.preferredLang,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt.toISOString(),
  };
}

export async function authRoutes(app: FastifyInstance): Promise<void> {
  app.post(
    '/api/v1/auth/register',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = registerSchema.parse(request.body);
      const existing = await prisma.user.findUnique({ where: { email: body.email } });
      if (existing) {
        return reply.code(409).send({ error: { code: 'CONFLICT', message: 'Email already registered' } });
      }
      const passwordHash = await hashPassword(body.password);
      const verifyToken = randomBytes(32).toString('hex');
      const user = await prisma.user.create({
        data: {
          email: body.email,
          name: body.name,
          passwordHash,
          // First user ever becomes ADMIN (bootstrap); everyone else is USER.
          // Role is server-assigned only — never taken from the request body.
          role: (await prisma.user.count()) === 0 ? 'ADMIN' : 'USER',
          preferredLang: body.preferredLang ?? 'AR',
          emailVerified: false,
          verifyToken,
        },
      });
      await prisma.auditLog.create({ data: { userId: user.id, action: 'auth.register' } });
      // Best-effort: registration succeeds even if the email fails to send.
      void sendVerifyEmail(user.email, user.name, verifyToken).catch((err) =>
        app.log.warn({ err: String(err) }, 'verification email failed'),
      );
      return reply.code(201).send({ user: publicUser(user) });
    },
  );

  app.post(
    '/api/v1/auth/login',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = loginSchema.parse(request.body);
      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (!user || !(await verifyPassword(body.password, user.passwordHash))) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid credentials' } });
      }
      const token = signToken({ sub: user.id, role: user.role });
      await prisma.auditLog.create({ data: { userId: user.id, action: 'auth.login' } });
      return reply.send({ token, user: publicUser(user) });
    },
  );

const googleSchema = z.object({
  idToken: z.string().min(1).max(8192),
});

  app.post(
    '/api/v1/auth/google',
    { config: { rateLimit: { max: 20, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = googleSchema.parse(request.body);
      let profile: { email: string; name: string };
      try {
        profile = await verifyGoogleIdToken(body.idToken);
      } catch (err) {
        return reply
          .code(401)
          .send({ error: { code: 'UNAUTHORIZED', message: 'Invalid Google ID token' } });
      }
      let user = await prisma.user.findUnique({ where: { email: profile.email } });
      if (!user) {
        // New Google user: role is always USER (the ADMIN bootstrap applies only
        // to email/password registration). Google emails are pre-verified.
        // passwordHash gets a random unguessable value — this account can never
        // log in via the password route.
        user = await prisma.user.create({
          data: {
            email: profile.email,
            name: profile.name,
            passwordHash: await hashPassword(randomUUID() + randomUUID()),
            role: 'USER',
            preferredLang: 'AR',
            emailVerified: true,
            hasPassword: false, // Google-only account: no usable password
          },
        });
        await prisma.auditLog.create({ data: { userId: user.id, action: 'auth.google.register' } });
        void sendWelcomeEmail(user.email, user.name).catch((err) =>
          app.log.warn({ err: String(err) }, 'welcome email failed'),
        );
      } else {
        // Existing email/password account with the same verified email: link it
        // by logging in — never create a duplicate.
        await prisma.auditLog.create({ data: { userId: user.id, action: 'auth.google.login' } });
      }
      const token = signToken({ sub: user.id, role: user.role });
      return reply.send({ token, user: publicUser(user) });
    },
  );

  app.get(
    '/api/v1/auth/verify-email',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const token = (request.query as { token?: unknown }).token;
      if (typeof token !== 'string' || token.length === 0) {
        return reply.code(400).send({ error: { code: 'BAD_REQUEST', message: 'Missing token' } });
      }
      const user = await prisma.user.findUnique({ where: { verifyToken: token } });
      if (!user) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
      }
      await prisma.user.update({
        where: { id: user.id },
        data: { emailVerified: true, verifyToken: null },
      });
      await prisma.auditLog.create({ data: { userId: user.id, action: 'auth.email.verified' } });
      return reply.send({ ok: true });
    },
  );

  app.get('/api/v1/auth/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user!.sub } });
    if (!user) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'User not found' } });
    }
    return reply.send({ user: publicUser(user) });
  });

  // Forgot password: always 200 for unknown emails (no user enumeration).
  // Google-only accounts (hasPassword=false) get a clear error telling them
  // to sign in with Google instead.
  app.post(
    '/api/v1/auth/forgot-password',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = z.object({ email: z.string().email() }).parse(request.body);
      const user = await prisma.user.findUnique({ where: { email: body.email } });
      if (!user) {
        return reply.send({ ok: true });
      }
      if (!user.hasPassword) {
        return reply.code(400).send({
          error: {
            code: 'GOOGLE_ONLY',
            message: 'هذا الحساب يستخدم الدخول بجوجل — سجّل الدخول بجوجل بدلًا من ذلك',
          },
        });
      }
      const token = randomBytes(32).toString('hex');
      await prisma.user.update({
        where: { id: user.id },
        data: { resetToken: token, resetTokenExpiry: new Date(Date.now() + 60 * 60 * 1000) },
      });
      await prisma.auditLog.create({ data: { userId: user.id, action: 'auth.password.reset.requested' } });
      void sendPasswordResetEmail(user.email, user.name, token).catch((err) =>
        request.log.warn({ err: String(err) }, 'password reset email failed'),
      );
      return reply.send({ ok: true });
    },
  );

  // Reset password: single-use token, 1h expiry.
  app.post(
    '/api/v1/auth/reset-password',
    { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } },
    async (request, reply) => {
      const body = z
        .object({
          token: z.string().min(1),
          newPassword: z.string().min(8, 'Password must be at least 8 characters').max(128),
        })
        .parse(request.body);
      const user = await prisma.user.findUnique({ where: { resetToken: body.token } });
      if (!user || !user.resetTokenExpiry || user.resetTokenExpiry.getTime() < Date.now()) {
        return reply
          .code(400)
          .send({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
      }
      await prisma.user.update({
        where: { id: user.id },
        data: {
          passwordHash: await hashPassword(body.newPassword),
          resetToken: null,
          resetTokenExpiry: null,
          hasPassword: true,
        },
      });
      await prisma.auditLog.create({ data: { userId: user.id, action: 'auth.password.reset.completed' } });
      return reply.send({ ok: true });
    },
  );
}
