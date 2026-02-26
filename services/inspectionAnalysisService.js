"use strict";

/**
 * Inspection Report Analysis Service
 *
 * Downloads PDF from S3, extracts text, calls OpenAI for structured analysis,
 * normalizes to canonical system list.
 */

const { PDFParse } = require("pdf-parse");
const OpenAI = require("openai");
const { getFile } = require("./s3Service");
const InspectionAnalysisJob = require("../models/inspectionAnalysisJob");
const InspectionAnalysisResult = require("../models/inspectionAnalysisResult");
const { AWS_S3_BUCKET } = require("../config");

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
  return CANONICAL_SYSTEMS.find((s) => lower.includes(s) || s.includes(lower)) || null;
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

const ANALYSIS_PROMPT = `You are an expert home inspector analyzing a property inspection report. Extract ALL structured information from the report text. Be thorough and comprehensive.

CRITICAL RULES:
- Output ONLY valid JSON. No markdown, no extra text.
- Extract EVERY system that is inspected, mentioned, or has findings. Include roof, gutters, foundation, exterior, windows, heating, ac, waterHeating, electrical, plumbing, safety, and any other systems present.
- Extract ALL recommendations, maintenance items, and items needing attention. Do not omit items—include everything the report mentions.
- Map systems to these canonical types only: roof, gutters, foundation, exterior, windows, heating, ac, waterHeating, electrical, plumbing, safety, inspections.
- For suggestedSystemsToAdd: include EVERY system that was inspected and has findings—each inspected system should appear here so the user can add it to their property.
- For needsAttention: include ALL defects, concerns, and recommendations from the report. Be thorough.
- For maintenanceSuggestions: include ALL maintenance tasks, service recommendations, and follow-up items.
- If the report does not mention something, omit it. Use confidence 0.5-0.9 when the report clearly states something; use 0.3-0.5 when inferred.
- For condition rating use exactly: excellent, good, fair, poor.
- For severity use: low, medium, high, critical.
- For priority use: low, medium, high, urgent.
- suggestedWhen: use phrases like "within 30 days", "within 6 months", "annually", "as soon as possible".
- Keep excerpts short (1-2 sentences max). Do not include full document text.

Output format (strict JSON):
{
  "condition": { "rating": "good", "confidence": 0.74, "rationale": "brief explanation" },
  "systemsDetected": [{ "systemType": "HVAC", "confidence": 0.81, "evidence": "short excerpt" }],
  "needsAttention": [{ "title": "...", "severity": "high", "priority": "urgent", "suggestedAction": "...", "evidence": "..." }],
  "suggestedSystemsToAdd": [{ "systemType": "Roof", "reason": "...", "confidence": 0.77 }],
  "maintenanceSuggestions": [{ "systemType": "HVAC", "task": "...", "suggestedWhen": "within 30 days", "priority": "high", "rationale": "...", "confidence": 0.76 }],
  "summary": "2-3 sentence summary of the report",
  "citations": [{ "page": 3, "excerpt": "short excerpt" }]
}

Report text:
`;

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

  // Use up to 100k chars (gpt-4o supports 128k context). Prioritize full report for accuracy.
  const maxChars = 100000;
  const textToUse = text.length > maxChars ? text.slice(0, maxChars) : text;

  let parsed;
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-4o",
      messages: [
        {
          role: "system",
          content: "You output only valid JSON. No markdown, no code blocks, no extra text.",
        },
        {
          role: "user",
          content: ANALYSIS_PROMPT + textToUse,
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
    : "good";

  const systemsDetected = (parsed.systemsDetected || []).map((s) => {
    const normalized = normalizeSystemType(s.systemType) || s.systemType;
    return {
      systemType: normalized,
      confidence: s.confidence ?? 0.5,
      evidence: s.evidence || null,
    };
  });

  const suggestedSystemsToAdd = (parsed.suggestedSystemsToAdd || []).map((s) => ({
    systemType: normalizeSystemType(s.systemType) || s.systemType,
    reason: s.reason || "",
    confidence: s.confidence ?? 0.5,
  }));

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
    severity: n.severity || "medium",
    evidence: n.evidence || null,
    suggestedAction: n.suggestedAction || "",
    priority: n.priority || "medium",
  }));

  try {
    await InspectionAnalysisResult.create({
      job_id: jobId,
      property_id: job.property_id,
      condition_rating: validCondition,
      condition_confidence: condition.confidence ?? null,
      condition_rationale: condition.rationale ?? null,
      systems_detected: systemsDetected,
      needs_attention: needsAttention,
      suggested_systems_to_add: suggestedSystemsToAdd,
      maintenance_suggestions: maintenanceSuggestions,
      summary: parsed.summary || null,
      citations: parsed.citations || [],
    });

    await InspectionAnalysisJob.updateStatus(jobId, { status: "completed", progress: "Done" });
  } catch (err) {
    console.error("[inspectionAnalysis] Save result error:", err);
    await InspectionAnalysisJob.updateStatus(jobId, {
      status: "failed",
      error_message: "Failed to save analysis result",
    });
  }
}

module.exports = { runAnalysis, CANONICAL_SYSTEMS };
