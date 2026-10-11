/**
 * MockProvider — scripted LLM for tests and offline verification.
 * Matches the last user message against scripted patterns; falls back
 * to a default response. Records every call (useful to assert that
 * emergency escalations never touch the LLM).
 */
import type { LlmMessage, LlmOptions, LlmProvider, LlmResponse } from './types.js';

export interface MockScript {
  /** If provided, the response is used when the last user message matches. */
  match?: RegExp | string;
  text: string;
}

export class MockProvider implements LlmProvider {
  readonly name = 'mock';
  readonly configured = true;
  readonly calls: LlmMessage[][] = [];
  private readonly scripts: MockScript[];
  private readonly fallback: string;

  constructor(scripts: MockScript[] = [], fallback = 'Mock response.') {
    this.scripts = scripts;
    this.fallback = fallback;
  }

  async complete(messages: LlmMessage[], _opts?: LlmOptions): Promise<LlmResponse> {
    this.calls.push(messages);
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    for (const s of this.scripts) {
      if (!s.match) return { text: s.text, model: 'mock' };
      const hit = typeof s.match === 'string' ? lastUser.includes(s.match) : s.match.test(lastUser);
      if (hit) return { text: s.text, model: 'mock' };
    }
    return { text: this.fallback, model: 'mock' };
  }
}
