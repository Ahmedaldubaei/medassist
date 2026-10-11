/**
 * Shared agent runtime: retrieval + prompt assembly helpers.
 * Every RAG agent goes through retrieveChunks() → rerank() so the
 * safety gate can ground doses and citations against the same chunks.
 */
import { hybridSearch, type RetrievalResult } from '../rag/retrieve.js';
import { rerank } from '../rag/rerank.js';
import type { EmbedProvider } from '../rag/embeddings.js';
import type { LlmMessage, LlmProvider } from '../llm/index.js';
import type { AgentDefinition, AgentId } from './registry.js';
import type { Lang } from './router.js';

/** One prior conversation turn, oldest-first. Excludes the current query. */
export interface HistoryTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AgentRunInput {
  query: string;
  lang: Lang;
  llm: LlmProvider;
  embedProvider?: EmbedProvider;
  /** Optional per-phase latency collector (eval harness). Absent = zero overhead. */
  timings?: PhaseTimings;
  /**
   * Prior conversation turns (oldest first), excluding the current query.
   * Conversation-scoped by the pipeline — never spans conversations.
   */
  history?: HistoryTurn[];
  /**
   * Optional pipeline phase reporter (M4: live status during SSE).
   * Fire-and-forget — implementations must never throw.
   */
  onPhase?: (phase: ChatPhase) => void;
}

/**
 * Pipeline phases reported to the client during streaming (M4).
 * The answer itself still streams only AFTER the safety post-check —
 * these events only make the wait feel alive.
 */
export type ChatPhase = 'preparing' | 'safety' | 'retrieval' | 'generating' | 'verifying';

/** Exception-safe phase emission: a failing listener must never break the pipeline. */
export function emitPhase(input: { onPhase?: (phase: ChatPhase) => void }, phase: ChatPhase): void {
  try {
    input.onPhase?.(phase);
  } catch {
    /* listener errors are swallowed by design */
  }
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
  onPhase?: (phase: ChatPhase) => void,
): Promise<RetrievalResult[]> {
  try {
    onPhase?.('retrieval');
  } catch {
    /* fire-and-forget */
  }
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
 * History budget for agent prompts (~6000 chars ≈ 1500 tokens).
 * Keeps multi-turn discussion affordable on the free tier.
 */
export const HISTORY_MAX_CHARS = 6000;

/**
 * Truncates history from the OLDEST side so total chars stay within budget.
 * A single over-long turn is cut with an ellipsis marker instead of
 * swallowing the whole budget silently.
 */
export function truncateHistory(turns: HistoryTurn[], maxChars = HISTORY_MAX_CHARS): HistoryTurn[] {
  const out: HistoryTurn[] = [];
  let used = 0;
  // Walk newest → oldest so the oldest turns are the first to be dropped.
  for (const t of [...turns].reverse()) {
    if (used + t.content.length <= maxChars) {
      out.unshift(t);
      used += t.content.length;
    } else if (out.length === 0 && t.content.length > maxChars) {
      out.unshift({ role: t.role, content: t.content.slice(0, maxChars - 1) + '…' });
      break;
    } else {
      break; // oldest turns dropped first
    }
  }
  return out;
}

/** History as real chat messages for the conversational (assistant) agent. */
export function historyToMessages(history: HistoryTurn[] | undefined): LlmMessage[] {
  return (history ?? []).map((t) => ({ role: t.role, content: t.content }) as LlmMessage);
}

/**
 * Compact history block for the RAG agents. Context only — the existing
 * hard rules (doses/citations exclusively from retrieved chunks) still apply.
 */
export function formatHistoryForPrompt(
  history: HistoryTurn[] | undefined,
  lang: Lang,
): string {
  if (!history || history.length === 0) return '';
  const lines = history.map((t) =>
    lang === 'ar'
      ? `${t.role === 'user' ? 'المستخدم' : 'المساعد'}: ${t.content}`
      : `${t.role === 'user' ? 'User' : 'Assistant'}: ${t.content}`,
  );
  return (
    lang === 'ar'
      ? 'سجل المحادثة (للسياق فقط — أجب عن الرسالة الأخيرة):\n'
      : 'Conversation history (context only — answer the last message):\n'
  ) + lines.join('\n') + '\n\n';
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
