"use strict";

/**
 * Plan Model
 *
 * Wraps subscription_products + plan_limits + plan_prices for billing.
 * Used by billing routes and tierService.
 */

const db = require("../db");
const { NotFoundError } = require("../expressError");

/** Get all active plans for an audience (homeowner | agent), with limits and prices. */
async function getPlansForAudience(audienceType) {
  const result = await db.query(
    `SELECT sp.id, sp.code, sp.name, sp.description, sp.target_role AS "targetRole",
            sp.price, sp.billing_interval AS "billingInterval", sp.sort_order AS "sortOrder",
            sp.trial_days AS "trialDays", sp.is_active AS "isActive"
     FROM subscription_products sp
     WHERE sp.target_role = $1 AND (sp.is_active IS NULL OR sp.is_active = true)
     ORDER BY sp.sort_order ASC, sp.price ASC`,
    [audienceType]
  );

  const plans = result.rows;
  for (const p of plans) {
    const limits = await db.query(
      `SELECT max_properties AS "maxProperties", max_contacts AS "maxContacts",
              max_viewers AS "maxViewers", max_team_members AS "maxTeamMembers",
              ai_token_monthly_quota AS "aiTokenMonthlyQuota", other_limits AS "otherLimits"
       FROM plan_limits WHERE subscription_product_id = $1`,
      [p.id]
    );
    p.limits = limits.rows[0] || {
      maxProperties: 1,
      maxContacts: 25,
      maxViewers: 2,
      maxTeamMembers: 5,
      aiTokenMonthlyQuota: 50000,
      otherLimits: {},
    };

    const prices = await db.query(
      `SELECT billing_interval AS "billingInterval", stripe_price_id AS "stripePriceId"
       FROM plan_prices WHERE subscription_product_id = $1`,
      [p.id]
    );
    p.prices = prices.rows.reduce((acc, r) => {
      acc[r.billingInterval] = r.stripePriceId;
      return acc;
    }, {});
  }
  return plans;
}

/** Get plan by code. */
async function getByCode(code) {
  const result = await db.query(
    `SELECT sp.id, sp.code, sp.name, sp.description, sp.target_role AS "targetRole",
            sp.price, sp.trial_days AS "trialDays", sp.is_active AS "isActive"
     FROM subscription_products sp WHERE sp.code = $1`,
    [code]
  );
  const plan = result.rows[0];
  if (!plan) throw new NotFoundError(`Plan not found: ${code}`);
  return plan;
}

/** Get all plans (Super Admin). */
async function getAll() {
  const result = await db.query(
    `SELECT sp.id, sp.code, sp.name, sp.description, sp.target_role AS "targetRole",
            sp.price, sp.sort_order AS "sortOrder", sp.trial_days AS "trialDays",
            sp.is_active AS "isActive", sp.created_at AS "createdAt", sp.updated_at AS "updatedAt"
     FROM subscription_products sp ORDER BY sp.sort_order ASC, sp.target_role, sp.price ASC`
  );
  const plans = result.rows;
  for (const p of plans) {
    const limits = await db.query(
      `SELECT id, max_properties AS "maxProperties", max_contacts AS "maxContacts",
              max_viewers AS "maxViewers", max_team_members AS "maxTeamMembers",
              ai_token_monthly_quota AS "aiTokenMonthlyQuota", other_limits AS "otherLimits"
       FROM plan_limits WHERE subscription_product_id = $1`,
      [p.id]
    );
    p.limits = limits.rows[0];

    const prices = await db.query(
      `SELECT id, billing_interval AS "billingInterval", stripe_price_id AS "stripePriceId"
       FROM plan_prices WHERE subscription_product_id = $1 ORDER BY billing_interval`,
      [p.id]
    );
    p.prices = prices.rows;
  }
  return plans;
}

/** Update plan (Super Admin). */
async function updatePlan(productId, data) {
  const { name, description, isActive, sortOrder, trialDays } = data;
  const updates = [];
  const values = [];
  let i = 1;
  if (name !== undefined) { updates.push(`name = $${i++}`); values.push(name); }
  if (description !== undefined) { updates.push(`description = $${i++}`); values.push(description); }
  if (isActive !== undefined) { updates.push(`is_active = $${i++}`); values.push(isActive); }
  if (sortOrder !== undefined) { updates.push(`sort_order = $${i++}`); values.push(sortOrder); }
  if (trialDays !== undefined) { updates.push(`trial_days = $${i++}`); values.push(trialDays); }
  if (updates.length > 0) {
    values.push(productId);
    await db.query(
      `UPDATE subscription_products SET ${updates.join(", ")}, updated_at = NOW() WHERE id = $${i}`,
      values
    );
  }
  return getPlanById(productId);
}

/** Update plan limits (Super Admin). */
async function updatePlanLimits(productId, limits) {
  const {
    maxProperties, maxContacts, maxViewers, maxTeamMembers,
    aiTokenMonthlyQuota, otherLimits,
  } = limits;
  await db.query(
    `INSERT INTO plan_limits (subscription_product_id, max_properties, max_contacts, max_viewers, max_team_members, ai_token_monthly_quota, other_limits, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
     ON CONFLICT (subscription_product_id) DO UPDATE SET
       max_properties = EXCLUDED.max_properties,
       max_contacts = EXCLUDED.max_contacts,
       max_viewers = EXCLUDED.max_viewers,
       max_team_members = EXCLUDED.max_team_members,
       ai_token_monthly_quota = EXCLUDED.ai_token_monthly_quota,
       other_limits = EXCLUDED.other_limits,
       updated_at = NOW()`,
    [
      productId,
      maxProperties ?? 1,
      maxContacts ?? 25,
      maxViewers ?? 2,
      maxTeamMembers ?? 5,
      aiTokenMonthlyQuota ?? 50000,
      otherLimits ? JSON.stringify(otherLimits) : "{}",
    ]
  );
  return getPlanById(productId);
}

/** Update plan price (Super Admin). */
async function updatePlanPrice(productId, billingInterval, stripePriceId) {
  if (!stripePriceId) {
    await db.query(
      `DELETE FROM plan_prices WHERE subscription_product_id = $1 AND billing_interval = $2`,
      [productId, billingInterval]
    );
  } else {
    await db.query(
      `INSERT INTO plan_prices (subscription_product_id, stripe_price_id, billing_interval)
       VALUES ($1, $2, $3)
       ON CONFLICT (subscription_product_id, billing_interval) DO UPDATE SET stripe_price_id = EXCLUDED.stripe_price_id`,
      [productId, stripePriceId, billingInterval]
    );
  }
  return getPlanById(productId);
}

async function getPlanById(id) {
  const result = await db.query(
    `SELECT sp.id, sp.code, sp.name, sp.description, sp.target_role AS "targetRole",
            sp.price, sp.sort_order AS "sortOrder", sp.trial_days AS "trialDays",
            sp.is_active AS "isActive"
     FROM subscription_products sp WHERE sp.id = $1`,
    [id]
  );
  const plan = result.rows[0];
  if (!plan) throw new NotFoundError(`Plan not found: ${id}`);
  const limits = await db.query(
    `SELECT * FROM plan_limits WHERE subscription_product_id = $1`,
    [id]
  );
  plan.limits = limits.rows[0];
  const prices = await db.query(
    `SELECT * FROM plan_prices WHERE subscription_product_id = $1`,
    [id]
  );
  plan.prices = prices.rows;
  return plan;
}

module.exports = {
  getPlansForAudience,
  getByCode,
  getAll,
  updatePlan,
  updatePlanLimits,
  updatePlanPrice,
  getPlanById,
};
