"use strict";

/**
 * Inspection Report Analysis Service
 *
 * Downloads PDF from S3, extracts text, calls OpenAI for structured analysis,
 * normalizes to canonical system list.
 */

const { PDFParse } = require("pdf-parse");
const OpenAI = require("openai");
const db = require("../db");
const { getFile } = require("./s3Service");
const InspectionAnalysisJob = require("../models/inspectionAnalysisJob");
const InspectionAnalysisResult = require("../models/inspectionAnalysisResult");
const { AWS_S3_BUCKET } = require("../config");

const { detectSystemsFromText } = require("./aiChatService");
const { triggerReanalysisOnInspection } = require("./ai/propertyReanalysisService");

const CANONICAL_SYSTEMS = [
  "roof",
  "gutters",
  "foundation",
  "exterior",
  "windows",
  "heating",
  "ac",
  "waterHeating",
  "electrical",
  "plumbing",
  "safety",
  "inspections",
];

/** Only unambiguous terminology (e.g. "HVAC" = heating+ac). AI decides best-fit for everything else. */
const SYSTEM_ALIASES = {
  hvac: ["heating", "ac"],
  "windows/doors": "windows",
  "water heater": "waterHeating",
  "gutters/drainage": "gutters",
  "fire safety": "safety",
  "air conditioning": "ac",
  "water heating": "waterHeating",
};

function normalizeSystemType(raw) {
  if (!raw || typeof raw !== "string") return null;
  const lower = raw.toLowerCase().trim().replace(/\s+/g, "");
  for (const [alias, canonical] of Object.entries(SYSTEM_ALIASES)) {
    const aliasNorm = alias.toLowerCase().replace(/\s+/g, "");
    if (lower.includes(aliasNorm) || aliasNorm.includes(lower)) {
      return Array.isArray(canonical) ? canonical[0] : canonical;
    }
  }
  const canonical = CANONICAL_SYSTEMS.find((s) => lower.includes(s) || s.includes(lower));
  if (canonical) return canonical;
  // Pass through custom system types (AI-chosen when no canonical fits)
  return raw.trim() || null;
}

async function extractTextFromPdf(buffer) {
  const parser = new PDFParse({ data: buffer });
  const result = await parser.getText();
  return result.text;
}

async function extractTextFromBuffer(buffer, mimeType) {
  if (mimeType === "application/pdf" || !mimeType) {
    try {
      return await extractTextFromPdf(buffer);
    } catch (err) {
      console.error("[inspectionAnalysis] PDF parse error:", err.message);
      return "";
    }
  }
  return "";
}

const CANONICAL_SYSTEMS_LIST = CANONICAL_SYSTEMS.join(", ");

const ANALYSIS_PROMPT = `You are an expert home inspector analyzing a property inspection report. Extract ALL structured information from the report text. Be thorough and comprehensive.

CRITICAL RULES:
- Output ONLY valid JSON. No markdown, no extra text.
- Extract EVERY system that is inspected, mentioned, or has findings. Extract ALL recommendations, maintenance items, and items needing attention. Do not omit items—include everything the report mentions.

SYSTEM TYPE: For each finding, choose the best-fitting system. You have two options:
1. Use a canonical type when it fits: ${CANONICAL_SYSTEMS_LIST}
2. Use a custom systemType when none of the above fit well (e.g. "pool", "deck", "landscaping", "septic"). Use lowercase camelCase (e.g. swimmingPool) or kebab-case (e.g. swimming-pool).

Analyze each report finding and assign the system that best describes it. Do not force findings into unrelated categories. If siding, stucco, or exterior envelope issues fit "exterior", use it. If a spa or pool fits neither plumbing nor any canonical type, use a custom "pool" or "spa". Use your judgment.

- For suggestedSystemsToAdd: include every system the report inspected with findings. Prefer canonical types when they fit; suggest custom types when the report describes systems not in the canonical list (so the user can add them to their property). Each system with findings should appear here.
- For needsAttention: assign systemType to each item—choose the best fit from canonical or custom.
- For maintenanceSuggestions: assign systemType to each task—choose the best fit from canonical or custom.
- If the report does not mention something, omit it. Use confidence 0.5-0.9 when the report clearly states something; use 0.3-0.5 when inferred.
- For condition rating use exactly: excellent, good, fair, poor. Use "unknown" only when there is truly insufficient information.
- Overall condition: ALWAYS try to infer a condition from the report. If not explicitly stated, predict from findings, recommendations, severity of issues, age of systems, and overall report tone. Only use "unknown" when the report has almost no usable information. When you infer (rather than extract) a condition, include confidence; when condition is "unknown", omit confidence.
- For systemsDetected: include condition when inferable from findings/recommendations for that system. When condition is specified, include confidence. When condition cannot be determined, use "unknown" and omit confidence.
- For severity use: low, medium, high, critical.
- For priority use: low, medium, high, urgent.
- suggestedWhen: use phrases like "within 30 days", "within 6 months", "annually", "as soon as possible".
- Keep excerpts short (1-2 sentences max). Do not include full document text.

Output format (strict JSON):
{
  "condition": { "rating": "good", "confidence": 0.74, "rationale": "brief explanation" },
  "systemsDetected": [{ "systemType": "HVAC", "condition": "good", "confidence": 0.81, "evidence": "short excerpt" }],
  "needsAttention": [{ "title": "...", "systemType": "Roof", "severity": "high", "priority": "urgent", "suggestedAction": "...", "evidence": "..." }],
  "suggestedSystemsToAdd": [{ "systemType": "Roof", "reason": "...", "confidence": 0.77 }],
  "maintenanceSuggestions": [{ "systemType": "HVAC", "task": "...", "suggestedWhen": "within 30 days", "priority": "high", "rationale": "...", "confidence": 0.76 }],
  "summary": "2-3 sentence summary of the report",
  "citations": [{ "page": 3, "excerpt": "short excerpt" }]
}

Report text:
`;

/** Fetch property context (existing systems) for analysis. */
async function getPropertyContextForAnalysis(propertyId) {
  const [propRes, systemsRes] = await Promise.all([
    db.query(
      `SELECT property_name, address, city, state, year_built FROM properties WHERE id = $1`,
      [propertyId]
    ),
    db.query(
      `SELECT system_key FROM property_systems WHERE property_id = $1`,
      [propertyId]
    ),
  ]);
  const prop = propRes.rows[0] || {};
  const existingSystems = (systemsRes.rows || []).map((r) => r.system_key).filter(Boolean);
  const parts = [];
  if (prop.property_name || prop.address) {
    parts.push(`Property: ${prop.property_name || "Unnamed"} at ${[prop.address, prop.city, prop.state].filter(Boolean).join(", ")}${prop.year_built ? ` (built ${prop.year_built})` : ""}`);
  }
  if (existingSystems.length > 0) {
    parts.push(`Property ALREADY tracks these systems: ${existingSystems.join(", ")}. Suggest adding any system the report inspected that is NOT in this list.`);
  }
  return parts.length > 0 ? parts.join("\n") + "\n\n" : "";
}

async function runAnalysis(jobId) {
  const job = await InspectionAnalysisJob.get(jobId);
  if (job.status !== "queued" && job.status !== "processing") {
    return;
  }

  await InspectionAnalysisJob.updateStatus(jobId, { status: "processing", progress: "Downloading report..." });

  let buffer;
  try {
    if (!AWS_S3_BUCKET) {
      throw new Error("S3 bucket not configured");
    }
    buffer = await getFile(job.s3_key);
  } catch (err) {
    console.error("[inspectionAnalysis] S3 download error:", err);
    await InspectionAnalysisJob.updateStatus(jobId, {
      status: "failed",
      error_message: "Failed to download report from storage",
    });
    return;
  }

  await InspectionAnalysisJob.updateStatus(jobId, { progress: "Extracting text..." });

  let text = await extractTextFromBuffer(buffer, job.mime_type);

  if (!text || text.trim().length < 100) {
    await InspectionAnalysisJob.updateStatus(jobId, {
      status: "failed",
      error_message: "Could not extract enough text from the report. The file may be scanned or corrupted.",
    });
    return;
  }

  // Rule-based pre-detection: deterministic keyword scan before LLM
  const keywordDetections = detectSystemsFromText(text);
  const preDetectedSystems = keywordDetections.map((d) => d.system);

  await InspectionAnalysisJob.updateStatus(jobId, { progress: "Analyzing with AI..." });

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    await InspectionAnalysisJob.updateStatus(jobId, {
      status: "failed",
      error_message: "AI analysis is not configured. Set OPENAI_API_KEY.",
    });
    return;
  }

  const openai = new OpenAI({ apiKey });

  const maxChars = 100000;
  const textToUse = text.length > maxChars ? text.slice(0, maxChars) : text;

  // Fetch property context (existing systems) to pass to the AI
  const propertyContext = await getPropertyContextForAnalysis(job.property_id);

  let parsed;
  try {
    const preDetectionHint = preDetectedSystems.length > 0
      ? `\n\nA keyword scan found references to: ${preDetectedSystems.join(", ")}. Consider which canonical or custom systems these relate to and include them in systemsDetected and suggestedSystemsToAdd where appropriate.\n\n`
      : "";

    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You output only valid JSON. No markdown, no code blocks, no extra text.",
        },
        {
          role: "user",
          content: (propertyContext ? `PROPERTY CONTEXT:\n${propertyContext}\n` : "") + ANALYSIS_PROMPT + preDetectionHint + textToUse,
        },
      ],
      temperature: 0.2,
      response_format: { type: "json_object" },
    });

    const content = completion.choices[0]?.message?.content;
    if (!content) {
      throw new Error("Empty response from AI");
    }
    parsed = JSON.parse(content);
  } catch (err) {
    console.error("[inspectionAnalysis] OpenAI error:", err);
    await InspectionAnalysisJob.updateStatus(jobId, {
      status: "failed",
      error_message: err.message || "AI analysis failed",
    });
    return;
  }

  const condition = parsed.condition || {};
  const conditionRating = (condition.rating || "unknown").toLowerCase();
  const validCondition = ["excellent", "good", "fair", "poor"].includes(conditionRating)
    ? conditionRating
    : "unknown";

  // Merge pre-detected systems the LLM may have missed
  const llmSystemTypes = new Set(
    (parsed.systemsDetected || []).map((s) => (normalizeSystemType(s.systemType) || s.systemType || "").toLowerCase())
  );
  for (const det of keywordDetections) {
    const normalized = normalizeSystemType(det.system) || det.system;
    if (!llmSystemTypes.has(normalized.toLowerCase())) {
      if (!parsed.systemsDetected) parsed.systemsDetected = [];
      parsed.systemsDetected.push({
        systemType: normalized,
        condition: "unknown",
        confidence: det.confidence * 0.6,
        evidence: `Detected via keyword scan: ${det.matchedKeywords.join(", ")}`,
      });
    }
  }

  const systemsDetectedSeen = new Set();
  const systemsDetected = (parsed.systemsDetected || [])
    .map((s) => {
      const normalized = normalizeSystemType(s.systemType) || s.systemType;
      const sysCondition = (s.condition || "unknown").toLowerCase();
      const hasCondition = ["excellent", "good", "fair", "poor"].includes(sysCondition);
      return {
        systemType: normalized,
        condition: hasCondition ? sysCondition : "unknown",
        confidence: hasCondition ? (s.confidence ?? 0.5) : null,
        evidence: s.evidence || null,
      };
    })
    .filter((s) => {
      const key = (s.systemType || "").toString().toLowerCase();
      if (!key || systemsDetectedSeen.has(key)) return false;
      systemsDetectedSeen.add(key);
      return true;
    });

  const suggestedSystemsToAddSeen = new Set();
  let suggestedSystemsToAdd = (parsed.suggestedSystemsToAdd || [])
    .map((s) => ({
      systemType: normalizeSystemType(s.systemType) || s.systemType,
      reason: s.reason || "",
      confidence: s.confidence ?? 0.5,
    }))
    .filter((s) => {
      const key = (s.systemType || "").toString().toLowerCase();
      if (!key || suggestedSystemsToAddSeen.has(key)) return false;
      suggestedSystemsToAddSeen.add(key);
      return true;
    });

  // Merge: add any system from systemsDetected (incl. pre-detected) that the LLM missed in suggestedSystemsToAdd
  for (const det of systemsDetected) {
    const key = (det.systemType || "").toString().toLowerCase();
    if (key && !suggestedSystemsToAddSeen.has(key)) {
      suggestedSystemsToAddSeen.add(key);
      suggestedSystemsToAdd.push({
        systemType: det.systemType,
        reason: det.evidence || `Report inspected ${det.systemType}`,
        confidence: det.confidence ?? 0.5,
      });
    }
  }

  const maintenanceSuggestions = (parsed.maintenanceSuggestions || []).map((s) => ({
    systemType: normalizeSystemType(s.systemType) || s.systemType,
    task: s.task || "",
    suggestedWhen: s.suggestedWhen || "",
    priority: s.priority || "medium",
    rationale: s.rationale || "",
    confidence: s.confidence ?? 0.5,
  }));

  const needsAttention = (parsed.needsAttention || []).map((n) => ({
    title: n.title || "",
    systemType: n.systemType ? normalizeSystemType(n.systemType) || n.systemType : null,
    severity: n.severity || "medium",
    evidence: n.evidence || null,
    suggestedAction: n.suggestedAction || "",
    priority: n.priority || "medium",
  }));

  try {
    const result = await InspectionAnalysisResult.create({
      job_id: jobId,
      property_id: job.property_id,
      condition_rating: validCondition,
      condition_confidence: validCondition === "unknown" ? null : (condition.confidence ?? null),
      condition_rationale: condition.rationale ?? null,
      systems_detected: systemsDetected,
      needs_attention: needsAttention,
      suggested_systems_to_add: suggestedSystemsToAdd,
      maintenance_suggestions: maintenanceSuggestions,
      summary: parsed.summary || null,
      citations: parsed.citations || [],
    });

    await InspectionAnalysisJob.updateStatus(jobId, { status: "completed", progress: "Done" });

    // Trigger AI reanalysis to merge inspection with existing property AI state (async)
    triggerReanalysisOnInspection(job.property_id, result).catch((err) =>
      console.error("[propertyReanalysis] Inspection trigger failed:", err.message)
    );
  } catch (err) {
    console.error("[inspectionAnalysis] Save result error:", err);
    await InspectionAnalysisJob.updateStatus(jobId, {
      status: "failed",
      error_message: "Failed to save analysis result",
    });
  }
}

module.exports = { runAnalysis, CANONICAL_SYSTEMS, normalizeSystemType };
