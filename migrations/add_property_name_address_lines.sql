-- Add property_name, address_line_1, address_line_2 to properties table
ALTER TABLE properties ADD COLUMN IF NOT EXISTS property_name VARCHAR(255);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS address_line_1 VARCHAR(255);
ALTER TABLE properties ADD COLUMN IF NOT EXISTS address_line_2 VARCHAR(255);
