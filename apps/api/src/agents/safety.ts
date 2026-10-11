/**
 * Clinical Safety Gate — deterministic, runs BEFORE and AFTER the LLM.
 * The LLM is never trusted with safety decisions (MediGenius
 * safety_router + dosage_grounding pattern, reimplemented in
 * TypeScript with Arabic localization).
 *
 * - preCheck(message): emergency → immediate escalation, no LLM call.
 * - postCheck(draft, chunks): dosage grounding, citation verification,
 *   confidence scoring, mandatory disclaimer.
 */
import type { RetrievalResult } from '../rag/retrieve.js';
import { detectEmergency, type EmergencyHit, type Lang } from './router.js';

export type SafetyVerdict = 'PASS' | 'FLAG' | 'BLOCK';

export interface Citation {
  n: number;
  title: string;
  source: string;
  guidelineYear: number | null;
  url: string | null;
  license: string;
}

export interface SafetyCheck {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface PreCheckResult {
  escalate: boolean;
  emergency: EmergencyHit | null;
  /** Ready-to-send escalation text (already includes guidance). */
  text: string;
  checks: SafetyCheck[];
}

const ESCALATION_AR =
  '🚨 **تنبيه طارئ:** رسالتك تشير إلى حالة طبية طارئة محتملة.\n\n' +
  'هذا التطبيق مساعد معرفي **ولا يمكنه المساعدة في الحالات الطارئة الفورية**.\n\n' +
  '**تصرف الآن:**\n' +
  '1. اتصل برقم الطوارئ المحلي فورًا (الإسعاف).\n' +
  '2. إذا كنت داخل منشأة طبية: فعّل بروتوكول الاستجابة للطوارئ واطلب المساعدة.\n' +
  '3. لا تنتظر ردًا من أي نظام ذكاء اصطناعي في حالة طارئة.\n\n' +
  'بعد استقرار الحالة يمكنك سؤالي عن المفاهيم والإرشادات الطبية.';

const ESCALATION_EN =
  '🚨 **Emergency alert:** your message suggests a possible medical emergency.\n\n' +
  'This app is a knowledge assistant and **cannot help with real-time emergencies**.\n\n' +
  '**Act now:**\n' +
  '1. Call your local emergency number (ambulance) immediately.\n' +
  '2. If inside a medical facility: activate the emergency response protocol and call for help.\n' +
  '3. Do not wait for any AI system during an emergency.\n\n' +
  'Once the situation is stable, you can ask me about medical concepts and guidelines.';

/** Runs on the raw user message, before any agent/LLM work. */
export function preCheck(message: string, lang: Lang): PreCheckResult {
  const emergency = detectEmergency(message);
  if (emergency) {
    return {
      escalate: true,
      emergency,
      text: lang === 'ar' ? ESCALATION_AR : ESCALATION_EN,
      checks: [
        {
          name: 'emergency_detection',
          passed: false,
          detail: `hit:${emergency.category} (keyword "${emergency.matched}")`,
        },
      ],
    };
  }
  return {
    escalate: false,
    emergency: null,
    text: '',
    checks: [{ name: 'emergency_detection', passed: true }],
  };
}

export const DISCLAIMER_AR =
  '⚠️ مساعد معرفي — ليس بديلًا عن طبيب التخدير. تحقق من الإرشادات الحالية واستشر زميلًا قبل أي قرار سريري.';
export const DISCLAIMER_EN =
  '⚠️ Knowledge assistant — not a substitute for an anesthesiologist. Verify against current guidelines and consult a colleague before any clinical decision.';

export function disclaimerFor(lang: Lang): string {
  return lang === 'ar' ? DISCLAIMER_AR : DISCLAIMER_EN;
}

/**
 * Dosage mention: number (optionally a range) + unit, EN or AR.
 * e.g. "2.5 mg/kg", "1-2 mg", "50 mcg", "5 ملغ", "وحدة/كغ".
 * Note: \b is ASCII-only, so the trailing boundary uses a
 * Unicode-aware lookahead instead (works after Arabic script).
 */
const DOSAGE_RE =
  /(\d+(?:\.\d+)?)(?:\s*[-–]\s*(\d+(?:\.\d+)?))?\s*(mg|mcg|µg|μg|g|ml|l|units?|iu|ملغ|مكغ|ميكروغرام|ميكروجرام|غرام|جم|مل|وحدة|وحدات|كغ|كجم|kg)(?![\p{L}\p{N}])/giu;

/** Unit normalization for grounding comparison (EN ↔ AR). */
const UNIT_GROUPS: string[][] = [
  ['mg', 'ملغ'],
  ['mcg', 'µg', 'μg', 'مكغ', 'ميكروغرام', 'ميكروجرام'],
  ['g', 'غرام', 'جم'],
  ['ml', 'مل'],
  ['l'],
  ['unit', 'units', 'iu', 'وحدة', 'وحدات'],
  ['kg', 'كغ', 'كجم'],
];

function unitGroup(unit: string): string[] {
  const u = unit.toLowerCase();
  return UNIT_GROUPS.find((g) => g.includes(u)) ?? [u];
}

export interface DosageMention {
  raw: string;
  numbers: string[];
  unit: string;
  index: number;
}

/** Extracts all dosage mentions from a draft answer. */
export function extractDosages(text: string): DosageMention[] {
  const out: DosageMention[] = [];
  DOSAGE_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DOSAGE_RE.exec(text)) !== null) {
    const numbers = [m[1]!, ...(m[2] ? [m[2]] : [])];
    out.push({ raw: m[0], numbers, unit: m[3]!.toLowerCase(), index: m.index });
  }
  return out;
}

/**
 * A dosage is grounded only if some retrieved chunk contains a dosage
 * mention with the same number AND a unit from the same unit group.
 * (Number and unit must co-occur as a real mention — checking them
 * independently anywhere in the chunk causes false grounding, e.g.
 * "100 percent oxygen" + "2.5 mg" would wrongly ground "100 mg".)
 */
export function isDosageGrounded(d: DosageMention, chunks: RetrievalResult[]): boolean {
  const units = unitGroup(d.unit);
  return chunks.some((c) => {
    const text = `${c.textEn ?? ''} ${c.textAr ?? ''}`;
    return extractDosages(text).some(
      (cd) =>
        cd.numbers.some((n) => d.numbers.includes(n)) &&
        unitGroup(cd.unit).some((u) => units.includes(u)),
    );
  });
}

// Accepts both [n] (prompt format) and 【n†Lx-Ly】/【n】 (what LLMs often emit).
const CITATION_RE = /(?:\[|【)(\d+)(?:\]|(?:†[^】]*)?】)/g;

export interface PostCheckInput {
  draft: string;
  chunks: RetrievalResult[];
  lang: Lang;
}

export interface PostCheckResult {
  verdict: SafetyVerdict;
  /** Sanitized answer text (citations validated, ungrounded doses stripped). */
  text: string;
  citations: Citation[];
  confidence: number;
  checks: SafetyCheck[];
  strippedDosages: string[];
}

/**
 * Splits text into sentences (AR/EN aware) for surgical removal of
 * ungrounded dosage sentences.
 */
function splitSentences(text: string): string[] {
  return text.split(/(?<=[.!?؟。\n])\s+/).filter((s) => s.trim().length > 0);
}

export function postCheck({ draft, chunks, lang }: PostCheckInput): PostCheckResult {
  const checks: SafetyCheck[] = [];
  let text = draft;
  const strippedDosages: string[] = [];
  let verdict: SafetyVerdict = 'PASS';

  // 1) Citation verification: every [n] must map to a retrieved chunk.
  const cited = new Set<number>();
  CITATION_RE.lastIndex = 0;
  let cm: RegExpExecArray | null;
  let fabricated = 0;
  while ((cm = CITATION_RE.exec(draft)) !== null) {
    const n = Number(cm[1]);
    if (n >= 1 && n <= chunks.length) cited.add(n);
    else fabricated++;
  }
  if (fabricated > 0) {
    // Remove fabricated markers rather than showing fake references.
    text = text.replace(/(?:\[|【)(\d+)(?:\]|(?:†[^】]*)?】)/g, (full, n: string) => {
      const idx = Number(n);
      return idx >= 1 && idx <= chunks.length ? full : '';
    });
    verdict = 'FLAG';
    checks.push({
      name: 'citation_verification',
      passed: false,
      detail: `${fabricated} fabricated citation marker(s) removed`,
    });
  } else {
    checks.push({ name: 'citation_verification', passed: true });
  }

  // 2) Dosage grounding (MediGenius dosage_grounding): strip any dosage
  //    sentence whose dose is not supported by the retrieved chunks.
  const dosages = extractDosages(text);
  const ungrounded = dosages.filter((d) => !isDosageGrounded(d, chunks));
  if (ungrounded.length > 0) {
    // Drop every sentence containing at least one ungrounded dosage.
    const sentences = splitSentences(text);
    const kept = sentences.filter((s) => {
      const bad = extractDosages(s).some((d) => !isDosageGrounded(d, chunks));
      if (bad) strippedDosages.push(s.trim().slice(0, 120));
      return !bad;
    });
    text = kept.join(' ');
    verdict = 'FLAG';
    checks.push({
      name: 'dosage_grounding',
      passed: false,
      detail: `${ungrounded.length} ungrounded dosage mention(s) stripped: ${ungrounded.map((u) => u.raw).join(', ')}`,
    });
    if (text.trim().length < 20) {
      // The answer was dose-centric with no grounded content left: block it.
      return {
        verdict: 'BLOCK',
        text:
          lang === 'ar'
            ? 'تم حجب هذه الإجابة: تضمنت جرعات دوائية غير مدعومة بالمصادر الموثقة المسترجعة. أعد صياغة السؤال أو راجع المصدر الأصلي.'
            : 'This answer was blocked: it contained drug doses not supported by the retrieved verified sources. Rephrase the question or consult the original source.',
        citations: [],
        confidence: 0,
        checks: [...checks, { name: 'dose_centric_block', passed: false }],
        strippedDosages,
      };
    }
  } else {
    checks.push({
      name: 'dosage_grounding',
      passed: true,
      detail: dosages.length === 0 ? 'no dosage mentions' : `${dosages.length} dosage(s) grounded`,
    });
  }

  // 3) Build the verified citation list (only chunks actually cited).
  const citations: Citation[] = [...cited]
    .sort((a, b) => a - b)
    .map((n) => {
      const c = chunks[n - 1]!;
      return {
        n,
        title: c.title,
        source: c.source,
        guidelineYear: c.guidelineYear,
        url: c.url,
        license: c.license,
      };
    });

  // 4) Confidence: deterministic, based on retrieval evidence.
  const citedCount = cited.size;
  const avgScore =
    chunks.length > 0 ? chunks.reduce((a, c) => a + c.score, 0) / chunks.length : 0;
  const confidence = Math.min(
    0.95,
    Math.max(0.1, 0.35 + 0.15 * Math.min(citedCount, 3) + Math.min(avgScore * 2, 0.2)),
  );

  return { verdict, text: text.trim(), citations, confidence, checks, strippedDosages };
}
