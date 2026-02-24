-- MFA (TOTP + Backup Codes) tables and user columns.
-- Run if not already present from pos-schema.sql.

-- Users table MFA columns (if not exists)
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN DEFAULT false;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret_encrypted TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enrolled_at TIMESTAMPTZ;

-- Backup codes table
CREATE TABLE IF NOT EXISTS mfa_backup_codes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mfa_backup_codes_user_id ON mfa_backup_codes(user_id);

-- Temporary enrollment (secret before confirmation)
CREATE TABLE IF NOT EXISTS mfa_enrollment_temp (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    secret_encrypted TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_mfa_enrollment_temp_user_id ON mfa_enrollment_temp(user_id);
CREATE INDEX IF NOT EXISTS idx_mfa_enrollment_temp_expires_at ON mfa_enrollment_temp(expires_at);
