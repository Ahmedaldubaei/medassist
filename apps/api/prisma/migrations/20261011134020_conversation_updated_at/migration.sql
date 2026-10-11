-- Add last-activity timestamp to Conversation so the conversation list can be
-- ordered by recency of activity instead of creation time. Backfills existing
-- rows with their creation time. Prisma's @updatedAt keeps it fresh on update.
ALTER TABLE "Conversation" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
