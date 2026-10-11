/**
 * Shared agent runtime: retrieval + prompt assembly helpers.
 * Every RAG agent goes through retrieveChunks() → rerank() so the
 * safety gate can ground doses and citations against the same chunks.
 */
import { hybridSearch, type RetrievalResult } from '../rag/retrieve.js';
import { rerank } from '../rag/rerank.js';
import type { EmbedProvider } from '../rag/embeddings.js';
import type { LlmProvider } from '../llm/index.js';
import type { AgentDefinition, AgentId } from './registry.js';
import type { Lang } from './router.js';

export interface AgentRunInput {
  query: string;
  lang: Lang;
  llm: LlmProvider;
  embedProvider?: EmbedProvider;
  /** Optional per-phase latency collector (eval harness). Absent = zero overhead. */
  timings?: PhaseTimings;
}

/** Per-phase latency breakdown in milliseconds. All fields start at 0. */
export interface PhaseTimings {
  embedMs: number;
  searchMs: number;
  rerankMs: number;
  llmMs: number;
  precheckMs: number;
  postcheckMs: number;
  persistMs: number;
}

export function newPhaseTimings(): PhaseTimings {
  return {
    embedMs: 0,
    searchMs: 0,
    rerankMs: 0,
    llmMs: 0,
    precheckMs: 0,
    postcheckMs: 0,
    persistMs: 0,
  };
}

export interface AgentRunOutput {
  draft: string;
  chunks: RetrievalResult[];
  agentId: AgentId;
}

const RETRIEVE_DEPTH = 12;
const INJECT_TOP_K = 6;
const CHUNK_SLICE = 1200;

/** Hybrid retrieval + rerank, scoped by the agent's knowledge filter. */
export async function retrieveChunks(
  query: string,
  agent: AgentDefinition,
  embedProvider?: EmbedProvider,
  timings?: PhaseTimings,
): Promise<RetrievalResult[]> {
  const results = await hybridSearch(
    query,
    { k: RETRIEVE_DEPTH, specialty: agent.knowledgeFilter?.specialty },
    embedProvider,
    timings,
  );
  const t0 = Date.now();
  const ranked = await rerank(query, results);
  if (timings) timings.rerankMs += Date.now() - t0;
  return ranked.slice(0, INJECT_TOP_K);
}

/** Numbered source block injected into the prompt; [n] maps to chunks[n-1]. */
export function formatChunksForPrompt(chunks: RetrievalResult[]): string {
  return chunks
    .map((c, i) => {
      const meta = `${c.title} (${c.source}${c.guidelineYear ? `, ${c.guidelineYear}` : ''})`;
      const body = (c.textEn ?? c.textAr ?? '').slice(0, CHUNK_SLICE);
      return `[${i + 1}] ${meta}\n${body}`;
    })
    .join('\n\n');
}

/**
 * Honest gap + conversation continuer (replaces the old dead-end).
 * Never fabricates: states the gap, then keeps the discussion alive
 * with a follow-up question. Optional `query` makes it personal.
 */
export function noEvidenceResponse(lang: Lang, query?: string): string {
  const topic = query ? `«${query.trim().slice(0, 120)}»` : '';
  return lang === 'ar'
    ? `لم أجد معلومات موثقة عن هذا ${topic ? `(${topic}) ` : ''}في مصادري الحالية، ولن أخترع إجابة. ` +
      `لكن يسعدني أن نناقش الموضوع: ما الذي تريد استكشافه تحديدًا — المبادئ العامة، مقارنة بين الخيارات، أم نقطة معينة تشغل بالك؟`
    : `I could not find verified information on this ${topic ? `(${topic}) ` : ''}in my current sources, and I will not invent an answer. ` +
      `But I am happy to discuss the topic: what would you like to explore — the general principles, a comparison of options, or a specific point on your mind?`;
}
