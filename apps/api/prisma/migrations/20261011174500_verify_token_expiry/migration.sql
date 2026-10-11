-- P3 audit item: verifyToken expiry (Low 2.8).
-- Additive-only and idempotent (IF NOT EXISTS): safe for production.
-- NOTE: do NOT generate this migration with `prisma migrate dev` — dev diffing
-- tries to DROP the search_vector column (not mapped in the Prisma schema).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "verifyTokenExpiry" TIMESTAMPTZ;
