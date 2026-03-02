-- Add system_id and system_context to ai_conversations for system-scoped chat
ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS system_id VARCHAR(50),
  ADD COLUMN IF NOT EXISTS system_context JSONB DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_ai_conversations_system ON ai_conversations(property_id, user_id, system_id);
