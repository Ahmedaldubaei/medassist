-- Delete the throwaway test-admin account smoke@medassist.dev now that both
-- corpus batches (anesthesia + ICU) are ingested.
-- Safe: Conversation/Message/AgentRun cascade via onDelete; AuditLog keeps a
-- null user (SetNull); KnowledgeDocument is global (no user relation) and is
-- unaffected.
DELETE FROM "User" WHERE email = 'smoke@medassist.dev';
