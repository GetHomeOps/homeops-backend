-- Support & Feedback ticketing system
-- Tiers for priority: premium/win (100), pro/maintain (50), free/basic (10)

CREATE TABLE IF NOT EXISTS support_tickets (
    id SERIAL PRIMARY KEY,
    type VARCHAR(20) NOT NULL CHECK (type IN ('support', 'feedback')),
    subject VARCHAR(500) NOT NULL,
    description TEXT NOT NULL,
    status VARCHAR(30) NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'working_on_it', 'solved')),
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
