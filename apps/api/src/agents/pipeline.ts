/**
 * Chat pipeline — the mandatory path every message takes:
 *   preCheck (deterministic) → router → agent (RAG + LLM) →
 *   postCheck (deterministic) → persist → response.
 *
 * The safety gate cannot be bypassed: there is no code path from
 * user message to answer that skips preCheck/postCheck.
 */
import { prisma } from '../db.js';
import { route, detectLanguage } from './router.js';
import {
  preCheck,
  postCheck,
  disclaimerFor,
  safeFallbackText,
  POLICY_VERSION,
  type Citation,
  type SafetyCheck,
  type SafetyVerdict,
} from './safety.js';
import { getLlmProvider, type LlmProvider } from '../llm/index.js';
import type { EmbedProvider } from '../rag/embeddings.js';
import { newPhaseTimings, truncateHistory, emitPhase, type ChatPhase, type HistoryTurn, type PhaseTimings, type AgentRunOutput } from './context.js';
import { runAssistantAgent } from './assistant.js';
import { runKnowledgeAgent } from './knowledge.js';
import { runAnesthesiologyAgent } from './anesthesiology.js';

export interface ChatOptions {
  llm?: LlmProvider;
  embedProvider?: EmbedProvider;
  /**
   * Eval-only exam mode: skips the preCheck emergency escalation so published
   * exam vignettes (MedXpertQA) can be analyzed. Dosage grounding, citation
   * verification, and the disclaimer stay fully active. NEVER true in
   * production — default false; only the eval harness passes true.
   */
  examMode?: boolean;
  /** Optional per-phase latency collector (eval harness). */
  timings?: PhaseTimings;
  /**
   * Regenerate mode: the conversation already exists and its last user
   * message is already persisted — do NOT create a duplicate USER message.
   * The caller must pass an existing conversationId.
   */
  regenerate?: boolean;
  /**
   * Optional pipeline phase reporter (M4: live `event: status` during SSE).
   * Fire-and-forget — the pipeline wraps every call in try/catch so a
   * failing listener can never break the safety path.
   */
  onPhase?: (phase: ChatPhase) => void;
  /**
   * Called exactly once, right after the conversation is resolved (existing)
   * or created (new chat). Lets the SSE route emit the conversationId in an
   * EARLY status event — the client needs it before `meta` arrives, because
   * a dropped stream must be retryable into the SAME conversation instead of
   * spawning a duplicate (retry-into-null bug). Fire-and-forget like onPhase.
   */
  onConversation?: (conversationId: string) => void;
}

export interface ChatResult {
  answer: string;
  citations: Citation[];
  confidence: number;
  disclaimer: string;
  agentUsed: string;
  safetyVerdict: SafetyVerdict;
  conversationId: string;
  escalated: boolean;
  checks: SafetyCheck[];
}

/**
 * P3: deterministic conversation title (~40 chars) cut at a word boundary
 * instead of mid-word. Falls back to a hard 40-char cut when the first
 * 40 chars contain no space (e.g. a single long word).
 */
export function conversationTitle(message: string): string {
  const text = message.trim().slice(0, 40);
  if (message.trim().length <= 40) return text;
  const lastSpace = text.lastIndexOf(' ');
  return (lastSpace > 0 ? text.slice(0, lastSpace) : text).trimEnd();
}

export async function runChat(
  userId: string,
  message: string,
  conversationId?: string,
  opts: ChatOptions = {},
): Promise<ChatResult> {
  const llm = opts.llm ?? getLlmProvider();
  const lang = detectLanguage(message);
  const disclaimer = disclaimerFor(lang);
  const started = Date.now();
  const agentsInvolved = ['router'];
  const timings = opts.timings ?? newPhaseTimings();
  // M4: phase reporter — exception-safe by construction.
  const phase = (p: ChatPhase): void => {
    try {
      opts.onPhase?.(p);
    } catch {
      /* listener errors are swallowed by design */
    }
  };
  phase('preparing');

  let conv = conversationId
    ? await prisma.conversation.findFirst({ where: { id: conversationId, userId } })
    : null;
  if (!conv) {
    if (opts.regenerate) {
      throw new Error('regenerate requires an existing conversation');
    }
    conv = await prisma.conversation.create({
      // Deterministic title from the first user message (~40 chars, no LLM
      // call). P3: cut at a word boundary instead of mid-word.
      data: { userId, title: conversationTitle(message) || 'محادثة جديدة' },
    });
  }
  // Retry-safety: the conversation id is known NOW (not at the end of the
  // pipeline). Report it immediately so the SSE route can emit it in an
  // early status event — see onConversation docs above.
  try {
    opts.onConversation?.(conv.id);
  } catch {
    /* listener errors are swallowed by design */
  }
  // The message being answered (persisted above, or the pre-existing last
  // user message in regenerate mode). Excluded from history — it is passed
  // separately as `query` so it appears exactly once in agent prompts.
  let queryMessageId: string | null = null;
  if (!opts.regenerate) {
    const created = await prisma.message.create({
      data: { conversationId: conv.id, role: 'USER', content: message },
    });
    queryMessageId = created.id;
  } else {
    // Regenerate answers the existing last user message — it is the query,
    // so it must be excluded from history (it is passed separately below).
    const lastUser = await prisma.message.findFirst({
      where: { conversationId: conv.id, role: 'USER' },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { id: true },
    });
    queryMessageId = lastUser?.id ?? null;
  }

  // 1) PRE-CHECK — deterministic, before any agent or LLM work.
  // In eval exam mode the emergency escalation is skipped (published exam
  // vignettes only); every other check stays active.
  const tp0 = Date.now();
  phase('safety');
  const pre = preCheck(message, lang);
  timings.precheckMs += Date.now() - tp0;
  if (pre.escalate && !opts.examMode) {
    const assistantMsg = await prisma.message.create({
      data: {
        conversationId: conv.id,
        role: 'ASSISTANT',
        content: pre.text,
        agentUsed: 'safety',
        confidence: 1,
        disclaimer,
        verdict: 'ESCALATE',
      },
    });
    await prisma.safetyReview.create({
      data: {
        messageId: assistantMsg.id,
        checksJson: JSON.parse(JSON.stringify({ policyVersion: POLICY_VERSION, checks: pre.checks })),
        verdict: 'ESCALATE',
        escalated: true,
      },
    });
    await prisma.agentRun.create({
      data: {
        conversationId: conv.id,
        routerDecision: 'emergency',
        agentsInvolved: [...agentsInvolved, 'safety'],
        latencyMs: Date.now() - started,
      },
    });
    // H4: an escalation is conversation activity too — keep list order fresh.
    await prisma.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
    return {
      answer: pre.text,
      citations: [],
      confidence: 1,
      disclaimer,
      agentUsed: 'safety',
      safetyVerdict: 'ESCALATE',
      conversationId: conv.id,
      escalated: true,
      checks: pre.checks,
    };
  }

  // 2) ROUTE (deterministic)

  // C1: load prior turns for agent context — AFTER preCheck so the safety
  // gate only ever sees the current message (history can mention emergencies
  // as a discussed topic without triggering escalation).
  // Strictly scoped to this user-verified conversation; the query message
  // itself is excluded (passed separately as `query`).
  const rawHistory = await prisma.message.findMany({
    where: { conversationId: conv.id },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: 21, // up to 10 prior turns + the query message
    select: { id: true, role: true, content: true },
  });
  const history: HistoryTurn[] = truncateHistory(
    rawHistory
      .reverse() // chronological, oldest first
      .filter((m) => m.id !== queryMessageId && (m.role === 'USER' || m.role === 'ASSISTANT'))
      .map((m) => ({ role: m.role === 'USER' ? ('user' as const) : ('assistant' as const), content: m.content })),
  );

  const decision = route(message);
  agentsInvolved.push(decision.agentId);

  // 3) AGENT RUN (RAG + LLM) — with SAFE_FALLBACK (policy §9.3, test G-06):
  //    a provider failure must never surface as a 500 with no guidance,
  //    and must never bypass into an unchecked answer.
  let run: AgentRunOutput;
  try {
    const input = { query: message, lang, llm, embedProvider: opts.embedProvider, timings, history, onPhase: opts.onPhase };
    run =
      decision.agentId === 'anesthesiology'
        ? await runAnesthesiologyAgent(input)
        : decision.agentId === 'knowledge'
          ? await runKnowledgeAgent(input)
          : await runAssistantAgent(input);
  } catch (err) {
    const fallbackChecks: SafetyCheck[] = [
      { name: 'provider_failure', passed: false, detail: String(err).slice(0, 200) },
    ];
    const fallbackText = safeFallbackText(lang);
    try {
      const fallbackMsg = await prisma.message.create({
        data: {
          conversationId: conv.id,
          role: 'ASSISTANT',
          content: fallbackText,
          agentUsed: 'safety',
          confidence: 0,
          disclaimer,
          verdict: 'SAFE_FALLBACK',
        },
      });
      await prisma.safetyReview.create({
        data: {
          messageId: fallbackMsg.id,
          checksJson: JSON.parse(JSON.stringify({ policyVersion: POLICY_VERSION, checks: fallbackChecks })),
          verdict: 'SAFE_FALLBACK',
          escalated: false,
        },
      });
      // H4: keep the conversation list ordered by last activity.
      await prisma.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });
    } catch {
      // Persist is best-effort here; the safe response is still returned.
    }
    await prisma.agentRun.create({
      data: {
        conversationId: conv.id,
        routerDecision: decision.reason,
        agentsInvolved,
        latencyMs: Date.now() - started,
      },
    }).catch(() => undefined);
    return {
      answer: fallbackText,
      citations: [],
      confidence: 0,
      disclaimer,
      agentUsed: 'safety',
      safetyVerdict: 'SAFE_FALLBACK',
      conversationId: conv.id,
      escalated: false,
      checks: fallbackChecks,
    };
  }

  // 4) POST-CHECK — deterministic, after the LLM.
  const tc0 = Date.now();
  phase('verifying');
  const post = postCheck({ draft: run.draft, chunks: run.chunks, lang });
  timings.postcheckMs += Date.now() - tc0;

  // 5) PERSIST
  const ts0 = Date.now();
  const assistantMsg = await prisma.message.create({
    data: {
      conversationId: conv.id,
      role: 'ASSISTANT',
      content: post.text,
      agentUsed: run.agentId,
      citationsJson: JSON.parse(JSON.stringify(post.citations)),
      confidence: post.confidence,
      disclaimer,
      verdict: post.verdict,
    },
  });
  await prisma.safetyReview.create({
    data: {
      messageId: assistantMsg.id,
      checksJson: JSON.parse(JSON.stringify({ policyVersion: POLICY_VERSION, checks: post.checks })),
      verdict: post.verdict,
      escalated: false,
    },
  });
  await prisma.agentRun.create({
    data: {
      conversationId: conv.id,
      routerDecision: decision.reason,
      agentsInvolved,
      latencyMs: Date.now() - started,
    },
  });
  timings.persistMs += Date.now() - ts0;
  // H4: touch updatedAt so the conversation list orders by last activity.
  // (Prisma does not bump @updatedAt on an empty data update, so set it explicitly.)
  await prisma.conversation.update({ where: { id: conv.id }, data: { updatedAt: new Date() } });

  return {
    answer: post.text,
    citations: post.citations,
    confidence: post.confidence,
    disclaimer,
    agentUsed: run.agentId,
    safetyVerdict: post.verdict,
    conversationId: conv.id,
    escalated: false,
    checks: post.checks,
  };
}
