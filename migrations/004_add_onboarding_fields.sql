-- Add onboarding fields to users table for Google OAuth signup flow.
-- subscription_tier: free | maintain | win | basic | pro | premium
-- onboarding_completed: false for new Google signups, true for everyone else (default)
ALTER TABLE users ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(50);
ALTER TABLE users ADD COLUMN IF NOT EXISTS onboarding_completed BOOLEAN DEFAULT true;
-- Ensure existing users have onboarding_completed = true
UPDATE users SET onboarding_completed = true WHERE onboarding_completed IS NULL;
