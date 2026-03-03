"use strict";

const express = require("express");
const {
  ensureLoggedIn,
  ensureAdminOrSuperAdmin,
  ensureUserCanAccessAccountByParam,
} = require("../middleware/auth");
const Communication = require("../models/communication");
const CommTemplate = require("../models/commTemplate");
const CommAttachment = require("../models/commAttachment");
const Notification = require("../models/notification");
const {
  getRecipientOptions,
  resolveRecipients,
  estimateRecipients,
} = require("../services/commRecipients");
const db = require("../db");

const router = express.Router();

function toDb(body) {
  const map = {
    templateId: "template_id",
    subject: "subject",
    content: "content",
    imageKey: "image_key",
    recipientMode: "recipient_mode",
    recipientIds: "recipient_ids",
    deliveryChannel: "delivery_channel",
    status: "status",
    scheduledAt: "scheduled_at",
  };
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    if (body[k] !== undefined) out[v] = body[k];
  }
  return out;
}

/* ---------- Templates ---------- */

router.get("/templates", ensureLoggedIn, ensureAdminOrSuperAdmin, async (req, res, next) => {
  try {
    const accountId = req.query.accountId;
    if (!accountId) return res.status(400).json({ error: { message: "accountId required" } });
    const templates = await CommTemplate.listForAccount(accountId);
    return res.json({ templates });
  } catch (err) {
    return next(err);
  }
});

router.get("/templates/default", ensureLoggedIn, ensureAdminOrSuperAdmin, async (req, res, next) => {
  try {
    const accountId = req.query.accountId;
    if (!accountId) return res.status(400).json({ error: { message: "accountId required" } });
    const template = await CommTemplate.getOrCreateDefault(accountId);
    return res.json({ template });
  } catch (err) {
    return next(err);
  }
});

router.patch("/templates/:templateId", ensureLoggedIn, ensureAdminOrSuperAdmin, async (req, res, next) => {
  try {
    const template = await CommTemplate.update(req.params.templateId, req.body);
    return res.json({ template });
  } catch (err) {
    return next(err);
  }
});

/* ---------- Recipient helpers ---------- */

router.get("/recipients/options", ensureLoggedIn, ensureAdminOrSuperAdmin, async (req, res, next) => {
  try {
    const userId = res.locals.user.id;
    const role = res.locals.user.role;
    const options = await getRecipientOptions(userId, role);
    return res.json(options);
  } catch (err) {
    return next(err);
  }
});

router.post("/recipients/estimate", ensureLoggedIn, ensureAdminOrSuperAdmin, async (req, res, next) => {
  try {
    const userId = res.locals.user.id;
    const role = res.locals.user.role;
    const { recipientMode, recipientIds } = req.body;
    const count = await estimateRecipients(userId, role, recipientMode, recipientIds);
    return res.json({ count });
  } catch (err) {
    return next(err);
  }
});

/* ---------- Recipient feed (must be before /:id) ---------- */

router.get("/received", ensureLoggedIn, async (req, res, next) => {
  try {
    const userId = res.locals.user.id;
    const { limit } = req.query;
    const comms = await Communication.listForRecipient(userId, {
      limit: limit ? parseInt(limit, 10) : 50,
    });
    return res.json({ communications: comms });
  } catch (err) {
    return next(err);
  }
});

/* ---------- CRUD ---------- */

router.get("/", ensureLoggedIn, ensureAdminOrSuperAdmin, async (req, res, next) => {
  try {
    const { accountId, status, limit } = req.query;
    if (!accountId) return res.status(400).json({ error: { message: "accountId required" } });
    const comms = await Communication.listForAccount(accountId, {
      status: status || undefined,
      limit: limit ? parseInt(limit, 10) : 100,
    });
    return res.json({ communications: comms });
  } catch (err) {
    return next(err);
  }
});

router.get("/:id/view", ensureLoggedIn, async (req, res, next) => {
  try {
    const comm = await Communication.getById(req.params.id);
    if (comm.status !== "sent") {
      return res.status(404).json({ error: { message: "Communication not found." } });
    }
    const recipientCheck = await db.query(
      `SELECT 1 FROM comm_recipients WHERE communication_id = $1 AND user_id = $2`,
      [comm.id, res.locals.user.id]
    );
    if (recipientCheck.rows.length === 0) {
      return res.status(404).json({ error: { message: "Communication not found." } });
    }
    const attachments = await CommAttachment.listForComm(comm.id);
    return res.json({ communication: comm, attachments });
  } catch (err) {
    return next(err);
  }
});

router.get("/:id", ensureLoggedIn, ensureAdminOrSuperAdmin, async (req, res, next) => {
  try {
    const comm = await Communication.getById(req.params.id);
    const attachments = await CommAttachment.listForComm(comm.id);
    const rules = await db.query(
      `SELECT id, trigger_event AS "triggerEvent", trigger_role AS "triggerRole", is_active AS "isActive"
       FROM comm_rules WHERE communication_id = $1 ORDER BY id`,
      [comm.id]
    );
    return res.json({ communication: comm, attachments, rules: rules.rows });
  } catch (err) {
    return next(err);
  }
});

router.post("/", ensureLoggedIn, ensureAdminOrSuperAdmin, async (req, res, next) => {
  try {
    const dbData = toDb(req.body);
    dbData.created_by = res.locals.user.id;
    dbData.account_id = req.body.accountId;

    if (!dbData.account_id) {
      return res.status(400).json({ error: { message: "accountId required" } });
    }

    const comm = await Communication.create(dbData);

    if (req.body.attachments?.length) {
      await CommAttachment.syncForComm(comm.id, req.body.attachments);
    }

    if (req.body.rules?.length) {
      for (const rule of req.body.rules) {
        await db.query(
          `INSERT INTO comm_rules (account_id, communication_id, trigger_event, trigger_role, is_active)
           VALUES ($1, $2, $3, $4, $5)`,
          [dbData.account_id, comm.id, rule.triggerEvent, rule.triggerRole || null, true]
        );
      }
    }

    const full = await Communication.getById(comm.id);
    const attachments = await CommAttachment.listForComm(comm.id);
    return res.status(201).json({ communication: full, attachments });
  } catch (err) {
    return next(err);
  }
});

router.patch("/:id", ensureLoggedIn, ensureAdminOrSuperAdmin, async (req, res, next) => {
  try {
    const existing = await Communication.getById(req.params.id);
    if (existing.status === "sent") {
      return res.status(400).json({ error: { message: "Cannot edit a sent communication." } });
    }

    const dbData = toDb(req.body);
    const comm = await Communication.update(req.params.id, dbData);

    if (req.body.attachments !== undefined) {
      await CommAttachment.syncForComm(comm.id, req.body.attachments || []);
    }

    if (req.body.rules !== undefined) {
      await db.query(`DELETE FROM comm_rules WHERE communication_id = $1`, [comm.id]);
      for (const rule of (req.body.rules || [])) {
        await db.query(
          `INSERT INTO comm_rules (account_id, communication_id, trigger_event, trigger_role, is_active)
           VALUES ($1, $2, $3, $4, $5)`,
          [existing.accountId, comm.id, rule.triggerEvent, rule.triggerRole || null, true]
        );
      }
    }

    const attachments = await CommAttachment.listForComm(comm.id);
    const rules = await db.query(
      `SELECT id, trigger_event AS "triggerEvent", trigger_role AS "triggerRole", is_active AS "isActive"
       FROM comm_rules WHERE communication_id = $1 ORDER BY id`,
      [comm.id]
    );
    return res.json({ communication: comm, attachments, rules: rules.rows });
  } catch (err) {
    return next(err);
  }
});

/* ---------- Send / Schedule ---------- */

router.post("/:id/send", ensureLoggedIn, ensureAdminOrSuperAdmin, async (req, res, next) => {
  try {
    const comm = await Communication.getById(req.params.id);
    if (comm.status === "sent") {
      return res.status(400).json({ error: { message: "Already sent." } });
    }

    const userId = res.locals.user.id;
    const role = res.locals.user.role;

    if (role === "agent") {
      const blocked = ["all_users", "all_agents", "selected_agents", "selected_users"];
      if (blocked.includes(comm.recipientMode)) {
        return res.status(403).json({ error: { message: "Agents can only send to homeowners." } });
      }
    }

    const { users, count } = await resolveRecipients(
      userId, role, comm.recipientMode, comm.recipientIds || []
    );

    await Communication.update(req.params.id, {
      status: "sent",
      sent_at: new Date().toISOString(),
      recipient_count: count,
    });

    const userIds = users.map((u) => u.id).filter(Boolean);
    for (const uid of userIds) {
      await db.query(
        `INSERT INTO comm_recipients (communication_id, user_id, channel, status, delivered_at)
         VALUES ($1, $2, $3, 'delivered', NOW())`,
        [comm.id, uid, comm.deliveryChannel === "email" ? "email" : "in_app"]
      );
      if (comm.deliveryChannel === "both") {
        await db.query(
          `INSERT INTO comm_recipients (communication_id, user_id, channel, status, delivered_at)
           VALUES ($1, $2, 'email', 'delivered', NOW())`,
          [comm.id, uid]
        );
      }
    }

    if (userIds.length > 0) {
      await Notification.createForUsers(userIds, {
        type: "communication_sent",
        title: `New: ${comm.subject || "Message"}`,
      });
    }

    const updated = await Communication.getById(req.params.id);
    return res.json({ communication: updated, sentTo: count });
  } catch (err) {
    return next(err);
  }
});

router.post("/:id/schedule", ensureLoggedIn, ensureAdminOrSuperAdmin, async (req, res, next) => {
  try {
    const { scheduledAt } = req.body;
    if (!scheduledAt) {
      return res.status(400).json({ error: { message: "scheduledAt is required" } });
    }
    const comm = await Communication.getById(req.params.id);
    if (comm.status === "sent") {
      return res.status(400).json({ error: { message: "Already sent." } });
    }
    const updated = await Communication.update(req.params.id, {
      status: "scheduled",
      scheduled_at: scheduledAt,
    });
    return res.json({ communication: updated });
  } catch (err) {
    return next(err);
  }
});

router.post("/:id/cancel-schedule", ensureLoggedIn, ensureAdminOrSuperAdmin, async (req, res, next) => {
  try {
    const comm = await Communication.getById(req.params.id);
    if (comm.status !== "scheduled") {
      return res.status(400).json({ error: { message: "Not scheduled." } });
    }
    const updated = await Communication.update(req.params.id, {
      status: "draft",
      scheduled_at: null,
    });
    return res.json({ communication: updated });
  } catch (err) {
    return next(err);
  }
});

/* ---------- Delete ---------- */

router.delete("/:id", ensureLoggedIn, ensureAdminOrSuperAdmin, async (req, res, next) => {
  try {
    await Communication.delete(req.params.id);
    return res.json({ deleted: req.params.id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
