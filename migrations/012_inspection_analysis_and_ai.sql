-- Run: psql $DATABASE_URL -f migrations/012_inspection_analysis_and_ai.sql
--
-- Inspection analysis jobs and results (async report analysis)
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

-- Property AI profile (token + UX optimization for chat)
CREATE TABLE property_ai_profiles (
    property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
    canonical_systems JSONB DEFAULT '[]',
    known_state JSONB DEFAULT '{}',
    key_issues TEXT[] DEFAULT '{}',
    maintenance_summary TEXT,
    last_analysis_at TIMESTAMPTZ,
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- AI conversations and messages
CREATE TABLE ai_conversations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_conversations_property ON ai_conversations(property_id);
CREATE INDEX idx_ai_conversations_user ON ai_conversations(user_id);

CREATE TABLE ai_messages (
    id SERIAL PRIMARY KEY,
    conversation_id UUID NOT NULL REFERENCES ai_conversations(id) ON DELETE CASCADE,
    role VARCHAR(20) NOT NULL CHECK (role IN ('user', 'assistant')),
    content TEXT NOT NULL,
    ui_directives JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_ai_messages_conversation ON ai_messages(conversation_id);

-- AI action drafts (scheduling proposals from chat)
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
