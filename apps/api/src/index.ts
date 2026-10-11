import Fastify from 'fastify';
import cors from '@fastify/cors';
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
import { getEmbedProvider } from './rag/embeddings.js';

export function buildApp() {
  const app = Fastify({ logger: config.NODE_ENV !== 'test' });

  // CORS must be registered before routes so browser preflights (OPTIONS)
  // from the web app are answered. Without this, every web API call is
  // blocked by the browser and surfaces as a misleading "network" error.
  app.register(cors, {
    // P3: origins come from CORS_ORIGINS env (comma-separated); the default
    // matches the previously hardcoded list.
    origin: config.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean),
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

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
    // Best-effort warmup: the local Xenova embedding model lazy-loads on
    // first query (big cold-start on small instances). Fire-and-forget —
    // a failure here must never affect boot.
    void (async () => {
      try {
        const provider = await getEmbedProvider();
        await provider.embed(['warmup'], 'query');
        app.log.info({ provider: provider.name }, 'embedding provider warmed up');
      } catch (err) {
        app.log.warn({ err: String(err) }, 'embedding warmup failed (non-fatal)');
      }
    })();
  } catch (err) {
    app.log.error(err);
    await prisma.$disconnect();
    process.exit(1);
  }
}

if (process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js')) {
  void main();
}
