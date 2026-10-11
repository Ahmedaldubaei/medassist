-- Switch the full-text search vector to the Arabic text-search configuration
-- so the keyword leg of hybrid search works for Arabic content (the 'english'
-- config provides no stemming/stop-words for Arabic). Now also indexes textAr,
-- which the previous definition ignored.
DROP INDEX IF EXISTS "KnowledgeChunk_search_vector_gin_idx";
ALTER TABLE "KnowledgeChunk" DROP COLUMN IF EXISTS "search_vector";
ALTER TABLE "KnowledgeChunk"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('arabic', coalesce("textAr", '') || ' ' || coalesce("textEn", '') || ' ' || coalesce("section", ''))
  ) STORED;

CREATE INDEX "KnowledgeChunk_search_vector_gin_idx"
  ON "KnowledgeChunk" USING GIN ("search_vector");
