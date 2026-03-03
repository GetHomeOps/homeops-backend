-- Communications refactor: Intercom-style compose → audience → send.
-- Introduces templates, structured content, scheduling, delivery records, and auto-send rules.
-- Existing resources/notifications tables are left intact for backward compatibility.

-- Org-level branding templates
CREATE TABLE IF NOT EXISTS comm_templates (
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

CREATE INDEX IF NOT EXISTS idx_comm_templates_account ON comm_templates(account_id);

-- Main communications table
CREATE TABLE IF NOT EXISTS communications (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    template_id INTEGER REFERENCES comm_templates(id) ON DELETE SET NULL,
    subject VARCHAR(500) NOT NULL,
    content JSONB NOT NULL DEFAULT '{"body":""}',

    recipient_mode VARCHAR(50),
    recipient_ids JSONB DEFAULT '[]',

    delivery_channel VARCHAR(20) DEFAULT 'in_app',
    status VARCHAR(20) DEFAULT 'draft',
    scheduled_at TIMESTAMPTZ,
    sent_at TIMESTAMPTZ,
    recipient_count INTEGER DEFAULT 0,

    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_communications_account ON communications(account_id);
CREATE INDEX IF NOT EXISTS idx_communications_status ON communications(status);
CREATE INDEX IF NOT EXISTS idx_communications_scheduled ON communications(scheduled_at) WHERE status = 'scheduled';
CREATE INDEX IF NOT EXISTS idx_communications_created_by ON communications(created_by);

-- File / link attachments
CREATE TABLE IF NOT EXISTS comm_attachments (
    id SERIAL PRIMARY KEY,
    communication_id INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
    type VARCHAR(20) NOT NULL,
    file_key TEXT,
    url TEXT,
    filename VARCHAR(500),
    sort_order INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_attachments_comm ON comm_attachments(communication_id);

-- Per-recipient delivery tracking
CREATE TABLE IF NOT EXISTS comm_recipients (
    id SERIAL PRIMARY KEY,
    communication_id INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
    user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
    channel VARCHAR(20) NOT NULL DEFAULT 'in_app',
    status VARCHAR(20) DEFAULT 'pending',
    delivered_at TIMESTAMPTZ,
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_recipients_comm ON comm_recipients(communication_id);
CREATE INDEX IF NOT EXISTS idx_comm_recipients_user ON comm_recipients(user_id);
CREATE INDEX IF NOT EXISTS idx_comm_recipients_status ON comm_recipients(status) WHERE status != 'read';

-- Auto-send rules
CREATE TABLE IF NOT EXISTS comm_rules (
    id SERIAL PRIMARY KEY,
    account_id INTEGER REFERENCES accounts(id) ON DELETE CASCADE,
    communication_id INTEGER NOT NULL REFERENCES communications(id) ON DELETE CASCADE,
    trigger_event VARCHAR(100) NOT NULL,
    trigger_role VARCHAR(50),
    is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comm_rules_active ON comm_rules(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_comm_rules_comm ON comm_rules(communication_id);

-- Seed a default template for accounts that don't have one yet.
-- (Run once; idempotent via ON CONFLICT if you add a unique constraint later.)
INSERT INTO comm_templates (account_id, name, is_default)
SELECT id, 'Default', true FROM accounts
ON CONFLICT DO NOTHING;
