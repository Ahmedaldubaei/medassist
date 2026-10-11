import type { FastifyInstance } from 'fastify';
import { prisma } from '../db.js';

export async function healthRoutes(app: FastifyInstance): Promise<void> {
  app.get('/health', async (_request, reply) => {
    let db: 'ok' | 'down' = 'down';
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = 'ok';
    } catch {
      db = 'down';
    }
    const status = db === 'ok' ? 200 : 503;
    return reply.code(status).send({ status: db === 'ok' ? 'ok' : 'degraded', db });
  });
}
