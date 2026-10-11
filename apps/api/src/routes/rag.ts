import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';
import { fetchUrlText, ingestDocument } from '../rag/ingest.js';
import { hybridSearch } from '../rag/retrieve.js';

const ingestUrlSchema = z.object({
  url: z.string().url().max(2000),
  title: z.string().min(1).max(300).optional(),
  source: z.string().min(1).max(200).optional(),
  license: z.string().min(1).max(200),
  guidelineYear: z.number().int().min(1900).max(2100).optional(),
  specialty: z.string().min(1).max(60).optional(),
  lang: z.enum(['en', 'ar']).optional(),
});

const ingestTextSchema = z.object({
  title: z.string().min(1).max(300),
  text: z.string().min(200).max(500_000),
  source: z.string().min(1).max(200),
  license: z.string().min(1).max(200),
  url: z.string().url().max(2000).optional(),
  guidelineYear: z.number().int().min(1900).max(2100).optional(),
  specialty: z.string().min(1).max(60).optional(),
  lang: z.enum(['en', 'ar']).optional(),
});

const searchSchema = z.object({
  query: z.string().min(1).max(500),
  k: z.number().int().min(1).max(20).optional(),
  specialty: z.string().min(1).max(60).optional(),
});

export async function ragRoutes(app: FastifyInstance): Promise<void> {
  // Admin-only ingestion: {url,...} or {title,text,source,license,...}.
  app.post(
    '/api/v1/admin/ingest',
    {
      preHandler: [app.authenticate, app.requireRole('ADMIN')],
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = request.body as Record<string, unknown>;
      let input: {
        title: string;
        text: string;
        source: string;
        license: string;
        url?: string;
        guidelineYear?: number;
        specialty?: string;
        lang?: 'en' | 'ar';
      };
      if (typeof body?.url === 'string' && typeof body?.text !== 'string') {
        const parsed = ingestUrlSchema.parse(body);
        const fetched = await fetchUrlText(parsed.url);
        input = {
          title: parsed.title ?? fetched.title,
          text: fetched.text,
          source: parsed.source ?? new URL(parsed.url).hostname,
          license: parsed.license,
          url: parsed.url,
          guidelineYear: parsed.guidelineYear,
          specialty: parsed.specialty,
          lang: parsed.lang,
        };
      } else {
        const parsed = ingestTextSchema.parse(body);
        input = { ...parsed };
      }

      // Skip exact-URL duplicates.
      if (input.url) {
        const existing = await prisma.knowledgeDocument.findFirst({ where: { url: input.url } });
        if (existing) {
          return reply.code(409).send({
            error: { code: 'CONFLICT', message: 'Document with this URL already ingested', documentId: existing.id },
          });
        }
      }

      const result = await ingestDocument(input);
      await prisma.auditLog.create({
        data: {
          userId: request.user!.sub,
          action: 'knowledge.ingest',
          detailsJson: { documentId: result.documentId, chunks: result.chunks, source: input.source } as object,
        },
      });
      return reply.code(201).send({ document: result });
    },
  );

  // Authenticated hybrid knowledge search.
  app.post(
    '/api/v1/knowledge/search',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const body = searchSchema.parse(request.body);
      const results = await hybridSearch(body.query, { k: body.k, specialty: body.specialty });
      return reply.send({ results });
    },
  );
}
