-- Migration: Add record_status column to property_maintenance
-- Run: psql -d your_database -f migrations/001_add_record_status_column.sql

ALTER TABLE property_maintenance
ADD COLUMN IF NOT EXISTS record_status VARCHAR(50);
