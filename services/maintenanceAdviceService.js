"use strict";

/**
 * AI Maintenance Advisor Service
 *
 * Analyzes property and system data (inspection reports, reanalysis, user-entered
 * system info) and returns actionable suggestions like "Replace X" or "Maintain Y".
 */

const OpenAI = require("openai");
const db = require("../db");
const InspectionAnalysisResult = require("../models/inspectionAnalysisResult");
const { getAiSummaryForProperty } = require("./ai/propertyReanalysisService");
const { normalizeSystemType } = require("./inspectionAnalysisService");

const MODEL = process.env.AI_MAINTENANCE_ADVICE_MODEL || "gpt-4o-mini";

function matchesSystem(systemKey, rawType) {
  if (!systemKey || !rawType) return false;
  const key = String(systemKey).toLowerCase().replace(/-/g, "");
  const norm = normalizeSystemType(rawType);
  if (!norm) return false;
  const normLower = String(norm).toLowerCase();
  return key === normLower || key.includes(normLower) || normLower.includes(key);
}

/**
 * Get inspection findings for the specified system.
 */
function filterFindingsForSystem(analysis, systemType) {
  if (!analysis) return { needsAttention: [], maintenanceSuggestions: [] };
  const needs = (analysis.needs_attention || analysis.needsAttention || []).filter(
    (n) => matchesSystem(systemType, n.systemType || n.system_type)
  );
  const maint = (
    analysis.maintenance_suggestions || analysis.maintenanceSuggestions || []
  ).filter((m) => matchesSystem(systemType, m.systemType || m.system_type));
  return { needsAttention: needs, maintenanceSuggestions: maint };
}

/**
 * Get maintenance recommendations for the system from reanalysis.
 */
function filterReanalysisForSystem(aiSummary, systemType) {
  if (!aiSummary?.maintenanceRecommendations) return [];
  return (aiSummary.maintenanceRecommendations || []).filter((r) => {
    const name = r.systemName || r.systemType || r.system_key || "";
    return matchesSystem(systemType, name);
  });
}

/**
 * Build system context string from frontend-provided systemContext.
 */
function buildSystemContextString(systemContext) {
  if (!systemContext || typeof systemContext !== "object") return "No system details available.";
  const lines = [];
  for (const [key, val] of Object.entries(systemContext)) {
    if (val == null || val === "") continue;
    const label = key.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
    lines.push(`${label}: ${val}`);
  }
  return lines.length ? lines.join("\n") : "No system details available.";
}

/**
 * Generate AI maintenance advice for a property/system.
 *
 * @param {Object} params
 * @param {string|number} params.propertyId - Property id (numeric or property_uid)
 * @param {string} params.systemType - e.g. "roof", "heating"
 * @param {string} params.systemName - Display name e.g. "Roof"
 * @param {Object} [params.systemContext] - Optional system-specific data from property (lastInspection, condition, issues, etc.)
 * @returns {Promise<{ recommendedFrequency, riskWarning, suggestedQuestions, suggestions }>}
 */
async function getMaintenanceAdvice({
  propertyId,
  systemType,
  systemName,
  systemContext = {},
}) {
  // Resolve property id
  let resolvedId = propertyId;
  if (!/^\d+$/.test(String(propertyId))) {
    const propRes = await db.query(
      `SELECT id FROM properties WHERE property_uid = $1`,
      [propertyId]
    );
    if (propRes.rows.length === 0) {
      throw new Error("Property not found");
    }
    resolvedId = propRes.rows[0].id;
  } else {
    resolvedId = parseInt(propertyId, 10);
  }

  const [analysis, aiSummary] = await Promise.all([
    InspectionAnalysisResult.getByPropertyId(resolvedId),
    getAiSummaryForProperty(resolvedId),
  ]);

  const { needsAttention, maintenanceSuggestions } = filterFindingsForSystem(
    analysis,
    systemType
  );
  const reanalysisMaint = filterReanalysisForSystem(aiSummary, systemType);

  const systemContextStr = buildSystemContextString(systemContext);

  const inspectionBlock =
    needsAttention.length > 0 || maintenanceSuggestions.length > 0
      ? `
INSPECTION REPORT FINDINGS (for ${systemName}):
${needsAttention.length > 0 ? `Needs attention:\n${JSON.stringify(needsAttention, null, 2)}` : ""}
${maintenanceSuggestions.length > 0 ? `Maintenance suggestions:\n${JSON.stringify(maintenanceSuggestions, null, 2)}` : ""}`
      : "";

  const reanalysisBlock =
    reanalysisMaint.length > 0
      ? `
REANALYSIS MAINTENANCE RECOMMENDATIONS:
${JSON.stringify(reanalysisMaint, null, 2)}`
      : "";

  const prompt = `You are an expert home maintenance advisor. Analyze the following information about the "${systemName}" system for a property and provide practical advice.

PROPERTY/SYSTEM DATA ENTERED BY USER:
${systemContextStr}
${inspectionBlock}
${reanalysisBlock}

Provide a JSON response with exactly these keys:
- recommendedFrequency: A brief sentence on recommended inspection/maintenance frequency (e.g. "Annual inspection recommended", "Every 6 months for filter replacement")
- riskWarning: If there is something urgent (overdue maintenance, poor condition, critical finding), a 1-2 sentence warning. Otherwise null.
- suggestedQuestions: Array of 2-4 questions the homeowner could ask their contractor (e.g. "What is included in a standard maintenance visit?")
- suggestions: Array of 2-6 actionable recommendations in second-person, imperative form. Be specific based on the data:
  - For items that need REPLACEMENT: "Replace [component]" with brief reason (e.g. "Replace roof shingles due to age (15+ years)")
  - For items that need MAINTENANCE: "Maintain [or have maintained] [task]" (e.g. "Have gutters cleaned annually", "Replace HVAC filters every 90 days")
  - Base suggestions on inspection findings, maintenance suggestions, condition, last service date, warranty, and age
  - If data is sparse, include general best-practice suggestions for this system type
  - Use clear, concise language. No preamble or filler.

Output ONLY valid JSON, no markdown.`;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return getFallbackAdvice(systemName, systemContext);
  }

  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: MODEL,
    messages: [
      {
        role: "user",
        content: prompt,
      },
    ],
    temperature: 0.3,
    max_tokens: 800,
  });

  const content = completion.choices?.[0]?.message?.content?.trim();
  if (!content) return getFallbackAdvice(systemName, systemContext);

  try {
    const parsed = JSON.parse(content);
    return {
      recommendedFrequency:
        parsed.recommendedFrequency || "Annual inspection recommended",
      riskWarning: parsed.riskWarning || null,
      suggestedQuestions:
        Array.isArray(parsed.suggestedQuestions) && parsed.suggestedQuestions.length > 0
          ? parsed.suggestedQuestions
          : [
            "What is included in a standard maintenance visit?",
            "Do you offer a maintenance plan or service contract?",
            "Are there any signs of wear I should monitor between visits?",
          ],
      suggestions:
        Array.isArray(parsed.suggestions) && parsed.suggestions.length > 0
          ? parsed.suggestions
          : [],
    };
  } catch {
    return getFallbackAdvice(systemName, systemContext);
  }
}

function getFallbackAdvice(systemName, systemContext) {
  const lastDate = systemContext?.lastInspection || systemContext?.lastMaintenance;
  const isOverdue =
    lastDate &&
    new Date(lastDate) < new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);

  return {
    recommendedFrequency: "Annual inspection recommended",
    riskWarning: isOverdue
      ? `Last maintenance was over a year ago. Consider scheduling soon to prevent potential issues.`
      : null,
    suggestedQuestions: [
      "What is included in a standard maintenance visit?",
      "Do you offer a maintenance plan or service contract?",
      "Are there any signs of wear I should monitor between visits?",
    ],
    suggestions: isOverdue
      ? ["Schedule an inspection or maintenance visit soon"]
      : [],
  };
}

module.exports = { getMaintenanceAdvice };
