# P2 — RAG pipeline: ingestion + embeddings + hybrid retrieval (done 2026-10-11)

## What was built (`apps/api/src/rag/`)
- `embeddings.ts` — provider abstraction (`EmbedProvider`: `embed(texts, kind)`):
  - `HuggingFaceProvider` ('hf'): **spec'd production path** — HF Inference API,
    `intfloat/multilingual-e5-large`, `query: `/`passage: ` prefixes, 1024-dim validation.
  - `LocalE5Provider` ('local'): in-process transformers.js,
    `Xenova/multilingual-e5-small` (int8 ONNX, mean pooling + L2 norm), 384 dims.
  - Selected by `EMBEDDING_PROVIDER` env; dim cross-checked against `EMBEDDING_DIM`;
    `__setEmbedProvider()` test hook for deterministic fakes.
- `chunk.ts` — HTML cleaning (script/style/nav stripped, main/article preferred) +
  sentence-aware chunking **1000 chars / 200 overlap** (MedRAG pattern).
- `ingest.ts` — `ingestDocument()` (text → clean → chunk → embed → raw-SQL insert
  with `::vector` cast) + `fetchUrlText()` (HTML **and PDF** via `pdftotext`,
  size caps, 25s timeout, ≥200 chars guard).
- `retrieve.ts` — hybrid search: pgvector cosine (`<=>`) + full-text
  (`search_vector @@ plainto_tsquery`, GIN) → **RRF fusion (k=60)** → top-k
  with chunk text + document metadata (title, source, year, url, license).
- `routes/rag.ts` — `POST /api/v1/admin/ingest` (ADMIN only, `{url}` or
  `{title,text,source,license}`, URL-dedup → 409, audit-logged, 10/min limit) +
  `POST /api/v1/knowledge/search` (authenticated, `{query, k≤20}`).
- Migration `20261011020000_rag_hybrid_search`: generated `search_vector`
  tsvector column + GIN index; `embedding` **vector(1024) → vector(384)**.

## Key decision: embeddings (deviates from the P2 brief — rationale)
The brief specified HF Inference API + `intfloat/multilingual-e5-large` (1024d).
**Blocked, verified three ways:**
1. `router.huggingface.co` → **403**: *"This authentication method does not have
   sufficient permissions to call Inference Providers on behalf of user oper49473"* —
   the `HF_TOKEN` from the rabt project is read-only, no inference permission.
2. `api-inference.huggingface.co` → connection dies (HTTP 000) through the egress proxy.
3. Running e5-large locally is impossible: only ~517 MB RAM free; the model needs >2 GB.
Per the brief ("report clearly, never fabricate vectors"), the pipeline runs on the
**local provider (384 dims)** instead. Consequences, all reversible:
- `KnowledgeChunk.embedding` migrated to `vector(384)` (table was empty).
- `EMBEDDING_PROVIDER=local`, `EMBEDDING_DIM=384` in `.env` (`.env.example` updated).
- The HF provider stays fully implemented; switching back = set
  `EMBEDDING_PROVIDER=hf` + `EMBEDDING_DIM=1024`, migrate the column, re-ingest.
  Requires an HF token **with Inference Providers permission** (user action).
- `npm install` needs `--ignore-scripts` (onnxruntime-node postinstall download
  hangs through the proxy — same class of issue as Prisma binaries in P1).

## Corpus: 10 open-license anesthesia documents (50 chunks, all 384-dim, all with tsvector)
| # | Document | License | Year |
|---|---|---|---|
| 1 | NICE NG45 — Routine preoperative tests for elective surgery | OGL v3.0 | 2016 |
| 2 | NICE CG65 — Hypothermia prevention in adults having surgery | OGL v3.0 | 2008 |
| 3 | NICE NG89 — Venous thromboembolism in over 16s | OGL v3.0 | 2018 |
| 4 | NICE NG24 — Blood transfusion | OGL v3.0 | 2015 |
| 5 | BMC Anesthesiology — LAST with liposomal bupivacaine (case series + review) | CC BY 4.0 | 2026 |
| 6 | BMC Anesthesiology — Septic shock in OR vs drug-induced anaphylaxis | CC BY 4.0 | 2026 |
| 7 | BMC Anesthesiology — Remimazolam anaphylaxis (case + review) | CC BY 4.0 | 2024 |
| 8 | BMC Anesthesiology — Rescue of cardiac arrest from intraoperative anaphylactic shock | CC BY 4.0 | 2025 |
| 9 | BMC Anesthesiology — Malignant hyperthermia as rare cause of SIRS | CC BY 4.0 | 2014 |
| 10 | BMC Anesthesiology — Dantrolene in MH treatment (case report) | CC BY 4.0 | 2014 |

**Skipped (with reason):** MSD Manual (free-to-read but © Merck, not openly licensed);
StatPearls/NCBI Bookshelf (© StatPearls Publishing); UpToDate (paywalled);
ASA practice guidelines (paywalled — only public summaries are open);
WFSA ATOTW (free educational access but **no formal open license** — kept out to stay
strictly open-license; re-add if the license stance loosens); WHO (no verified
open HTML URL obtained; checklist PDF is a candidate for later).

## Verified live
- `POST /knowledge/search` "malignant hyperthermia treatment" → dantrolene/MH article
  first (vector rank 1 **and** keyword rank 1, score 0.0328), with source/year/license.
- Arabic query "علاج ارتفاع الحرارة الخبيث أثناء التخدير" → correct MH chunks via
  **cross-lingual vector search** (keyword search correctly returns nothing — corpus is English).
- `tsc` clean; `npm test` **21/21 green** (7 P1 + 14 P2: chunking, RRF, e2e ingest→search,
  dim check = 384, admin 403/401, URL-dedup 409).

## Known limitations / next
- Springer/NICE pages leave some boilerplate (nav, "cite this article") in chunks —
  consider readability-style extraction later.
- No ivfflat index yet: exact search is fine at this scale; add when chunks > ~10k.
- Corpus is English-only; Arabic medical sources are scarce — the app answers in
  Arabic citing English sources (per P0 safety rule: never invent Arabic references).
- HF_TOKEN (read-only) kept in local `.env` only (0600), never printed or committed.
