import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('365d'),
  // --- RAG / embeddings ---
  // 'hf'    -> HuggingFace Inference API, intfloat/multilingual-e5-large (1024 dims).
  //            Requires an HF token with Inference Providers permission.
  // 'local' -> in-process transformers.js, Xenova/multilingual-e5-small (384 dims).
  //            Offline fallback used when the HF API is unreachable/unauthorized.
  EMBEDDING_PROVIDER: z.enum(['hf', 'local']).default('local'),
  EMBEDDING_DIM: z.coerce.number().int().positive().default(384),
  HF_TOKEN: z.string().optional(),
  // --- LLM ---
  // 'auto'     -> fallback ladder: Gemini -> Cerebras (default)
  // 'gemini'   -> Gemini only (primary)
  // 'cerebras' -> Cerebras only (fallback)
  // 'mock'     -> scripted MockProvider (tests)
  // NOTE (2026-10-11): Groq removed permanently per user instruction (429 throttling).
  LLM_PROVIDER: z.enum(['auto', 'gemini', 'cerebras', 'mock']).default('auto'),
  GEMINI_API_KEY: z.string().optional(),
  // NOTE (P6): gemini-2.5-flash was retired for new API users (404) — 3.8-flash verified live 2026-10-11.
  GEMINI_MODEL: z.string().default('gemini-3.8-flash'),
  CEREBRAS_API_KEY: z.string().optional(),
  CEREBRAS_MODEL: z.string().default('gpt-oss-120b'),
  // --- Reranker ---
  // 'keyword'      -> deterministic token-overlap + contrast guard (default, offline)
  // 'crossencoder' -> Xenova/ms-marco-MiniLM-L-6-v2 via transformers.js (opt-in)
  RERANK_PROVIDER: z.enum(['keyword', 'crossencoder']).default('keyword'),
  // --- Google Sign-In ---
  // Web OAuth client ID from the MedAssist GCP project. Empty = Google sign-in disabled.
  GOOGLE_CLIENT_ID: z.string().default(''),
  // --- Email (Resend) ---
  // Empty = email sending disabled (registration still succeeds; a warning is logged).
  RESEND_API_KEY: z.string().default(''),
  // NOTE: onboarding@resend.dev is Resend's sandbox sender — it only delivers to
  // the account owner's email. Replace with a verified domain sender for production.
  RESEND_FROM: z.string().default('MedAssist <onboarding@resend.dev>'),
  // Public URL of the web app, used to build email verification links.
  APP_WEB_URL: z.string().default('https://medassist-app-sun3.onrender.com'),
  // P3: CORS origins via env (comma-separated). Defaults preserve the
  // previously hardcoded list — no behavior change without the env var.
  CORS_ORIGINS: z
    .string()
    .default('https://medassist-app-sun3.onrender.com,http://localhost:8081,http://localhost:19006'),
});

export type Config = z.infer<typeof envSchema>;

export const config: Config = envSchema.parse(process.env);
