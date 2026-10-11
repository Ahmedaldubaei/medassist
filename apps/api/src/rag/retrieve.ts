/**
 * Hybrid retrieval: pgvector cosine search + Postgres full-text search,
 * fused with Reciprocal Rank Fusion (RRF, k=60), returning top-k chunks
 * with document metadata for citation.
 */
import { Prisma } from '@prisma/client';
import { prisma } from '../db.js';
import { getEmbedProvider, type EmbedProvider } from './embeddings.js';
import type { PhaseTimings } from '../agents/context.js';

/** RRF constant (standard value from the RRF paper). */
export const RRF_K = 60;

export interface RetrievalResult {
  chunkId: string;
  documentId: string;
  section: string | null;
  textEn: string | null;
  textAr: string | null;
  title: string;
  source: string;
  guidelineYear: number | null;
  url: string | null;
  license: string;
  specialty: string;
  /** Fused RRF score (higher = better). */
  score: number;
  vectorRank: number | null;
  keywordRank: number | null;
}

/**
 * Pure RRF fusion: each input list is an array of ids ordered best-first.
 * score(id) = sum over lists of 1 / (RRF_K + rank), rank is 1-based.
 */
export function reciprocalRankFusion(rankedLists: string[][], k: number = RRF_K): Map<string, number> {
  const scores = new Map<string, number>();
  for (const list of rankedLists) {
    list.forEach((id, idx) => {
      scores.set(id, (scores.get(id) ?? 0) + 1 / (k + idx + 1));
    });
  }
  return scores;
}

interface RankedRow {
  id: string;
}

function toVectorLiteral(vec: number[]): string {
  return `[${vec.map((v) => Number(v.toFixed(6))).join(',')}]`;
}

export interface SearchOptions {
  k?: number;
  specialty?: string;
  /** Per-list depth before fusion. */
  depth?: number;
}

/**
 * Hybrid search. `provider` is injectable for tests (defaults to configured).
 */
export async function hybridSearch(
  query: string,
  options: SearchOptions = {},
  provider?: EmbedProvider,
  timings?: PhaseTimings,
): Promise<RetrievalResult[]> {
  const q = query.trim();
  if (!q) return [];
  const k = Math.min(Math.max(options.k ?? 8, 1), 20);
  const depth = options.depth ?? 20;
  const embedder = provider ?? (await getEmbedProvider());

  const te0 = Date.now();
  const [qvec] = await embedder.embed([q], 'query');
  if (timings) timings.embedMs += Date.now() - te0;
  const vecLiteral = toVectorLiteral(qvec!);
  const specialtyFilter = options.specialty
    ? Prisma.sql`AND "KnowledgeChunk"."documentId" IN (SELECT id FROM "KnowledgeDocument" WHERE specialty = ${options.specialty})`
    : Prisma.sql``;

  const ts0 = Date.now();
  // 1) Vector search (cosine distance via pgvector).
  const vectorRows = (await prisma.$queryRaw`
    SELECT "KnowledgeChunk".id FROM "KnowledgeChunk"
    WHERE embedding IS NOT NULL ${specialtyFilter}
    ORDER BY embedding <=> ${vecLiteral}::vector
    LIMIT ${depth}
  `) as RankedRow[];

  // 2) Keyword search (full-text over the generated tsvector column).
  const keywordRows = (await prisma.$queryRaw`
    SELECT "KnowledgeChunk".id FROM "KnowledgeChunk"
    WHERE search_vector @@ plainto_tsquery('english', ${q}) ${specialtyFilter}
    ORDER BY ts_rank(search_vector, plainto_tsquery('english', ${q})) DESC
    LIMIT ${depth}
  `) as RankedRow[];

  const vectorIds = vectorRows.map((r) => r.id);
  const keywordIds = keywordRows.map((r) => r.id);
  if (vectorIds.length === 0 && keywordIds.length === 0) return [];

  const fused = reciprocalRankFusion([vectorIds, keywordIds]);
  const vectorRank = new Map(vectorIds.map((id, i) => [id, i + 1] as const));
  const keywordRank = new Map(keywordIds.map((id, i) => [id, i + 1] as const));

  const topIds = [...fused.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, k)
    .map(([id]) => id);

  // 3) Hydrate with chunk text + document metadata for citations.
  const chunks = await prisma.knowledgeChunk.findMany({
    where: { id: { in: topIds } },
    include: { document: true },
  });
  if (timings) timings.searchMs += Date.now() - ts0;
  const byId = new Map(chunks.map((c) => [c.id, c]));

  return topIds
    .map((id) => {
      const c = byId.get(id);
      if (!c) return null;
      return {
        chunkId: c.id,
        documentId: c.documentId,
        section: c.section,
        textEn: c.textEn,
        textAr: c.textAr,
        title: c.document.title,
        source: c.document.source,
        guidelineYear: c.document.guidelineYear,
        url: c.document.url,
        license: c.document.license,
        specialty: c.document.specialty,
        score: fused.get(id) ?? 0,
        vectorRank: vectorRank.get(id) ?? null,
        keywordRank: keywordRank.get(id) ?? null,
      } satisfies RetrievalResult;
    })
    .filter((r): r is RetrievalResult => r !== null);
}
