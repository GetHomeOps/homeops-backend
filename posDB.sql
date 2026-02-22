\echo 'Delete and recreate posDB db?'
\prompt 'Return for yes or control-C to cancel > ' confirm

-- Drop the database if it exists
DROP DATABASE IF EXISTS posdb;
-- Recreate the database
CREATE DATABASE posdb;
-- Connect to the newly created database
\connect posdb;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS account_usage_events CASCADE;
DROP TABLE IF EXISTS account_analytics_snapshot CASCADE;
DROP TABLE IF EXISTS daily_metrics_snapshot CASCADE;
DROP TABLE IF EXISTS platform_engagement_events CASCADE;
DROP TABLE IF EXISTS account_subscriptions CASCADE;
DROP TABLE IF EXISTS subscription_products CASCADE;
DROP TABLE IF EXISTS invitations CASCADE;
DROP TABLE IF EXISTS property_documents CASCADE;
DROP TABLE IF EXISTS property_maintenance CASCADE;
DROP TABLE IF EXISTS property_systems CASCADE;
DROP TABLE IF EXISTS property_users CASCADE;
DROP TABLE IF EXISTS properties CASCADE;
DROP TABLE IF EXISTS account_contacts CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS account_users CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS users CASCADE;

-- Drop old tables from previous schema (cleanup)
DROP TABLE IF EXISTS agent_databases CASCADE;
DROP TABLE IF EXISTS user_databases CASCADE;
DROP TABLE IF EXISTS contacts_databases CASCADE;
DROP TABLE IF EXISTS databases CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS user_invitations CASCADE;
DROP TABLE IF EXISTS user_api_usage CASCADE;

-- Drop old views
DROP VIEW IF EXISTS daily_platform_metrics CASCADE;
DROP VIEW IF EXISTS database_analytics CASCADE;

-- Drop existing types
DROP TYPE IF EXISTS user_role CASCADE;
DROP TYPE IF EXISTS account_role CASCADE;
DROP TYPE IF EXISTS property_role CASCADE;
DROP TYPE IF EXISTS invitation_type CASCADE;
DROP TYPE IF EXISTS invitation_status CASCADE;
DROP TYPE IF EXISTS contact_type CASCADE;
DROP TYPE IF EXISTS role CASCADE;
DROP TYPE IF EXISTS db_role CASCADE;
DROP TYPE IF EXISTS subscription_type CASCADE;
DROP TYPE IF EXISTS subscription_status CASCADE;

-- Import the new schema
\i pos-schema.sql
