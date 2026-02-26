"use strict";

const express = require("express");
const db = require("../db");
const OpenAI = require("openai");
const { ensureLoggedIn, ensurePropertyAccess } = require("../middleware/auth");
const { BadRequestError, ForbiddenError } = require("../expressError");
const MaintenanceEvent = require("../models/maintenanceEvent");
const InspectionAnalysisResult = require("../models/inspectionAnalysisResult");
const documentRagService = require("../services/documentRagService");

const router = express.Router();

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

/** Build property context for chat (profile + inspection summary + maintenance history). */
async function getPropertyContext(propertyId) {
  const [propRes, analysisRes, maintenanceRes] = await Promise.all([
    db.query(
      `SELECT property_name, address, city, state, zip, year_built
       FROM properties WHERE id = $1`,
      [propertyId]
    ),
    db.query(
      `SELECT condition_rating, summary, systems_detected, needs_attention, maintenance_suggestions
       FROM inspection_analysis_results r
       JOIN inspection_analysis_jobs j ON j.id = r.job_id
       WHERE r.property_id = $1 AND j.status = 'completed'
       ORDER BY r.created_at DESC LIMIT 1`,
      [propertyId]
    ),
    db.query(
      `SELECT system_key, system_name, scheduled_date, status
       FROM maintenance_events
       WHERE property_id = $1
       ORDER BY scheduled_date DESC
       LIMIT 10`,
      [propertyId]
    ),
  ]);

  const prop = propRes.rows[0] || {};
  const analysis = analysisRes.rows[0] || {};
  const maintenance = maintenanceRes.rows || [];
  const parts = [];
  parts.push(`Property: ${prop.property_name || "Unnamed"} at ${[prop.address, prop.city, prop.state].filter(Boolean).join(", ")}`);
  if (prop.year_built) parts.push(`Year built: ${prop.year_built}`);
  if (analysis.condition_rating) parts.push(`Condition (from inspection): ${analysis.condition_rating}`);
  if (analysis.summary) parts.push(`Inspection summary: ${analysis.summary}`);
  if (analysis.systems_detected?.length) {
    parts.push(`Systems detected: ${analysis.systems_detected.map((s) => s.systemType).join(", ")}`);
  }
  if (analysis.needs_attention?.length) {
    parts.push(`Needs attention: ${analysis.needs_attention.map((n) => n.title).join("; ")}`);
  }
  if (maintenance.length > 0) {
    parts.push(`Recent maintenance: ${maintenance.map((m) => `${m.system_name || m.system_key} (${m.scheduled_date}, ${m.status})`).join("; ")}`);
  }
  return parts.join("\n");
}

/** POST /chat - Send message, get AI response. Body: { conversationId?, propertyId, message }. */
router.post(
  "/chat",
  ensureLoggedIn,
  async function (req, res, next) {
    try {
      const { conversationId, propertyId, message } = req.body || {};
      const userId = res.locals.user.id;

      if (!propertyId || !message || typeof message !== "string") {
        throw new BadRequestError("propertyId and message are required");
      }

      req.params = { propertyId };
      await resolvePropertyId(req, res, () => {});
      const resolvedId = req.resolvedPropertyId;
      if (!resolvedId) throw new BadRequestError("Invalid property");

      const accessCheck = await db.query(
        `SELECT 1 FROM property_users WHERE property_id = $1 AND user_id = $2`,
        [resolvedId, userId]
      );
      if (accessCheck.rows.length === 0 && res.locals.user.role !== "super_admin" && res.locals.user.role !== "admin") {
        throw new ForbiddenError("You do not have access to this property.");
      }

      const apiKey = process.env.OPENAI_API_KEY;
      if (!apiKey) {
        throw new BadRequestError("AI chat is not configured. Set OPENAI_API_KEY.");
      }

      const [context, docContext] = await Promise.all([
        getPropertyContext(resolvedId),
        documentRagService.getDocumentContext(resolvedId, message).catch(() => ""),
      ]);

      const contextParts = [`Property context:\n${context}`];
      if (docContext) contextParts.push(docContext);

      const openai = new OpenAI({ apiKey });
      const systemPrompt = `You are a helpful property assistant. Use only the property context and documents provided. Do not invent facts. If the user asks about scheduling maintenance or inspections, suggest specific tasks and indicate you can help schedule them. Be concise.`;

      const completion = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: `${contextParts.join("\n\n")}\n\nUser question: ${message}` },
        ],
        temperature: 0.3,
      });

      const assistantMessage = completion.choices[0]?.message?.content || "I couldn't generate a response.";

      const lowerMsg = (assistantMessage + message).toLowerCase();
      const hasScheduleIntent = lowerMsg.includes("schedule") || lowerMsg.includes("book") || lowerMsg.includes("maintenance") || lowerMsg.includes("inspection");

      let uiDirectives = null;
      if (hasScheduleIntent) {
        const analysisRes = await db.query(
          `SELECT maintenance_suggestions FROM inspection_analysis_results r
           JOIN inspection_analysis_jobs j ON j.id = r.job_id
           WHERE r.property_id = $1 AND j.status = 'completed'
           ORDER BY r.created_at DESC LIMIT 1`,
          [resolvedId]
        );
        const suggestions = analysisRes.rows[0]?.maintenance_suggestions || [];
        let tasks = suggestions.slice(0, 3).map((s) => ({
          systemType: s.systemType,
          task: s.task || s.systemType,
          suggestedWhen: s.suggestedWhen,
          priority: s.priority,
        }));
        if (tasks.length === 0) {
          tasks = [{ systemType: "general", task: "Maintenance / inspection", suggestedWhen: "as needed", priority: "medium" }];
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

      return res.json({
        conversationId: conversationId || null,
        assistantMessage,
        uiDirectives,
      });
    } catch (err) {
      return next(err);
    }
  }
);

/** POST /ingest-documents - Backfill RAG for property documents. Body: { propertyId }. Admin or property access. */
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

      const accessCheck = await db.query(
        `SELECT 1 FROM property_users WHERE property_id = $1 AND user_id = $2`,
        [resolvedId, userId]
      );
      if (accessCheck.rows.length === 0 && res.locals.user.role !== "super_admin" && res.locals.user.role !== "admin") {
        throw new ForbiddenError("You do not have access to this property.");
      }

      const results = await documentRagService.ingestPropertyDocuments(resolvedId);
      return res.json({ ingested: results });
    } catch (err) {
      return next(err);
    }
  }
);

/** POST /actions/:actionDraftId/select-contractor - Set contractor for draft. Body: { contractorId, contractorSource?, contractorName? }. */
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

/** POST /actions/:actionDraftId/confirm-schedule - Create maintenance event from draft. Body: { scheduledFor, notes? }. */
router.post(
  "/actions/:actionDraftId/confirm-schedule",
  ensureLoggedIn,
  async function (req, res, next) {
    try {
      const draftId = req.params.actionDraftId;
      const userId = res.locals.user.id;
      const { scheduledFor, notes } = req.body || {};

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
      const systemName = firstTask.task || systemKey;

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
        system_name: systemName,
        contractor_id: contractorId,
        contractor_source: contractorSource,
        contractor_name: contractorName,
        scheduled_date: scheduledFor,
        scheduled_time: null,
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

module.exports = router;
