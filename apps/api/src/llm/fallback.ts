/**
 * FallbackLlmProvider — tries providers in order and fails over on
 * retryable errors: HTTP 429, HTTP 5xx, or network errors. Providers
 * without a configured API key are skipped silently.
 *
 * Only the serving provider's NAME is logged — never any key material.
 */
import type { LlmMessage, LlmOptions, LlmProvider, LlmResponse } from './types.js';
import { LlmNotConfiguredError } from './types.js';

/** Extract an HTTP status code from our providers' "[llm:name] request failed (NNN)" errors. */
function statusFromError(err: unknown): number | null {
  const msg = err instanceof Error ? err.message : String(err);
  const m = msg.match(/request failed \((\d{3})\)/);
  return m ? Number(m[1]) : null;
}

function isNetworkError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return (
    msg.includes('fetch failed') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('econnrefused') ||
    msg.includes('enotfound') ||
    msg.includes('econnreset') ||
    msg.includes('socket hang up') ||
    (err instanceof Error && err.name === 'AbortError')
  );
}

function isMissingKeyError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('is not set');
}

/** Retryable: rate-limited, server-side failure, network failure, or unconfigured key. */
export function isRetryableLlmError(err: unknown): boolean {
  if (isMissingKeyError(err)) return true;
  if (isNetworkError(err)) return true;
  const status = statusFromError(err);
  return status !== null && (status === 429 || (status >= 500 && status <= 599));
}

export class FallbackLlmProvider implements LlmProvider {
  readonly name = 'fallback';
  private readonly chain: LlmProvider[];
  private readonly log: (msg: string) => void;

  constructor(chain: LlmProvider[], log: (msg: string) => void = () => {}) {
    this.chain = chain;
    this.log = log;
  }

  get configured(): boolean {
    return this.chain.some((p) => p.configured);
  }

  async complete(messages: LlmMessage[], opts: LlmOptions = {}): Promise<LlmResponse> {
    const tried: string[] = [];
    let lastError: unknown = null;

    for (const provider of this.chain) {
      if (!provider.configured) {
        tried.push(`${provider.name}(skipped: no key)`);
        continue;
      }
      try {
        const res = await provider.complete(messages, opts);
        this.log(`[llm] served by ${provider.name}`);
        return res;
      } catch (err) {
        lastError = err;
        tried.push(provider.name);
        if (!isRetryableLlmError(err)) {
          // Non-retryable (e.g. 400/401/403): fail fast with a clear error.
          throw err;
        }
        // Retryable: fall through to the next provider.
      }
    }

    if (lastError === null) {
      throw new LlmNotConfiguredError();
    }
    const detail = lastError instanceof Error ? lastError.message : String(lastError);
    throw new Error(`[llm] all providers failed (tried: ${tried.join(' -> ')}): ${detail}`);
  }
}
