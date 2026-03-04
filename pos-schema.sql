-- ============================================================
-- HomeOps Platform Schema
-- Refactored: databases → accounts, tier-based subscriptions,
-- invitation system, usage tracking, role cleanup
-- ============================================================
-- Requires: pgvector extension for document_chunks (RAG). See docs/PGVECTOR_SETUP.md

CREATE EXTENSION IF NOT EXISTS vector;

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
-- API Usage (per-user AI token tracking for tier limits)
-- ============================================================
CREATE TABLE IF NOT EXISTS user_api_usage (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  endpoint VARCHAR(255) NOT NULL,
  model VARCHAR(100) NOT NULL,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  total_cost NUMERIC(10, 6) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_id ON user_api_usage(user_id);
CREATE INDEX IF NOT EXISTS idx_api_usage_created_at ON user_api_usage(created_at);
CREATE INDEX IF NOT EXISTS idx_api_usage_user_month ON user_api_usage(user_id, created_at);

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

-- Document chunks with embeddings for RAG over property documents
CREATE TABLE document_chunks (
    id SERIAL PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    document_id INTEGER NOT NULL REFERENCES property_documents(id) ON DELETE CASCADE,
    document_key VARCHAR(512) NOT NULL,
    system_key VARCHAR(50) NOT NULL,
    document_type VARCHAR(255),
    chunk_index INTEGER NOT NULL,
    content TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_document_chunks_property ON document_chunks(property_id);
CREATE INDEX idx_document_chunks_document ON document_chunks(document_id);
CREATE INDEX idx_document_chunks_system ON document_chunks(system_key);

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
-- Subscription Products & Account Subscriptions (incl. Stripe billing)
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
    code VARCHAR(100) UNIQUE,
    sort_order INTEGER DEFAULT 0,
    trial_days INTEGER,
    popular BOOLEAN DEFAULT false,
    features JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE account_subscriptions (
    id SERIAL PRIMARY KEY,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    subscription_product_id INTEGER NOT NULL
        REFERENCES subscription_products(id) ON DELETE RESTRICT,
    stripe_subscription_id VARCHAR(255),
    stripe_customer_id VARCHAR(255),
    stripe_price_id VARCHAR(255),
    cancel_at_period_end BOOLEAN DEFAULT false,
    status VARCHAR(50) NOT NULL DEFAULT 'active',
    current_period_start TIMESTAMPTZ,
    current_period_end TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_account_subs_account ON account_subscriptions(account_id);
CREATE INDEX idx_account_subs_status ON account_subscriptions(status);
CREATE UNIQUE INDEX idx_account_subs_stripe_sub_id ON account_subscriptions(stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;

-- Plan prices: monthly + annual Stripe Price IDs (one row per billing interval per plan)
CREATE TABLE plan_prices (
    id SERIAL PRIMARY KEY,
    subscription_product_id INTEGER NOT NULL REFERENCES subscription_products(id) ON DELETE CASCADE,
    stripe_price_id VARCHAR(255) NOT NULL UNIQUE,
    billing_interval VARCHAR(20) NOT NULL CHECK (billing_interval IN ('month', 'year')),
    unit_amount INTEGER,
    currency VARCHAR(10) DEFAULT 'usd',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(subscription_product_id, billing_interval)
);
CREATE INDEX idx_plan_prices_product ON plan_prices(subscription_product_id);
CREATE INDEX idx_plan_prices_stripe ON plan_prices(stripe_price_id);

-- Plan limits: editable limits per plan (overrides inline subscription_products limits when present)
CREATE TABLE plan_limits (
    id SERIAL PRIMARY KEY,
    subscription_product_id INTEGER NOT NULL REFERENCES subscription_products(id) ON DELETE CASCADE UNIQUE,
    max_properties INTEGER NOT NULL DEFAULT 1,
    max_contacts INTEGER NOT NULL DEFAULT 25,
    max_viewers INTEGER NOT NULL DEFAULT 2,
    max_team_members INTEGER NOT NULL DEFAULT 5,
    ai_token_monthly_quota INTEGER DEFAULT 50000,
    max_documents_per_system INTEGER DEFAULT 5,
    other_limits JSONB DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_plan_limits_product ON plan_limits(subscription_product_id);

-- Webhook idempotency: prevent duplicate processing
CREATE TABLE stripe_webhook_events (
    id SERIAL PRIMARY KEY,
    stripe_event_id VARCHAR(255) NOT NULL UNIQUE,
    processed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_stripe_webhook_events_id ON stripe_webhook_events(stripe_event_id);

-- Usage counters: monthly aggregates for AI tokens and cached counts
CREATE TABLE usage_counters (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    period_start DATE NOT NULL,
    ai_tokens_used INTEGER NOT NULL DEFAULT 0,
    contacts_count_cached INTEGER,
    properties_count_cached INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_id, account_id, period_start)
);
CREATE INDEX idx_usage_counters_user_period ON usage_counters(user_id, period_start);
CREATE INDEX idx_usage_counters_account_period ON usage_counters(account_id, period_start);

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

-- Support ticket replies (admin/user exchange on tickets)
CREATE TABLE support_ticket_replies (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'user')),
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_support_ticket_replies_ticket_id ON support_ticket_replies(ticket_id);
CREATE INDEX idx_support_ticket_replies_created_at ON support_ticket_replies(created_at);

-- ============================================================
-- Resources (broadcast/messaging: draft + send to recipients)
-- ============================================================

CREATE TABLE resources (
    id SERIAL PRIMARY KEY,
    subject VARCHAR(500) NOT NULL DEFAULT '',
    type VARCHAR(50) DEFAULT 'post',
    recipient_mode VARCHAR(50),
    recipient_ids JSONB DEFAULT '[]',
    content_format VARCHAR(20) DEFAULT 'text',
    body_text TEXT,
    url TEXT,
    image_key VARCHAR(512),
    pdf_key VARCHAR(512),
    delivery_channel VARCHAR(20) DEFAULT 'both' CHECK (delivery_channel IN ('email', 'in_app', 'both')),
    auto_send_triggers JSONB DEFAULT '[]',
    auto_send_enabled BOOLEAN DEFAULT false,
    status VARCHAR(20) DEFAULT 'draft',
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    sent_at TIMESTAMPTZ,
    recipient_count INTEGER,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_resources_status ON resources(status);
CREATE INDEX idx_resources_sent_at ON resources(sent_at DESC);

-- ============================================================
-- Notifications (when resources are sent, recipients get notified)
-- Homeowners and agents see these in the bell dropdown and home page
-- ============================================================

CREATE TABLE notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL DEFAULT 'resource_sent',
    resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
    invitation_id UUID REFERENCES invitations(id) ON DELETE SET NULL,
    title VARCHAR(500),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user_id ON notifications(user_id);
CREATE INDEX idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX idx_notifications_read_at ON notifications(read_at) WHERE read_at IS NULL;

-- ============================================================
-- Communications (Intercom-style: compose → audience → send)
-- Templates, structured content, scheduling, delivery records, auto-send rules
-- ============================================================

CREATE TABLE comm_templates (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    name VARCHAR(200) NOT NULL DEFAULT 'Default',
    logo_key TEXT,
    primary_color VARCHAR(7) DEFAULT '#456564',
    secondary_color VARCHAR(7) DEFAULT '#f9fafb',
    footer_text TEXT DEFAULT '',
    is_default BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comm_templates_account ON comm_templates(account_id);

CREATE TABLE communications (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    template_id INTEGER REFERENCES comm_templates(id) ON DELETE SET NULL,
    subject VARCHAR(500) NOT NULL,
    content JSONB NOT NULL DEFAULT '{"body":""}',
    image_key TEXT,
    recipient_mode VARCHAR(50),
    recipient_ids JSONB DEFAULT '[]',
    delivery_channel VARCHAR(20) DEFAULT 'in_app' CHECK (delivery_channel IN ('email', 'in_app', 'both')),
    status VARCHAR(20) DEFAULT 'draft',
    scheduled_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    recipient_count INTEGER DEFAULT 0,
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_communications_account ON communications(account_id);
CREATE INDEX idx_communications_status ON communications(status);
CREATE INDEX idx_communications_scheduled ON communications(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX idx_communications_created_by ON communications(created_by);

CREATE TABLE comm_attachments (
    id SERIAL PRIMARY KEY,
    communication_id INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,
    file_key TEXT,
    url TEXT,
    filename VARCHAR(500),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comm_attachments_comm ON comm_attachments(communication_id);

CREATE TABLE comm_recipients (
    id SERIAL PRIMARY KEY,
    communication_id INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL DEFAULT 'in_app',
    status VARCHAR(20) DEFAULT 'pending',
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comm_recipients_comm ON comm_recipients(communication_id);
CREATE INDEX idx_comm_recipients_user ON comm_recipients(user_id);
CREATE INDEX idx_comm_recipients_status ON comm_recipients(status) WHERE status != 'read';

CREATE TABLE comm_rules (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    communication_id INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
    trigger_event VARCHAR(100) NOT NULL,
    trigger_role VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_comm_rules_active ON comm_rules(is_active) WHERE is_active = true;
CREATE INDEX idx_comm_rules_comm ON comm_rules(communication_id);

-- Seed default comm template per account (idempotent)
INSERT INTO comm_templates (account_id, name, is_default)
SELECT a.id, 'Default', true FROM accounts a
WHERE NOT EXISTS (SELECT 1 FROM comm_templates ct WHERE ct.account_id = a.id AND ct.is_default = true);

-- ============================================================
-- Inspection Analysis (async report analysis)
-- ============================================================

CREATE TABLE inspection_analysis_jobs (
    id SERIAL PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    s3_key VARCHAR(512) NOT NULL,
    file_name VARCHAR(255),
    mime_type VARCHAR(100),
    status VARCHAR(30) NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed')),
    progress VARCHAR(100),
    error_message TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inspection_analysis_jobs_property ON inspection_analysis_jobs(property_id);
CREATE INDEX idx_inspection_analysis_jobs_status ON inspection_analysis_jobs(status);
CREATE INDEX idx_inspection_analysis_jobs_created ON inspection_analysis_jobs(created_at DESC);

CREATE TABLE inspection_analysis_results (
    id SERIAL PRIMARY KEY,
    job_id INTEGER NOT NULL REFERENCES inspection_analysis_jobs(id) ON DELETE CASCADE UNIQUE,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    condition_rating VARCHAR(20) NOT NULL CHECK (condition_rating IN ('excellent', 'good', 'fair', 'poor')),
    condition_confidence NUMERIC(4, 2),
    condition_rationale TEXT,
    systems_detected JSONB DEFAULT '[]',
    needs_attention JSONB DEFAULT '[]',
    suggested_systems_to_add JSONB DEFAULT '[]',
    maintenance_suggestions JSONB DEFAULT '[]',
    summary TEXT,
    citations JSONB DEFAULT '[]',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_inspection_analysis_results_property ON inspection_analysis_results(property_id);

-- ============================================================
-- Property AI Profile (token + UX optimization for chat)
-- ============================================================

CREATE TABLE property_ai_profiles (
    property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
    canonical_systems JSONB DEFAULT '[]',
    known_state JSONB DEFAULT '{}',
    key_issues TEXT[] DEFAULT '{}',
    maintenance_summary TEXT,
    last_analysis_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- ============================================================
-- Property AI Reanalysis (dynamic re-analysis on document/maintenance)
-- ============================================================

CREATE TABLE property_ai_summary_state (
    property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
    updated_systems JSONB DEFAULT '[]',
    newly_detected_systems JSONB DEFAULT '[]',
    maintenance_recommendations JSONB DEFAULT '[]',
    risk_flags JSONB DEFAULT '[]',
    summary_delta TEXT,
    report_analysis TEXT,
    last_reanalysis_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_property_ai_summary_state_updated
    ON property_ai_summary_state(updated_at DESC);

CREATE TABLE property_ai_reanalysis_audit (
    id SERIAL PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    trigger_source VARCHAR(50) NOT NULL,
    trigger_id INTEGER,
    previous_state JSONB,
    new_state JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_property_ai_reanalysis_audit_property
    ON property_ai_reanalysis_audit(property_id);
CREATE INDEX idx_property_ai_reanalysis_audit_created
    ON property_ai_reanalysis_audit(created_at DESC);

-- ============================================================
-- AI Conversations and Messages
-- ============================================================

CREATE TABLE ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    system_id VARCHAR(50),
    system_context JSONB DEFAULT '{}',
    context_summary TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_conversations_property ON ai_conversations(property_id);
CREATE INDEX idx_ai_conversations_user ON ai_conversations(user_id);
CREATE INDEX idx_ai_conversations_user_property_updated ON ai_conversations(user_id, property_id, updated_at DESC);

CREATE TABLE ai_messages (
    id SERIAL PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
    content TEXT NOT NULL,
    ui_directives JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_messages_conversation ON ai_messages(conversation_id);

-- ============================================================
-- AI Action Drafts (scheduling proposals from chat)
-- ============================================================

CREATE TABLE ai_action_drafts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id UUID REFERENCES ai_conversations(id) ON DELETE SET NULL,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    status VARCHAR(30) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'ready_to_schedule', 'scheduled', 'cancelled')),
    tasks JSONB NOT NULL DEFAULT '[]',
    contractor_id INTEGER,
    contractor_source VARCHAR(20),
    contractor_name VARCHAR(255),
    scheduled_for DATE,
    scheduled_time TIME,
    notes TEXT,
    maintenance_event_id INTEGER REFERENCES maintenance_events(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_action_drafts_property ON ai_action_drafts(property_id);
CREATE INDEX idx_ai_action_drafts_user ON ai_action_drafts(user_id);
CREATE INDEX idx_ai_action_drafts_status ON ai_action_drafts(status);
