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
  'Structure the answer in two labeled sections:\n' +
  '## Documented knowledge — only claims grounded in the provided sources, each cited [n].\n' +
  '## Model inference — clearly labeled reasoning that goes beyond the sources; ' +
  'must not contradict them and must not state doses.';

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
        ? 'أنت المساعد الطبي في تطبيق معرفي للأطباء. أجب باحترافية وإيجاز بالعربية. ' +
          'للتحيات والمساعدة ونطاق التطبيق أجب مباشرة. ' +
          'للأسئلة الطبية: وضّح أنك ستحوّل السؤال للوكيل المختص. لا تقدم معلومات طبية من ذاكرتك.'
        : 'You are the Medical Assistant of a knowledge app for physicians. Reply professionally and concisely in English. ' +
          'Handle greetings, help, and scope questions directly. ' +
          'For medical questions, explain you will route to the specialist agent. Never answer medicine from memory.',
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
      // AR
      'تخدير', 'مخدر', 'التخدير', 'قبل التخدير', 'قبل العملية', 'مجرى الهواء', 'المجرى الهوائي',
      'تنبيب', 'التنبيب', 'مالامباتي', 'تصنيف asa', 'تهدئة', 'تخدير عام', 'تخدير ناحي', 'تخدير نصفي',
      'فوق الجافية', 'إحصار', 'إفاقة', 'فرط الحرارة الخبيث', 'دانترولين', 'حساسية مفرطة',
      'تشنج الحنجرة', 'مراقبة التخدير', 'بعد التخدير',
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
