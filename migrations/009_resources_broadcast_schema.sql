-- Refactor resources for broadcast/messaging: draft + send to recipients.
-- Run after 008. Migrates from Discover feed schema to broadcast schema.

-- Add new columns
ALTER TABLE resources ADD COLUMN IF NOT EXISTS subject VARCHAR(500);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS type VARCHAR(50) DEFAULT 'post';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS recipient_mode VARCHAR(50);
ALTER TABLE resources ADD COLUMN IF NOT EXISTS recipient_ids JSONB DEFAULT '[]';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS content_format VARCHAR(20) DEFAULT 'text';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS body_text TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft';
ALTER TABLE resources ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ;
ALTER TABLE resources ADD COLUMN IF NOT EXISTS recipient_count INTEGER;

-- Migrate existing data from 008 schema (title, body, link_url, published)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'resources' AND column_name = 'title') THEN
    UPDATE resources SET subject = title WHERE subject IS NULL;
    UPDATE resources SET body_text = body WHERE body_text IS NULL;
    UPDATE resources SET url = link_url WHERE url IS NULL;
    UPDATE resources SET status = CASE WHEN published THEN 'sent' ELSE 'draft' END;
  END IF;
END $$;

-- Drop old columns from 008
ALTER TABLE resources DROP COLUMN IF EXISTS short_description;
ALTER TABLE resources DROP COLUMN IF EXISTS category;
ALTER TABLE resources DROP COLUMN IF EXISTS image_url;
ALTER TABLE resources DROP COLUMN IF EXISTS link_url;
ALTER TABLE resources DROP COLUMN IF EXISTS body;
ALTER TABLE resources DROP COLUMN IF EXISTS tags;
ALTER TABLE resources DROP COLUMN IF EXISTS published;
ALTER TABLE resources DROP COLUMN IF EXISTS title;

-- Ensure subject NOT NULL (use empty string for any nulls)
UPDATE resources SET subject = '' WHERE subject IS NULL;
ALTER TABLE resources ALTER COLUMN subject SET NOT NULL;
ALTER TABLE resources ALTER COLUMN subject SET DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_resources_status ON resources(status);
CREATE INDEX IF NOT EXISTS idx_resources_sent_at ON resources(sent_at DESC);
