-- P2 audit items: session invalidation (H5) + persisted disclaimer/verdict (M5).
-- Additive-only and idempotent (IF NOT EXISTS): safe for production.
-- NOTE: do NOT generate this migration with `prisma migrate dev` — dev diffing
-- tries to DROP the search_vector column (not mapped in the Prisma schema).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "tokenVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "disclaimer" TEXT;
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "verdict" TEXT;
