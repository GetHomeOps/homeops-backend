-- Billing & Stripe: plans, plan_limits, plan_prices, webhook idempotency, usage counters
-- Run after pos-schema.sql. Extends subscription_products for Stripe billing.

-- Add plan identification and Stripe price columns to subscription_products
ALTER TABLE subscription_products ADD COLUMN IF NOT EXISTS code VARCHAR(100) UNIQUE;
ALTER TABLE subscription_products ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0;
ALTER TABLE subscription_products ADD COLUMN IF NOT EXISTS trial_days INTEGER;

-- Plan prices: monthly + annual Stripe Price IDs (one row per billing interval per plan)
CREATE TABLE IF NOT EXISTS plan_prices (
  id SERIAL PRIMARY KEY,
  subscription_product_id INTEGER NOT NULL REFERENCES subscription_products(id) ON DELETE CASCADE,
  stripe_price_id VARCHAR(255) NOT NULL UNIQUE,
  billing_interval VARCHAR(20) NOT NULL CHECK (billing_interval IN ('month', 'year')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(subscription_product_id, billing_interval)
);
CREATE INDEX IF NOT EXISTS idx_plan_prices_product ON plan_prices(subscription_product_id);
CREATE INDEX IF NOT EXISTS idx_plan_prices_stripe ON plan_prices(stripe_price_id);

-- Plan limits: editable limits per plan (overrides inline subscription_products limits when present)
CREATE TABLE IF NOT EXISTS plan_limits (
  id SERIAL PRIMARY KEY,
  subscription_product_id INTEGER NOT NULL REFERENCES subscription_products(id) ON DELETE CASCADE UNIQUE,
  max_properties INTEGER NOT NULL DEFAULT 1,
  max_contacts INTEGER NOT NULL DEFAULT 25,
  max_viewers INTEGER NOT NULL DEFAULT 2,
  max_team_members INTEGER NOT NULL DEFAULT 5,
  ai_token_monthly_quota INTEGER DEFAULT 50000,
  other_limits JSONB DEFAULT '{}',
  updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_plan_limits_product ON plan_limits(subscription_product_id);

-- Webhook idempotency: prevent duplicate processing
CREATE TABLE IF NOT EXISTS stripe_webhook_events (
  id SERIAL PRIMARY KEY,
  stripe_event_id VARCHAR(255) NOT NULL UNIQUE,
  processed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stripe_webhook_events_id ON stripe_webhook_events(stripe_event_id);

-- Usage counters: monthly aggregates for AI tokens and cached counts
CREATE TABLE IF NOT EXISTS usage_counters (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  period_start DATE NOT NULL,
  ai_tokens_used INTEGER NOT NULL DEFAULT 0,
  contacts_count_cached INTEGER,
  properties_count_cached INTEGER,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(user_id, account_id, period_start)
);
CREATE INDEX IF NOT EXISTS idx_usage_counters_user_period ON usage_counters(user_id, period_start);
CREATE INDEX IF NOT EXISTS idx_usage_counters_account_period ON usage_counters(account_id, period_start);

-- Extend account_subscriptions for Stripe
ALTER TABLE account_subscriptions ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255);
ALTER TABLE account_subscriptions ADD COLUMN IF NOT EXISTS stripe_price_id VARCHAR(255);
ALTER TABLE account_subscriptions ADD COLUMN IF NOT EXISTS cancel_at_period_end BOOLEAN DEFAULT false;
-- Unique on stripe_subscription_id for upsert (partial index allows multiple NULLs)
CREATE UNIQUE INDEX IF NOT EXISTS idx_account_subs_stripe_sub_id ON account_subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
