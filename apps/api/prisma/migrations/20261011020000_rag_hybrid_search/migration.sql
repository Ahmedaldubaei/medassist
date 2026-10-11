-- P2: hybrid RAG retrieval.
-- 1) Full-text search vector (generated, kept in sync by Postgres) + GIN index.
-- 2) Embedding dimension 1024 -> 384 to match the working embedding provider
--    (local Xenova/multilingual-e5-small). See P2-NOTES.md for the rationale.
--    KnowledgeChunk is empty in dev/test, so no data migration is needed.

ALTER TABLE "KnowledgeChunk"
  ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (
    to_tsvector('english', coalesce("textEn", '') || ' ' || coalesce("section", ''))
  ) STORED;

CREATE INDEX "KnowledgeChunk_search_vector_gin_idx"
  ON "KnowledgeChunk" USING GIN ("search_vector");

ALTER TABLE "KnowledgeChunk" ALTER COLUMN "embedding" TYPE vector(384);
