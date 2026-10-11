/**
 * LLM provider abstraction. Mirrors the embeddings.ts pattern:
 * a primary provider (Gemini), an automatic fallback (Cerebras),
 * and a scripted MockProvider for tests.
 *
 * NOTE (2026-10-11): Groq was removed from the default chain permanently
 * per user instruction (repeated 429 throttling during P5 evaluation).
 */

export interface LlmMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface LlmResponse {
  text: string;
  model: string;
  /** Token usage when the provider reports it (for cost/limit monitoring). */
  usage?: TokenUsage;
}

export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmOptions {
  maxTokens?: number;
  temperature?: number;
  /** Per-request timeout in ms. */
  timeoutMs?: number;
}

export interface LlmProvider {
  readonly name: string;
  /** False when the provider has no API key configured (chain will skip it). */
  readonly configured: boolean;
  complete(messages: LlmMessage[], opts?: LlmOptions): Promise<LlmResponse>;
}

/** Thrown when the provider chain has no configured provider to serve a call. */
export class LlmNotConfiguredError extends Error {
  constructor() {
    super(
      '[llm] No LLM provider is configured. Set GEMINI_API_KEY (primary) ' +
        'and/or CEREBRAS_API_KEY (fallback) in the environment.',
    );
    this.name = 'LlmNotConfiguredError';
  }
}
