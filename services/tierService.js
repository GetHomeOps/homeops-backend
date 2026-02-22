"use strict";

/**
 * Tier Service
 *
 * Enforces subscription tier limits. Reads limits from active subscription
 * (or free product fallback) and checks current usage before allowing
 * actions like creating properties, adding contacts, inviting viewers,
 * or adding team members.
 *
 * Exports: getAccountLimits, canCreateProperty, canAddContact,
 *          canInviteViewer, canAddTeamMember
 */

const db = require("../db");

async function getAccountLimits(accountId) {
  const result = await db.query(
    `SELECT sp.max_properties AS "maxProperties",
            sp.max_contacts AS "maxContacts",
            sp.max_viewers AS "maxViewers",
            sp.max_team_members AS "maxTeamMembers"
     FROM account_subscriptions asub
     JOIN subscription_products sp ON sp.id = asub.subscription_product_id
     WHERE asub.account_id = $1 AND asub.status = 'active'
     ORDER BY sp.price DESC
     LIMIT 1`,
    [accountId]
  );
  if (result.rows[0]) return result.rows[0];

  const freeProduct = await db.query(
    `SELECT max_properties AS "maxProperties", max_contacts AS "maxContacts",
            max_viewers AS "maxViewers", max_team_members AS "maxTeamMembers"
     FROM subscription_products
     WHERE LOWER(name) = 'free' AND is_active = true
     LIMIT 1`
  );
  return freeProduct.rows[0] || { maxProperties: 3, maxContacts: 50, maxViewers: 5, maxTeamMembers: 10 };
}

async function canCreateProperty(accountId) {
  const limits = await getAccountLimits(accountId);
  const countRes = await db.query(
    `SELECT COUNT(*)::int AS count FROM properties WHERE account_id = $1`,
    [accountId]
  );
  const current = countRes.rows[0].count;
  return { allowed: current < limits.maxProperties, current, max: limits.maxProperties };
}

async function canAddContact(accountId) {
  const limits = await getAccountLimits(accountId);
  const countRes = await db.query(
    `SELECT COUNT(*)::int AS count FROM account_contacts WHERE account_id = $1`,
    [accountId]
  );
  const current = countRes.rows[0].count;
  return { allowed: current < limits.maxContacts, current, max: limits.maxContacts };
}

async function canInviteViewer(accountId, propertyId) {
  const limits = await getAccountLimits(accountId);
  const countRes = await db.query(
    `SELECT COUNT(*)::int AS count FROM property_users WHERE property_id = $1 AND role = 'viewer'`,
    [propertyId]
  );
  const current = countRes.rows[0].count;
  return { allowed: current < limits.maxViewers, current, max: limits.maxViewers };
}

async function canAddTeamMember(accountId, propertyId) {
  const limits = await getAccountLimits(accountId);
  const countRes = await db.query(
    `SELECT COUNT(*)::int AS count FROM property_users WHERE property_id = $1`,
    [propertyId]
  );
  const current = countRes.rows[0].count;
  return { allowed: current < limits.maxTeamMembers, current, max: limits.maxTeamMembers };
}

module.exports = { getAccountLimits, canCreateProperty, canAddContact, canInviteViewer, canAddTeamMember };
