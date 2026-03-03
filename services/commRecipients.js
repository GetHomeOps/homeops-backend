"use strict";

/**
 * Resolves recipients for the refactored Communications module.
 *
 * Permission model:
 *  - admin / super_admin: can target all homeowners, all agents, all users, or pick specific ones.
 *  - agent: can only target homeowners linked to them via shared account membership.
 */

const db = require("../db");

async function getHomeownersForUser(userId, userRole) {
  if (userRole === "super_admin" || userRole === "admin") {
    const r = await db.query(
      `SELECT DISTINCT u.id, u.name, u.email, u.role
       FROM users u
       JOIN account_users au ON au.user_id = u.id
       WHERE u.is_active = true AND u.role = 'homeowner'
       ORDER BY u.name`
    );
    return r.rows;
  }
  // Agent: homeowners in accounts the agent belongs to
  const r = await db.query(
    `SELECT DISTINCT u.id, u.name, u.email, u.role
     FROM users u
     JOIN account_users au ON au.user_id = u.id
     WHERE u.is_active = true AND u.role = 'homeowner'
       AND au.account_id IN (SELECT account_id FROM account_users WHERE user_id = $1)
     ORDER BY u.name`,
    [userId]
  );
  return r.rows;
}

async function getAgentsForUser(userId, userRole) {
  if (userRole !== "super_admin" && userRole !== "admin") return [];
  const r = await db.query(
    `SELECT DISTINCT u.id, u.name, u.email, u.role
     FROM users u
     JOIN account_users au ON au.user_id = u.id
     WHERE u.is_active = true AND u.role = 'agent'
     ORDER BY u.name`
  );
  return r.rows;
}

async function getAllUsersForAdmin() {
  const r = await db.query(
    `SELECT DISTINCT u.id, u.name, u.email, u.role
     FROM users u
     JOIN account_users au ON au.user_id = u.id
     WHERE u.is_active = true
     ORDER BY u.name`
  );
  return r.rows;
}

async function getRecipientOptions(userId, userRole) {
  const homeowners = await getHomeownersForUser(userId, userRole);
  let agents = [];
  if (userRole === "super_admin" || userRole === "admin") {
    agents = await getAgentsForUser(userId, userRole);
  }
  return { homeowners, agents };
}

async function resolveRecipients(userId, userRole, recipientMode, recipientIds = []) {
  const ids = Array.isArray(recipientIds) ? recipientIds : [];
  let users = [];

  switch (recipientMode) {
    case "all_homeowners":
      users = await getHomeownersForUser(userId, userRole);
      break;

    case "all_agents":
      users = await getAgentsForUser(userId, userRole);
      break;

    case "all_users":
      if (userRole === "super_admin" || userRole === "admin") {
        users = await getAllUsersForAdmin();
      }
      break;

    case "selected_homeowners": {
      if (!ids.length) break;
      const allowed = await getHomeownersForUser(userId, userRole);
      const allowedSet = new Set(allowed.map((u) => u.id));
      users = allowed.filter((u) => ids.includes(u.id) && allowedSet.has(u.id));
      break;
    }

    case "selected_agents": {
      if (userRole !== "super_admin" && userRole !== "admin") break;
      if (!ids.length) break;
      const r = await db.query(
        `SELECT id, name, email, role FROM users
         WHERE id = ANY($1::int[]) AND is_active = true AND role = 'agent'`,
        [ids]
      );
      users = r.rows;
      break;
    }

    case "selected_users": {
      if (userRole !== "super_admin" && userRole !== "admin") break;
      if (!ids.length) break;
      const r = await db.query(
        `SELECT id, name, email, role FROM users WHERE id = ANY($1::int[]) AND is_active = true`,
        [ids]
      );
      users = r.rows;
      break;
    }

    default:
      break;
  }

  return { users, count: users.length };
}

async function estimateRecipients(userId, userRole, recipientMode, recipientIds = []) {
  const { count } = await resolveRecipients(userId, userRole, recipientMode, recipientIds);
  return count;
}

module.exports = {
  getRecipientOptions,
  resolveRecipients,
  estimateRecipients,
  getHomeownersForUser,
  getAgentsForUser,
};
