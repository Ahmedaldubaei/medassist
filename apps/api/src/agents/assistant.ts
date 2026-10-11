/**
 * Medical Assistant Agent — reception and conversation.
 * Handles greetings, help, and scope directly (deterministic);
 * anything else is discussed conversationally like a knowledgeable
 * colleague — never a one-line deflection. Hard safety rules
 * (no doses, no invented citations) are baked into its system prompt.
 */
import { getAgent } from './registry.js';
import type { AgentRunInput, AgentRunOutput } from './context.js';

const HELP_AR =
  'أنا المساعد الطبي — مرجع معرفي لطبيب واستشاري التخدير.\n\n' +
  'يمكنك سؤالي عن:\n' +
  '• التخدير: التقييم قبل التخدير، مجرى الهواء، الأدوية، المراقبة، الرعاية بعد التخدير\n' +
  '• المعرفة الطبية الموثقة بالمصادر\n\n' +
  'اكتب ما يشغل بالك وسنناقشه معًا — وعندما تحتاج معلومة موثقة بالمصادر سأجلبها لك.';

const HELP_EN =
  'I am the Medical Assistant — a knowledge reference for anesthesiologists.\n\n' +
  'You can ask me about:\n' +
  '• Anesthesia: pre-anesthesia evaluation, airway, drugs, monitoring, post-anesthesia care\n' +
  '• Documented medical knowledge with sources\n\n' +
  'Tell me what is on your mind and we will discuss it — and when you need source-backed facts, I will pull them for you.';

export async function runAssistantAgent(input: AgentRunInput): Promise<AgentRunOutput> {
  const def = getAgent('assistant');
  const text = input.query.trim().toLowerCase();
  const wantsHelp = /مساعدة|help|ماذا|ممكن|what can you|who are you|من أنت/.test(text);
  const draft = wantsHelp ? (input.lang === 'ar' ? HELP_AR : HELP_EN) : await input.llm.complete(
    [
      { role: 'system', content: def.systemPrompt(input.lang) },
      {
        role: 'user',
        content:
          input.lang === 'ar'
            ? `رسالة المستخدم: "${input.query}"\nتحدث معه بشكل طبيعي كزميل مطّلع: تفاعل مع ما قاله، ناقش الموضوع على مستوى عام، واطرح سؤال متابعة مدروسًا. لا توجهه لصياغة سؤال، ولا تستخدم عبارات بيروقراطية. بحد أقصى 250 كلمة تقريبًا.`
            : `User message: "${input.query}"\nConverse naturally as a knowledgeable colleague: engage with what they said, discuss the topic at a general level, and ask a thoughtful follow-up question. Do not ask them to rephrase, and avoid bureaucratic redirects. Roughly 250 words max.`,
      },
    ],
    { maxTokens: 400, temperature: 0.7 },
  ).then((r) => r.text);
  return { draft, chunks: [], agentId: 'assistant' };
}
