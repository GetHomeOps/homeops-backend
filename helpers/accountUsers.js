"use strict";

/**
 * Account Users Helper
 *
 * Checks account-user relationships. Used to determine if an account has
 * any members and if a user is an account owner (for removal validation).
 *
 * Exports: isAccountLinkedToUser, isAccountOwner
 */

const db = require("../db");

async function isAccountLinkedToUser(accountId) {
  const result = await db.query(
    `SELECT 1 FROM account_users WHERE account_id = $1 LIMIT 1`,
    [accountId]
  );
  return result.rows.length > 0;
}

async function isAccountOwner(userId) {
  const result = await db.query(
    `SELECT 1 FROM account_users WHERE user_id = $1 AND role = 'owner' LIMIT 1`,
    [userId]
  );
  return result.rows.length > 0;
}

module.exports = { isAccountLinkedToUser, isAccountOwner };
