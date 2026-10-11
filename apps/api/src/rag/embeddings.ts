/**
 * Embedding providers for the RAG pipeline.
 *
 * Two providers:
 *  - HuggingFaceProvider ('hf'): HuggingFace Inference API,
 *    intfloat/multilingual-e5-large, 1024 dims. Spec'd production path.
 *    Requires HF_TOKEN with Inference Providers permission.
 *  - LocalE5Provider ('local'): in-process transformers.js,
 *    Xenova/multilingual-e5-small (quantized ONNX), 384 dims.
 *    Offline fallback — used when the HF API is unreachable or the
 *    token lacks inference permission.
 *
 * Both follow the e5 prefix convention: "query: " for queries,
 * "passage: " for document chunks. Vectors are L2-normalized.
 */
import { config } from '../config.js';

export type EmbedKind = 'query' | 'passage';

export interface EmbedProvider {
  readonly name: string;
  readonly dim: number;
  embed(texts: string[], kind: EmbedKind): Promise<number[][]>;
}

const QUERY_PREFIX = 'query: ';
const PASSAGE_PREFIX = 'passage: ';

function withPrefix(texts: string[], kind: EmbedKind): string[] {
  const prefix = kind === 'query' ? QUERY_PREFIX : PASSAGE_PREFIX;
  return texts.map((t) => (t.startsWith(prefix) ? t : prefix + t));
}

function assertDims(vectors: number[][], expected: number, provider: string): void {
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length !== expected || v.some((x) => !Number.isFinite(x))) {
      throw new Error(
        `[embeddings:${provider}] expected ${expected}-dim finite vectors, got ${Array.isArray(v) ? v.length : typeof v}`,
      );
    }
  }
}

const BATCH_SIZE = 32;

async function batched<T>(items: T[], size: number, fn: (batch: T[]) => Promise<number[][]>): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(...(await fn(items.slice(i, i + size))));
  }
  return out;
}

/** Spec'd production provider: HF Inference API, intfloat/multilingual-e5-large (1024d). */
export class HuggingFaceProvider implements EmbedProvider {
  readonly name = 'hf';
  readonly dim = 1024;
  private readonly model = 'intfloat/multilingual-e5-large';
  private readonly endpoint = 'https://router.huggingface.co/hf-inference/models/intfloat/multilingual-e5-large';

  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    const token = config.HF_TOKEN;
    if (!token) {
      throw new Error('[embeddings:hf] HF_TOKEN is not set — cannot call the HuggingFace Inference API');
    }
    const inputs = withPrefix(texts, kind);
    const vectors = await batched(inputs, BATCH_SIZE, async (batch) => {
      const res = await fetch(this.endpoint, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ inputs: batch, options: { wait_for_model: true } }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!res.ok) {
        const body = await res.text().catch(() => '');
        throw new Error(
          `[embeddings:hf] inference request failed (${res.status}): ${body.slice(0, 200) || res.statusText}`,
        );
      }
      const data = (await res.json()) as unknown;
      if (!Array.isArray(data)) {
        throw new Error(`[embeddings:hf] unexpected response shape: ${JSON.stringify(data).slice(0, 200)}`);
      }
      return data as number[][];
    });
    assertDims(vectors, this.dim, this.name);
    return vectors;
  }
}

/** Offline fallback: transformers.js + Xenova/multilingual-e5-small quantized ONNX (384d). */
export class LocalE5Provider implements EmbedProvider {
  readonly name = 'local';
  readonly dim = 384;
  private readonly modelId = 'Xenova/multilingual-e5-small';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractor: any = null;
  private loading: Promise<void> | null = null;

  private async load(): Promise<void> {
    if (this.extractor) return;
    if (!this.loading) {
      this.loading = (async () => {
        const { pipeline, env } = await import('@huggingface/transformers');
        // Keep model cache inside the project workspace (persists across restarts).
        env.cacheDir = process.env.HF_CACHE_DIR ?? '/home/hatch/workspace/medical-ai-assistant/.hf-cache';
        // `int8` keeps RAM usage low (~120MB) on small VMs.
        this.extractor = await pipeline('feature-extraction', this.modelId, { dtype: 'int8' });
      })();
    }
    await this.loading;
  }

  async embed(texts: string[], kind: EmbedKind): Promise<number[][]> {
    await this.load();
    const inputs = withPrefix(texts, kind);
    const vectors = await batched(inputs, BATCH_SIZE, async (batch) => {
      // Mean pooling + L2 normalization, the standard e5 recipe.
      const output = await this.extractor(batch, { pooling: 'mean', normalize: true });
      return output.tolist() as number[][];
    });
    assertDims(vectors, this.dim, this.name);
    return vectors;
  }
}

let cached: EmbedProvider | null = null;

/** Returns the provider selected by EMBEDDING_PROVIDER (cached singleton). */
export async function getEmbedProvider(): Promise<EmbedProvider> {
  if (!cached) {
    cached = config.EMBEDDING_PROVIDER === 'hf' ? new HuggingFaceProvider() : new LocalE5Provider();
    if (cached.dim !== config.EMBEDDING_DIM) {
      throw new Error(
        `[embeddings] provider dim (${cached.dim}) != EMBEDDING_DIM (${config.EMBEDDING_DIM}); ` +
          `migrate the KnowledgeChunk.embedding column or fix the env`,
      );
    }
  }
  return cached;
}

/** Test hook: override the cached provider (e.g. with a deterministic fake). */
export function __setEmbedProvider(provider: EmbedProvider | null): void {
  cached = provider;
}
