/**
 * MedXpertQA evaluation harness (P5, revised).
 *
 * Runs a sampled subset of MedXpertQA (MIT, TsinghuaC3I) multiple-choice
 * questions through the REAL chat pipeline (router → agent → safety gate)
 * and measures accuracy + per-phase latency. No product behavior is changed:
 * - the "Answer: X" instruction is appended by the harness to the user message;
 * - examMode is passed as an explicit ChatOption (eval-only), so published
 *   exam vignettes are analyzed instead of emergency-escalated; dosage
 *   grounding, citation verification, and the disclaimer stay fully active.
 *
 * Usage:
 *   npm run eval:medxpertqa            # full run: 60 anesthesia + 40 general
 *   npm run eval:medxpertqa -- --smoke # 3 questions via MockProvider (no LLM cost)
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { prisma } from '../db.js';
import { runChat } from '../agents/pipeline.js';
import { preCheck } from '../agents/safety.js';
import { detectLanguage } from '../agents/router.js';
import { newPhaseTimings, type PhaseTimings } from '../agents/context.js';
import {
  MockProvider,
  FallbackLlmProvider,
  GeminiProvider,
  CerebrasProvider,
  type LlmProvider,
  type LlmMessage,
  type LlmOptions,
  type LlmResponse,
} from '../llm/index.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const DATA = join(HERE, '../../eval-data/medxpertqa_text_input.jsonl');
const OUTDIR = join(HERE, '../../eval-results');

const SMOKE = process.argv.includes('--smoke');
const N_ANES = SMOKE ? 2 : 60;
const N_GEN = SMOKE ? 1 : 40;
/** Inter-question delay: free tiers (Gemini + Cerebras) are RPM-limited;
 *  pacing keeps us under quota. The ladder falls back automatically on 429,
 *  but pacing avoids burning the fallback on every question. */
const DELAY_MS = SMOKE ? 0 : 4000;

interface McqOption {
  letter: string;
  content: string;
}
interface Mcq {
  id: string;
  question: string;
  options: McqOption[];
  label: string[];
  medical_task: string;
  body_system: string;
}

const STRONG_ANES =
  /anesthesi|intubat|propofol|sevoflurane|isoflurane|desflurane|dantrolene|malignant hyperthermia|neuromuscular block|epidural|spinal anesthesia|laryngoscop|endotracheal|monitored anesthesia|regional anesthesia|muscle relaxant|succinylcholine|rocuronium|vecuronium|supraglottic|difficult airway|mallampati/i;
const WEAK_ANES =
  /\bairway\b|sedation|preoperative|pre-anesthesia|conscious sedation|\bopioid\b|local anesthetic|general anesthesia|\bASA\b/i;

function anesthesiaStrength(q: Mcq): number {
  if (STRONG_ANES.test(q.question)) return 2;
  if (WEAK_ANES.test(q.question)) return 1;
  return 0;
}

const ANSWER_INSTRUCTION =
  '\n\n[Evaluation instruction — follow exactly: after your analysis, end your response ' +
  'with exactly one line in this format:\n' +
  'Answer: X\n' +
  'where X is the single letter of the option you choose (A, B, C, D, E, ...). ' +
  'You MUST write the letter — do not leave it blank. Put absolutely nothing after that line: ' +
  'no citations, no punctuation, no extra text.]';

type ExtractMethod = 'final-line' | 'anywhere' | 'fallback-letter' | 'judge' | 'failed';

/**
 * Deterministic answer-letter extraction, strongest signal first.
 * Returns the letter and which method produced it (for failure analysis).
 */
function extractAnswer(text: string, validLetters: string[]): { letter: string | null; method: ExtractMethod } {
  const valid = new Set(validLetters.map((l) => l.toUpperCase()));
  // 1) The instructed final line, scanned from the end of the text.
  const lines = text.split('\n');
  for (let i = lines.length - 1; i >= 0; i--) {
    const m = /^\s*(?:\*\*)?(?:Answer|الإجابة)\s*:\s*([A-J])(?:\*\*)?\s*[.)]?\s*$/.exec(lines[i]!.trim());
    if (m && valid.has(m[1]!.toUpperCase())) return { letter: m[1]!.toUpperCase(), method: 'final-line' };
  }
  // 2) Last "Answer: X" anywhere in the text.
  const anyRe = /(?:Answer|الإجابة)\s*:\s*([A-J])\b/gi;
  let m: RegExpExecArray | null;
  let last: string | null = null;
  while ((m = anyRe.exec(text)) !== null) {
    if (valid.has(m[1]!.toUpperCase())) last = m[1]!.toUpperCase();
  }
  if (last) return { letter: last, method: 'anywhere' };
  // 3) Fallback: last standalone option letter in the final 600 chars.
  const tail = text.slice(-600);
  const letterRe = /\b([A-J])\b/g;
  let lastL: string | null = null;
  while ((m = letterRe.exec(tail)) !== null) {
    if (valid.has(m[1]!.toUpperCase())) lastL = m[1]!.toUpperCase();
  }
  if (lastL) return { letter: lastL, method: 'fallback-letter' };
  return { letter: null, method: 'failed' };
}

/**
 * Second-pass judge: when the model didn't emit a parseable "Answer: X",
 * ask the ladder which option letter the response actually selected.
 * Lenient single-letter parse; null when the judge doesn't comply.
 * NOTE: maxTokens must be generous — thinking models (gemini-3.8-flash)
 * consume the token budget on reasoning and truncate tiny budgets.
 */
async function judgeExtract(
  answer: string,
  validLetters: string[],
  llm: LlmProvider,
): Promise<string | null> {
  const prompt =
    `Read the following response to a multiple-choice medical question. ` +
    `Which option letter did the responder select as their final answer? ` +
    `Reply with ONLY the single capital letter (one of ${validLetters.join(', ')}). No other text.\n\n---\n` +
    answer.slice(0, 4000);
  try {
    const r = await llm.complete([{ role: 'user', content: prompt }], { maxTokens: 500, temperature: 0 });
    const m = /\b([A-J])\b/.exec(r.text);
    const letter = m?.[1]?.toUpperCase() ?? null;
    return letter && validLetters.map((l) => l.toUpperCase()).includes(letter) ? letter : null;
  } catch {
    return null;
  }
}

/** LLM decorator that accumulates per-call latency into a PhaseTimings object. */
class TimingLlmProvider implements LlmProvider {
  readonly name: string;
  constructor(
    private readonly inner: LlmProvider,
    private readonly timings: PhaseTimings,
    private readonly onResponse?: (res: LlmResponse) => void,
  ) {
    this.name = inner.name;
  }
  get configured(): boolean {
    return this.inner.configured;
  }
  async complete(messages: LlmMessage[], opts?: LlmOptions): Promise<LlmResponse> {
    const t0 = Date.now();
    try {
      const res = await this.inner.complete(messages, opts);
      this.onResponse?.(res);
      return res;
    } finally {
      this.timings.llmMs += Date.now() - t0;
    }
  }
}

/** Per-provider token accounting for the cost section of the report. */
interface ProviderUsage {
  calls: number;
  inputTokens: number;
  outputTokens: number;
}

/** Deterministic PRNG for reproducible sampling. */
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface EvalRecord {
  id: string;
  subset: 'anesthesia' | 'general';
  medicalTask: string;
  label: string;
  extracted: string | null;
  extractMethod: ExtractMethod;
  /** Extraction failed for a reason other than a pipeline error/escalation. */
  extractFailure: boolean;
  correct: boolean | null;
  escalated: boolean;
  /** Would the default (non-exam) pipeline have escalated this vignette? */
  wouldEscalate: boolean;
  servedBy: string;
  agentUsed: string;
  safetyVerdict: string;
  citations: number;
  disclaimerPresent: boolean;
  latencyMs: number;
  timings: PhaseTimings;
  answerTail: string;
  error?: string;
}

async function main() {
  mkdirSync(OUTDIR, { recursive: true });
  const recs: Mcq[] = readFileSync(DATA, 'utf8')
    .split('\n')
    .filter((l) => l.trim().length > 0)
    .map((l) => JSON.parse(l));

  const strong = recs.filter((q) => anesthesiaStrength(q) === 2);
  const weak = recs.filter((q) => anesthesiaStrength(q) === 1);
  const anesSample = [...strong, ...weak].slice(0, N_ANES);
  const anesIds = new Set(anesSample.map((q) => q.id));
  const generalPool = recs.filter((q) => !anesIds.has(q.id));
  const rand = mulberry32(20261011);
  const shuffled = [...generalPool];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  const genSample = shuffled.slice(0, N_GEN);
  const sample: Array<{ q: Mcq; subset: 'anesthesia' | 'general' }> = [
    ...anesSample.map((q) => ({ q, subset: 'anesthesia' as const })),
    ...genSample.map((q) => ({ q, subset: 'general' as const })),
  ];

  console.log(
    `MedXpertQA eval: ${anesSample.length} anesthesia (strong:${Math.min(strong.length, N_ANES)}, weak:${anesSample.length - Math.min(strong.length, N_ANES)}) + ${genSample.length} general = ${sample.length} questions`,
  );
  if (SMOKE) console.log('SMOKE MODE — MockProvider, no live LLM calls.');
  else console.log('EXAM MODE — preCheck emergency escalation skipped for eval vignettes only.');

  const evalUser = await prisma.user.upsert({
    where: { email: 'eval@medassist.local' },
    update: {},
    create: {
      email: 'eval@medassist.local',
      name: 'Eval Harness',
      passwordHash: 'not-a-real-hash',
      role: 'VIEWER',
    },
  });

  const records: EvalRecord[] = [];
  const usage: Record<string, ProviderUsage> = {};
  const recordUsage = (provider: string, res: LlmResponse) => {
    const u = (usage[provider] ??= { calls: 0, inputTokens: 0, outputTokens: 0 });
    u.calls += 1;
    u.inputTokens += res.usage?.inputTokens ?? 0;
    u.outputTokens += res.usage?.outputTokens ?? 0;
  };
  for (const [i, { q, subset }] of sample.entries()) {
    const label = q.label?.[0]?.toUpperCase() ?? '?';
    const validLetters = q.options?.map((o) => o.letter) ?? ['A', 'B', 'C', 'D', 'E'];
    const lang = detectLanguage(q.question);
    const wouldEscalate = preCheck(q.question, lang).escalate;
    const timings = newPhaseTimings();
    let servedBy = SMOKE ? 'mock' : 'unknown';

    let llm: LlmProvider | undefined;
    if (SMOKE) {
      llm = new TimingLlmProvider(
        new MockProvider([], 'Mock analysis of the options. Answer: A'),
        timings,
        (res) => recordUsage('mock', res),
      );
    } else {
      const chain = new FallbackLlmProvider([new GeminiProvider(), new CerebrasProvider()], (msg) => {
        const mm = /served by (\w+)/.exec(msg);
        if (mm) servedBy = mm[1]!;
      });
      llm = new TimingLlmProvider(chain, timings, (res) => recordUsage(servedBy, res));
    }

    const t0 = Date.now();
    let res: Awaited<ReturnType<typeof runChat>> | null = null;
    let attemptError: unknown = null;
    for (let attempt = 0; attempt < 2 && !res; attempt++) {
      try {
        res = await runChat(evalUser.id, q.question + ANSWER_INSTRUCTION, undefined, {
          llm,
          timings,
          examMode: !SMOKE,
        });
      } catch (e) {
        attemptError = e;
        // Back off once on any transient failure (rate limits, empty
        // completions, timeouts), then record the error.
        if (attempt === 0) {
          console.log(`  transient error, backing off 15s... (${String(e).slice(0, 80)})`);
          await sleep(15000);
        }
      }
    }
    const dt = Date.now() - t0;
    if (!res) {
      records.push({
        id: q.id,
        subset,
        medicalTask: q.medical_task,
        label,
        extracted: null,
        extractMethod: 'failed',
        extractFailure: false,
        correct: null,
        escalated: false,
        wouldEscalate,
        servedBy,
        agentUsed: 'error',
        safetyVerdict: 'error',
        citations: 0,
        disclaimerPresent: false,
        latencyMs: dt,
        timings,
        answerTail: '',
        error: String(attemptError).slice(0, 200),
      });
      console.log(`[${i + 1}/${sample.length}] ${q.id} ERROR: ${String(attemptError).slice(0, 120)}`);
    } else {
      let { letter, method } = extractAnswer(res.answer, validLetters);
      // Judge pass: when the model didn't emit a parseable "Answer: X"
      // (or only a weak fallback-letter guess exists), ask the ladder
      // which option the response actually selected.
      if (method === 'failed' || method === 'fallback-letter') {
        const judged = await judgeExtract(res.answer, validLetters, llm);
        if (judged) {
          letter = judged;
          method = 'judge';
        }
      }
      const rec: EvalRecord = {
        id: q.id,
        subset,
        medicalTask: q.medical_task,
        label,
        extracted: letter,
        extractMethod: method,
        extractFailure: letter === null,
        correct: letter ? letter === label : null,
        escalated: res.escalated,
        wouldEscalate,
        servedBy,
        agentUsed: res.agentUsed,
        safetyVerdict: res.safetyVerdict,
        citations: res.citations.length,
        disclaimerPresent: res.disclaimer.trim().length > 0,
        latencyMs: dt,
        timings,
        answerTail: res.answer.slice(-300),
      };
      records.push(rec);
      console.log(
        `[${i + 1}/${sample.length}] ${q.id} (${subset}) label=${label} extracted=${letter}(${method}) ` +
          `correct=${rec.correct} agent=${res.agentUsed} esc=${res.escalated} wouldEsc=${wouldEscalate} by=${servedBy} ${dt}ms`,
      );
    }
    if (DELAY_MS > 0) await sleep(DELAY_MS);
  }

  // Cleanup: remove eval conversations (cascades to messages/reviews/runs).
  const convs = await prisma.conversation.findMany({
    where: { userId: evalUser.id },
    select: { id: true },
  });
  await prisma.conversation.deleteMany({ where: { userId: evalUser.id } });
  console.log(`Cleaned up ${convs.length} eval conversations.`);

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const outPath = join(OUTDIR, `medxpertqa-${stamp}.json`);
  writeFileSync(outPath, JSON.stringify({ records, examMode: !SMOKE, usage }, null, 1));
  console.log(`Results written to ${outPath}`);

  printSummary(records, usage);
  await prisma.$disconnect();
}

export function printSummary(records: EvalRecord[], usage?: Record<string, ProviderUsage>): void {
  const scored = records.filter((r) => r.correct !== null && !r.error);
  const anes = scored.filter((r) => r.subset === 'anesthesia');
  const gen = scored.filter((r) => r.subset === 'general');
  const acc = (rs: EvalRecord[]) =>
    rs.length ? ((rs.filter((r) => r.correct).length / rs.length) * 100).toFixed(1) : 'n/a';
  const lat = scored.map((r) => r.latencyMs).sort((a, b) => a - b);
  const pct = (p: number) => (lat.length ? lat[Math.min(lat.length - 1, Math.floor(lat.length * p))] : 0);
  const avg = lat.length ? Math.round(lat.reduce((a, b) => a + b, 0) / lat.length) : 0;
  const phaseAvg = (k: keyof PhaseTimings) =>
    scored.length ? Math.round(scored.reduce((a, r) => a + r.timings[k], 0) / scored.length) : 0;
  const byProvider = scored.reduce<Record<string, number>>((m, r) => {
    m[r.servedBy] = (m[r.servedBy] ?? 0) + 1;
    return m;
  }, {});
  console.log(`\nAccuracy — anesthesia: ${acc(anes)} (${anes.length} scored), general: ${acc(gen)} (${gen.length} scored)`);
  console.log(`Latency — avg ${avg}ms, p50 ${pct(0.5)}ms, p95 ${pct(0.95)}ms (n=${lat.length})`);
  console.log(
    `Phase avg ms — embed ${phaseAvg('embedMs')}, search ${phaseAvg('searchMs')}, rerank ${phaseAvg('rerankMs')}, ` +
      `llm ${phaseAvg('llmMs')}, precheck ${phaseAvg('precheckMs')}, postcheck ${phaseAvg('postcheckMs')}, persist ${phaseAvg('persistMs')}`,
  );
  console.log(`Served by: ${JSON.stringify(byProvider)}`);
  console.log(
    `Escalated: ${records.filter((r) => r.escalated).length}, would-escalate (default mode): ${records.filter((r) => r.wouldEscalate).length}, ` +
      `extract-failures: ${records.filter((r) => r.extractFailure).length}, errors: ${records.filter((r) => r.error).length}`,
  );
  if (usage) {
    for (const [p, u] of Object.entries(usage)) {
      console.log(
        `Tokens [${p}]: ${u.calls} calls, in=${u.inputTokens.toLocaleString()}, out=${u.outputTokens.toLocaleString()}`,
      );
    }
  }
}

main().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
