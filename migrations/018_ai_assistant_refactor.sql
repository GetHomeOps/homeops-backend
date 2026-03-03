-- 018: AI Assistant Refactor — persistent context, rolling summaries, system role
-- Adds context_summary to ai_conversations for hybrid sliding-window memory.
-- Expands ai_messages role check to include 'system' for stored system prompts.

-- 1. Add context_summary column
ALTER TABLE ai_conversations
  ADD COLUMN IF NOT EXISTS context_summary TEXT;

-- 2. Expand role check to include 'system'
ALTER TABLE ai_messages
  DROP CONSTRAINT IF EXISTS ai_messages_role_check;

ALTER TABLE ai_messages
  ADD CONSTRAINT ai_messages_role_check
  CHECK (role IN ('user', 'assistant', 'system'));

-- 3. Add index for fast latest-conversation lookup
CREATE INDEX IF NOT EXISTS idx_ai_conversations_user_property_updated
  ON ai_conversations (user_id, property_id, updated_at DESC);
