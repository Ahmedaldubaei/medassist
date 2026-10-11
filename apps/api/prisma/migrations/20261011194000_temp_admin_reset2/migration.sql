-- Second one-time password reset for the throwaway test-admin account
-- smoke@medassist.dev, to allow the staged ICU corpus batch ingestion.
-- The account is deleted immediately after ingestion; this hash then becomes
-- useless. The plaintext was random, single-use, and never stored in the repo.
UPDATE "User"
SET "passwordHash" = '$2a$12$aUj/Zu7sGntX1wbXfmXnFulsHXNKRiqGhwXKsm5j6fHRORy1BrhcS'
WHERE email = 'smoke@medassist.dev';
