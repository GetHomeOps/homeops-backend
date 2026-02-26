"use strict";

/**
 * Auto-send resources when triggers fire.
 * Called from auth (user created), properties (property created), etc.
 */

const db = require("../db");
const Notification = require("../models/notification");

/** Find draft resources with auto_send_triggers matching any of the given trigger values. */
async function getResourcesForTriggers(triggerValues) {
  if (!triggerValues?.length) return [];
  const result = await db.query(
    `SELECT id, subject, type, delivery_channel AS "deliveryChannel", auto_send_triggers AS "autoSendTriggers"
     FROM resources
     WHERE status = 'draft'
       AND COALESCE(auto_send_enabled, false) = true
       AND auto_send_triggers IS NOT NULL
       AND jsonb_array_length(auto_send_triggers) > 0
       AND EXISTS (
         SELECT 1 FROM jsonb_array_elements_text(auto_send_triggers) AS t
         WHERE t = ANY($1::text[])
       )`,
    [triggerValues]
  );
  return result.rows;
}

/** Send resource to a user (create notification). Does not change resource status. */
async function sendResourceToUser(resourceId, userId, title) {
  await Notification.create({
    userId,
    type: "resource_sent",
    resourceId,
    title: title || "New resource shared with you",
  });
}

/**
 * When a user is created. Triggers: homeowner_create_account, agent_create_account
 */
async function onUserCreated({ userId, role }) {
  const triggers = [];
  if (role === "homeowner") triggers.push("homeowner_create_account");
  if (role === "agent") triggers.push("agent_create_account");
  if (triggers.length === 0) return;

  const resources = await getResourcesForTriggers(triggers);
  for (const r of resources) {
    try {
      await sendResourceToUser(r.id, userId, `New resource: ${r.subject || "Shared with you"}`);
    } catch (err) {
      console.error(`[resourceAutoSend] Failed to send resource ${r.id} to user ${userId}:`, err.message);
    }
  }
}

/**
 * When a property is created. Triggers: homeowner_create_property, agent_create_property
 * Uses creatorRole to match. homeowner_create_property only when creator is homeowner (and optionally first property).
 */
async function onPropertyCreated({ propertyId, accountId, createdByUserId, creatorRole, isFirstPropertyForUser }) {
  const triggers = [];
  if (creatorRole === "homeowner") triggers.push("homeowner_create_property");
  if (creatorRole === "agent") triggers.push("agent_create_property");
  if (triggers.length === 0) return;

  const recipientUserId = createdByUserId;
  if (!recipientUserId) return;

  const resources = await getResourcesForTriggers(triggers);
  for (const r of resources) {
    try {
      await sendResourceToUser(r.id, recipientUserId, `New resource: ${r.subject || "Shared with you"}`);
    } catch (err) {
      console.error(`[resourceAutoSend] Failed to send resource ${r.id} to user ${recipientUserId}:`, err.message);
    }
  }
}

/**
 * When a maintenance/calendar event is scheduled. Triggers: homeowner_schedule_event, agent_schedule_event
 */
async function onEventScheduled({ eventId, propertyId, createdByUserId, creatorRole }) {
  const triggers = [];
  if (creatorRole === "homeowner") triggers.push("homeowner_schedule_event");
  if (creatorRole === "agent") triggers.push("agent_schedule_event");
  if (triggers.length === 0) return;

  if (!createdByUserId) return;

  const resources = await getResourcesForTriggers(triggers);
  for (const r of resources) {
    try {
      await sendResourceToUser(r.id, createdByUserId, `New resource: ${r.subject || "Shared with you"}`);
    } catch (err) {
      console.error(`[resourceAutoSend] Failed to send resource ${r.id} to user ${createdByUserId}:`, err.message);
    }
  }
}

module.exports = {
  onUserCreated,
  onPropertyCreated,
  onEventScheduled,
  getResourcesForTriggers,
};
