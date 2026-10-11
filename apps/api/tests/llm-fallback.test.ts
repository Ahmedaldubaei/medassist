/**
 * Tests for the LLM fallback ladder (Gemini -> Cerebras).
 * All providers are stubs — no live calls, no keys needed.
 */
import { describe, expect, it } from 'vitest';
import {
  FallbackLlmProvider,
  isRetryableLlmError,
  LlmNotConfiguredError,
} from '../src/llm/index.js';
import { GeminiProvider } from '../src/llm/gemini.js';
import { CerebrasProvider } from '../src/llm/cerebras.js';
import type { LlmMessage, LlmProvider, LlmResponse } from '../src/llm/index.js';

const msgs: LlmMessage[] = [{ role: 'user', content: 'hello' }];

function stub(
  name: string,
  configured: boolean,
  fn: () => Promise<LlmResponse>,
): LlmProvider & { calls: number } {
  const s = {
    name,
    configured,
    calls: 0,
    async complete(messages: LlmMessage[]): Promise<LlmResponse> {
      s.calls++;
      void messages;
      return fn();
    },
  };
  return s;
}

const ok = (text: string) => async (): Promise<LlmResponse> => ({ text, model: 'stub' });
const fail = (message: string) => async (): Promise<LlmResponse> => {
  throw new Error(message);
};

describe('isRetryableLlmError', () => {
  it('treats 429 as retryable', () => {
    expect(isRetryableLlmError(new Error('[llm:gemini] request failed (429): slow down'))).toBe(true);
  });
  it('treats 5xx as retryable', () => {
    expect(isRetryableLlmError(new Error('[llm:cerebras] request failed (503): boom'))).toBe(true);
    expect(isRetryableLlmError(new Error('[llm:x] request failed (500): boom'))).toBe(true);
  });
  it('treats network errors as retryable', () => {
    expect(isRetryableLlmError(new Error('fetch failed'))).toBe(true);
    expect(isRetryableLlmError(new Error('socket hang up'))).toBe(true);
  });
  it('treats missing-key errors as retryable (skip to next provider)', () => {
    expect(isRetryableLlmError(new Error('[llm:gemini] GEMINI_API_KEY is not set'))).toBe(true);
  });
  it('treats other 4xx as non-retryable', () => {
    expect(isRetryableLlmError(new Error('[llm:gemini] request failed (400): bad request'))).toBe(false);
    expect(isRetryableLlmError(new Error('[llm:gemini] request failed (401): bad key'))).toBe(false);
  });
});

describe('FallbackLlmProvider', () => {
  it('falls over from a 429 on Gemini to Cerebras', async () => {
    const logs: string[] = [];
    const gemini = stub('gemini', true, fail('[llm:gemini] request failed (429): rate limited'));
    const cerebras = stub('cerebras', true, ok('served by cerebras'));
    const chain = new FallbackLlmProvider([gemini, cerebras], (m) => logs.push(m));

    const res = await chain.complete(msgs);

    expect(res.text).toBe('served by cerebras');
    expect(gemini.calls).toBe(1);
    expect(cerebras.calls).toBe(1);
    // Only the provider NAME is logged — never key material.
    expect(logs).toEqual(['[llm] served by cerebras']);
  });

  it('skips providers without a configured key', async () => {
    const gemini = stub('gemini', false, fail('should never be called'));
    const cerebras = stub('cerebras', true, ok('ok'));
    const chain = new FallbackLlmProvider([gemini, cerebras]);

    const res = await chain.complete(msgs);

    expect(res.text).toBe('ok');
    expect(gemini.calls).toBe(0);
    expect(cerebras.calls).toBe(1);
  });

  it('fails fast on non-retryable errors without trying the next provider', async () => {
    const gemini = stub('gemini', true, fail('[llm:gemini] request failed (400): bad request'));
    const cerebras = stub('cerebras', true, ok('ok'));
    const chain = new FallbackLlmProvider([gemini, cerebras]);

    await expect(chain.complete(msgs)).rejects.toThrow('request failed (400)');
    expect(cerebras.calls).toBe(0);
  });

  it('throws a clear aggregate error when every provider fails retryably', async () => {
    const gemini = stub('gemini', true, fail('[llm:gemini] request failed (500): down'));
    const cerebras = stub('cerebras', true, fail('[llm:cerebras] request failed (503): down'));
    const chain = new FallbackLlmProvider([gemini, cerebras]);

    await expect(chain.complete(msgs)).rejects.toThrow(/all providers failed.*gemini -> cerebras/);
  });

  it('throws LlmNotConfiguredError naming the required env vars when nothing is configured', async () => {
    const chain = new FallbackLlmProvider([
      stub('gemini', false, ok('x')),
      stub('cerebras', false, ok('x')),
    ]);

    const err = await chain.complete(msgs).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmNotConfiguredError);
    expect((err as Error).message).toContain('GEMINI_API_KEY');
    expect((err as Error).message).toContain('CEREBRAS_API_KEY');
  });

  it('reports configured=false for real providers when keys are absent (test env)', () => {
    // setup.ts does not set any LLM keys, so both must report unconfigured.
    expect(new GeminiProvider().configured).toBe(false);
    expect(new CerebrasProvider().configured).toBe(false);
    expect(new FallbackLlmProvider([new GeminiProvider(), new CerebrasProvider()]).configured).toBe(
      false,
    );
  });
});
