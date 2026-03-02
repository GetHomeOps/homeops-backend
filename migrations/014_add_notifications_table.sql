-- Notifications: bell icon dropdown for resources sent and property invitations.
-- Depends on: users, resources, invitations.

CREATE TABLE IF NOT EXISTS notifications (
    id SERIAL PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type VARCHAR(50) NOT NULL DEFAULT 'resource_sent',
    resource_id INTEGER REFERENCES resources(id) ON DELETE CASCADE,
    invitation_id UUID REFERENCES invitations(id) ON DELETE SET NULL,
    title VARCHAR(500),
    read_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_read_at ON notifications(read_at) WHERE read_at IS NULL;
