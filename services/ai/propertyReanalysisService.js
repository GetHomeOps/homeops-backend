"use strict";

/**
 * Property AI Reanalysis Service
 *
 * Event-driven re-analysis when new documents or maintenance records are added.
 * Sends only: existing AI summary state + newly added structured content.
 * Merges incrementally—does not reprocess entire property history.
 */

const OpenAI = require("openai");
const db = require("../../db");
const { normalizeSystemType } = require("../inspectionAnalysisService");

const CONFIDENCE_THRESHOLD_AUTO = 0.85;
const CONFIDENCE_THRESHOLD_REVIEW = 0.5;
const REANALYSIS_MODEL = process.env.AI_REANALYSIS_MODEL || "gpt-4o-mini";

// -----------------------------------------------------------------
// Response schema validation
// -----------------------------------------------------------------

const AI_RESPONSE_SCHEMA = {
  updatedSystems: "array",
  newlyDetectedSystems: "array",
  maintenanceRecommendations: "array",
  riskFlags: "array",
  summaryDelta: "string",
};

function validateAiResponse(obj) {
  if (!obj || typeof obj !== "object") return false;
  const required = ["updatedSystems", "newlyDetectedSystems", "maintenanceRecommendations", "riskFlags"];
  for (const key of required) {
    if (!Array.isArray(obj[key]) && (key === "summaryDelta" ? typeof obj[key] !== "string" : true)) {
      if (key !== "summaryDelta" && !(key in obj)) return false;
    }
  }
  if (!Array.isArray(obj.updatedSystems)) obj.updatedSystems = [];
  if (!Array.isArray(obj.newlyDetectedSystems)) obj.newlyDetectedSystems = [];
  if (!Array.isArray(obj.maintenanceRecommendations)) obj.maintenanceRecommendations = [];
  if (!Array.isArray(obj.riskFlags)) obj.riskFlags = [];
  if (typeof obj.summaryDelta !== "string") obj.summaryDelta = "";
  return true;
}

function normalizeSystemEntry(s) {
  if (!s || typeof s !== "object") return null;
  const name = (s.name || s.systemType || s.system_key || "").trim();
  if (!name) return null;
  const normalized = normalizeSystemType(name) || name;
  const condition = (s.condition || "unknown").toLowerCase();
  const validCondition = ["excellent", "good", "fair", "poor"].includes(condition) ? condition : "unknown";
  const confidence = typeof s.confidence === "number" ? Math.max(0, Math.min(1, s.confidence)) : 0.5;
  return {
    name: normalized,
    condition: validCondition,
    confidence,
    notes: s.notes || null,
    recommendedActions: Array.isArray(s.recommendedActions) ? s.recommendedActions : [],
    needsReview: confidence > 0 && confidence < CONFIDENCE_THRESHOLD_AUTO,
  };
}

// -----------------------------------------------------------------
// Structured extraction: documents and maintenance
// -----------------------------------------------------------------

/**
 * Extract structured content from a property document (metadata + optional chunk excerpt).
 */
async function extractDocumentStructuredContent(propertyId, documentId) {
  const docRes = await db.query(
    `SELECT id, document_name, document_date, document_type, system_key
     FROM property_documents
     WHERE id = $1 AND property_id = $2`,
    [documentId, propertyId]
  );
  if (docRes.rows.length === 0) return null;

  const doc = docRes.rows[0];
  const base = {
    source: "document",
    documentId: doc.id,
    documentType: doc.document_type,
    date: doc.document_date,
    systemReferenced: doc.system_key,
    documentName: doc.document_name,
  };

  // Optional: first chunk excerpt for condition/cost/contractor hints
  const chunkRes = await db.query(
    `SELECT content FROM document_chunks WHERE document_id = $1 ORDER BY chunk_index ASC LIMIT 1`,
    [documentId]
  );
  if (chunkRes.rows.length > 0 && chunkRes.rows[0].content) {
    const excerpt = String(chunkRes.rows[0].content).slice(0, 800);
    base.excerpt = excerpt;
  }

  return base;
}

/**
 * Extract structured content from a maintenance record.
 */
function extractMaintenanceStructuredContent(record) {
  if (!record || !record.system_key) return null;
  const data = record.data || {};
  return {
    source: "maintenance",
    maintenanceId: record.id,
    systemKey: record.system_key,
    completedAt: record.completed_at,
    nextServiceDate: record.next_service_date,
    status: record.status,
    observedCondition: data.condition || data.observedCondition || null,
    cost: data.cost ?? data.amount ?? null,
    contractor: data.contractor ?? data.contractorName ?? null,
    warrantyExpiration: data.warrantyExpiration ?? data.warranty_expiration ?? null,
    notes: data.notes || null,
  };
}

/**
 * Build structured content from inspection analysis result (for merge after inspection completes).
 */
function extractInspectionStructuredContent(analysis) {
  if (!analysis) return null;
  return {
    source: "inspection",
    inspectionResultId: analysis.id,
    conditionRating: analysis.condition_rating,
    conditionConfidence: analysis.condition_confidence,
    conditionRationale: analysis.condition_rationale,
    systemsDetected: analysis.systems_detected || [],
    needsAttention: analysis.needs_attention || [],
    maintenanceSuggestions: analysis.maintenance_suggestions || [],
    suggestedSystemsToAdd: analysis.suggested_systems_to_add || [],
    summary: analysis.summary,
  };
}

// -----------------------------------------------------------------
// State retrieval and persistence
// -----------------------------------------------------------------

async function getPreviousAiSummary(propertyId) {
  const res = await db.query(
    `SELECT updated_systems, newly_detected_systems, maintenance_recommendations,
            risk_flags, summary_delta, report_analysis, last_reanalysis_at
     FROM property_ai_summary_state
     WHERE property_id = $1`,
    [propertyId]
  );
  return res.rows[0] || null;
}

async function saveAiSummary(propertyId, state, triggerSource, triggerId, previousState) {
  const client = await db.connect();
  try {
    await client.query("BEGIN");

    const auditRow = {
      property_id: propertyId,
      trigger_source: triggerSource,
      trigger_id: triggerId,
      previous_state: previousState ? JSON.stringify(previousState) : null,
      new_state: JSON.stringify(state),
    };

    await client.query(
      `INSERT INTO property_ai_summary_state
       (property_id, updated_systems, newly_detected_systems, maintenance_recommendations,
        risk_flags, summary_delta, report_analysis, last_reanalysis_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, NOW(), NOW())
       ON CONFLICT (property_id) DO UPDATE SET
         updated_systems = EXCLUDED.updated_systems,
         newly_detected_systems = EXCLUDED.newly_detected_systems,
         maintenance_recommendations = EXCLUDED.maintenance_recommendations,
         risk_flags = EXCLUDED.risk_flags,
         summary_delta = EXCLUDED.summary_delta,
         report_analysis = COALESCE(EXCLUDED.report_analysis, property_ai_summary_state.report_analysis),
         last_reanalysis_at = NOW(),
         updated_at = NOW()`,
      [
        propertyId,
        JSON.stringify(state.updatedSystems || []),
        JSON.stringify(state.newlyDetectedSystems || []),
        JSON.stringify(state.maintenanceRecommendations || []),
        JSON.stringify(state.riskFlags || []),
        state.summaryDelta || null,
        state.reportAnalysis || null,
      ]
    );

    await client.query(
      `INSERT INTO property_ai_reanalysis_audit
       (property_id, trigger_source, trigger_id, previous_state, new_state)
       VALUES ($1, $2, $3, $4::jsonb, $5::jsonb)`,
      [
        auditRow.property_id,
        auditRow.trigger_source,
        auditRow.trigger_id,
        auditRow.previous_state,
        auditRow.new_state,
      ]
    );

    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

// -----------------------------------------------------------------
// Prompt building and AI call
// -----------------------------------------------------------------

function buildReanalysisPrompt(previousState, newContent) {
  const previousJson = previousState
    ? JSON.stringify({
        updatedSystems: previousState.updated_systems || [],
        newlyDetectedSystems: previousState.newly_detected_systems || [],
        maintenanceRecommendations: previousState.maintenance_recommendations || [],
        riskFlags: previousState.risk_flags || [],
        reportAnalysis: previousState.report_analysis || null,
      })
    : "{}";

  const newContentJson = JSON.stringify(newContent);

  return `You are a property analysis assistant. Merge the EXISTING property AI summary with NEWLY ADDED content. Return ONLY valid JSON.

RULES:
- Do NOT hallucinate systems. Only include systems that appear in existing state OR are clearly evidenced in the new content.
- For updatedSystems: each entry needs name, condition (excellent/good/fair/poor), confidence (0-1), notes, recommendedActions.
- Only add to newlyDetectedSystems when the new content STRONGLY implies a system not in updatedSystems. Use high confidence (>0.8).
- For maintenanceRecommendations: merge with existing; add new tasks from new content; avoid duplicates.
- For riskFlags: merge existing with new; include severity and system when relevant.
- summaryDelta: 1-2 sentences explaining what changed from the previous analysis.
- Preserve existing analysis when new content does not contradict it.

EXISTING AI SUMMARY:
${previousJson}

NEWLY ADDED CONTENT (structured):
${newContentJson}

Return JSON only (no markdown):
{
  "updatedSystems": [{"name": "roof", "condition": "Good", "confidence": 0.92, "notes": "...", "recommendedActions": []}],
  "newlyDetectedSystems": [],
  "maintenanceRecommendations": [{"system": "roof", "task": "...", "priority": "medium", "suggestedWhen": "..."}],
  "riskFlags": [{"message": "...", "severity": "medium", "system": "roof"}],
  "summaryDelta": "What changed from previous analysis"
}`;
}

async function callReanalysisAi(previousState, newContent) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY not configured");
  }

  const openai = new OpenAI({ apiKey });
  const prompt = buildReanalysisPrompt(previousState, newContent);

  const completion = await openai.chat.completions.create({
    model: REANALYSIS_MODEL,
    messages: [
      { role: "system", content: "You output only valid JSON. No markdown, no code blocks, no extra text." },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
    response_format: { type: "json_object" },
  });

  const content = completion.choices[0]?.message?.content;
  if (!content) throw new Error("Empty AI response");

  const parsed = JSON.parse(content);
  if (!validateAiResponse(parsed)) throw new Error("Invalid AI response schema");

  return parsed;
}

// -----------------------------------------------------------------
// Apply confidence logic: only auto-update system status if confidence > 0.85
// -----------------------------------------------------------------

function applyConfidenceLogic(parsed) {
  const updatedSystems = (parsed.updatedSystems || []).map((s) => {
    const norm = normalizeSystemEntry(s);
    if (!norm) return null;
    if (norm.confidence < CONFIDENCE_THRESHOLD_AUTO && norm.condition !== "unknown") {
      norm.needsReview = true;
      norm._originalCondition = norm.condition;
      norm.condition = norm.confidence < CONFIDENCE_THRESHOLD_REVIEW ? "unknown" : norm.condition;
    }
    return norm;
  }).filter(Boolean);

  const newlyDetected = (parsed.newlyDetectedSystems || []).map((s) => {
    const norm = normalizeSystemEntry(s);
    if (!norm) return null;
    if (norm.confidence < CONFIDENCE_THRESHOLD_AUTO) norm.needsReview = true;
    return norm;
  }).filter(Boolean);

  return {
    ...parsed,
    updatedSystems,
    newlyDetectedSystems: newlyDetected,
  };
}

// -----------------------------------------------------------------
// Public API
// -----------------------------------------------------------------

/**
 * Trigger reanalysis when a new document is uploaded.
 * @param {number} propertyId
 * @param {number} documentId
 */
async function triggerReanalysisOnDocument(propertyId, documentId) {
  const extracted = await extractDocumentStructuredContent(propertyId, documentId);
  if (!extracted) return { skipped: true, reason: "Document not found" };

  return runReanalysis(propertyId, [extracted], "document", documentId);
}

/**
 * Trigger reanalysis when a maintenance record is created or updated.
 * @param {number} propertyId
 * @param {Object} maintenanceRecord - Full record with id, system_key, data, etc.
 */
async function triggerReanalysisOnMaintenance(propertyId, maintenanceRecord) {
  const extracted = extractMaintenanceStructuredContent(maintenanceRecord);
  if (!extracted) return { skipped: true, reason: "Invalid maintenance record" };

  return runReanalysis(propertyId, [extracted], "maintenance", maintenanceRecord.id);
}

/**
 * Trigger reanalysis when inspection analysis completes.
 * @param {number} propertyId
 * @param {Object} inspectionResult - Full inspection_analysis_results row
 */
async function triggerReanalysisOnInspection(propertyId, inspectionResult) {
  const extracted = extractInspectionStructuredContent(inspectionResult);
  if (!extracted) return { skipped: true, reason: "Invalid inspection result" };

  return runReanalysis(propertyId, [extracted], "inspection", inspectionResult.id);
}

/**
 * Core reanalysis: fetch previous state, call AI, validate, apply confidence, save.
 */
async function runReanalysis(propertyId, newContentItems, triggerSource, triggerId) {
  if (!newContentItems || newContentItems.length === 0) {
    return { skipped: true, reason: "No content to merge" };
  }

  const previousState = await getPreviousAiSummary(propertyId);
  const previousForAudit = previousState
    ? {
        updatedSystems: previousState.updated_systems,
        newlyDetectedSystems: previousState.newly_detected_systems,
        maintenanceRecommendations: previousState.maintenance_recommendations,
        riskFlags: previousState.risk_flags,
      }
    : null;

  let parsed;
  try {
    parsed = await callReanalysisAi(previousState, newContentItems);
  } catch (err) {
    console.error("[propertyReanalysis] AI call failed:", err.message);
    throw err;
  }

  const withConfidence = applyConfidenceLogic(parsed);
  const stateToSave = {
    updatedSystems: withConfidence.updatedSystems,
    newlyDetectedSystems: withConfidence.newlyDetectedSystems,
    maintenanceRecommendations: withConfidence.maintenanceRecommendations,
    riskFlags: withConfidence.riskFlags,
    summaryDelta: withConfidence.summaryDelta,
    reportAnalysis: withConfidence.reportAnalysis || (previousState && previousState.report_analysis),
  };

  await saveAiSummary(propertyId, stateToSave, triggerSource, triggerId, previousForAudit);

  return {
    success: true,
    triggerSource,
    triggerId,
    systemsUpdated: stateToSave.updatedSystems.length,
    needsReview: stateToSave.updatedSystems.some((s) => s.needsReview)
      || stateToSave.newlyDetectedSystems.some((s) => s.needsReview),
  };
}

/**
 * Get current AI summary for a property (for frontend/API).
 */
async function getAiSummaryForProperty(propertyId) {
  const row = await getPreviousAiSummary(propertyId);
  if (!row) return null;

  return {
    updatedSystems: row.updated_systems,
    newlyDetectedSystems: row.newly_detected_systems,
    maintenanceRecommendations: row.maintenance_recommendations,
    riskFlags: row.risk_flags,
    summaryDelta: row.summary_delta,
    reportAnalysis: row.report_analysis,
    lastReanalysisAt: row.last_reanalysis_at,
  };
}

/**
 * Get audit trail for a property (before/after view).
 */
async function getReanalysisAudit(propertyId, limit = 20) {
  const res = await db.query(
    `SELECT id, property_id, trigger_source, trigger_id, previous_state, new_state, created_at
     FROM property_ai_reanalysis_audit
     WHERE property_id = $1
     ORDER BY created_at DESC
     LIMIT $2`,
    [propertyId, limit]
  );
  return res.rows;
}

module.exports = {
  triggerReanalysisOnDocument,
  triggerReanalysisOnMaintenance,
  triggerReanalysisOnInspection,
  runReanalysis,
  getAiSummaryForProperty,
  getReanalysisAudit,
  extractDocumentStructuredContent,
  extractMaintenanceStructuredContent,
  extractInspectionStructuredContent,
  CONFIDENCE_THRESHOLD_AUTO,
};
