/**
 * Anesthesiology Agent — specialist reference for the expert user.
 * RAG is mandatory: no retrieved evidence → no medical answer.
 * Expert tone: concise, technical, checklists and criteria, no basics.
 */
import { getAgent } from './registry.js';
import {
  formatChunksForPrompt,
  noEvidenceResponse,
  retrieveChunks,
  type AgentRunInput,
  type AgentRunOutput,
} from './context.js';

export async function runAnesthesiologyAgent(input: AgentRunInput): Promise<AgentRunOutput> {
  const def = getAgent('anesthesiology');
  const chunks = await retrieveChunks(input.query, def, input.embedProvider, input.timings);
  if (chunks.length === 0) {
    return { draft: noEvidenceResponse(input.lang, input.query), chunks, agentId: 'anesthesiology' };
  }
  const { text } = await input.llm.complete(
    [
      { role: 'system', content: def.systemPrompt(input.lang) },
      {
        role: 'user',
        content:
          (input.lang === 'ar'
            ? `سؤال من استشاري تخدير: ${input.query}\n\nالمصادر الموثقة (تخدير):\n${formatChunksForPrompt(chunks)}\n\n`
            : `Question from an anesthesia consultant: ${input.query}\n\nVerified sources (anesthesiology):\n${formatChunksForPrompt(chunks)}\n\n`) +
          (input.lang === 'ar'
            ? 'إذا كان السؤال غامضًا أو نقاشيًا (وليس سؤالًا واقعيًا محددًا): تحدث كزميل سينيور — ' +
              'تفاعل مع ما قاله المستخدم، ناقش الموضوع على مستوى عام/مفاهيمي، واطرح أسئلة متابعة مدروسة. ' +
              'لا تستخدم الأقسام الصارمة هنا، ولا تخترع معلومات واقعية. ' +
              'أما إذا كان سؤالًا واقعيًا محددًا: أجب بتركيز تقني موجز. كل معلومة واقعية تستشهد [n]. ' +
              'الجرعات فقط كما وردت في المصادر حرفيًا.'
            : 'If the question is vague or discussion-like (not a precise factual question): respond as a senior colleague — ' +
              'engage with what the user said, discuss the topic at a general/conceptual level, and ask thoughtful follow-up questions. ' +
              'Do not use the rigid sections here, and do not invent facts. ' +
              'For precise factual questions: answer with concise technical focus. Cite every factual claim [n]. ' +
              'Doses only as stated verbatim in the sources.'),
      },
    ],
    { maxTokens: 1400, temperature: 0.2 },
  );
  return { draft: text, chunks, agentId: 'anesthesiology' };
}
