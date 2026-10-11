import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { Role } from '@prisma/client';
import { verifyToken, type TokenPayload } from '../lib/jwt.js';
import { prisma } from '../db.js';

declare module 'fastify' {
  interface FastifyRequest {
    user?: TokenPayload;
  }
  interface FastifyInstance {
    authenticate: (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
    requireRole: (...roles: string[]) => (request: FastifyRequest, reply: FastifyReply) => Promise<void>;
  }
}

async function authPlugin(app: FastifyInstance): Promise<void> {
  app.decorate('authenticate', async (request: FastifyRequest, reply: FastifyReply) => {
    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Missing bearer token' } });
    }
    try {
      const payload = verifyToken(header.slice(7));
      // Defense in depth: reject tokens carrying an unknown role (e.g. forged
      // before a role was removed from the enum). Roles are server-assigned.
      if (!Object.values(Role).includes(payload.role as Role)) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
      }
      // H5 session invalidation: the token's session version must match the
      // user's current tokenVersion. Password resets/changes bump the version,
      // which revokes all previously issued tokens. Deleted users fail here
      // (no row → 401), so their tokens die with the account.
      const user = await prisma.user.findUnique({
        where: { id: payload.sub },
        select: { id: true, tokenVersion: true },
      });
      if (!user) {
        return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'User not found' } });
      }
      if (user.tokenVersion !== payload.tv) {
        return reply
          .code(401)
          .send({ error: { code: 'TOKEN_REVOKED', message: 'Session expired — please sign in again' } });
      }
      request.user = payload;
    } catch {
      return reply.code(401).send({ error: { code: 'UNAUTHORIZED', message: 'Invalid or expired token' } });
    }
  });

  app.decorate('requireRole', (...roles: string[]) => {
    return async (request: FastifyRequest, reply: FastifyReply) => {
      if (!request.user || !roles.includes(request.user.role)) {
        return reply.code(403).send({ error: { code: 'FORBIDDEN', message: 'Insufficient role' } });
      }
    };
  });
}

export default fp(authPlugin);
