"use strict";

const express = require("express");
const { ensureLoggedIn, ensurePlatformAdmin, ensureAdminOrSuperAdmin } = require("../middleware/auth");
const Resource = require("../models/resource");
const Notification = require("../models/notification");
const {
  estimateRecipients,
  resolveRecipients,
  getContactsForUser,
  getActiveUsersForUser,
} = require("../services/resourceRecipients");

const router = express.Router();

/** Map camelCase body to snake_case for DB */
function toDb(data) {
  const map = {
    subject: "subject",
    type: "type",
    recipientMode: "recipient_mode",
    recipientIds: "recipient_ids",
    contentFormat: "content_format",
    bodyText: "body_text",
    url: "url",
    imageKey: "image_key",
    pdfKey: "pdf_key",
    deliveryChannel: "delivery_channel",
    autoSendTriggers: "auto_send_triggers",
    autoSendEnabled: "auto_send_enabled",
    status: "status",
  };
  const out = {};
  for (const [k, v] of Object.entries(map)) {
    if (data[k] !== undefined) out[v] = data[k];
  }
  return out;
}

/** GET / - List sent resources (for Discover feed). */
router.get("/", ensureLoggedIn, async function (req, res, next) {
  try {
    const { limit } = req.query;
    const resources = await Resource.listSent({ limit: limit ? parseInt(limit, 10) : 50 });
    return res.json({ resources });
  } catch (err) {
    return next(err);
  }
});

/** GET /recipients/options - Get contacts and users for recipient selection. */
router.get("/recipients/options", ensureLoggedIn, ensureAdminOrSuperAdmin, async function (req, res, next) {
  try {
    const userId = res.locals.user.id;
    const role = res.locals.user.role;
    const contacts = await getContactsForUser(userId, role);
    const homeowners = await getActiveUsersForUser(userId, role, "homeowner");
    let agents = [];
    let allUsers = [];
    if (role === "super_admin" || role === "admin") {
      agents = await getActiveUsersForUser(userId, role, "agent");
      allUsers = await getActiveUsersForUser(userId, role, null);
    }
    return res.json({
      contacts,
      homeowners,
      agents,
      allUsers,
    });
  } catch (err) {
    return next(err);
  }
});

/** POST /recipients/estimate - Estimate recipient count. Must be before /:id */
router.post("/recipients/estimate", ensureLoggedIn, ensureAdminOrSuperAdmin, async function (req, res, next) {
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

/** GET /admin - List all resources (admin/super_admin/agent). */
router.get("/admin", ensureLoggedIn, ensureAdminOrSuperAdmin, async function (req, res, next) {
  try {
    const { status, limit } = req.query;
    const resources = await Resource.listAll({
      status: status || undefined,
      limit: limit ? parseInt(limit, 10) : 100,
    });
    return res.json({ resources });
  } catch (err) {
    return next(err);
  }
});

/** GET /:id/view - Get sent resource for viewing (any logged-in user). */
router.get("/:id/view", ensureLoggedIn, async function (req, res, next) {
  try {
    const resource = await Resource.getById(req.params.id);
    if (resource.status !== "sent") {
      return res.status(404).json({ error: { message: "Resource not found or not yet published." } });
    }
    return res.json({ resource });
  } catch (err) {
    return next(err);
  }
});

/** GET /:id - Get single resource. */
router.get("/:id", ensureLoggedIn, ensureAdminOrSuperAdmin, async function (req, res, next) {
  try {
    const resource = await Resource.getById(req.params.id);
    return res.json({ resource });
  } catch (err) {
    return next(err);
  }
});

/** POST / - Create resource (admin/super_admin/agent). */
router.post("/", ensureLoggedIn, ensureAdminOrSuperAdmin, async function (req, res, next) {
  try {
    const resource = await Resource.create({
      ...toDb(req.body),
      created_by: res.locals.user.id,
    });
    return res.status(201).json({ resource });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /:id - Update resource. Only draft can be edited. Agents can edit own; admins can edit any. */
router.patch("/:id", ensureLoggedIn, ensureAdminOrSuperAdmin, async function (req, res, next) {
  try {
    const existing = await Resource.getById(req.params.id);
    if (existing.status === "sent") {
      return res.status(400).json({ error: { message: "Cannot edit a sent resource. Duplicate to create a new one." } });
    }
    const resource = await Resource.update(req.params.id, toDb(req.body));
    return res.json({ resource });
  } catch (err) {
    return next(err);
  }
});

/** POST /:id/send - Send resource to recipients. */
router.post("/:id/send", ensureLoggedIn, ensureAdminOrSuperAdmin, async function (req, res, next) {
  try {
    const resource = await Resource.getById(req.params.id);
    if (resource.status === "sent") {
      return res.status(400).json({ error: { message: "Resource already sent." } });
    }
    const userId = res.locals.user.id;
    const role = res.locals.user.role;
    const { count, emails, users } = await resolveRecipients(
      userId,
      role,
      resource.recipientMode,
      resource.recipientIds || []
    );
    // Allow sending with 0 recipients - resource is published to Discover feed
    await Resource.update(req.params.id, {
      status: "sent",
      sent_at: new Date().toISOString(),
      recipient_count: count,
    });
    const userIds = (users || []).map((u) => u.id).filter(Boolean);
    if (userIds.length > 0) {
      await Notification.createForUsers(userIds, {
        type: "resource_sent",
        resourceId: resource.id,
        title: `New resource: ${resource.subject || "Shared with you"}`,
      });
    }
    return res.json({
      resource: await Resource.getById(req.params.id),
      sentTo: count,
      message: `Sent to ${count} recipients.`,
    });
  } catch (err) {
    return next(err);
  }
});

/** POST /:id/activate - Activate auto-send for a draft resource. */
router.post("/:id/activate", ensureLoggedIn, ensureAdminOrSuperAdmin, async function (req, res, next) {
  try {
    const resource = await Resource.getById(req.params.id);
    if (resource.status !== "draft") {
      return res.status(400).json({ error: { message: "Only draft resources can be activated." } });
    }
    const triggers = resource.autoSendTriggers || [];
    if (!Array.isArray(triggers) || triggers.length === 0) {
      return res.status(400).json({ error: { message: "Add at least one auto-send rule before activating." } });
    }
    const updated = await Resource.update(req.params.id, { auto_send_enabled: true });
    return res.json({ resource: updated });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /:id - Delete resource. */
router.delete("/:id", ensureLoggedIn, ensureAdminOrSuperAdmin, async function (req, res, next) {
  try {
    await Resource.delete(req.params.id);
    return res.json({ deleted: req.params.id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
