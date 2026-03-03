-- Migration: Property AI Reanalysis State and Audit Trail
-- Stores merged AI summary state per property and full audit trail for reanalysis events.

-- Current AI summary state per property (single row per property)
CREATE TABLE IF NOT EXISTS property_ai_summary_state (
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

CREATE INDEX IF NOT EXISTS idx_property_ai_summary_state_updated
    ON property_ai_summary_state(updated_at DESC);

-- Audit trail: each reanalysis event
CREATE TABLE IF NOT EXISTS property_ai_reanalysis_audit (
    id SERIAL PRIMARY KEY,
    property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
    trigger_source VARCHAR(50) NOT NULL,
    trigger_id INTEGER,
    previous_state JSONB,
    new_state JSONB,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_property_ai_reanalysis_audit_property
    ON property_ai_reanalysis_audit(property_id);
CREATE INDEX IF NOT EXISTS idx_property_ai_reanalysis_audit_created
    ON property_ai_reanalysis_audit(created_at DESC);

COMMENT ON TABLE property_ai_summary_state IS 'Stores merged AI analysis state per property. Updated incrementally when documents or maintenance records change.';
COMMENT ON COLUMN property_ai_reanalysis_audit.trigger_source IS 'document | maintenance | inspection';
COMMENT ON COLUMN property_ai_reanalysis_audit.trigger_id IS 'document_id, maintenance_record_id, or inspection_result_id';
