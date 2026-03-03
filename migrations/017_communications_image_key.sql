-- Add preview/header image to communications for Discover cards and viewer
ALTER TABLE communications ADD COLUMN IF NOT EXISTS image_key TEXT;
