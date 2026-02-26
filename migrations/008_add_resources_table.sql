-- Resources: admin/agent-managed content for Discover feed.
-- Supports articles, links, videos, reminders.

CREATE TABLE IF NOT EXISTS resources (
    id SERIAL PRIMARY KEY,
    title VARCHAR(500) NOT NULL,
    short_description TEXT,
    category VARCHAR(100) NOT NULL DEFAULT 'General',
    image_url TEXT,
    link_url TEXT,
    body TEXT,
    tags TEXT[] DEFAULT '{}',
    created_by_role VARCHAR(50),
    created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
    published BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_resources_published ON resources(published);
CREATE INDEX IF NOT EXISTS idx_resources_category ON resources(category);
CREATE INDEX IF NOT EXISTS idx_resources_created_at ON resources(created_at DESC);
