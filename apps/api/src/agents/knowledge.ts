/**
 * Medical Knowledge Agent — answers STRICTLY from retrieved chunks.
 * No evidence → explicit "not found", never speculation.
 */
import { getAgent } from './registry.js';
import {
  formatChunksForPrompt,
  noEvidenceResponse,
  retrieveChunks,
  type AgentRunInput,
  type AgentRunOutput,
} from './context.js';

export async function runKnowledgeAgent(input: AgentRunInput): Promise<AgentRunOutput> {
  const def = getAgent('knowledge');
  const chunks = await retrieveChunks(input.query, def, input.embedProvider, input.timings);
  if (chunks.length === 0) {
    return { draft: noEvidenceResponse(input.lang), chunks, agentId: 'knowledge' };
  }
  const { text } = await input.llm.complete(
    [
      { role: 'system', content: def.systemPrompt(input.lang) },
      {
        role: 'user',
        content:
          (input.lang === 'ar'
            ? `السؤال: ${input.query}\n\nالمصادر الموثقة:\n${formatChunksForPrompt(chunks)}\n\nأجب من المصادر أعلاه فقط، مع الاستشهاد [n].`
            : `Question: ${input.query}\n\nVerified sources:\n${formatChunksForPrompt(chunks)}\n\nAnswer from the sources above only, citing [n].`),
      },
    ],
    { maxTokens: 1200, temperature: 0.2 },
  );
  return { draft: text, chunks, agentId: 'knowledge' };
}
