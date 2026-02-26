-- Add support_ticket_replies table for tracking admin/user exchanges on tickets.
-- Run: psql $DATABASE_URL -f migrations/010_add_support_ticket_replies.sql
-- Each reply stores: ticket_id, author (user_id), role (admin/user), body text, created_at.

CREATE TABLE IF NOT EXISTS support_ticket_replies (
    id SERIAL PRIMARY KEY,
    ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
    author_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('admin', 'user')),
    body TEXT NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_support_ticket_replies_ticket_id ON support_ticket_replies(ticket_id);
CREATE INDEX idx_support_ticket_replies_created_at ON support_ticket_replies(created_at);
