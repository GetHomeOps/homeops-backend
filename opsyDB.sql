\echo 'Delete and recreate Opsy db?'
\prompt 'Return for yes or control-C to cancel > ' confirm

-- Drop the database if it exists
DROP DATABASE IF EXISTS opsy;
-- Recreate the database
CREATE DATABASE opsy;
-- Connect to the newly created database
\connect opsy;

-- Drop tables in reverse dependency order
DROP TABLE IF EXISTS comm_attachments CASCADE;
DROP TABLE IF EXISTS comm_recipients CASCADE;
DROP TABLE IF EXISTS comm_rules CASCADE;
DROP TABLE IF EXISTS communications CASCADE;
DROP TABLE IF EXISTS comm_templates CASCADE;
DROP TABLE IF EXISTS support_ticket_replies CASCADE;
DROP TABLE IF EXISTS plan_limits CASCADE;
DROP TABLE IF EXISTS plan_prices CASCADE;
DROP TABLE IF EXISTS stripe_webhook_events CASCADE;
DROP TABLE IF EXISTS support_tickets CASCADE;
DROP TABLE IF EXISTS ai_action_drafts CASCADE;
DROP TABLE IF EXISTS ai_messages CASCADE;
DROP TABLE IF EXISTS ai_conversations CASCADE;
DROP TABLE IF EXISTS property_ai_profiles CASCADE;
DROP TABLE IF EXISTS inspection_checklist_items CASCADE;
DROP TABLE IF EXISTS inspection_analysis_results CASCADE;
DROP TABLE IF EXISTS inspection_analysis_jobs CASCADE;
DROP TABLE IF EXISTS professional_reviews CASCADE;
DROP TABLE IF EXISTS saved_professionals CASCADE;
DROP TABLE IF EXISTS professional_photos CASCADE;
DROP TABLE IF EXISTS professionals CASCADE;
DROP TABLE IF EXISTS professional_categories CASCADE;
DROP TABLE IF EXISTS maintenance_events CASCADE;
DROP TABLE IF EXISTS usage_counters CASCADE;
DROP TABLE IF EXISTS account_usage_events CASCADE;
DROP TABLE IF EXISTS account_analytics_snapshot CASCADE;
DROP TABLE IF EXISTS daily_metrics_snapshot CASCADE;
DROP TABLE IF EXISTS platform_engagement_events CASCADE;
DROP TABLE IF EXISTS account_subscriptions CASCADE;
DROP TABLE IF EXISTS subscription_products CASCADE;
DROP TABLE IF EXISTS invitations CASCADE;
DROP TABLE IF EXISTS document_chunks CASCADE;
DROP TABLE IF EXISTS property_documents CASCADE;
DROP TABLE IF EXISTS contractor_report_tokens CASCADE;
DROP TABLE IF EXISTS property_maintenance CASCADE;
DROP TABLE IF EXISTS property_systems CASCADE;
DROP TABLE IF EXISTS property_users CASCADE;
DROP TABLE IF EXISTS properties CASCADE;
DROP TABLE IF EXISTS contact_tags CASCADE;
DROP TABLE IF EXISTS account_contacts CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS tags CASCADE;
DROP TABLE IF EXISTS account_users CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS mfa_backup_codes CASCADE;
DROP TABLE IF EXISTS mfa_enrollment_temp CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS password_reset_tokens CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS resources CASCADE;
DROP TABLE IF EXISTS user_api_usage CASCADE;
DROP TABLE IF EXISTS invitations CASCADE;
DROP TABLE IF EXISTS notifications CASCADE;
DROP TABLE IF EXISTS document_chunks CASCADE;
DROP TABLE IF EXISTS property_documents CASCADE;
DROP TABLE IF EXISTS contractor_report_tokens CASCADE;
DROP TABLE IF EXISTS property_maintenance CASCADE;
DROP TABLE IF EXISTS property_systems CASCADE;
DROP TABLE IF EXISTS property_users CASCADE;
DROP TABLE IF EXISTS properties CASCADE;
DROP TABLE IF EXISTS contact_tags CASCADE;
DROP TABLE IF EXISTS account_contacts CASCADE;
DROP TABLE IF EXISTS contacts CASCADE;
DROP TABLE IF EXISTS tags CASCADE;
DROP TABLE IF EXISTS account_users CASCADE;
DROP TABLE IF EXISTS accounts CASCADE;
DROP TABLE IF EXISTS mfa_backup_codes CASCADE;
DROP TABLE IF EXISTS mfa_enrollment_temp CASCADE;
DROP TABLE IF EXISTS users CASCADE;
DROP TABLE IF EXISTS password_reset_tokens CASCADE;
DROP TABLE IF EXISTS refresh_tokens CASCADE;
DROP TABLE IF EXISTS resources CASCADE;
DROP TABLE IF EXISTS user_api_usage CASCADE;
DROP TABLE IF EXISTS property_ai_summary_state CASCADE;
DROP TABLE IF EXISTS property_ai_reanalysis_audit CASCADE;

-- Drop old views
DROP VIEW IF EXISTS daily_platform_metrics CASCADE;
DROP VIEW IF EXISTS database_analytics CASCADE;
DROP VIEW IF EXISTS daily_platform_metrics CASCADE;
DROP VIEW IF EXISTS daily_metrics_snapshot CASCADE;
DROP VIEW IF EXISTS account_analytics_snapshot CASCADE;
DROP VIEW IF EXISTS notifications_view CASCADE;
DROP VIEW IF EXISTS property_ai_summary_state CASCADE;
DROP VIEW IF EXISTS property_ai_reanalysis_audit CASCADE;



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
DROP TYPE IF EXISTS delivery_channel CASCADE;
DROP TYPE IF EXISTS trigger_source CASCADE;
DROP TYPE IF EXISTS maintenance_priority CASCADE;
DROP TYPE IF EXISTS maintenance_status CASCADE;
DROP TYPE IF EXISTS maintenance_type CASCADE;
DROP TYPE IF EXISTS maintenance_category CASCADE;
DROP TYPE IF EXISTS maintenance_subcategory CASCADE;
DROP TYPE IF EXISTS record_status CASCADE;


-- Import the new schema
\i opsy-schema.sql
