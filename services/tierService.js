"use strict";

/**
 * Tier Service
 *
 * Enforces subscription tier limits. Reads limits from plan_limits (preferred)
 * or subscription_products. Checks usage before allowing actions.
 *
 * Exports: getAccountLimits, getEffectiveLimits, canCreateProperty, canAddContact,
 *          canInviteViewer, canAddTeamMember, checkAiTokenQuota
 */

const db = require("../db");
const { BILLING_MOCK_MODE } = require("../config");

const DEFAULT_LIMITS = { maxProperties: 3, maxContacts: 50, maxViewers: 5, maxTeamMembers: 10, aiTokenMonthlyQuota: 50000 };

async function getAccountLimits(accountId) {
  const subRes = await db.query(
    `SELECT asub.subscription_product_id
     FROM account_subscriptions asub
     WHERE asub.account_id = $1 AND asub.status IN ('active', 'trialing')
     ORDER BY asub.current_period_end DESC NULLS LAST
     LIMIT 1`,
    [accountId]
  );

  const productId = subRes.rows[0]?.subscription_product_id;
  if (productId) {
    const limRes = await db.query(
      `SELECT pl.max_properties AS "maxProperties", pl.max_contacts AS "maxContacts",
              pl.max_viewers AS "maxViewers", pl.max_team_members AS "maxTeamMembers",
              pl.ai_token_monthly_quota AS "aiTokenMonthlyQuota"
       FROM plan_limits pl WHERE pl.subscription_product_id = $1`,
      [productId]
    );
    if (limRes.rows[0]) return { ...DEFAULT_LIMITS, ...limRes.rows[0] };
    const spRes = await db.query(
      `SELECT max_properties AS "maxProperties", max_contacts AS "maxContacts",
              max_viewers AS "maxViewers", max_team_members AS "maxTeamMembers"
       FROM subscription_products WHERE id = $1`,
      [productId]
    );
    if (spRes.rows[0]) return { ...DEFAULT_LIMITS, ...spRes.rows[0] };
  }

  const freeRes = await db.query(
    `SELECT pl.max_properties AS "maxProperties", pl.max_contacts AS "maxContacts",
            pl.max_viewers AS "maxViewers", pl.max_team_members AS "maxTeamMembers",
            pl.ai_token_monthly_quota AS "aiTokenMonthlyQuota"
     FROM plan_limits pl
     JOIN subscription_products sp ON sp.id = pl.subscription_product_id
     WHERE sp.code = 'homeowner_free' LIMIT 1`
  );
  if (freeRes.rows[0]) return { ...DEFAULT_LIMITS, ...freeRes.rows[0] };

  const fallback = await db.query(
    `SELECT max_properties AS "maxProperties", max_contacts AS "maxContacts",
            max_viewers AS "maxViewers", max_team_members AS "maxTeamMembers"
     FROM subscription_products WHERE (code = 'homeowner_free' OR LOWER(name) = 'free') AND is_active = true LIMIT 1`
  );
  return fallback.rows[0] ? { ...DEFAULT_LIMITS, ...fallback.rows[0] } : DEFAULT_LIMITS;
}

/** Get effective limits for a user (via their primary account). */
async function getEffectiveLimits(userId) {
  const accRes = await db.query(
    `SELECT account_id FROM account_users WHERE user_id = $1 ORDER BY (account_id IN (SELECT id FROM accounts WHERE owner_user_id = $1)) DESC LIMIT 1`,
    [userId, userId]
  );
  if (!accRes.rows[0]) return DEFAULT_LIMITS;
  return getAccountLimits(accRes.rows[0].account_id);
}

/** Check if user has AI token quota remaining this month. Returns { allowed, used, quota }. */
async function checkAiTokenQuota(userId) {
  if (BILLING_MOCK_MODE) return { allowed: true, used: 0, quota: 999999 };

  const accRes = await db.query(
    `SELECT account_id FROM account_users WHERE user_id = $1 LIMIT 1`,
    [userId]
  );
  if (!accRes.rows[0]) return { allowed: false, used: 0, quota: 0 };

  const limits = await getAccountLimits(accRes.rows[0].account_id);
  const quota = limits.aiTokenMonthlyQuota ?? 0;
  if (quota <= 0) return { allowed: true, used: 0, quota: 0 };

  const usedRes = await db.query(
    `SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0)::bigint AS used
     FROM user_api_usage WHERE user_id = $1 AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
    [userId]
  );
  const used = Number(usedRes.rows[0]?.used || 0);
  return { allowed: used < quota, used, quota };
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

module.exports = {
  getAccountLimits,
  getEffectiveLimits,
  canCreateProperty,
  canAddContact,
  canInviteViewer,
  canAddTeamMember,
  checkAiTokenQuota,
};
