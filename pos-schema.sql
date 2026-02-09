-- Create ENUM types
CREATE TYPE role AS ENUM ('super_admin', 'admin','agent','homeowner');
CREATE TYPE db_role AS ENUM ('admin','agent','homeowner');
CREATE TYPE contact_type AS ENUM ('individual', 'company');

-- Users table
CREATE TABLE users(
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    role role DEFAULT 'admin',
    contact_id INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT false,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Databases table
CREATE TABLE databases(
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    url VARCHAR(255) NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Databases Users table
CREATE TABLE user_databases(
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    database_id INTEGER REFERENCES databases(id) ON DELETE RESTRICT,
    role db_role DEFAULT 'admin',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    db_admin BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (user_id, database_id)
);

-- Agent Databases Junction Table
CREATE TABLE agent_databases (
    agent_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    database_id INTEGER REFERENCES databases(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (agent_id, database_id)
);

-- Contacts Table
CREATE TABLE contacts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    image VARCHAR(500),
    type INTEGER,
    phone VARCHAR(50),
    email VARCHAR(255),
    website VARCHAR(255),
    street1 VARCHAR(255),
    street2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    zip_code VARCHAR(20),
    country VARCHAR(100),
    country_code VARCHAR(10),
    notes TEXT,
    role VARCHAR(50),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Contacts Databases Junction Table
CREATE TABLE contacts_databases (
    contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
    database_id INTEGER REFERENCES databases(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (contact_id, database_id)
);

-- User Invitations Table
CREATE TABLE user_invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMP NOT NULL,
  used_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT now()
);

-- Properties Table
-- id: internal BIGSERIAL for joins and FK (fast)
-- property_uid: ULID, public; passport_id: meaningful id to display to users
CREATE TABLE properties (
  id           SERIAL PRIMARY KEY,
  property_uid CHAR(26) UNIQUE,

  -- Identity & Address
  passport_id  VARCHAR(255),  -- meaningful id to display to users
  main_photo   TEXT,
  hps_score     INTEGER,
  tax_id            VARCHAR(255),
  county            VARCHAR(255),
  address           TEXT,
  city              VARCHAR(255),
  state             VARCHAR(2),
  zip               VARCHAR(20),

  -- Ownership & Occupancy
  owner_name        VARCHAR(255),
  owner_name_2      VARCHAR(255),
  owner_city        VARCHAR(255),
  occupant_name     VARCHAR(255),
  occupant_type     VARCHAR(50),
  owner_phone       VARCHAR(50),
  phone_to_show     VARCHAR(50),

  -- General Information
  property_type     VARCHAR(100),
  sub_type          VARCHAR(100),
  roof_type         VARCHAR(100),
  year_built        INTEGER,
  effective_year_built INTEGER,
  effective_year_built_source VARCHAR(255),

  -- Size & Lot
  sq_ft_total       NUMERIC(12, 2),
  sq_ft_finished    NUMERIC(12, 2),
  sq_ft_unfinished  NUMERIC(12, 2),
  garage_sq_ft      NUMERIC(12, 2),
  total_dwelling_sq_ft NUMERIC(12, 2),
  sq_ft_source      VARCHAR(100),
  lot_size          VARCHAR(100),
  lot_size_source   VARCHAR(100),
  lot_dim           VARCHAR(100),
  price_per_sq_ft   VARCHAR(50),
  total_price_per_sq_ft VARCHAR(50),

  -- Rooms & Baths
  bed_count         INTEGER,
  bath_count        INTEGER,
  full_baths        INTEGER,
  three_quarter_baths INTEGER,
  half_baths        INTEGER,
  number_of_showers INTEGER,
  number_of_bathtubs INTEGER,

  -- Features & Parking
  fireplaces        INTEGER,
  fireplace_types   VARCHAR(255),
  basement          VARCHAR(255),
  parking_type      VARCHAR(255),
  total_covered_parking    INTEGER,
  total_uncovered_parking  INTEGER,

  -- Schools
  school_district   VARCHAR(255),
  elementary_school VARCHAR(255),
  junior_high_school VARCHAR(255),
  senior_high_school VARCHAR(255),
  school_district_websites TEXT,

  -- Listing & Dates
  list_date         DATE,
  expire_date       DATE,

  created_at        TIMESTAMPTZ DEFAULT NOW(),
  updated_at        TIMESTAMPTZ DEFAULT NOW()
);

-- Property Users Junction Table
CREATE TABLE property_users (
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    role role DEFAULT 'agent',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (property_id, user_id)
);

/* Property Systems Table */
CREATE TABLE property_systems (
  id SERIAL PRIMARY KEY,
  property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
  system_key VARCHAR(50) NOT NULL,  -- 'heating', 'ac', 'plumbing', etc.
  data JSONB DEFAULT '{}',          -- system-specific fields (brand, model, last_service, etc.)
  next_service_date DATE,
  included BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(property_id, system_key)
);


/* Property Maintenance Table */
CREATE TABLE property_maintenance (
  id SERIAL PRIMARY KEY,
  property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
  system_key VARCHAR(50) NOT NULL,  -- 'heating', 'ac', 'plumbing', etc.
  completed_at TIMESTAMPTZ,
  next_service_date TIMESTAMPTZ,
  data JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'pending',               -- 'pending', 'completed', etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

/* Property Documents Table */
CREATE TABLE property_documents (
  id SERIAL PRIMARY KEY,
  property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
  document_name VARCHAR(255) NOT NULL,
  document_date DATE NOT NULL,
  document_key VARCHAR(512) NOT NULL,  -- S3 object key (e.g. documents/123/abc.pdf)
  document_type VARCHAR(255) NOT NULL,
  system_key VARCHAR(50) NOT NULL, -- 'heating', 'ac', 'plumbing', etc.
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);