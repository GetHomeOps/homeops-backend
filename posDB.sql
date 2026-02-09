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

-- Drop existing types with CASCADE to avoid dependency issues
DROP TYPE IF EXISTS role CASCADE;
DROP TYPE IF EXISTS db_role CASCADE;
DROP TYPE IF EXISTS contact_type CASCADE;

-- Import the schema
\i pos-schema.sql

