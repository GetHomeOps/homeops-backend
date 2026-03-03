"use strict";

const db = require("../db");
const OpenAI = require("openai");

const SLIDING_WINDOW_SIZE = 8;
const SUMMARY_TRIGGER_COUNT = 16;
const MAX_RESPONSE_TOKENS = 800;
const CHAT_TEMPERATURE = 0.35;

// -----------------------------------------------------------------
// Keyword-based system detection for inspection text
// -----------------------------------------------------------------

const SYSTEM_KEYWORDS = {
  roof: ["roof", "roofing", "shingles", "flashing", "soffit", "fascia", "ridge", "attic ventilation"],
  plumbing: ["plumbing", "pipes", "faucet", "drain", "sewer", "water supply", "toilet", "water line", "valve"],
  hvac: ["hvac", "furnace", "air conditioning", "heating", "cooling", "ductwork", "thermostat", "condenser", "heat pump", "air handler"],
  electrical: ["electrical", "wiring", "breaker", "panel", "outlet", "circuit", "grounding", "gfci", "afci"],
  foundation: ["foundation", "crawl space", "basement", "slab", "footing", "settlement", "crack"],
  appliances: ["appliance", "dishwasher", "refrigerator", "oven", "stove", "washer", "dryer", "microwave", "garbage disposal"],
  structure: ["structural", "framing", "load-bearing", "beam", "joist", "truss", "support"],
  gutters: ["gutter", "downspout", "drainage"],
  exterior: ["exterior", "siding", "stucco", "brick veneer", "paint", "cladding", "exterior walls", "exterior maintenance", "exterior surfaces", "trim", "caulking", "masonry", "weep hole", "vinyl siding", "wood siding", "hardie", "eifs", "weather barrier", "water intrusion"],
  windows: ["window", "door", "weatherstripping", "glazing", "screen"],
  waterHeating: ["water heater", "water heating", "hot water", "tankless"],
  safety: ["smoke detector", "carbon monoxide", "fire extinguisher", "safety", "radon", "handrail"],
};

function detectSystemsFromText(text) {
  if (!text) return [];
  const lower = text.toLowerCase();
  const detected = [];
  for (const [system, keywords] of Object.entries(SYSTEM_KEYWORDS)) {
    const matched = keywords.filter((kw) => lower.includes(kw));
    if (matched.length > 0) {
      detected.push({
        system,
        confidence: Math.min(0.5 + matched.length * 0.15, 0.95),
        matchedKeywords: matched,
      });
    }
  }
  return detected.sort((a, b) => b.confidence - a.confidence);
}

// -----------------------------------------------------------------
// Intent detection — determines which data slice to inject
// -----------------------------------------------------------------

const INTENT_KEYWORDS = {
  roof: ["roof", "roofing", "shingle", "leak"],
  plumbing: ["plumbing", "pipe", "faucet", "drain", "sewer", "water line"],
  heating: ["heating", "furnace", "heat pump", "hvac"],
  ac: ["ac", "air conditioning", "cooling", "condenser"],
  electrical: ["electrical", "wiring", "breaker", "panel", "outlet"],
  foundation: ["foundation", "crawl space", "basement", "slab"],
  gutters: ["gutter", "downspout", "drainage"],
  exterior: ["exterior", "siding", "paint"],
  windows: ["window", "door"],
  waterHeating: ["water heater", "hot water", "tankless"],
  safety: ["smoke detector", "carbon monoxide", "fire safety", "radon"],
  schedule: ["schedule", "book", "appointment", "maintenance due", "set up", "arrange"],
  general: ["summary", "overview", "property", "overall", "everything"],
};

function detectIntent(message) {
  if (!message) return { type: "general", systems: [] };
  const lower = message.toLowerCase();

  if (/\b(schedule|book|set up|arrange|appointment)\b/.test(lower)) {
    return { type: "schedule", systems: [] };
  }

  const matchedSystems = [];
  for (const [system, keywords] of Object.entries(INTENT_KEYWORDS)) {
    if (system === "schedule" || system === "general") continue;
    if (keywords.some((kw) => lower.includes(kw))) {
      matchedSystems.push(system);
    }
  }

  if (matchedSystems.length > 0) {
    return { type: "system_specific", systems: matchedSystems };
  }

  if (/\b(summary|overview|everything|full report|all systems)\b/.test(lower)) {
    return { type: "general", systems: [] };
  }

  return { type: "conversational", systems: [] };
}

// -----------------------------------------------------------------
// Context builder — only injects relevant data based on intent
// -----------------------------------------------------------------

async function buildFocusedContext(propertyId, intent, existingSummary) {
  const parts = [];

  if (existingSummary) {
    parts.push(`Previous conversation summary: ${existingSummary}`);
  }

  const propRes = await db.query(
    `SELECT property_name, address, city, state, zip, year_built
     FROM properties WHERE id = $1`,
    [propertyId]
  );
  const prop = propRes.rows[0] || {};
  parts.push(`Property: ${prop.property_name || "Unnamed"} at ${[prop.address, prop.city, prop.state].filter(Boolean).join(", ")}${prop.year_built ? ` (built ${prop.year_built})` : ""}`);

  if (intent.type === "general") {
    const analysisRes = await db.query(
      `SELECT condition_rating, condition_rationale, summary, r.created_at
       FROM inspection_analysis_results r
       JOIN inspection_analysis_jobs j ON j.id = r.job_id
       WHERE r.property_id = $1 AND j.status = 'completed'
       ORDER BY r.created_at DESC LIMIT 1`,
      [propertyId]
    );
    const analysis = analysisRes.rows[0];
    if (analysis) {
      parts.push(`Inspection analysis (${analysis.created_at?.toISOString?.()?.slice(0, 10) || "N/A"}): Condition ${analysis.condition_rating}. ${analysis.summary || ""}`);
    }
    return { context: parts.join("\n"), analysisDate: analysis?.created_at || null };
  }

  if (intent.type === "system_specific" && intent.systems.length > 0) {
    const analysisRes = await db.query(
      `SELECT systems_detected, needs_attention, maintenance_suggestions, r.created_at
       FROM inspection_analysis_results r
       JOIN inspection_analysis_jobs j ON j.id = r.job_id
       WHERE r.property_id = $1 AND j.status = 'completed'
       ORDER BY r.created_at DESC LIMIT 1`,
      [propertyId]
    );
    const analysis = analysisRes.rows[0] || {};
    const targetSystems = new Set(intent.systems.map((s) => s.toLowerCase()));

    const relevantDetected = (analysis.systems_detected || []).filter(
      (s) => targetSystems.has((s.systemType || "").toLowerCase())
    );
    if (relevantDetected.length > 0) {
      parts.push(`Relevant systems: ${relevantDetected.map((s) => `${s.systemType} (${s.condition || "unknown"})`).join(", ")}`);
    }

    const relevantAttention = (analysis.needs_attention || []).filter(
      (n) => targetSystems.has((n.systemType || "").toLowerCase())
    );
    if (relevantAttention.length > 0) {
      parts.push(`Issues: ${relevantAttention.map((n) => `${n.title} [${n.severity}]${n.suggestedAction ? ` — ${n.suggestedAction}` : ""}`).join("; ")}`);
    }

    const relevantMaint = (analysis.maintenance_suggestions || []).filter(
      (m) => targetSystems.has((m.systemType || "").toLowerCase())
    );
    if (relevantMaint.length > 0) {
      parts.push(`Maintenance: ${relevantMaint.map((m) => `${m.task} (${m.suggestedWhen}) [${m.priority}]`).join("; ")}`);
    }

    for (const sysKey of intent.systems) {
      const eventsRes = await db.query(
        `SELECT system_name, scheduled_date, status FROM maintenance_events
         WHERE property_id = $1 AND (system_key = $2 OR system_key ILIKE $2)
         ORDER BY scheduled_date DESC LIMIT 3`,
        [propertyId, sysKey]
      );
      if (eventsRes.rows.length > 0) {
        parts.push(`${sysKey} events: ${eventsRes.rows.map((e) => `${e.system_name} (${e.scheduled_date}, ${e.status})`).join("; ")}`);
      }
    }

    return { context: parts.join("\n"), analysisDate: analysis.created_at || null };
  }

  return { context: parts.join("\n"), analysisDate: null };
}

// -----------------------------------------------------------------
// Sliding window + rolling summary
// -----------------------------------------------------------------

async function getWindowedMessages(conversationId) {
  const countRes = await db.query(
    `SELECT COUNT(*) AS cnt FROM ai_messages WHERE conversation_id = $1`,
    [conversationId]
  );
  const total = parseInt(countRes.rows[0].cnt, 10);

  const recent = await db.query(
    `SELECT role, content FROM ai_messages
     WHERE conversation_id = $1
     ORDER BY created_at DESC LIMIT $2`,
    [conversationId, SLIDING_WINDOW_SIZE]
  );
  const messages = recent.rows.reverse().map((r) => ({ role: r.role, content: r.content }));

  return { messages, total, needsSummary: total > SUMMARY_TRIGGER_COUNT };
}

async function generateAndStoreSummary(conversationId, openai, model) {
  const oldMessages = await db.query(
    `SELECT role, content FROM ai_messages
     WHERE conversation_id = $1
     ORDER BY created_at ASC
     LIMIT $2`,
    [conversationId, SUMMARY_TRIGGER_COUNT - SLIDING_WINDOW_SIZE]
  );

  const convRes = await db.query(
    `SELECT context_summary FROM ai_conversations WHERE id = $1`,
    [conversationId]
  );
  const existingSummary = convRes.rows[0]?.context_summary || "";

  const toSummarize = oldMessages.rows.map((r) => `${r.role}: ${r.content}`).join("\n");
  const summaryInput = existingSummary
    ? `Previous summary:\n${existingSummary}\n\nNew messages to incorporate:\n${toSummarize}`
    : toSummarize;

  try {
    const completion = await openai.chat.completions.create({
      model,
      messages: [
        {
          role: "system",
          content: "Summarize this conversation into a concise paragraph (max 200 words). Preserve key facts: systems discussed, conditions mentioned, recommendations given, actions taken. Output plain text only.",
        },
        { role: "user", content: summaryInput },
      ],
      temperature: 0.2,
      max_tokens: 300,
    });

    const summary = completion.choices[0]?.message?.content || "";
    if (summary) {
      await db.query(
        `UPDATE ai_conversations SET context_summary = $2, updated_at = NOW() WHERE id = $1`,
        [conversationId, summary]
      );
    }
    return summary;
  } catch (err) {
    console.error("[aiChatService] Summary generation failed:", err.message);
    return existingSummary;
  }
}

// -----------------------------------------------------------------
// Output sanitization — strip markdown artifacts
// -----------------------------------------------------------------

function sanitizeResponse(text) {
  if (!text) return text;
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")   // **bold** -> bold
    .replace(/\*([^*]+)\*/g, "$1")        // *italic* -> italic
    .replace(/__([^_]+)__/g, "$1")        // __bold__ -> bold
    .replace(/_([^_]+)_/g, "$1")          // _italic_ -> italic
    .replace(/^#{1,6}\s+/gm, "")          // # headings -> plain
    .replace(/^[-*+]\s+/gm, "- ")         // normalize list markers
    .replace(/`([^`]+)`/g, "$1")          // `code` -> code
    .replace(/```[\s\S]*?```/g, "")       // remove code blocks
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1"); // [link](url) -> link
}

// -----------------------------------------------------------------
// Exports
// -----------------------------------------------------------------

module.exports = {
  SLIDING_WINDOW_SIZE,
  SUMMARY_TRIGGER_COUNT,
  MAX_RESPONSE_TOKENS,
  CHAT_TEMPERATURE,
  SYSTEM_KEYWORDS,
  detectSystemsFromText,
  detectIntent,
  buildFocusedContext,
  getWindowedMessages,
  generateAndStoreSummary,
  sanitizeResponse,
};
