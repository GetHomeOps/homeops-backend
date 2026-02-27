"use strict";

/**
 * Compute per-system aiCondition from inspection analysis.
 * Matches system_key with systemsDetected, needsAttention, maintenanceSuggestions.
 * Does not persist; returns computed object to attach to each system.
 */

const { normalizeSystemType } = require("../services/inspectionAnalysisService");

/** Map severity/priority to status. */
function severityToStatus(severity, priority) {
  const s = (severity || "").toLowerCase();
  const p = (priority || "").toLowerCase();
  if (s === "urgent" || s === "critical" || p === "urgent") return "poor";
  if (s === "high" || p === "high") return "poor";
  if (s === "medium" || p === "medium") return "fair";
  if (s === "low" || p === "low") return "good";
  return "fair";
}

/** Check if system key matches a normalized system type. */
function matchesSystem(systemKey, rawType) {
  if (!systemKey || !rawType) return false;
  const key = String(systemKey).toLowerCase().replace(/-/g, "");
  const norm = normalizeSystemType(rawType);
  if (!norm) return false;
  const normLower = String(norm).toLowerCase();
  return key === normLower || key.includes(normLower) || normLower.includes(key);
}

/**
 * Compute aiCondition for a single system from inspection analysis.
 * @param {string} systemKey - e.g. "roof", "heating", "waterHeating"
 * @param {Object} analysis - Inspection analysis result (systems_detected, needs_attention, maintenance_suggestions, condition_rating)
 * @returns {Object|null} aiCondition or null if no analysis / confidence too low
 */
function computeAiConditionForSystem(systemKey, analysis) {
  if (!analysis || !systemKey) return null;

  const systemsDetected = analysis.systems_detected || analysis.systemsDetected || [];
  const needsAttention = analysis.needs_attention || analysis.needsAttention || [];
  const maintenanceSuggestions = analysis.maintenance_suggestions || analysis.maintenanceSuggestions || [];
  const overallCondition = (analysis.condition_rating || analysis.conditionRating || "good").toLowerCase();

  let status = null;
  let severity = null;
  let confidence = null;
  let source = "inspection_analysis";

  // Check needsAttention first (defects take precedence)
  const needsForSystem = needsAttention.filter((n) => {
    const st = n.systemType || n.system_type;
    return st && matchesSystem(systemKey, st);
  });
  if (needsForSystem.length > 0) {
    const worst = needsForSystem.reduce((a, b) => {
      const aSev = (a.severity || a.priority || "").toLowerCase();
      const bSev = (b.severity || b.priority || "").toLowerCase();
      const order = { urgent: 0, critical: 1, high: 2, medium: 3, low: 4 };
      return (order[aSev] ?? 5) <= (order[bSev] ?? 5) ? a : b;
    });
    severity = worst.severity || worst.priority || "medium";
    status = severityToStatus(severity, worst.priority);
    confidence = 0.7;
  }

  // Else check maintenanceSuggestions for this system
  if (status == null) {
    const maintForSystem = maintenanceSuggestions.filter((m) =>
      matchesSystem(systemKey, m.systemType || m.system_type)
    );
    if (maintForSystem.length > 0) {
      const worst = maintForSystem.reduce((a, b) => {
        const aP = (a.priority || "").toLowerCase();
        const bP = (b.priority || "").toLowerCase();
        const order = { urgent: 0, high: 1, medium: 2, low: 3 };
        return (order[aP] ?? 4) <= (order[bP] ?? 4) ? a : b;
      });
      severity = worst.priority || "medium";
      status = severityToStatus(severity, worst.priority);
      confidence = worst.confidence ?? 0.6;
    }
  }

  // Else if system detected but no issues, use overall condition or good
  if (status == null) {
    const isDetected = systemsDetected.some((s) =>
      matchesSystem(systemKey, s.systemType || s.system_type)
    );
    if (isDetected) {
      status = ["excellent", "good", "fair", "poor"].includes(overallCondition)
        ? overallCondition
        : "good";
      confidence = 0.5;
    }
  }

  if (status == null) return null;

  // Confidence threshold - don't show if too low
  if (confidence != null && confidence < 0.5) return null;

  const result = { status, source };
  if (severity) result.severity = severity.toLowerCase();
  if (confidence != null) result.confidence = confidence;
  return result;
}

/**
 * Enrich systems array with aiCondition per system.
 * @param {Array} systems - From property_systems
 * @param {Object|null} analysis - Inspection analysis for property
 * @returns {Array} Systems with aiCondition added
 */
function enrichSystemsWithAiCondition(systems, analysis) {
  if (!Array.isArray(systems)) return systems;
  if (!analysis) return systems;

  return systems.map((s) => {
    const systemKey = s.system_key || s.systemKey;
    const aiCondition = computeAiConditionForSystem(systemKey, analysis);
    return { ...s, aiCondition: aiCondition || undefined };
  });
}

module.exports = {
  computeAiConditionForSystem,
  enrichSystemsWithAiCondition,
};
