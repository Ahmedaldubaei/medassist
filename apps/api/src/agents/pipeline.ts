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
  type Citation,
  type SafetyCheck,
  type SafetyVerdict,
} from './safety.js';
import { getLlmProvider, type LlmProvider } from '../llm/index.js';
import type { EmbedProvider } from '../rag/embeddings.js';
import { newPhaseTimings, type PhaseTimings } from './context.js';
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

  let conv = conversationId
    ? await prisma.conversation.findFirst({ where: { id: conversationId, userId } })
    : null;
  if (!conv) {
    conv = await prisma.conversation.create({
      // Deterministic title from the first user message (~40 chars, no LLM call).
      data: { userId, title: message.trim().slice(0, 40) || 'محادثة جديدة' },
    });
  }
  await prisma.message.create({
    data: { conversationId: conv.id, role: 'USER', content: message },
  });

  // 1) PRE-CHECK — deterministic, before any agent or LLM work.
  // In eval exam mode the emergency escalation is skipped (published exam
  // vignettes only); every other check stays active.
  const tp0 = Date.now();
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
      },
    });
    await prisma.safetyReview.create({
      data: {
        messageId: assistantMsg.id,
        checksJson: JSON.parse(JSON.stringify(pre.checks)),
        verdict: 'BLOCK',
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
    return {
      answer: pre.text,
      citations: [],
      confidence: 1,
      disclaimer,
      agentUsed: 'safety',
      safetyVerdict: 'BLOCK',
      conversationId: conv.id,
      escalated: true,
      checks: pre.checks,
    };
  }

  // 2) ROUTE (deterministic)
  const decision = route(message);
  agentsInvolved.push(decision.agentId);

  // 3) AGENT RUN (RAG + LLM)
  const input = { query: message, lang, llm, embedProvider: opts.embedProvider, timings };
  const run =
    decision.agentId === 'anesthesiology'
      ? await runAnesthesiologyAgent(input)
      : decision.agentId === 'knowledge'
        ? await runKnowledgeAgent(input)
        : await runAssistantAgent(input);

  // 4) POST-CHECK — deterministic, after the LLM.
  const tc0 = Date.now();
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
    },
  });
  await prisma.safetyReview.create({
    data: {
      messageId: assistantMsg.id,
      checksJson: JSON.parse(JSON.stringify(post.checks)),
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
