"use strict";

/**
 * Resolves recipients for resource broadcasts.
 * - admin/super_admin: all contacts + all active users
 * - agents: their contacts + linked homeowners (same account)
 */

const db = require("../db");

/** Get contacts for a user (by account access).
 * Agents: contacts in their account(s). Admins: all contacts.
 */
async function getContactsForUser(userId, userRole) {
  if (userRole === "super_admin" || userRole === "admin") {
    const r = await db.query(
      `SELECT c.id, c.name, c.email FROM contacts c
       JOIN account_contacts ac ON ac.contact_id = c.id
       ORDER BY c.name`
    );
    return r.rows;
  }
  const r = await db.query(
    `SELECT DISTINCT c.id, c.name, c.email FROM contacts c
     JOIN account_contacts ac ON ac.contact_id = c.id
     JOIN account_users au ON au.account_id = ac.account_id
     WHERE au.user_id = $1 AND c.email IS NOT NULL AND c.email != ''
     ORDER BY c.name`,
    [userId]
  );
  return r.rows;
}

/** Get active users (is_active, has account_users).
 * roleFilter: 'homeowner' | 'agent' | null (all)
 */
async function getActiveUsersForUser(userId, userRole, roleFilter = null) {
  let query = `
    SELECT u.id, u.email, u.name FROM users u
    JOIN account_users au ON au.user_id = u.id
    WHERE u.is_active = true
  `;
  const values = [];
  let idx = 1;

  if (roleFilter) {
    query += ` AND u.role = $${idx}`;
    values.push(roleFilter);
    idx++;
  }

  if (userRole === "super_admin" || userRole === "admin") {
    query += ` ORDER BY u.name`;
    const r = await db.query(query, values);
    return r.rows;
  }

  if (userRole === "agent") {
    query += ` AND au.account_id IN (
      SELECT account_id FROM account_users WHERE user_id = $${idx}
    )`;
    values.push(userId);
    query += ` ORDER BY u.name`;
    const r = await db.query(query, values);
    return r.rows;
  }

  return [];
}

/** Resolve recipients based on mode and ids. Returns { contacts, users, count }. */
async function resolveRecipients(userId, userRole, recipientMode, recipientIds = []) {
  const ids = Array.isArray(recipientIds) ? recipientIds : [];
  let contacts = [];
  let users = [];

  switch (recipientMode) {
    case "all_contacts": {
      contacts = await getContactsForUser(userId, userRole);
      break;
    }
    case "specific_contacts": {
      if (ids.length === 0) break;
      const r = await db.query(
        `SELECT id, name, email FROM contacts WHERE id = ANY($1::int[]) AND email IS NOT NULL AND email != ''`,
        [ids]
      );
      contacts = r.rows;
      break;
    }
    case "all_homeowners": {
      users = await getActiveUsersForUser(userId, userRole, "homeowner");
      break;
    }
    case "all_users": {
      if (userRole !== "super_admin" && userRole !== "admin") break;
      users = await getActiveUsersForUser(userId, userRole, null);
      break;
    }
    case "all_agents": {
      if (userRole !== "super_admin" && userRole !== "admin") break;
      users = await getActiveUsersForUser(userId, userRole, "agent");
      break;
    }
    case "specific_users": {
      if (userRole !== "super_admin" && userRole !== "admin" || ids.length === 0) break;
      const r = await db.query(
        `SELECT id, email, name FROM users WHERE id = ANY($1::int[]) AND is_active = true`,
        [ids]
      );
      users = r.rows;
      break;
    }
    default:
      break;
  }

  const emails = new Set();
  contacts.forEach((c) => { if (c.email) emails.add(c.email); });
  users.forEach((u) => { if (u.email) emails.add(u.email); });

  return {
    contacts,
    users,
    count: emails.size,
    emails: Array.from(emails),
  };
}

/** Estimate recipient count without full resolution. */
async function estimateRecipients(userId, userRole, recipientMode, recipientIds = []) {
  const { count } = await resolveRecipients(userId, userRole, recipientMode, recipientIds);
  return count;
}

module.exports = {
  resolveRecipients,
  estimateRecipients,
  getContactsForUser,
  getActiveUsersForUser,
};
