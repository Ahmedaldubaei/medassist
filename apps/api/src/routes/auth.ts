import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { hashPassword, verifyPassword } from '../lib/password.js';
import { signToken } from '../lib/jwt.js';

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

function publicUser(user: { id: string; email: string; name: string; role: string; preferredLang: string; createdAt: Date }) {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    preferredLang: user.preferredLang,
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
      const user = await prisma.user.create({
        data: {
          email: body.email,
          name: body.name,
          passwordHash,
          // First user ever becomes ADMIN (bootstrap); everyone else is USER.
          // Role is server-assigned only — never taken from the request body.
          role: (await prisma.user.count()) === 0 ? 'ADMIN' : 'USER',
          preferredLang: body.preferredLang ?? 'AR',
        },
      });
      await prisma.auditLog.create({ data: { userId: user.id, action: 'auth.register' } });
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

  app.get('/api/v1/auth/me', { preHandler: [app.authenticate] }, async (request, reply) => {
    const user = await prisma.user.findUnique({ where: { id: request.user!.sub } });
    if (!user) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'User not found' } });
    }
    return reply.send({ user: publicUser(user) });
  });
}
