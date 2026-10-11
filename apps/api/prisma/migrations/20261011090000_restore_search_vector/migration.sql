-- Restore the full-text search vector dropped accidentally by
-- 20261011051147_add_clinical_content_and_pin (the column is not mapped in
-- the Prisma model, so `migrate dev` generated a DROP; retrieve.ts hybrid
-- search depends on it via raw SQL). IF NOT EXISTS keeps this idempotent
-- for databases where the column was never dropped (e.g. production if the
-- drop migration was never applied there).
ALTER TABLE "KnowledgeChunk"
  ADD COLUMN IF NOT EXISTS "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("textEn", '') || ' ' || coalesce("section", ''))
  ) STORED;

CREATE INDEX IF NOT EXISTS "KnowledgeChunk_search_vector_gin_idx"
  ON "KnowledgeChunk" USING GIN ("search_vector");
