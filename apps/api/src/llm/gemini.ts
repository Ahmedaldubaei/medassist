/**
 * GeminiProvider — primary LLM path (user instruction 2026-10-11).
 * Google Generative Language OpenAI-compatible chat completions endpoint.
 */
import { config } from '../config.js';
import type { LlmMessage, LlmOptions, LlmProvider, LlmResponse } from './types.js';

const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';

export class GeminiProvider implements LlmProvider {
  readonly name = 'gemini';

  get configured(): boolean {
    return !!config.GEMINI_API_KEY;
  }

  async complete(messages: LlmMessage[], opts: LlmOptions = {}): Promise<LlmResponse> {
    const key = config.GEMINI_API_KEY;
    if (!key) {
      throw new Error('[llm:gemini] GEMINI_API_KEY is not set');
    }
    const model = config.GEMINI_MODEL;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: messages.map((m) => ({ role: m.role, content: m.content })),
        temperature: opts.temperature ?? 0.2,
        max_tokens: opts.maxTokens ?? 1200,
      }),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`[llm:gemini] request failed (${res.status}): ${body.slice(0, 300) || res.statusText}`);
    }
    const data = (await res.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const text = data.choices?.[0]?.message?.content?.trim();
    if (!text) {
      throw new Error('[llm:gemini] empty completion');
    }
    return {
      text,
      model,
      usage: {
        inputTokens: data.usage?.prompt_tokens ?? 0,
        outputTokens: data.usage?.completion_tokens ?? 0,
      },
    };
  }
}
