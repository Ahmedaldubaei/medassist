/**
 * Declarative agent registry (the `agents.yaml` idea from the
 * Healthcare Agent Orchestrator research: adding a new specialty =
 * a new registry entry, no core changes).
 *
 * Each agent declares: id, names, description, routing domains
 * (keyword lists used by the deterministic router), an optional
 * knowledge filter, and its base system prompt.
 */
import type { Lang } from './router.js';

export type AgentId = 'assistant' | 'anesthesiology' | 'knowledge';

export interface AgentDefinition {
  id: AgentId;
  name: string;
  nameAr: string;
  description: string;
  /** Keywords (EN + AR) the router uses to select this agent. */
  domains: string[];
  /** Optional pgvector knowledge filter (specialty column). */
  knowledgeFilter?: { specialty: string };
  /** Base system prompt. The agent appends retrieved context at runtime. */
  systemPrompt: (lang: Lang) => string;
}

const EXPERT_TONE =
  'The user is an expert (anesthesiologist/consultant). Be concise and technical. ' +
  'Do not explain basics unless asked. Prefer checklists, doses with units, and criteria.';

const CITATION_RULES =
  'Cite every factual claim with [n] referencing the provided sources. ' +
  'Never invent references, guideline names, years, or URLs. ' +
  'If the sources do not contain the answer, say so explicitly instead of guessing.';

const ANSWER_STRUCTURE =
  'For precise factual questions grounded in the provided sources, structure the answer in two labeled sections:\n' +
  '## Documented knowledge — only claims grounded in the provided sources, each cited [n].\n' +
  '## Model inference — clearly labeled reasoning that goes beyond the sources; ' +
  'must not contradict them and must not state doses.';

const CONVERSATIONAL_MODE =
  'Read the user message first: if it is vague, open-ended, or discussion-like, respond conversationally ' +
  '(warm expert colleague tone, ask follow-up questions, no rigid sections). ' +
  'Use the two-section structure ONLY for precise factual answers. ' +
  'Hard rules never change: doses ONLY verbatim from the provided sources (never from memory, never computed); ' +
  'cite every factual claim [n]; if the sources lack the answer, say so honestly AND continue the discussion ' +
  'generally without fabricating; never invent guideline names, years, or URLs.';

const DOSAGE_RULE =
  'State a drug dose ONLY if it appears verbatim in the provided sources. ' +
  'Never compute, adjust, or extrapolate doses.';

export const AGENT_REGISTRY: AgentDefinition[] = [
  {
    id: 'assistant',
    name: 'Medical Assistant',
    nameAr: 'المساعد الطبي',
    description: 'Receives questions, handles greetings/help/scope, and directs medical questions to specialists.',
    domains: [],
    systemPrompt: (lang: Lang) =>
      lang === 'ar'
        ? 'أنت المساعد الطبي في تطبيق معرفي للأطباء — زميل مطّلع يتحدث بطبيعية مثل ChatGPT، بالعربية. ' +
          'للتحيات والمساعدة ونطاق التطبيق أجب مباشرة. ' +
          'للرسائل الطبية أو النقاشية: تحدث بشكل طبيعي — تفاعل مع ما قاله المستخدم، ناقش الموضوع على مستوى عام/مفاهيمي، ' +
          'واطرح أسئلة متابعة مدروسة. لا تحوّل المستخدم بإجراءات بيروقراطية. ' +
          'قواعد صارمة: لا تذكر جرعات أدوية أبدًا، ولا تستشهد بإرشادات أو دراسات أو سنوات محددة من ذاكرتك، ولا تخترع مراجع. ' +
          'إذا طلب المستخدم تفاصيل موثقة (جرعات، بروتوكولات، نصوص إرشادية): قل بشكل طبيعي إنك ستجلب المصادر الموثقة لذلك.'
        : 'You are the Medical Assistant of a knowledge app for physicians — a knowledgeable colleague who talks naturally like ChatGPT, in English. ' +
          'Handle greetings, help, and scope questions directly. ' +
          'For medical or discussion-like messages: converse naturally — engage with what the user said, discuss the topic at a general/conceptual level, ' +
          'and ask thoughtful follow-up questions. Never give bureaucratic redirects. ' +
          'Hard rules: never state drug doses, never cite specific guidelines/studies/years from memory, never invent references. ' +
          'When the user wants documented specifics (doses, protocols, guideline statements): say conversationally that you will pull the verified sources for that.',
  },
  {
    id: 'anesthesiology',
    name: 'Anesthesiology Agent',
    nameAr: 'وكيل التخدير',
    description:
      'Specialist in anesthesia: pre-anesthesia evaluation, airway, anesthetic drugs, monitoring, post-anesthesia care.',
    domains: [
      // EN
      'anesthesia', 'anesthetic', 'anesthesiologist', 'preoperative', 'pre-op', 'preop', 'airway',
      'intubation', 'laryngoscopy', 'mallampati', 'asa', 'sedation', 'general anesthesia',
      'regional anesthesia', 'spinal', 'epidural', 'neuromuscular', 'blockade', 'pacu',
      'malignant hyperthermia', 'dantrolene', 'anaphylaxis', 'laryngospasm', 'bronchospasm',
      'local anesthesia', 'neuraxial', 'peripheral nerve block', 'nerve block',
      'spinal anesthesia', 'epidural anesthesia',
      // AR
      'تخدير', 'مخدر', 'التخدير', 'قبل التخدير', 'قبل العملية', 'مجرى الهواء', 'المجرى الهوائي',
      'تنبيب', 'التنبيب', 'مالامباتي', 'تصنيف asa', 'تهدئة', 'تخدير عام', 'تخدير ناحي', 'تخدير نصفي',
      'فوق الجافية', 'إحصار', 'إفاقة', 'فرط الحرارة الخبيث', 'دانترولين', 'حساسية مفرطة',
      'تشنج الحنجرة', 'مراقبة التخدير', 'بعد التخدير',
      'تخدير موضعي', 'التخدير الموضعي', 'التخدير الناحي', 'حصار العصب', 'الحصار العصبي',
      'التخدير الشوكي', 'التخدير فوق الجافية', 'تخدير شوكي',
    ],
    knowledgeFilter: { specialty: 'ANESTHESIOLOGY' },
    systemPrompt: (lang: Lang) =>
      (lang === 'ar'
        ? 'أنت وكيل التخدير: مرجع معرفي متخصص لطبيب واستشاري التخدير. أجب بالعربية. '
        : 'You are the Anesthesiology Agent: a knowledge reference for anesthesiologists and consultants. Answer in English. ') +
      EXPERT_TONE +
      ' ' +
      CITATION_RULES +
      ' ' +
      DOSAGE_RULE +
      ' ' +
      CONVERSATIONAL_MODE +
      ' ' +
      ANSWER_STRUCTURE,
  },
  {
    id: 'knowledge',
    name: 'Medical Knowledge Agent',
    nameAr: 'وكيل المعرفة الطبية',
    description: 'Searches verified medical sources and answers strictly from retrieved chunks.',
    domains: [
      'guideline', 'treatment', 'diagnosis', 'symptom', 'disease', 'syndrome', 'dose', 'drug',
      'إرشادات', 'علاج', 'تشخيص', 'أعراض', 'مرض', 'متلازمة', 'جرعة', 'دواء',
    ],
    systemPrompt: (lang: Lang) =>
      (lang === 'ar'
        ? 'أنت وكيل المعرفة الطبية. أجب بالعربية **من المقاطع المسترجعة فقط**. '
        : 'You are the Medical Knowledge Agent. Answer in English **strictly from the retrieved chunks**. ') +
      CITATION_RULES +
      ' If the chunks do not contain the answer, say "Not found in the verified sources." ' +
      'and do not speculate. ' +
      ANSWER_STRUCTURE,
  },
];

const byId = new Map<AgentId, AgentDefinition>(AGENT_REGISTRY.map((a) => [a.id, a]));

export function getAgent(id: AgentId): AgentDefinition {
  const def = byId.get(id);
  if (!def) throw new Error(`[registry] unknown agent: ${id}`);
  return def;
}

export function listAgents(): AgentDefinition[] {
  return [...AGENT_REGISTRY];
}
