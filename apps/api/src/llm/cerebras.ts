/**
 * CerebrasProvider — fallback LLM path (user instruction 2026-10-11).
 * OpenAI-compatible chat completions endpoint.
 *
 * Expert notes (2026-10-11):
 * - gpt-oss-120b is a reasoning model: every response carries a `reasoning`
 *   field, and reasoning tokens count against max_tokens. With small budgets
 *   the visible `content` can come back empty while `reasoning` holds the
 *   model's actual conclusion — so we fall back to `reasoning` text instead
 *   of throwing, and retry once on transient empties.
 * - CEREBRAS_REASONING_EFFORT (optional, e.g. "low") is forwarded as the
 *   `reasoning_effort` request parameter when set; unset by default.
 */
import { config } from '../config.js';
import type { LlmMessage, LlmOptions, LlmProvider, LlmResponse } from './types.js';

const ENDPOINT = 'https://api.cerebras.ai/v1/chat/completions';
const RETRY_DELAY_MS = 3000;

interface CerebrasChoice {
  message?: { content?: string; reasoning?: string };
  finish_reason?: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CerebrasProvider implements LlmProvider {
  readonly name = 'cerebras';

  get configured(): boolean {
    return !!config.CEREBRAS_API_KEY;
  }

  async complete(messages: LlmMessage[], opts: LlmOptions = {}): Promise<LlmResponse> {
    const key = config.CEREBRAS_API_KEY;
    if (!key) {
      throw new Error('[llm:cerebras] CEREBRAS_API_KEY is not set');
    }
    const model = config.CEREBRAS_MODEL;
    const reasoningEffort = process.env.CEREBRAS_REASONING_EFFORT;
    // One attempt + one retry: empty completions from reasoning models are
    // usually transient (budget starvation), not hard failures.
    let lastError: unknown = null;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        return await this.tryComplete(key, model, messages, opts, reasoningEffort);
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        const retryable = /empty completion|429|5\d\d|timeout|network|fetch failed/i.test(msg);
        if (attempt === 2 || !retryable) throw err;
        await sleep(RETRY_DELAY_MS);
      }
    }
    throw lastError;
  }

  private async tryComplete(
    key: string,
    model: string,
    messages: LlmMessage[],
    opts: LlmOptions,
    reasoningEffort: string | undefined,
  ): Promise<LlmResponse> {
    const body: Record<string, unknown> = {
      model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: opts.temperature ?? 0.2,
      max_tokens: opts.maxTokens ?? 1200,
    };
    if (reasoningEffort) body.reasoning_effort = reasoningEffort;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 60_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`[llm:cerebras] request failed (${res.status}): ${text.slice(0, 300) || res.statusText}`);
    }
    const data = (await res.json()) as {
      choices?: CerebrasChoice[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const message = data.choices?.[0]?.message;
    // Reasoning models may return empty `content` with the conclusion only
    // in `reasoning` (budget starvation). Prefer content; fall back to
    // reasoning text rather than failing the whole ladder.
    const text = message?.content?.trim() || message?.reasoning?.trim() || '';
    if (!text) {
      throw new Error('[llm:cerebras] empty completion');
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
