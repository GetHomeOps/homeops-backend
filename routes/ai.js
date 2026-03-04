"use strict";

const express = require("express");
const db = require("../db");
const OpenAI = require("openai");
const { ensureLoggedIn, ensurePropertyAccess } = require("../middleware/auth");
const { BadRequestError, ForbiddenError } = require("../expressError");
const { checkAiTokenQuota } = require("../services/tierService");
const MaintenanceEvent = require("../models/maintenanceEvent");
const InspectionAnalysisResult = require("../models/inspectionAnalysisResult");
const documentRagService = require("../services/documentRagService");
const ApiUsage = require("../models/apiUsage");
const { getAiSummaryForProperty, getReanalysisAudit } = require("../services/ai/propertyReanalysisService");
const {
  SLIDING_WINDOW_SIZE,
  MAX_RESPONSE_TOKENS,
  CHAT_TEMPERATURE,
  detectIntent,
  buildFocusedContext,
  getWindowedMessages,
  generateAndStoreSummary,
  sanitizeResponse,
} = require("../services/aiChatService");

const router = express.Router();

// -----------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------

async function resolvePropertyId(req, res, next) {
  try {
    const raw = req.params.propertyId || req.body?.propertyId;
    if (!raw) return next();
    if (/^\d+$/.test(String(raw))) {
      req.resolvedPropertyId = parseInt(raw, 10);
      return next();
    }
    if (/^[0-9A-Z]{26}$/i.test(raw)) {
      const propRes = await db.query(
        `SELECT id FROM properties WHERE property_uid = $1`,
        [raw]
      );
      if (propRes.rows.length === 0) throw new ForbiddenError("Property not found.");
      req.resolvedPropertyId = propRes.rows[0].id;
      return next();
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

async function ensurePropertyAccessForUser(resolvedId, userId, userRole) {
  const accessCheck = await db.query(
    `SELECT 1 FROM property_users WHERE property_id = $1 AND user_id = $2`,
    [resolvedId, userId]
  );
  if (accessCheck.rows.length === 0 && userRole !== "super_admin" && userRole !== "admin") {
    throw new ForbiddenError("You do not have access to this property.");
  }
}

const SYSTEM_PHRASE_MAP = {
  hvac: ["heating", "ac"],
  "air conditioning": "ac",
  ac: "ac",
  heating: "heating",
  furnace: "heating",
  roof: "roof",
  roofing: "roof",
  gutters: "gutters",
  gutter: "gutters",
  foundation: "foundation",
  exterior: "exterior",
  siding: "exterior",
  windows: "windows",
  "water heater": "waterHeating",
  waterheating: "waterHeating",
  electrical: "electrical",
  plumbing: "plumbing",
  safety: "safety",
  inspections: "inspections",
};

function detectSystemSwitchIntent(message) {
  const lower = (message || "").toLowerCase().trim();
  const switchPattern = /\b(what about|how about|switch to|tell me about|change to)\s+(.+?)(?:\?|$)/i;
  const match = lower.match(switchPattern);
  if (!match) return null;
  const phrase = (match[2] || "").trim().replace(/[.?]/g, "");
  for (const [key, val] of Object.entries(SYSTEM_PHRASE_MAP)) {
    if (phrase.includes(key)) {
      return Array.isArray(val) ? val[0] : val;
    }
  }
  return null;
}

async function getOrCreateConversation(userId, propertyId, systemId = null, systemContext = null) {
  const existing = await db.query(
    `SELECT id, system_id, system_context, context_summary FROM ai_conversations
     WHERE user_id = $1 AND property_id = $2 AND (system_id IS NOT DISTINCT FROM $3)
     ORDER BY updated_at DESC LIMIT 1`,
    [userId, propertyId, systemId || null]
  );
  if (existing.rows.length > 0) {
    const row = existing.rows[0];
    if (systemContext && Object.keys(systemContext).length > 0) {
      await db.query(
        `UPDATE ai_conversations SET system_id = $2, system_context = $3, updated_at = NOW() WHERE id = $1`,
        [row.id, systemId, JSON.stringify(systemContext)]
      );
    }
    return { id: row.id, contextSummary: row.context_summary };
  }
  const insert = await db.query(
    `INSERT INTO ai_conversations (property_id, user_id, system_id, system_context)
     VALUES ($1, $2, $3, $4::jsonb)
     RETURNING id`,
    [propertyId, userId, systemId, JSON.stringify(systemContext || {})]
  );
  return { id: insert.rows[0].id, contextSummary: null };
}

async function saveMessage(conversationId, role, content, uiDirectives = null) {
  await db.query(
    `INSERT INTO ai_messages (conversation_id, role, content, ui_directives)
     VALUES ($1, $2, $3, $4::jsonb)`,
    [conversationId, role, content, uiDirectives ? JSON.stringify(uiDirectives) : null]
  );
  await db.query(
    `UPDATE ai_conversations SET updated_at = NOW() WHERE id = $1`,
    [conversationId]
  );
}

async function getSystemContextFromDb(propertyId, systemId) {
  const systemKey = (systemId || "").toLowerCase();
  const [analysisRes, maintenanceRes, recordsRes] = await Promise.all([
    db.query(
      `SELECT systems_detected, needs_attention, maintenance_suggestions
       FROM inspection_analysis_results r
       JOIN inspection_analysis_jobs j ON j.id = r.job_id
       WHERE r.property_id = $1 AND j.status = 'completed'
       ORDER BY r.created_at DESC LIMIT 1`,
      [propertyId]
    ),
    db.query(
      `SELECT system_key, system_name, scheduled_date, status
       FROM maintenance_events
       WHERE property_id = $1 AND (system_key = $2 OR system_key ILIKE $2)
       ORDER BY scheduled_date DESC LIMIT 5`,
      [propertyId, systemKey]
    ),
    db.query(
      `SELECT system_key, completed_at, next_service_date, data
       FROM property_maintenance
       WHERE property_id = $1 AND (system_key = $2 OR system_key ILIKE $2)
       ORDER BY completed_at DESC NULLS LAST LIMIT 5`,
      [propertyId, systemKey]
    ),
  ]);
  const analysis = analysisRes.rows[0] || {};
  const systemsDetected = analysis.systems_detected || [];
  const sysMatch = systemsDetected.find(
    (s) => (s.systemType || s.system_key || "").toLowerCase() === systemKey
  );
  const needsAttention = (analysis.needs_attention || []).filter(
    (n) => (n.systemType || n.system_type || "").toLowerCase() === systemKey
  );
  const maintenanceSuggestions = (analysis.maintenance_suggestions || []).filter(
    (m) => (m.systemType || m.system_type || "").toLowerCase() === systemKey
  );
  const lastRecord = recordsRes.rows[0];
  const upcomingEvents = maintenanceRes.rows.filter(
    (e) => (e.scheduled_date || "") >= new Date().toISOString().slice(0, 10)
  );
  return {
    systemCondition: sysMatch?.condition || "unknown",
    lastMaintenanceDate: lastRecord?.completed_at || lastRecord?.next_service_date || null,
    upcomingEvents: upcomingEvents.map((e) => ({
      date: e.scheduled_date,
      type: e.system_name || e.system_key,
      status: e.status,
    })),
    inspectionFindingsForThisSystemOnly: [...needsAttention, ...maintenanceSuggestions].map((x) => ({
      title: x.title || x.task || x.systemType,
      severity: x.severity || x.priority,
      suggestedAction: x.suggestedAction || x.rationale || x.suggestedWhen,
    })),
  };
}

// -----------------------------------------------------------------
// System prompt builder
// -----------------------------------------------------------------

function buildSystemPrompt(systemId, systemName, systemCtx, contextSwitched) {
  const systemCondition = systemCtx?.systemCondition ?? systemCtx?.system_condition;
  const lastMaintenance = systemCtx?.lastMaintenanceDate ?? systemCtx?.last_maintenance_date;
  const upcomingEvents = systemCtx?.upcomingEvents ?? systemCtx?.upcoming_events ?? [];
  const findings = systemCtx?.inspectionFindingsForThisSystemOnly ?? systemCtx?.inspection_findings ?? [];

  let prompt = `You are a property advisor. Answer only the specific question asked. Do not summarize the entire property unless explicitly requested.

Respond in clean, professional plain text. Do not use markdown formatting such as asterisks, bold, italic, headings, or special characters. Use plain dashes for lists.

Use ONLY the property context and document excerpts provided. Cite specific details when relevant. Do not invent facts. If information is not in the context, say so.

Be natural and helpful. Be thorough but concise.`;

  if (systemId && systemName) {
    prompt += `

You MUST discuss ONLY the ${systemName} system unless the user explicitly changes topic. Do NOT return the full property inspection summary — focus only on ${systemName}.`;
    if (systemCondition) prompt += ` Current ${systemName} condition: ${systemCondition}.`;
    if (lastMaintenance) prompt += ` Last maintenance: ${lastMaintenance}.`;
    if (upcomingEvents?.length) prompt += ` Upcoming events: ${JSON.stringify(upcomingEvents)}.`;
    if (findings?.length) prompt += ` Inspection findings for this system: ${JSON.stringify(findings)}.`;
    prompt += `

Structure your response: Current condition, Risk level, Recommended action, Optional cost estimate range.`;
  }

  prompt += `

When relevant (poor/fair condition, overdue maintenance, no contractor assigned, or user asks to schedule), end with: "Would you like to schedule this now?" If the user confirms, acknowledge it and the system will offer scheduling.`;

  if (contextSwitched) {
    prompt += `\n\nUser just switched context to ${systemName}. Briefly confirm: "Switching to ${systemName}." then provide system-scoped insights.`;
  }

  return prompt;
}

// -----------------------------------------------------------------
// Routes
// -----------------------------------------------------------------

/** GET /system-context */
router.get(
  "/system-context",
  ensureLoggedIn,
  async function (req, res, next) {
    try {
      const { propertyId: rawPropId, systemId } = req.query || {};
      const userId = res.locals.user.id;
      if (!rawPropId || !systemId) {
        throw new BadRequestError("propertyId and systemId are required");
      }
      req.params = { propertyId: rawPropId };
      await resolvePropertyId(req, res, () => {});
      const resolvedId = req.resolvedPropertyId;
      if (!resolvedId) throw new BadRequestError("Invalid property");

      await ensurePropertyAccessForUser(resolvedId, userId, res.locals.user.role);

      const ctx = await getSystemContextFromDb(resolvedId, systemId);
      const systemName = (systemId || "").charAt(0).toUpperCase() + (systemId || "").slice(1);
      return res.json({ propertyId: resolvedId, systemId, systemName, ...ctx });
    } catch (err) {
      return next(err);
    }
  }
);

/** GET /conversations/latest — Load the most recent conversation for a property+user. */
router.get(
  "/conversations/latest",
  ensureLoggedIn,
  async function (req, res, next) {
    try {
      const { propertyId: rawPropId } = req.query || {};
      const userId = res.locals.user.id;
      if (!rawPropId) throw new BadRequestError("propertyId is required");

      req.params = { propertyId: rawPropId };
      await resolvePropertyId(req, res, () => {});
      const resolvedId = req.resolvedPropertyId;
      if (!resolvedId) throw new BadRequestError("Invalid property");

      await ensurePropertyAccessForUser(resolvedId, userId, res.locals.user.role);

      const convRes = await db.query(
        `SELECT id, system_id, system_context, context_summary, created_at, updated_at
         FROM ai_conversations
         WHERE user_id = $1 AND property_id = $2
         ORDER BY updated_at DESC LIMIT 1`,
        [userId, resolvedId]
      );

      if (convRes.rows.length === 0) {
        return res.json({ conversation: null, messages: [] });
      }

      const conv = convRes.rows[0];
      const msgRes = await db.query(
        `SELECT id, role, content, ui_directives, created_at
         FROM ai_messages
         WHERE conversation_id = $1
         ORDER BY created_at ASC`,
        [conv.id]
      );

      const analysisRes = await db.query(
        `SELECT r.created_at AS analysis_date
         FROM inspection_analysis_results r
         JOIN inspection_analysis_jobs j ON j.id = r.job_id
         WHERE r.property_id = $1 AND j.status = 'completed'
         ORDER BY r.created_at DESC LIMIT 1`,
        [resolvedId]
      );

      return res.json({
        conversation: {
          id: conv.id,
          systemId: conv.system_id,
          systemContext: conv.system_context,
          contextSummary: conv.context_summary,
          createdAt: conv.created_at,
          updatedAt: conv.updated_at,
        },
        messages: msgRes.rows.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
          uiDirectives: m.ui_directives,
          createdAt: m.created_at,
        })),
        inspectionAnalysisDate: analysisRes.rows[0]?.analysis_date || null,
      });
    } catch (err) {
      return next(err);
    }
  }
);

/** DELETE /conversations/:conversationId — Reset (delete) a conversation. */
router.delete(
  "/conversations/:conversationId",
  ensureLoggedIn,
  async function (req, res, next) {
    try {
      const { conversationId } = req.params;
      const userId = res.locals.user.id;

      const convRes = await db.query(
        `SELECT id, user_id FROM ai_conversations WHERE id = $1::uuid`,
        [conversationId]
      );
      if (convRes.rows.length === 0) {
        throw new BadRequestError("Conversation not found.");
      }
      if (convRes.rows[0].user_id !== userId && res.locals.user.role !== "super_admin") {
        throw new ForbiddenError("Not your conversation.");
      }

      await db.query(`DELETE FROM ai_conversations WHERE id = $1::uuid`, [conversationId]);
      return res.json({ deleted: true });
    } catch (err) {
      return next(err);
    }
  }
);

/** POST /chat — Send message, get AI response. */
router.post(
  "/chat",
  ensureLoggedIn,
  async function (req, res, next) {
    try {
      const { conversationId, propertyId, message, systemContext: clientSystemContext } = req.body || {};
      const userId = res.locals.user.id;

      if (!propertyId || !message || typeof message !== "string") {
        throw new BadRequestError("propertyId and message are required");
      }

      req.params = { propertyId };
      await resolvePropertyId(req, res, () => {});
      const resolvedId = req.resolvedPropertyId;
      if (!resolvedId) throw new BadRequestError("Invalid property");

      await ensurePropertyAccessForUser(resolvedId, userId, res.locals.user.role);

      const quotaCheck = await checkAiTokenQuota(userId, res.locals.user?.role);
      if (!quotaCheck.allowed) {
        throw new ForbiddenError(
          `AI token quota exceeded (${quotaCheck.used}/${quotaCheck.quota} this month). Upgrade your plan for more.`
        );
      }

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new BadRequestError("AI chat is not configured. Set OPENAI_API_KEY.");
      }

      // --- System switch detection ---
      let systemId = clientSystemContext?.systemId ?? null;
      let systemName = clientSystemContext?.systemName ?? null;
      let systemCtx = clientSystemContext ?? null;
      let contextSwitched = false;

      const switchTarget = detectSystemSwitchIntent(message);
      if (switchTarget) {
        systemId = switchTarget;
        systemCtx = await getSystemContextFromDb(resolvedId, systemId);
        systemName = systemId.charAt(0).toUpperCase() + systemId.slice(1);
        contextSwitched = true;
      } else if (clientSystemContext?.systemId) {
        systemCtx = clientSystemContext;
      } else if (conversationId) {
        const convRes = await db.query(
          `SELECT system_id, system_context FROM ai_conversations WHERE id = $1::uuid`,
          [conversationId]
        );
        if (convRes.rows.length > 0 && convRes.rows[0].system_id) {
          systemId = convRes.rows[0].system_id;
          systemCtx = convRes.rows[0].system_context || {};
          systemName = systemCtx.systemName || (systemId ? systemId.charAt(0).toUpperCase() + systemId.slice(1) : null);
        }
      }

      // --- Get or create conversation ---
      let convId = conversationId;
      let contextSummary = null;
      if (convId) {
        const verify = await db.query(
          `SELECT id, context_summary FROM ai_conversations WHERE id = $1::uuid AND user_id = $2 AND property_id = $3`,
          [convId, userId, resolvedId]
        );
        if (verify.rows.length === 0) {
          convId = null;
        } else {
          contextSummary = verify.rows[0].context_summary;
        }
      }
      if (!convId) {
        const conv = await getOrCreateConversation(userId, resolvedId, systemId, systemCtx);
        convId = conv.id;
        contextSummary = conv.contextSummary;
      } else if (systemCtx && Object.keys(systemCtx).length > 0) {
        await db.query(
          `UPDATE ai_conversations SET system_id = $2, system_context = $3, updated_at = NOW() WHERE id = $1::uuid`,
          [convId, systemId, JSON.stringify(systemCtx)]
        );
      }

      // --- Sliding window: get recent messages + check if summary needed ---
      const { messages: history, needsSummary } = await getWindowedMessages(convId);
      await saveMessage(convId, "user", message);

      // --- Intent detection: only inject relevant context ---
      const intent = detectIntent(message);
      const { context: focusedContext, analysisDate } = await buildFocusedContext(
        resolvedId,
        systemId ? { type: "system_specific", systems: [systemId] } : intent,
        contextSummary
      );

      // --- Document RAG (scoped to query, not full property) ---
      const docContext = await documentRagService
        .getDocumentContext(resolvedId, message, { limit: 6 })
        .catch(() => "");

      let contextBlock = `Property context:\n${focusedContext}`;
      if (docContext) contextBlock += `\n\nRelevant document excerpts:\n${docContext}`;

      // --- Build system prompt ---
      const systemPrompt = buildSystemPrompt(systemId, systemName, systemCtx, contextSwitched);

      // --- Assemble LLM messages ---
      const llmMessages = [
        { role: "system", content: systemPrompt },
        ...history.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: `${contextBlock}\n\nUser: ${message}` },
      ];

      // --- Call OpenAI ---
      const openai = new OpenAI({ apiKey });
      const chatModel = process.env.AI_CHAT_MODEL || "gpt-4o-mini";
      const completion = await openai.chat.completions.create({
        model: chatModel,
        messages: llmMessages,
        temperature: CHAT_TEMPERATURE,
        max_tokens: MAX_RESPONSE_TOKENS,
      });

      let assistantMessage = completion.choices[0]?.message?.content || "I couldn't generate a response.";

      // --- Sanitize markdown artifacts ---
      assistantMessage = sanitizeResponse(assistantMessage);

      if (contextSwitched && !assistantMessage.toLowerCase().includes("switching")) {
        assistantMessage = `Switching to ${systemName}.\n\n${assistantMessage}`;
      }

      // --- Record token usage ---
      const usage = completion.usage;
      if (usage?.prompt_tokens != null && usage?.completion_tokens != null) {
        ApiUsage.record({
          userId,
          endpoint: "ai/chat",
          model: chatModel,
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
        }).catch(() => {});
      }

      // --- Schedule intent detection ---
      const lowerUserMsg = (message || "").toLowerCase();
      const systemCondition = systemCtx?.systemCondition ?? systemCtx?.system_condition;
      const findings = systemCtx?.inspectionFindingsForThisSystemOnly ?? systemCtx?.inspection_findings ?? [];
      const shouldSuggestSchedule =
        (systemCondition && ["poor", "fair"].includes(String(systemCondition).toLowerCase())) ||
        (findings && findings.length > 0) ||
        /\b(schedule|book|set up|arrange|yes|yeah|sure|please)\b/.test(lowerUserMsg);

      const hasScheduleIntent =
        /\b(schedule|book|set up|arrange)\b/.test(lowerUserMsg) &&
        (/\b(maintenance|inspection|appointment|service|visit)\b/.test(lowerUserMsg) ||
          /\b(schedule|book)\s+(a|an|the|my|this)\b/.test(lowerUserMsg) ||
          /\b(want|would like|need|help me)\s+to\s+(schedule|book)\b/.test(lowerUserMsg)) ||
        (/\b(yes|yeah|sure|please|ok|okay)\b/.test(lowerUserMsg) && lowerUserMsg.length < 50);

      let uiDirectives = null;
      const effectiveSystemId = systemId || "general";
      if (hasScheduleIntent || (shouldSuggestSchedule && /\b(yes|yeah|sure|please)\b/.test(lowerUserMsg))) {
        const analysisRes = await db.query(
          `SELECT maintenance_suggestions FROM inspection_analysis_results r
           JOIN inspection_analysis_jobs j ON j.id = r.job_id
           WHERE r.property_id = $1 AND j.status = 'completed'
           ORDER BY r.created_at DESC LIMIT 1`,
          [resolvedId]
        );
        const suggestions = analysisRes.rows[0]?.maintenance_suggestions || [];
        let tasks = suggestions
          .filter((s) => !systemId || (s.systemType || "").toLowerCase() === effectiveSystemId)
          .slice(0, 3)
          .map((s) => ({
            systemType: s.systemType || effectiveSystemId,
            task: s.task || s.systemType || systemName || "Maintenance",
            suggestedWhen: s.suggestedWhen,
            priority: s.priority,
          }));
        if (tasks.length === 0) {
          tasks = [{ systemType: effectiveSystemId, task: systemName || "Maintenance / inspection", suggestedWhen: "as needed", priority: "medium" }];
        }
        const draftRes = await db.query(
          `INSERT INTO ai_action_drafts (property_id, user_id, status, tasks)
           VALUES ($1, $2, 'draft', $3::jsonb)
           RETURNING id`,
          [resolvedId, userId, JSON.stringify(tasks)]
        );
        uiDirectives = {
          type: "SCHEDULE_PROPOSAL",
          actionDraftId: draftRes.rows[0].id,
          tasks,
        };
      }

      // --- Save assistant message ---
      await saveMessage(convId, "assistant", assistantMessage, uiDirectives);

      // --- Trigger async summary if needed (don't block response) ---
      if (needsSummary) {
        generateAndStoreSummary(convId, openai, chatModel).catch((err) =>
          console.error("[ai/chat] Async summary failed:", err.message)
        );
      }

      return res.json({
        conversationId: convId,
        assistantMessage,
        uiDirectives,
        systemId: systemId || undefined,
        systemName: systemName || undefined,
        contextSwitched: contextSwitched || undefined,
        inspectionAnalysisDate: analysisDate || undefined,
      });
    } catch (err) {
      return next(err);
    }
  }
);

/** POST /ingest-documents */
router.post(
  "/ingest-documents",
  ensureLoggedIn,
  async function (req, res, next) {
    try {
      const { propertyId } = req.body || {};
      const userId = res.locals.user.id;

      if (!propertyId) throw new BadRequestError("propertyId is required");

      req.params = { propertyId };
      await resolvePropertyId(req, res, () => {});
      const resolvedId = req.resolvedPropertyId;
      if (!resolvedId) throw new BadRequestError("Invalid property");

      await ensurePropertyAccessForUser(resolvedId, userId, res.locals.user.role);

      const results = await documentRagService.ingestPropertyDocuments(resolvedId);
      return res.json({ ingested: results });
    } catch (err) {
      return next(err);
    }
  }
);

/** POST /actions/:actionDraftId/select-contractor */
router.post(
  "/actions/:actionDraftId/select-contractor",
  ensureLoggedIn,
  async function (req, res, next) {
    try {
      const draftId = req.params.actionDraftId;
      const userId = res.locals.user.id;
      const { contractorId, contractorSource, contractorName } = req.body || {};

      if (!contractorId) throw new BadRequestError("contractorId is required");

      const draftRes = await db.query(
        `SELECT id, user_id, property_id FROM ai_action_drafts WHERE id = $1::uuid`,
        [draftId]
      );
      if (draftRes.rows.length === 0) throw new ForbiddenError("Action draft not found.");
      const draft = draftRes.rows[0];
      if (draft.user_id !== userId) throw new ForbiddenError("Not your action draft.");

      const isContact = String(contractorId).startsWith("contact-");
      const isPro = String(contractorId).startsWith("pro-");
      const sourceId = isContact ? contractorId.replace("contact-", "") : isPro ? contractorId.replace("pro-", "") : contractorId;
      const source = contractorSource || (isContact ? "contact" : "professional");
      const numericId = /^\d+$/.test(sourceId) ? parseInt(sourceId, 10) : null;

      await db.query(
        `UPDATE ai_action_drafts
         SET contractor_id = $2, contractor_source = $3, contractor_name = $4, status = 'ready_to_schedule', updated_at = NOW()
         WHERE id = $1::uuid`,
        [draftId, numericId, source, contractorName || null]
      );

      return res.json({ status: "ready_to_schedule" });
    } catch (err) {
      return next(err);
    }
  }
);

/** POST /actions/:actionDraftId/confirm-schedule */
router.post(
  "/actions/:actionDraftId/confirm-schedule",
  ensureLoggedIn,
  async function (req, res, next) {
    try {
      const draftId = req.params.actionDraftId;
      const userId = res.locals.user.id;
      const { scheduledFor, scheduledTime, eventType, notes } = req.body || {};

      if (!scheduledFor) throw new BadRequestError("scheduledFor (YYYY-MM-DD) is required");

      const draftRes = await db.query(
        `SELECT * FROM ai_action_drafts WHERE id = $1::uuid`,
        [draftId]
      );
      if (draftRes.rows.length === 0) throw new ForbiddenError("Action draft not found.");
      const draft = draftRes.rows[0];
      if (draft.user_id !== userId) throw new ForbiddenError("Not your action draft.");
      if (draft.status !== "ready_to_schedule") {
        throw new BadRequestError("Select a contractor first.");
      }

      const tasks = draft.tasks || [];
      const firstTask = tasks[0] || {};
      const systemKey = firstTask.systemType || "general";
      const baseName = firstTask.task || systemKey;
      const systemNameForEvent =
        eventType === "inspection"
          ? baseName.toLowerCase().includes("inspection")
            ? baseName
            : `${baseName} inspection`
          : eventType === "maintenance"
            ? baseName.toLowerCase().includes("maintenance")
              ? baseName
              : `${baseName} maintenance`
            : baseName;

      let contractorId = null;
      let contractorSource = null;
      let contractorName = draft.contractor_name;
      if (draft.contractor_id && draft.contractor_source === "professional") {
        contractorId = parseInt(draft.contractor_id, 10);
        contractorSource = "professional";
      } else if (draft.contractor_source === "contact") {
        contractorSource = "contact";
        contractorId = null;
      }

      const event = await MaintenanceEvent.create({
        property_id: draft.property_id,
        system_key: systemKey,
        system_name: systemNameForEvent,
        contractor_id: contractorId,
        contractor_source: contractorSource,
        contractor_name: contractorName,
        scheduled_date: scheduledFor,
        scheduled_time: scheduledTime || null,
        recurrence_type: "one-time",
        alert_timing: "3d",
        email_reminder: true,
        message_enabled: !!notes,
        message_body: notes || null,
        status: "scheduled",
        created_by: userId,
      });

      await db.query(
        `UPDATE ai_action_drafts
         SET status = 'scheduled', maintenance_event_id = $2, scheduled_for = $3::date, notes = $4, updated_at = NOW()
         WHERE id = $1::uuid`,
        [draftId, event.id, scheduledFor, notes || null]
      );

      return res.json({
        status: "scheduled",
        eventId: event.id,
        event,
      });
    } catch (err) {
      return next(err);
    }
  }
);

/** GET /property-ai-summary/:propertyId - Get current AI summary state for property. */
router.get(
  "/property-ai-summary/:propertyId",
  ensureLoggedIn,
  async (req, res, next) => {
    try {
      const raw = req.params.propertyId;
      if (!raw) throw new BadRequestError("propertyId required");
      req.params = { propertyId: raw };
      await resolvePropertyId(req, res, () => {});
      const resolvedId = req.resolvedPropertyId;
      if (!resolvedId) throw new BadRequestError("Invalid property");

      await ensurePropertyAccessForUser(resolvedId, res.locals.user.id, res.locals.user.role);

      const summary = await getAiSummaryForProperty(resolvedId);
      return res.json({ aiSummary: summary });
    } catch (err) {
      return next(err);
    }
  }
);

/** GET /property-ai-audit/:propertyId - Get reanalysis audit trail for before/after view. */
router.get(
  "/property-ai-audit/:propertyId",
  ensureLoggedIn,
  async (req, res, next) => {
    try {
      const raw = req.params.propertyId;
      const limit = Math.min(parseInt(req.query.limit, 10) || 20, 50);
      if (!raw) throw new BadRequestError("propertyId required");
      req.params = { propertyId: raw };
      await resolvePropertyId(req, res, () => {});
      const resolvedId = req.resolvedPropertyId;
      if (!resolvedId) throw new BadRequestError("Invalid property");

      await ensurePropertyAccessForUser(resolvedId, res.locals.user.id, res.locals.user.role);

      const audit = await getReanalysisAudit(resolvedId, limit);
      return res.json({ audit });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
