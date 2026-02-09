-- Add image column to users table for profile/avatar photos (S3 key).
-- Run this on existing databases; new installs can use pos-schema.sql with image included.
ALTER TABLE users ADD COLUMN IF NOT EXISTS image VARCHAR(500);
