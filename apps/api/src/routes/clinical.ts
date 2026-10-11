import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { prisma } from '../db.js';

const keyParam = z.object({ key: z.string().min(1).max(64) });
const drugQuery = z.object({ q: z.string().max(100).optional() });

export async function clinicalRoutes(app: FastifyInstance): Promise<void> {
  // List all checklists (titles only — steps come from the detail route).
  app.get(
    '/api/v1/clinical/checklists',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (_request, reply) => {
      const lists = await prisma.clinicalChecklist.findMany({
        orderBy: { key: 'asc' },
        select: { key: true, titleAr: true, titleEn: true, category: true, updatedAt: true },
      });
      return reply.send({ checklists: lists });
    },
  );

  // Full checklist with cited steps.
  app.get(
    '/api/v1/clinical/checklists/:key',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const params = keyParam.parse(request.params);
      const item = await prisma.clinicalChecklist.findUnique({ where: { key: params.key } });
      if (!item) {
        return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'Checklist not found' } });
      }
      return reply.send({
        key: item.key,
        titleAr: item.titleAr,
        titleEn: item.titleEn,
        category: item.category,
        steps: item.stepsJson,
        updatedAt: item.updatedAt.toISOString(),
      });
    },
  );

  // Drug quick-reference search (ILIKE on both names).
  app.get(
    '/api/v1/clinical/drugs',
    {
      preHandler: [app.authenticate],
      config: { rateLimit: { max: 60, timeWindow: '1 minute' } },
    },
    async (request, reply) => {
      const query = drugQuery.parse(request.query);
      const q = (query.q ?? '').trim();
      const drugs = await prisma.drugReference.findMany({
        where: q
          ? {
              OR: [
                { nameEn: { contains: q, mode: 'insensitive' } },
                { nameAr: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {},
        orderBy: { nameEn: 'asc' },
      });
      return reply.send({
        drugs: drugs.map((d) => ({
          nameAr: d.nameAr,
          nameEn: d.nameEn,
          classAr: d.classAr,
          entries: d.entriesJson,
          updatedAt: d.updatedAt.toISOString(),
        })),
      });
    },
  );
}
