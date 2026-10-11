import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';

async function errorPlugin(app: FastifyInstance): Promise<void> {
  app.setErrorHandler((error: FastifyError, _request: FastifyRequest, reply: FastifyReply) => {
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: {
          code: 'VALIDATION_ERROR',
          message: 'Invalid request payload',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
    }
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return reply.code(409).send({
        error: { code: 'CONFLICT', message: 'Resource already exists' },
      });
    }
    const status = error.statusCode && error.statusCode >= 400 ? error.statusCode : 500;
    const code = status === 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR';
    const message = status === 500 ? 'Something went wrong' : error.message;
    return reply.code(status).send({ error: { code, message } });
  });

  app.setNotFoundHandler((_request, reply) => {
    return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
  });
}

export default fp(errorPlugin);
