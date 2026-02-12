\echo 'Delete and recreate posDB db?'
\prompt 'Return for yes or control-C to cancel > '

-- Drop the database if it exists
DROP DATABASE IF EXISTS posdb;
-- Recreate the database
CREATE DATABASE posdb;
-- Connect to the newly created database
\connect posdb;

-- Drop tables in the correct order to handle dependencies
DROP TABLE IF EXISTS agent_databases CASCADE;
DROP TABLE IF EXISTS user_databases CASCADE;
DROP TABLE IF EXISTS databases CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS contacts_databases CASCADE;
DROP TABLE IF EXISTS user_invitations CASCADE;
DROP TABLE IF EXISTS properties CASCADE;
DROP TABLE IF EXISTS property_maintenance CASCADE;
DROP TABLE IF EXISTS property_systems CASCADE;
DROP TABLE IF EXISTS property_users CASCADE;
DROP TABLE IF EXISTS property_documents CASCADE;
DROP TABLE IF EXISTS subscription_products CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS platform_engagement_events CASCADE;
DROP TABLE IF EXISTS daily_platform_metrics CASCADE;
DROP TABLE IF EXISTS database_analytics CASCADE;
DROP VIEW IF EXISTS daily_platform_metrics CASCADE;
DROP VIEW IF EXISTS database_analytics CASCADE;
DROP VIEW IF EXISTS platform_metrics_daily CASCADE;
DROP VIEW IF EXISTS platform_engagement_events CASCADE;
DROP VIEW IF EXISTS daily_platform_metrics CASCADE;
DROP VIEW IF EXISTS database_analytics CASCADE;


-- Drop existing types with CASCADE to avoid dependency issues
DROP TYPE IF EXISTS role CASCADE;
DROP TYPE IF EXISTS db_role CASCADE;
DROP TYPE IF EXISTS contact_type CASCADE;
DROP TYPE IF EXISTS subscription_type CASCADE;
DROP TYPE IF EXISTS subscription_status CASCADE;
DROP TYPE IF EXISTS platform_engagement_event_type CASCADE;
DROP TYPE IF EXISTS daily_platform_metric_type CASCADE;
DROP TYPE IF EXISTS database_analytics_type CASCADE;


-- Import the schema
\i pos-schema.sql

