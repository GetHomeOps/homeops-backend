"use strict";

/**
 * Auto-send communications when trigger events fire.
 * Called from auth (user created), properties (property created), maintenance, etc.
 */

const db = require("../db");
const Notification = require("../models/notification");

async function getRulesForTrigger(triggerEvent, triggerRole = null) {
  const conditions = [`cr.is_active = true`, `cr.trigger_event = $1`];
  const values = [triggerEvent];
  let idx = 2;

  if (triggerRole) {
    conditions.push(`(cr.trigger_role = $${idx} OR cr.trigger_role IS NULL)`);
    values.push(triggerRole);
  }

  const result = await db.query(
    `SELECT cr.id, cr.communication_id, cr.trigger_event, cr.trigger_role,
            c.subject, c.delivery_channel AS "deliveryChannel"
     FROM comm_rules cr
     JOIN communications c ON c.id = cr.communication_id
     WHERE ${conditions.join(" AND ")}
       AND c.status = 'draft'`,
    values
  );
  return result.rows;
}

async function sendToUser(communicationId, userId, title) {
  await Notification.create({
    userId,
    type: "communication_sent",
    resourceId: null,
    title: title || "New message",
  });

  await db.query(
    `INSERT INTO comm_recipients (communication_id, user_id, channel, status, delivered_at)
     VALUES ($1, $2, 'in_app', 'delivered', NOW())`,
    [communicationId, userId]
  );
}

async function onUserCreated({ userId, role }) {
  const rules = await getRulesForTrigger("user_created", role);
  for (const rule of rules) {
    try {
      await sendToUser(rule.communication_id, userId, `New: ${rule.subject || "Message"}`);
    } catch (err) {
      console.error(`[commAutoSend] Failed comm ${rule.communication_id} → user ${userId}:`, err.message);
    }
  }
}

async function onPropertyCreated({ createdByUserId, creatorRole }) {
  if (!createdByUserId) return;
  const rules = await getRulesForTrigger("property_created", creatorRole);
  for (const rule of rules) {
    try {
      await sendToUser(rule.communication_id, createdByUserId, `New: ${rule.subject || "Message"}`);
    } catch (err) {
      console.error(`[commAutoSend] Failed comm ${rule.communication_id} → user ${createdByUserId}:`, err.message);
    }
  }
}

async function onMaintenanceRecorded({ createdByUserId, creatorRole }) {
  if (!createdByUserId) return;
  const rules = await getRulesForTrigger("maintenance_recorded", creatorRole);
  for (const rule of rules) {
    try {
      await sendToUser(rule.communication_id, createdByUserId, `New: ${rule.subject || "Message"}`);
    } catch (err) {
      console.error(`[commAutoSend] Failed comm ${rule.communication_id} → user ${createdByUserId}:`, err.message);
    }
  }
}

async function onEventScheduled({ createdByUserId, creatorRole }) {
  if (!createdByUserId) return;
  const rules = await getRulesForTrigger("event_scheduled", creatorRole);
  for (const rule of rules) {
    try {
      await sendToUser(rule.communication_id, createdByUserId, `New: ${rule.subject || "Message"}`);
    } catch (err) {
      console.error(`[commAutoSend] Failed comm ${rule.communication_id} → user ${createdByUserId}:`, err.message);
    }
  }
}

module.exports = {
  onUserCreated,
  onPropertyCreated,
  onMaintenanceRecorded,
  onEventScheduled,
  getRulesForTrigger,
};
