/**
 * Medical Assistant Agent — reception and routing.
 * Handles greetings, help, and scope directly (deterministic);
 * anything medical is redirected to the specialist agents.
 */
import { getAgent } from './registry.js';
import type { AgentRunInput, AgentRunOutput } from './context.js';

const HELP_AR =
  'أنا المساعد الطبي — مرجع معرفي لطبيب واستشاري التخدير.\n\n' +
  'يمكنك سؤالي عن:\n' +
  '• التخدير: التقييم قبل التخدير، مجرى الهواء، الأدوية، المراقبة، الرعاية بعد التخدير\n' +
  '• المعرفة الطبية الموثقة بالمصادر\n\n' +
  'اكتب سؤالك وسأوجهه للوكيل المختص.';

const HELP_EN =
  'I am the Medical Assistant — a knowledge reference for anesthesiologists.\n\n' +
  'You can ask me about:\n' +
  '• Anesthesia: pre-anesthesia evaluation, airway, drugs, monitoring, post-anesthesia care\n' +
  '• Documented medical knowledge with sources\n\n' +
  'Type your question and I will route it to the specialist agent.';

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
            ? `رسالة المستخدم: "${input.query}"\nهذه ليست تحية ولا طلب مساعدة واضح. رد بجملة واحدة توجهه لصياغة سؤال طبي أو تخدير واضح.`
            : `User message: "${input.query}"\nThis is neither a greeting nor a clear help request. Reply with one sentence directing them to phrase a clear medical or anesthesia question.`,
      },
    ],
    { maxTokens: 200, temperature: 0.2 },
  ).then((r) => r.text);
  return { draft, chunks: [], agentId: 'assistant' };
}
