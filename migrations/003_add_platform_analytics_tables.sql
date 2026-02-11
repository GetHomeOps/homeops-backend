-- Migration 003: Platform Analytics Layer
-- Creates tables and views for platform-level analytics:
--   - subscriptions table
--   - platform_engagement_events table
--   - daily_platform_metrics view (corrected to work against actual schema)
--   - database_analytics view (corrected to join through junction tables)

-- ─── Subscriptions Table ──────────────────────────────────────────
-- Tracks per-user subscription plans (free, starter, pro, enterprise).
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  subscription_type VARCHAR(255) NOT NULL,
  subscription_status VARCHAR(255) NOT NULL,
  subscription_start_date DATE NOT NULL,
  subscription_end_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(subscription_status);
CREATE INDEX IF NOT EXISTS idx_subscriptions_type ON subscriptions(subscription_type);

-- ─── Platform Engagement Events Table ─────────────────────────────
-- Logs fine-grained user actions for engagement analytics.
CREATE TABLE IF NOT EXISTS platform_engagement_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(255) NOT NULL,
  event_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_engagement_user_id ON platform_engagement_events(user_id);
CREATE INDEX IF NOT EXISTS idx_engagement_event_type ON platform_engagement_events(event_type);
CREATE INDEX IF NOT EXISTS idx_engagement_created_at ON platform_engagement_events(created_at);

-- ─── Daily Platform Metrics View ──────────────────────────────────
-- Aggregates daily snapshots of platform-wide counts.
-- Queries actual tables (users, databases, properties) by their created_at.
CREATE OR REPLACE VIEW daily_platform_metrics AS
SELECT
  d.date,
  -- Cumulative totals as of each date
  (SELECT COUNT(*)::int FROM users      u WHERE u.created_at::date <= d.date)  AS total_users,
  (SELECT COUNT(*)::int FROM databases  db WHERE db.created_at::date <= d.date) AS total_databases,
  (SELECT COUNT(*)::int FROM properties p WHERE p.created_at::date <= d.date)  AS total_properties,
  -- New entities on each date
  (SELECT COUNT(*)::int FROM users      u WHERE u.created_at::date = d.date)  AS new_users,
  (SELECT COUNT(*)::int FROM databases  db WHERE db.created_at::date = d.date) AS new_databases,
  (SELECT COUNT(*)::int FROM properties p WHERE p.created_at::date = d.date)  AS new_properties
FROM (
  -- Generate a date series covering the last 90 days
  SELECT generate_series(
    (CURRENT_DATE - INTERVAL '90 days')::date,
    CURRENT_DATE,
    '1 day'::interval
  )::date AS date
) d;

-- ─── Database Analytics View ──────────────────────────────────────
-- Per-database rollup joining through junction tables to the actual schema.
CREATE OR REPLACE VIEW database_analytics AS
SELECT
  db.id                                       AS database_id,
  db.name                                     AS database_name,
  COUNT(DISTINCT pu_props.id)::int            AS total_properties,
  COUNT(DISTINCT ud.user_id)::int             AS total_users,
  COUNT(DISTINCT ps.system_key)::int          AS total_systems,
  COUNT(DISTINCT pm.id)::int                  AS total_maintenance_records,
  ROUND(AVG(pu_props.hps_score))::int         AS avg_hps_score,
  MAX(GREATEST(
    pu_props.updated_at,
    db.updated_at
  ))                                          AS last_active_at
FROM databases db
-- Users in this database
LEFT JOIN user_databases ud ON ud.database_id = db.id
-- Properties belonging to users of this database
LEFT JOIN property_users pu ON pu.user_id = ud.user_id
LEFT JOIN properties pu_props ON pu_props.id = pu.property_id
-- Systems on those properties
LEFT JOIN property_systems ps ON ps.property_id = pu_props.id
-- Maintenance records on those properties
LEFT JOIN property_maintenance pm ON pm.property_id = pu_props.id
GROUP BY db.id, db.name;
