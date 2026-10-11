import Fastify from 'fastify';
import rateLimit from '@fastify/rate-limit';
import { config } from './config.js';
import { prisma } from './db.js';
import authPlugin from './plugins/auth.js';
import errorPlugin from './plugins/errors.js';
import { healthRoutes } from './routes/health.js';
import { authRoutes } from './routes/auth.js';
import { ragRoutes } from './routes/rag.js';
import { chatRoutes } from './routes/chat.js';
import { conversationRoutes } from './routes/conversations.js';
import { clinicalRoutes } from './routes/clinical.js';

export function buildApp() {
  const app = Fastify({ logger: config.NODE_ENV !== 'test' });

  app.register(errorPlugin);
  app.register(authPlugin);
  app.register(rateLimit, { global: true, max: 300, timeWindow: '1 minute' });
  app.register(healthRoutes);
  app.register(authRoutes);
  app.register(ragRoutes);
  app.register(chatRoutes);
  app.register(conversationRoutes);
  app.register(clinicalRoutes);

  return app;
}

async function main() {
  const app = buildApp();

  const shutdown = async (signal: string) => {
    app.log.info({ signal }, 'shutting down');
    await app.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`API listening on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  void main();
}
