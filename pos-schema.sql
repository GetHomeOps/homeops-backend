-- ============================================================
-- HomeOps Platform Schema
-- Refactored: databases → accounts, tier-based subscriptions,
-- invitation system, usage tracking, role cleanup
-- ============================================================

-- ============================================================
-- ENUM Types
-- ============================================================
CREATE TYPE user_role AS ENUM (
  'super_admin', 'admin', 'agent', 'homeowner',
  'insurance', 'lender', 'attorney'
);

CREATE TYPE account_role AS ENUM ('owner', 'admin', 'member', 'view_only');
CREATE TYPE property_role AS ENUM ('owner', 'editor', 'viewer');
CREATE TYPE invitation_type AS ENUM ('account', 'property');
CREATE TYPE invitation_status AS ENUM ('pending', 'accepted', 'declined', 'expired', 'revoked');
CREATE TYPE contact_type AS ENUM ('individual', 'company');

-- ============================================================
-- Core Tables
-- ============================================================

CREATE TABLE users (
    id SERIAL PRIMARY KEY,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255),
    name VARCHAR(100) NOT NULL,
    phone VARCHAR(50),
    role user_role DEFAULT 'homeowner',
    contact_id INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT false,
    image VARCHAR(500),
    auth_provider VARCHAR(20) DEFAULT 'local',
    google_sub VARCHAR(255) UNIQUE,
    avatar_url VARCHAR(500),
    email_verified BOOLEAN,
    mfa_enabled BOOLEAN DEFAULT false,
    mfa_secret_encrypted TEXT,
    mfa_enrolled_at TIMESTAMPTZ,
    subscription_tier VARCHAR(50),
    onboarding_completed BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE accounts (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    url VARCHAR(255) NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    stripe_customer_id VARCHAR(255),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE account_users (
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    role account_role DEFAULT 'member',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (account_id, user_id)
);

CREATE INDEX idx_account_users_user_id ON account_users(user_id);
CREATE INDEX idx_account_users_account_id ON account_users(account_id);

-- ============================================================
-- Refresh Tokens (for access/refresh token rotation)
-- ============================================================

CREATE TABLE refresh_tokens (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash TEXT NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- ============================================================
-- MFA (TOTP + Backup Codes)
-- ============================================================

CREATE TABLE mfa_backup_codes (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash TEXT NOT NULL,
    used_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_mfa_backup_codes_user_id ON mfa_backup_codes(user_id);

CREATE TABLE mfa_enrollment_temp (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE UNIQUE,
    secret_encrypted TEXT NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_mfa_enrollment_temp_user_id ON mfa_enrollment_temp(user_id);
CREATE INDEX idx_mfa_enrollment_temp_expires_at ON mfa_enrollment_temp(expires_at);

-- ============================================================
-- Contacts
-- ============================================================

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
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE account_contacts (
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    contact_id INTEGER REFERENCES contacts(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (account_id, contact_id)
);

CREATE INDEX idx_account_contacts_account_id ON account_contacts(account_id);

-- ============================================================
-- Properties
-- ============================================================

CREATE TABLE properties (
    id SERIAL PRIMARY KEY,
    property_uid CHAR(26) UNIQUE,
    account_id INTEGER NOT NULL REFERENCES accounts(id),

    -- Identity & Address
    passport_id VARCHAR(255),
    property_name VARCHAR(255),
    main_photo TEXT,
    hps_score INTEGER,
    tax_id VARCHAR(255),
    county VARCHAR(255),
    address TEXT,
    address_line_1 VARCHAR(255),
    address_line_2 VARCHAR(255),
    city VARCHAR(255),
    state VARCHAR(2),
    zip VARCHAR(20),

    -- Ownership & Occupancy
    owner_name VARCHAR(255),
    owner_name_2 VARCHAR(255),
    owner_city VARCHAR(255),
    occupant_name VARCHAR(255),
    occupant_type VARCHAR(50),
    owner_phone VARCHAR(50),
    phone_to_show VARCHAR(50),

    -- General Information
    property_type VARCHAR(100),
    sub_type VARCHAR(100),
    roof_type VARCHAR(100),
    year_built INTEGER,
    effective_year_built INTEGER,
    effective_year_built_source VARCHAR(255),

    -- Size & Lot
    sq_ft_total NUMERIC(12, 2),
    sq_ft_finished NUMERIC(12, 2),
    sq_ft_unfinished NUMERIC(12, 2),
    garage_sq_ft NUMERIC(12, 2),
    total_dwelling_sq_ft NUMERIC(12, 2),
    sq_ft_source VARCHAR(100),
    lot_size VARCHAR(100),
    lot_size_source VARCHAR(100),
    lot_dim VARCHAR(100),
    price_per_sq_ft VARCHAR(50),
    total_price_per_sq_ft VARCHAR(50),

    -- Rooms & Baths
    bed_count INTEGER,
    bath_count INTEGER,
    full_baths INTEGER,
    three_quarter_baths INTEGER,
    half_baths INTEGER,
    number_of_showers INTEGER,
    number_of_bathtubs INTEGER,

    -- Features & Parking
    fireplaces INTEGER,
    fireplace_types VARCHAR(255),
    basement VARCHAR(255),
    parking_type VARCHAR(255),
    total_covered_parking INTEGER,
    total_uncovered_parking INTEGER,

    -- Schools
    school_district VARCHAR(255),
    elementary_school VARCHAR(255),
    junior_high_school VARCHAR(255),
    senior_high_school VARCHAR(255),
    school_district_websites TEXT,

    -- Listing & Dates
    list_date DATE,
    expire_date DATE,

    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_properties_account_id ON properties(account_id);

CREATE TABLE property_users (
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    role property_role DEFAULT 'editor',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (property_id, user_id)
);

CREATE INDEX idx_property_users_user_id ON property_users(user_id);

-- ============================================================
-- Property Systems, Maintenance, Documents
-- ============================================================

CREATE TABLE property_systems (
    id SERIAL PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    system_key VARCHAR(50) NOT NULL,
    data JSONB DEFAULT '{}',
    next_service_date DATE,
    included BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(property_id, system_key)
);

CREATE TABLE property_maintenance (
    id SERIAL PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    system_key VARCHAR(50) NOT NULL,
    completed_at TIMESTAMPTZ,
    next_service_date TIMESTAMPTZ,
    data JSONB DEFAULT '{}',
    status VARCHAR(50) DEFAULT 'pending',
    record_status VARCHAR(50),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE property_documents (
    id SERIAL PRIMARY KEY,
    property_id INTEGER REFERENCES properties(id) ON DELETE CASCADE,
    document_name VARCHAR(255) NOT NULL,
    document_date DATE NOT NULL,
    document_key VARCHAR(512) NOT NULL,
    document_type VARCHAR(255) NOT NULL,
    system_key VARCHAR(50) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Invitations
-- ============================================================

CREATE TABLE invitations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    type invitation_type NOT NULL,
    inviter_user_id INTEGER NOT NULL REFERENCES users(id),
    invitee_email VARCHAR(255) NOT NULL,
    account_id INTEGER NOT NULL REFERENCES accounts(id),
    property_id INTEGER REFERENCES properties(id),
    intended_role VARCHAR(50) NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    status invitation_status DEFAULT 'pending',
    expires_at TIMESTAMPTZ NOT NULL,
    accepted_at TIMESTAMPTZ,
    accepted_by_user_id INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_invitations_email_status ON invitations(invitee_email, status);
CREATE INDEX idx_invitations_account ON invitations(account_id, status);
CREATE INDEX idx_invitations_property ON invitations(property_id, status);

-- ============================================================
-- Subscription Products & Account Subscriptions
-- ============================================================

CREATE TABLE subscription_products (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    description TEXT,
    target_role user_role NOT NULL,
    stripe_product_id VARCHAR(255),
    stripe_price_id VARCHAR(255),
    price DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    billing_interval VARCHAR(50) DEFAULT 'month',
    max_properties INTEGER NOT NULL DEFAULT 1,
    max_contacts INTEGER NOT NULL DEFAULT 25,
    max_viewers INTEGER NOT NULL DEFAULT 2,
    max_team_members INTEGER NOT NULL DEFAULT 5,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE account_subscriptions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    subscription_product_id INTEGER NOT NULL
        REFERENCES subscription_products(id) ON DELETE RESTRICT,
    stripe_subscription_id VARCHAR(255),
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_account_subs_account ON account_subscriptions(account_id);
CREATE INDEX idx_account_subs_status ON account_subscriptions(status);

-- ============================================================
-- Usage Tracking (Unit Economics)
-- ============================================================

CREATE TABLE account_usage_events (
    id BIGSERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category VARCHAR(50) NOT NULL,
    resource VARCHAR(100) NOT NULL,
    quantity NUMERIC(14, 4) NOT NULL,
    unit VARCHAR(20) NOT NULL,
    unit_cost NUMERIC(12, 8) NOT NULL DEFAULT 0,
    total_cost NUMERIC(12, 6) NOT NULL DEFAULT 0,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_usage_account_date ON account_usage_events(account_id, created_at);
CREATE INDEX idx_usage_user_date ON account_usage_events(user_id, created_at);
CREATE INDEX idx_usage_category ON account_usage_events(category, created_at);

-- ============================================================
-- Platform Engagement Events
-- ============================================================

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

-- ============================================================
-- Daily Metrics Snapshot (replaces expensive view)
-- Populated by a scheduled job, not computed on read
-- ============================================================

CREATE TABLE daily_metrics_snapshot (
    date DATE PRIMARY KEY,
    total_users INTEGER DEFAULT 0,
    total_accounts INTEGER DEFAULT 0,
    total_properties INTEGER DEFAULT 0,
    new_users INTEGER DEFAULT 0,
    new_accounts INTEGER DEFAULT 0,
    new_properties INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Account Analytics Snapshot (replaces expensive view)
-- Populated by a scheduled job, not computed on read
-- ============================================================

CREATE TABLE account_analytics_snapshot (
    account_id INTEGER PRIMARY KEY REFERENCES accounts(id) ON DELETE CASCADE,
    account_name VARCHAR(255),
    total_properties INTEGER DEFAULT 0,
    total_users INTEGER DEFAULT 0,
    total_systems INTEGER DEFAULT 0,
    total_maintenance_records INTEGER DEFAULT 0,
    avg_hps_score INTEGER DEFAULT 0,
    last_active_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Professional Categories
-- ============================================================

CREATE TABLE professional_categories (
    id SERIAL PRIMARY KEY,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    type VARCHAR(20) NOT NULL DEFAULT 'child',
    parent_id INTEGER REFERENCES professional_categories(id) ON DELETE CASCADE,
    icon VARCHAR(50),
    image_key VARCHAR(512),
    sort_order INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prof_categories_parent ON professional_categories(parent_id);
CREATE INDEX idx_prof_categories_type ON professional_categories(type);

-- ============================================================
-- Professionals
-- ============================================================

CREATE TABLE professionals (
    id SERIAL PRIMARY KEY,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    company_name VARCHAR(255),
    category_id INTEGER REFERENCES professional_categories(id),
    subcategory_id INTEGER REFERENCES professional_categories(id),
    description TEXT,
    phone VARCHAR(50),
    email VARCHAR(255),
    website VARCHAR(255),
    street1 VARCHAR(255),
    street2 VARCHAR(255),
    city VARCHAR(100),
    state VARCHAR(100),
    zip_code VARCHAR(20),
    country VARCHAR(100),
    service_area TEXT,
    budget_level VARCHAR(10),
    languages TEXT[] DEFAULT '{}',
    rating NUMERIC(3,1) DEFAULT 0,
    review_count INTEGER DEFAULT 0,
    years_in_business INTEGER,
    is_verified BOOLEAN DEFAULT false,
    license_number VARCHAR(100),
    profile_photo VARCHAR(512),
    is_active BOOLEAN DEFAULT true,
    account_id INTEGER REFERENCES accounts(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_professionals_account ON professionals(account_id);
CREATE INDEX idx_professionals_category ON professionals(category_id);
CREATE INDEX idx_professionals_subcategory ON professionals(subcategory_id);
CREATE INDEX idx_professionals_city_state ON professionals(city, state);
CREATE INDEX idx_professionals_active ON professionals(is_active);

-- ============================================================
-- Professional Project Photos
-- ============================================================

CREATE TABLE professional_photos (
    id SERIAL PRIMARY KEY,
    professional_id INTEGER REFERENCES professionals(id) ON DELETE CASCADE,
    photo_key VARCHAR(512) NOT NULL,
    caption VARCHAR(255),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_prof_photos_professional ON professional_photos(professional_id);

-- ============================================================
-- Saved Professionals (user favorites)
-- ============================================================

CREATE TABLE saved_professionals (
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    professional_id INTEGER REFERENCES professionals(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, professional_id)
);

CREATE INDEX idx_saved_professionals_user ON saved_professionals(user_id);

-- ============================================================
-- Maintenance Events (scheduled maintenance)
-- ============================================================

CREATE TABLE maintenance_events (
    id SERIAL PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    system_key VARCHAR(50) NOT NULL,
    system_name VARCHAR(100),
    contractor_id INTEGER,
    contractor_source VARCHAR(20),
    contractor_name VARCHAR(255),
    scheduled_date DATE NOT NULL,
    scheduled_time TIME,
    recurrence_type VARCHAR(20) DEFAULT 'one-time',
    recurrence_interval_value INTEGER,
    recurrence_interval_unit VARCHAR(10),
    alert_timing VARCHAR(10) DEFAULT '3d',
    alert_custom_days INTEGER,
    email_reminder BOOLEAN DEFAULT false,
    message_enabled BOOLEAN DEFAULT false,
    message_body TEXT,
    status VARCHAR(30) DEFAULT 'scheduled',
    timezone VARCHAR(50),
    created_by INTEGER REFERENCES users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_maintenance_events_property ON maintenance_events(property_id);
CREATE INDEX idx_maintenance_events_date ON maintenance_events(scheduled_date);
CREATE INDEX idx_maintenance_events_status ON maintenance_events(status);

-- ============================================================
-- Support Tickets (support & feedback)
-- ============================================================

CREATE TABLE support_tickets (
    id SERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL CHECK (type IN ('support', 'feedback')),
    subject VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'new' CHECK (status IN (
        'new', 'working_on_it', 'solved',
        'waiting_on_user', 'resolved', 'closed',
        'under_review', 'planned', 'implemented', 'rejected'
    )),
    subscription_tier VARCHAR(50),
    priority_score INTEGER NOT NULL DEFAULT 10,
    created_by INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    assigned_to INTEGER REFERENCES users(id) ON DELETE SET NULL,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    internal_notes TEXT,
    attachment_keys TEXT[],
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_support_tickets_created_by ON support_tickets(created_by);
CREATE INDEX idx_support_tickets_account_id ON support_tickets(account_id);
CREATE INDEX idx_support_tickets_status ON support_tickets(status);
CREATE INDEX idx_support_tickets_priority ON support_tickets(priority_score DESC, created_at ASC);
