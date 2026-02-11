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
    image VARCHAR(500),
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
/* record_status: draft | user_completed | contractor_pending (null treated as draft by frontend) */
CREATE TABLE property_maintenance (
  id SERIAL PRIMARY KEY,
  property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
  system_key VARCHAR(50) NOT NULL,  -- 'heating', 'ac', 'plumbing', etc.
  completed_at TIMESTAMPTZ,
  next_service_date TIMESTAMPTZ,
  data JSONB DEFAULT '{}',
  status VARCHAR(50) DEFAULT 'pending',               -- 'pending', 'completed', etc.
  record_status VARCHAR(50),                          -- draft | user_completed | contractor_pending
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

-- Subscription products table (must exist before subscriptions)
CREATE TABLE subscription_products (
  id SERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL UNIQUE,
  description TEXT,
  price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Subscriptions Table
CREATE TABLE subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  subscription_product_id INTEGER NOT NULL REFERENCES subscription_products(id) ON DELETE RESTRICT,
  subscription_type VARCHAR(255) NOT NULL,
  subscription_status VARCHAR(255) NOT NULL,
  subscription_start_date DATE NOT NULL,
  subscription_end_date DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Platform engagement events table
CREATE TABLE platform_engagement_events (
  id SERIAL PRIMARY KEY,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  event_type VARCHAR(255) NOT NULL,
  event_data JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_engagement_user_id ON platform_engagement_events(user_id);
CREATE INDEX idx_engagement_event_type ON platform_engagement_events(event_type);
CREATE INDEX idx_engagement_created_at ON platform_engagement_events(created_at);
CREATE INDEX idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX idx_subscriptions_product_id ON subscriptions(subscription_product_id);
CREATE INDEX idx_subscriptions_status ON subscriptions(subscription_status);
CREATE INDEX idx_subscriptions_type ON subscriptions(subscription_type);

-- Daily Platform Metrics View
-- Aggregates daily snapshots of platform-wide counts over last 90 days.
CREATE VIEW daily_platform_metrics AS
SELECT
  d.date,
  (SELECT COUNT(*)::int FROM users      u WHERE u.created_at::date <= d.date)  AS total_users,
  (SELECT COUNT(*)::int FROM databases  db WHERE db.created_at::date <= d.date) AS total_databases,
  (SELECT COUNT(*)::int FROM properties p WHERE p.created_at::date <= d.date)  AS total_properties,
  (SELECT COUNT(*)::int FROM users      u WHERE u.created_at::date = d.date)  AS new_users,
  (SELECT COUNT(*)::int FROM databases  db WHERE db.created_at::date = d.date) AS new_databases,
  (SELECT COUNT(*)::int FROM properties p WHERE p.created_at::date = d.date)  AS new_properties
FROM (
  SELECT generate_series(
    (CURRENT_DATE - INTERVAL '90 days')::date,
    CURRENT_DATE,
    '1 day'::interval
  )::date AS date
) d;

-- Database analytics view
-- Per-database rollup joining through junction tables.
CREATE VIEW database_analytics AS
SELECT
  db.id                                       AS database_id,
  db.name                                     AS database_name,
  COUNT(DISTINCT pu_props.id)::int            AS total_properties,
  COUNT(DISTINCT ud.user_id)::int             AS total_users,
  COUNT(DISTINCT ps.system_key)::int          AS total_systems,
  COUNT(DISTINCT pm.id)::int                  AS total_maintenance_records,
  ROUND(AVG(pu_props.hps_score))::int         AS avg_hps_score,
  MAX(GREATEST(pu_props.updated_at, db.updated_at)) AS last_active_at
FROM databases db
LEFT JOIN user_databases ud ON ud.database_id = db.id
LEFT JOIN property_users pu ON pu.user_id = ud.user_id
LEFT JOIN properties pu_props ON pu_props.id = pu.property_id
LEFT JOIN property_systems ps ON ps.property_id = pu_props.id
LEFT JOIN property_maintenance pm ON pm.property_id = pu_props.id
GROUP BY db.id, db.name;