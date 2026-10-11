/**
 * LLM provider selection.
 *
 * `LLM_PROVIDER` env:
 *   'auto'     -> fallback ladder Gemini -> Cerebras (default)
 *   'gemini'   -> Gemini only
 *   'cerebras' -> Cerebras only
 *   'mock'     -> scripted MockProvider (tests)
 *
 * `__setLlmProvider()` overrides for tests.
 *
 * NOTE (2026-10-11): Groq was removed from the chain permanently per user
 * instruction (repeated 429 throttling during P5 evaluation).
 */
import { config } from '../config.js';
import type { LlmProvider } from './types.js';
import { LlmNotConfiguredError } from './types.js';
import { GeminiProvider } from './gemini.js';
import { CerebrasProvider } from './cerebras.js';
import { FallbackLlmProvider } from './fallback.js';
import { MockProvider } from './mock.js';

export type { LlmMessage, LlmOptions, LlmProvider, LlmResponse } from './types.js';
export { LlmNotConfiguredError } from './types.js';
export { GeminiProvider } from './gemini.js';
export { CerebrasProvider } from './cerebras.js';
export { FallbackLlmProvider, isRetryableLlmError } from './fallback.js';
export { MockProvider } from './mock.js';
export type { MockScript } from './mock.js';

let cached: LlmProvider | null = null;
let warnedNoKey = false;

export function getLlmProvider(): LlmProvider {
  if (!cached) {
    if (config.LLM_PROVIDER === 'mock') {
      cached = new MockProvider();
    } else if (config.LLM_PROVIDER === 'gemini') {
      cached = new GeminiProvider();
    } else if (config.LLM_PROVIDER === 'cerebras') {
      cached = new CerebrasProvider();
    } else {
      cached = new FallbackLlmProvider([new GeminiProvider(), new CerebrasProvider()], (msg) =>
        console.error(msg),
      );
    }
    if (!cached.configured && !warnedNoKey) {
      warnedNoKey = true;
      console.error(
        '[llm] WARNING: no LLM provider is configured. ' +
          'Set GEMINI_API_KEY (primary) and/or CEREBRAS_API_KEY (fallback). ' +
          '/api/v1/chat will return 503 until a key is provided.',
      );
    }
  }
  return cached;
}

/** Test hook: override the cached provider. */
export function __setLlmProvider(provider: LlmProvider | null): void {
  cached = provider;
  warnedNoKey = false;
}
