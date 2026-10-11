/**
 * Deterministic router (MediGenius safety_router pattern, localized):
 * language detection + emergency detection run on rules FIRST —
 * no LLM is ever consulted for these decisions (fail-closed).
 */
import { AGENT_REGISTRY, type AgentId } from './registry.js';

export type Lang = 'ar' | 'en';

export type EmergencyCategory =
  | 'cardiac_arrest'
  | 'respiratory_arrest'
  | 'severe_bleeding'
  | 'anaphylaxis'
  | 'seizure'
  | 'chest_pain'
  | 'stroke'
  | 'shock'
  | 'unconscious'
  | 'airway_emergency'
  | 'malignant_hyperthermia'
  | 'last_toxicity';

type TopicCategory =
  | 'shock'
  | 'unconscious'
  | 'airway_emergency'
  | 'malignant_hyperthermia'
  | 'last_toxicity';

export interface EmergencyHit {
  category: EmergencyCategory;
  matched: string;
}

/**
 * Arabic orthographic normalization (policy §4.1: spelling variants).
 * Applied to BOTH the message and the keyword lists before matching, so
 * dialectal spellings like "حساسيه" match "حساسية" and vice versa.
 * - أ/إ/آ → ا
 * - ة → ه
 * - ى → ي
 */
export function normalizeArabic(text: string): string {
  return text
    .replace(/[أإآ]/g, 'ا')
    .replace(/ة/g, 'ه')
    .replace(/ى/g, 'ي');
}

/** Normalizes a keyword for comparison (lowercase + Arabic normalization). */
function normKw(kw: string): string {
  return normalizeArabic(kw.toLowerCase());
}

/**
 * Emergency keyword lists (AR + EN), two tiers.
 *
 * Tier 1 (EMERGENCY_KEYWORDS): inherently acute phrasing — always escalate.
 * Tier 2 (TOPIC_EMERGENCY_KEYWORDS): condition names that double as common
 * knowledge topics for an anesthesiologist (MH, shock, airway management,
 * LAST, unconsciousness). These escalate ONLY with an acute marker present,
 * so "dantrolene dose for malignant hyperthermia" still routes to the
 * anesthesiology agent instead of the emergency path.
 *
 * Curated for high recall on true reports: false negatives are unacceptable;
 * false positives are cheap (urgent-care guidance + the user can continue).
 */
const EMERGENCY_KEYWORDS: Record<EmergencyCategory, string[]> = {
  cardiac_arrest: [
    'توقف القلب', 'توقف قلبي', 'توقف النبض', 'النبض متوقف', 'لا يوجد نبض',
    // Yemeni/Gulf dialect variants (policy §4.1, tests E-02)
    'قلبه وقف', 'القلب وقف', 'قلبه توقف', 'توقف قلبه', 'توقف قلب المريض',
    'cardiac arrest', 'heart stopped', 'no pulse', 'pulseless',
  ],
  respiratory_arrest: [
    'توقف عن التنفس', 'توقف التنفس', 'توقف تنفسي', 'لا يتنفس', 'توقف النفس',
    'اختناق', 'يختنق', 'زرقة', 'تنفس احتضاري', 'تنفس متقطع',
    // dialect variants
    'ما يتنفس', 'مب قادر يتنفس', 'مو قادر يتنفس', 'ما يقدر يتنفس',
    'تنفسه وقف', 'انقطع نفسه', 'نفسه انقطع', 'ما فيه نفس',
    'apnea', 'apnoea', 'not breathing',
    "can't breathe", 'cannot breathe', 'respiratory arrest', 'stopped breathing',
    'choking', 'cyanosis', 'agonal breathing', 'gasping',
  ],
  severe_bleeding: [
    'نزيف حاد', 'نزيف شديد', 'نزيف غزير', 'نزيف لا يتوقف', 'فقدان دم',
    // dialect variants
    'نزيف قوي', 'ينزف بقوة', 'ينزف كثير', 'دم كثير', 'نزف قوي',
    'severe bleeding', 'heavy bleeding', 'hemorrhage', 'bleeding heavily',
    'uncontrolled bleeding', 'massive bleeding', 'losing blood',
  ],
  anaphylaxis: [
    'حساسية مفرطة', 'صدمة تحسسية', 'صدمة الحساسية', 'وذمة وعائية',
    // dialect variants (orthographic normalization maps ة↔ه)
    'حساسيه من البنج', 'حساسية البنج', 'تحسس من البنج', 'صدمه تحسسيه',
    'anaphylaxis', 'anaphylactic shock', 'angioedema',
  ],
  seizure: [
    'نوبة صرع', 'نوبة تشنج', 'تشنجات مستمرة',
    // dialect variants
    'يتشنج', 'قاعد يتشنج', 'تشنج مستمر',
    'seizure', 'convulsion', 'status epilepticus',
  ],
  chest_pain: [
    'ألم صدر', 'ألم في الصدر', 'ألم شديد في الصدر', 'ألم صدري شديد', 'وجع الصدر', 'وجع في الصدر',
    // dialect variants
    'صدره يعوره', 'وجع بصدره', 'الم بالصدر',
    'chest pain', 'crushing chest', 'pressure in chest',
  ],
  stroke: [
    'سكتة دماغية', 'جلطة دماغية', 'شلل مفاجئ', 'تدلي الوجه', 'صعوبة مفاجئة في الكلام',
    // dialect variants
    'جلطه', 'انشل', 'وجهه مائل',
    'stroke', 'facial droop', 'sudden weakness', 'slurred speech',
  ],
  shock: [
    // Hypotension reports are acute in anesthesia context (policy §4.1:
    // conservative rules where a miss is high-consequence). Tier 1.
    'ضغطه نازل', 'الضغط نازل', 'ضغط المريض نازل', 'هبوط حاد في الضغط',
    'blood pressure crashing', 'severe hypotension',
  ],
  unconscious: [
    // dialect variants (tier 1: inherently acute phrasing)
    'طاح', 'طاح المريض', 'غمي عليه', 'مغمى عليه',
  ],
  airway_emergency: [
    'cannot intubate', "can't intubate", 'cannot ventilate', "can't ventilate",
    'stridor', 'sats dropping', 'desaturation',
    'صرير', 'نقص الأكسجة',
  ],
  malignant_hyperthermia: [],
  last_toxicity: [],
};

/** Tier 2: topic-like emergency terms — need an acute marker to escalate. */
const TOPIC_EMERGENCY_KEYWORDS: Record<TopicCategory, string[]> = {
  shock: [
    'صدمة', 'في صدمة', 'هبوط الضغط', 'انخفاض ضغط الدم',
    'shock', 'in shock', 'blood pressure crashing', 'hypotension', 'hypotensive',
  ],
  unconscious: [
    'فاقد للوعي', 'فقد الوعي', 'لا يستجيب', 'انهار', 'غيبوبة',
    'unconscious', 'unresponsive', 'not responding', 'collapsed', 'coma',
  ],
  airway_emergency: [
    'انسداد مجرى الهواء', 'انسداد المجرى الهوائي', 'فشل التنبيب', 'فشل التهوية',
    'airway obstruction', 'failed intubation', 'failed ventilation',
  ],
  malignant_hyperthermia: [
    'فرط حرارة خبيث', 'فرط الحرارة الخبيث', 'malignant hyperthermia',
  ],
  last_toxicity: [
    'تسمم بالمخدر الموضعي', 'تسمم المخدر الموضعي',
    'سمية المخدر الموضعي', 'سمية مخدر موضعي',
    'local anesthetic toxicity', 'local anaesthetic toxicity',
  ],
};

/** Marks a message as an acute patient report (vs. a knowledge question). */
const ACUTE_MARKERS = [
  'طارئ', 'طوارئ', 'عاجل', 'الآن', 'المريض', 'مريض', 'اشتباه', 'يحدث',
  'فجأة', 'تدهور', 'يختنق', 'نبض',
  'emergency', 'urgent', 'patient', 'suspected', 'acute', 'now',
  'sudden', 'deteriorat', 'crashing', 'map', 'spo2',
];

const ARABIC_RE = /[\u0600-\u06FF]/g;
const LATIN_RE = /[a-zA-Z]/g;

/** Language detection by script ratio (Arabic-first app). */
export function detectLanguage(text: string): Lang {
  const ar = (text.match(ARABIC_RE) ?? []).length;
  const en = (text.match(LATIN_RE) ?? []).length;
  if (ar === 0 && en === 0) return 'ar'; // default to Arabic UI
  return ar >= en ? 'ar' : 'en';
}

/**
 * Educational-question guard (test-plan E-04): an explicit definition /
 * explanation request with NO acute markers is a knowledge question, not an
 * incident report — e.g. "ما هو تعريف توقف القلب؟" must NOT escalate even
 * though it contains a tier-1 keyword. Any acute marker present keeps the
 * conservative escalate behavior.
 */
const EDUCATIONAL_PREFIXES = [
  'ما هو تعريف', 'ما تعريف', 'ما المقصود', 'عرف ', 'اشرح ',
  'what is the definition of', 'define ', 'explain ',
];

function isEducationalQuestion(norm: string): boolean {
  return EDUCATIONAL_PREFIXES.some((p) => norm.includes(normKw(p)));
}

/**
 * Deterministic emergency scan. Two tiers:
 *  - Tier 1: inherently acute phrasing → escalate immediately.
 *  - Tier 2: topic-like terms (MH, shock, airway, LAST, unconscious) →
 *    escalate only when an acute marker shows this is a patient report,
 *    not a knowledge question.
 * Both the message and the keyword lists go through Arabic orthographic
 * normalization (أ/إ/آ→ا، ة→ه، ى→ي) before matching (policy §4.1).
 * Returns the first hit or null.
 */
export function detectEmergency(text: string): EmergencyHit | null {
  const norm = normalizeArabic(text.toLowerCase());
  const acute = ACUTE_MARKERS.some((m) => norm.includes(normKw(m)));
  // E-04: explicit educational question without acute markers → not an incident.
  if (!acute && isEducationalQuestion(norm)) return null;
  for (const [category, keywords] of Object.entries(EMERGENCY_KEYWORDS) as Array<
    [EmergencyCategory, string[]]
  >) {
    for (const kw of keywords) {
      if (kw.length > 0 && norm.includes(normKw(kw))) {
        return { category, matched: kw };
      }
    }
  }
  if (!acute) return null;
  for (const [category, keywords] of Object.entries(TOPIC_EMERGENCY_KEYWORDS) as Array<
    [TopicCategory, string[]]
  >) {
    for (const kw of keywords) {
      if (norm.includes(normKw(kw))) {
        return { category, matched: kw };
      }
    }
  }
  return null;
}

const GREETINGS = [
  'مرحبا', 'مرحباً', 'اهلا', 'أهلا', 'السلام', 'صباح الخير', 'مساء الخير',
  'شكرا', 'شكراً', 'hello', 'hi', 'hey', 'thanks', 'thank you', 'good morning',
  'who are you', 'من أنت', 'ما هذا', 'what is this', 'help', 'مساعدة',
];

function isGreeting(text: string): boolean {
  const low = text.trim().toLowerCase();
  if (low.length > 60) return false;
  return GREETINGS.some((g) => low.includes(g.toLowerCase()));
}

export interface RouteDecision {
  agentId: AgentId;
  lang: Lang;
  emergency: EmergencyHit | null;
  reason: string;
}

/**
 * Deterministic routing order:
 * 1. emergency → flagged (pipeline escalates, agent unused)
 * 2. anesthesiology domain keywords → anesthesiology
 * 3. greeting/small-talk → assistant
 * 4. medical-knowledge signals → knowledge
 * 5. default → assistant (it will redirect to a specialist)
 */
export function route(text: string): RouteDecision {
  const lang = detectLanguage(text);
  const emergency = detectEmergency(text);
  if (emergency) {
    return { agentId: 'assistant', lang, emergency, reason: `emergency:${emergency.category}` };
  }
  const low = text.toLowerCase();
  const anesthesiology = AGENT_REGISTRY.find((a) => a.id === 'anesthesiology')!;
  if (anesthesiology.domains.some((d) => low.includes(d.toLowerCase()))) {
    return { agentId: 'anesthesiology', lang, emergency: null, reason: 'domain:anesthesiology' };
  }
  if (isGreeting(text)) {
    return { agentId: 'assistant', lang, emergency: null, reason: 'greeting' };
  }
  const knowledge = AGENT_REGISTRY.find((a) => a.id === 'knowledge')!;
  const looksMedical =
    knowledge.domains.some((d) => low.includes(d.toLowerCase())) ||
    text.includes('؟') ||
    text.trim().endsWith('?');
  if (looksMedical) {
    return { agentId: 'knowledge', lang, emergency: null, reason: 'medical-question' };
  }
  return { agentId: 'assistant', lang, emergency: null, reason: 'default' };
}
