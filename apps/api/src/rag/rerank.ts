/**
 * Reranking layer applied to hybridSearch() results before prompt injection.
 *
 * Addresses the P2 observation: cross-lingual vector search confused
 * hyperthermia with hypothermia (ranks 2-3). Two strategies:
 *
 * - 'keyword' (default, deterministic, offline): token-overlap scoring
 *   blended with the fused RRF score, plus a contrast guard that demotes
 *   chunks containing the *opposite* of a contrast pair present in the query
 *   (hyper/hypo-thermia, -tension, -glycemia, tachy/bradycardia).
 * - 'crossencoder' (opt-in via RERANK_PROVIDER): Xenova/ms-marco-MiniLM-L-6-v2
 *   pair scoring. Heavier (second model load); falls back to keyword on error.
 */
import { config } from '../config.js';
import type { RetrievalResult } from './retrieve.js';

/** Contrast pairs: [positive, negative] in EN with AR equivalents. */
const CONTRAST_PAIRS: Array<{ en: [string, string]; ar: [string, string] }> = [
  { en: ['hyperthermia', 'hypothermia'], ar: ['ارتفاع الحرارة', 'انخفاض الحرارة'] },
  { en: ['hypertension', 'hypotension'], ar: ['ارتفاع الضغط', 'انخفاض الضغط'] },
  { en: ['hyperglycemia', 'hypoglycemia'], ar: ['ارتفاع السكر', 'انخفاض السكر'] },
  { en: ['tachycardia', 'bradycardia'], ar: ['تسرع القلب', 'بطء القلب'] },
  { en: ['hyperkalemia', 'hypokalemia'], ar: ['ارتفاع البوتاسيوم', 'انخفاض البوتاسيوم'] },
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length > 2);
}

/**
 * Contrast penalty: if the query mentions the "positive" side of a pair
 * (EN or AR) and the chunk mentions only the negative side, demote it.
 * Returns a 0..1 multiplier.
 */
export function contrastMultiplier(query: string, chunkText: string): number {
  const q = query.toLowerCase();
  const c = chunkText.toLowerCase();
  for (const { en, ar } of CONTRAST_PAIRS) {
    const qPos = q.includes(en[0]) || q.includes(ar[0]);
    const qNeg = q.includes(en[1]) || q.includes(ar[1]);
    if (qPos && !qNeg) {
      // P3: check Arabic chunk text too (was English-only) — symmetric with
      // the query check above.
      const cNeg = c.includes(en[1]) || c.includes(ar[1]);
      const cPos = c.includes(en[0]) || c.includes(ar[0]);
      if (cNeg && !cPos) return 0.25; // chunk is about the opposite condition
    }
  }
  return 1;
}

export interface RerankScores {
  overlap: number;
  multiplier: number;
  final: number;
}

/** Deterministic keyword rerank: token overlap blended with the RRF score. */
export function keywordRerank(query: string, results: RetrievalResult[]): RetrievalResult[] {
  const qTokens = new Set(tokenize(query));
  if (qTokens.size === 0 || results.length === 0) return results;
  const maxScore = Math.max(...results.map((r) => r.score), 1e-9);

  const scored = results.map((r) => {
    const text = `${r.title} ${r.section ?? ''} ${r.textEn ?? ''} ${r.textAr ?? ''}`;
    const cTokens = new Set(tokenize(text));
    let overlap = 0;
    for (const t of qTokens) if (cTokens.has(t)) overlap++;
    const overlapNorm = overlap / qTokens.size;
    const multiplier = contrastMultiplier(query, text);
    const final = (0.7 * overlapNorm + 0.3 * (r.score / maxScore)) * multiplier;
    return { r, final };
  });
  scored.sort((a, b) => b.final - a.final);
  return scored.map((s) => s.r);
}

type CrossEncoder = (query: string, doc: string) => Promise<number>;

let crossEncoder: CrossEncoder | null = null;
let crossEncoderFailed = false;

async function loadCrossEncoder(): Promise<CrossEncoder> {
  if (crossEncoder) return crossEncoder;
  // Lazy import keeps the heavy dependency out of the default path.
  const { AutoTokenizer, AutoModelForSequenceClassification, env } = await import(
    '@huggingface/transformers'
  );
  env.cacheDir =
    process.env.HF_CACHE_DIR ?? '/home/hatch/workspace/medical-ai-assistant/.hf-cache';
  const modelId = 'Xenova/ms-marco-MiniLM-L-6-v2';
  const tokenizer = await AutoTokenizer.from_pretrained(modelId);
  const model = await AutoModelForSequenceClassification.from_pretrained(modelId, {
    dtype: 'int8',
  });
  crossEncoder = async (query: string, doc: string) => {
    const enc = await tokenizer(query, { text_pair: doc, padding: true, truncation: true });
    const out = await model(enc);
    const logits = out.logits.tolist() as number[][];
    return logits[0]?.[0] ?? Number.NEGATIVE_INFINITY;
  };
  return crossEncoder;
}

/**
 * Main entry: reranks hybrid results. Cross-encoder failures fall back
 * to the deterministic keyword reranker (fail-safe, never throws).
 */
export async function rerank(query: string, results: RetrievalResult[]): Promise<RetrievalResult[]> {
  if (results.length <= 1) return results;
  if (config.RERANK_PROVIDER === 'crossencoder' && !crossEncoderFailed) {
    try {
      const ce = await loadCrossEncoder();
      const docs = results.slice(0, 10);
      const scored = await Promise.all(
        docs.map(async (r) => ({
          r,
          s: await ce(query, `${r.title}. ${r.textEn ?? ''} ${r.textAr ?? ''}`.slice(0, 1500)),
        })),
      );
      scored.sort((a, b) => b.s - a.s);
      const rest = results.slice(10);
      return [...scored.map((x) => x.r), ...rest];
    } catch {
      crossEncoderFailed = true; // fall through to keyword
    }
  }
  return keywordRerank(query, results);
}
