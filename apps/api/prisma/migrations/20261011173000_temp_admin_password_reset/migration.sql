-- Temporary one-time password reset for the throwaway test-admin account
-- smoke@medassist.dev, to allow the staged corpus batch ingestion.
-- The account is slated for deletion immediately after ingestion; this hash
-- becomes useless at that point. The plaintext was random, single-use, and
-- never stored in the repo.
UPDATE "User"
SET "passwordHash" = '$2a$12$1WlwKWgiBrAVp8qTfiiHPuWTy0Z16ma9vnFSDXcSqjGZxz5kDhzbK'
WHERE email = 'smoke@medassist.dev';
