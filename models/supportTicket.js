"use strict";

/**
 * Support Ticket Model
 *
 * Manages support and feedback tickets. Priority is computed server-side from
 * subscription tier: Premium/Win (100) > Pro/Maintain (50) > Free/Basic (10).
 */

const db = require("../db");
const { NotFoundError, BadRequestError } = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

/** Map subscription tier to priority score. Higher = higher priority. */
const TIER_TO_PRIORITY = {
  premium: 100,
  win: 100,
  pro: 50,
  maintain: 50,
  free: 10,
  basic: 10,
};

function getPriorityFromTier(tier) {
  if (!tier || typeof tier !== "string") return 10;
  const normalized = tier.toLowerCase().trim();
  return TIER_TO_PRIORITY[normalized] ?? 10;
}

/** Resolve subscription tier for a user/account. Uses user's tier first, then account's active subscription product name. */
async function resolveSubscriptionTier(userId, accountId) {
  const userRes = await db.query(
    `SELECT subscription_tier FROM users WHERE id = $1`,
    [userId]
  );
  const userTier = userRes.rows[0]?.subscription_tier;
  if (userTier) return userTier;

  const subRes = await db.query(
    `SELECT sp.name AS product_name
     FROM account_subscriptions s
     JOIN subscription_products sp ON sp.id = s.subscription_product_id
     WHERE s.account_id = $1 AND s.status = 'active'
     ORDER BY s.current_period_end DESC
     LIMIT 1`,
    [accountId]
  );
  return subRes.rows[0]?.product_name || "free";
}

/**
 * Create a new support ticket.
 * Automatically sets: createdBy, accountId, subscriptionTier, priorityScore, status, createdAt.
 */
async function create({ type, subject, description, createdBy, accountId, attachmentKeys }) {
  if (!type || !subject?.trim() || !description?.trim()) {
    throw new BadRequestError("type, subject, and description are required");
  }
  if (!["support", "feedback"].includes(type)) {
    throw new BadRequestError("type must be 'support' or 'feedback'");
  }
  if (!createdBy || !accountId) {
    throw new BadRequestError("createdBy and accountId are required");
  }

  const subscriptionTier = await resolveSubscriptionTier(createdBy, accountId);
  const priorityScore = getPriorityFromTier(subscriptionTier);

  const result = await db.query(
    `INSERT INTO support_tickets
       (type, subject, description, status, subscription_tier, priority_score, created_by, account_id, attachment_keys)
     VALUES ($1, $2, $3, 'new', $4, $5, $6, $7, $8)
     RETURNING id, type, subject, description, status,
               subscription_tier AS "subscriptionTier",
               priority_score AS "priorityScore",
               created_by AS "createdBy",
               assigned_to AS "assignedTo",
               account_id AS "accountId",
               internal_notes AS "internalNotes",
               attachment_keys AS "attachmentKeys",
               created_at AS "createdAt",
               updated_at AS "updatedAt"`,
    [type, subject.trim(), description.trim(), subscriptionTier, priorityScore, createdBy, accountId, attachmentKeys || null]
  );
  const ticket = result.rows[0];
  const creator = await db.query(
    `SELECT id, name, email FROM users WHERE id = $1`,
    [createdBy]
  );
  const account = await db.query(
    `SELECT id, name, url FROM accounts WHERE id = $1`,
    [accountId]
  );
  ticket.createdByName = creator.rows[0]?.name || creator.rows[0]?.email;
  ticket.accountName = account.rows[0]?.name;
  ticket.accountUrl = account.rows[0]?.url;
  return ticket;
}

/** Get ticket by id with creator, account info, and replies. */
async function get(id) {
  const result = await db.query(
    `SELECT t.id, t.type, t.subject, t.description, t.status,
            t.subscription_tier AS "subscriptionTier",
            t.priority_score AS "priorityScore",
            t.created_by AS "createdBy",
            t.assigned_to AS "assignedTo",
            t.account_id AS "accountId",
            t.internal_notes AS "internalNotes",
            t.attachment_keys AS "attachmentKeys",
            t.created_at AS "createdAt",
            t.updated_at AS "updatedAt",
            u.name AS "createdByName",
            u.email AS "createdByEmail",
            a.name AS "accountName",
            a.url AS "accountUrl",
            au.name AS "assignedToName"
     FROM support_tickets t
     LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN users au ON au.id = t.assigned_to
     WHERE t.id = $1`,
    [id]
  );
  const ticket = result.rows[0];
  if (!ticket) throw new NotFoundError(`No ticket with id: ${id}`);

  let replies = [];
  try {
    const repliesRes = await db.query(
      `SELECT r.id, r.ticket_id AS "ticketId", r.author_id AS "authorId",
              r.role, r.body, r.created_at AS "createdAt",
              u.name AS "authorName", u.email AS "authorEmail"
       FROM support_ticket_replies r
       LEFT JOIN users u ON u.id = r.author_id
       WHERE r.ticket_id = $1
       ORDER BY r.created_at ASC`,
      [id]
    );
    replies = repliesRes.rows || [];
  } catch (err) {
    if (err.code !== "42P01") throw err; // 42P01 = relation does not exist (migration not run)
  }
  ticket.replies = replies;
  ticket.activity = buildActivityFromReplies(ticket, ticket.replies);
  return ticket;
}

/** Build activity items for timeline (replies only; frontend adds initial message). */
function buildActivityFromReplies(ticket, replies) {
  return (replies || []).map((r) => ({
    type: "reply",
    actor: r.authorName || r.authorEmail || (r.role === "admin" ? "Support" : "User"),
    text: r.body,
    timestamp: r.createdAt,
    label: r.role === "admin" ? "Admin reply" : "User reply",
  }));
}

/** Add a reply to a ticket. Admin adds as 'admin', user adds as 'user'. */
async function addReply(ticketId, { authorId, role, body }) {
  if (!body?.trim()) throw new BadRequestError("Reply body is required");
  if (!["admin", "user"].includes(role)) throw new BadRequestError("role must be 'admin' or 'user'");

  await db.query(
    `INSERT INTO support_ticket_replies (ticket_id, author_id, role, body)
     VALUES ($1, $2, $3, $4)`,
    [ticketId, authorId, role, body.trim()]
  );
  return get(ticketId);
}

/** List tickets for the current user (their own submissions). */
async function listForUser(userId) {
  const result = await db.query(
    `SELECT t.id, t.type, t.subject, t.description, t.status,
            t.subscription_tier AS "subscriptionTier",
            t.priority_score AS "priorityScore",
            t.created_at AS "createdAt",
            t.updated_at AS "updatedAt"
     FROM support_tickets t
     WHERE t.created_by = $1
     ORDER BY t.created_at DESC`,
    [userId]
  );
  return result.rows;
}

/** List all tickets for admin. Sorted by status, then priority desc, then createdAt asc. */
async function listForAdmin() {
  const result = await db.query(
    `SELECT t.id, t.type, t.subject, t.description, t.status,
            t.subscription_tier AS "subscriptionTier",
            t.priority_score AS "priorityScore",
            t.created_by AS "createdBy",
            t.assigned_to AS "assignedTo",
            t.account_id AS "accountId",
            t.internal_notes AS "internalNotes",
            t.created_at AS "createdAt",
            t.updated_at AS "updatedAt",
            u.name AS "createdByName",
            u.email AS "createdByEmail",
            a.name AS "accountName",
            a.url AS "accountUrl",
            au.name AS "assignedToName"
     FROM support_tickets t
     LEFT JOIN users u ON u.id = t.created_by
     LEFT JOIN accounts a ON a.id = t.account_id
     LEFT JOIN users au ON au.id = t.assigned_to
     ORDER BY
       CASE t.status
         WHEN 'new' THEN 1
         WHEN 'working_on_it' THEN 2
         WHEN 'waiting_on_user' THEN 3
         WHEN 'solved' THEN 4
         WHEN 'resolved' THEN 4
         WHEN 'closed' THEN 5
         WHEN 'under_review' THEN 2
         WHEN 'planned' THEN 3
         WHEN 'implemented' THEN 4
         WHEN 'rejected' THEN 5
         ELSE 6
       END,
       t.priority_score DESC,
       t.created_at ASC`
  );
  return result.rows;
}

/** Update ticket. Only status, assignedTo, internalNotes allowed for admin. */
async function update(id, data) {
  const jsToSql = {
    status: "status",
    assignedTo: "assigned_to",
    internalNotes: "internal_notes",
    attachmentKeys: "attachment_keys",
  };
  const allowed = ["status", "assignedTo", "internalNotes", "attachmentKeys"];
  const filtered = {};
  for (const k of allowed) {
    if (data[k] !== undefined) filtered[k] = data[k];
  }
  if (Object.keys(filtered).length === 0) {
    return get(id);
  }
  const { setCols, values } = sqlForPartialUpdate(filtered, jsToSql);
  const idVarIdx = "$" + (values.length + 1);
  await db.query(
    `UPDATE support_tickets SET ${setCols}, updated_at = NOW() WHERE id = ${idVarIdx}`,
    [...values, id]
  );
  return get(id);
}

module.exports = {
  create,
  get,
  listForUser,
  listForAdmin,
  update,
  addReply,
  getPriorityFromTier,
  resolveSubscriptionTier,
};
