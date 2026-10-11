-- Extends the SafetyVerdict enum with the policy §9.3 taxonomy:
-- CLARIFY, ESCALATE, SAFE_FALLBACK (PASS/FLAG/BLOCK already existed).
-- Idempotent DO blocks: safe to apply even if a value already exists.
-- NOTE: search_vector is managed by raw SQL outside the Prisma schema;
-- it is intentionally NOT touched here.

DO $$ BEGIN
  ALTER TYPE "SafetyVerdict" ADD VALUE 'CLARIFY';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "SafetyVerdict" ADD VALUE 'ESCALATE';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE "SafetyVerdict" ADD VALUE 'SAFE_FALLBACK';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
