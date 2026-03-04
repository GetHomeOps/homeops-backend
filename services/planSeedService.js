"use strict";

/**
 * Plan Seed Service
 *
 * Ensures the 6 official plans (from data/plans.json) exist in the database on startup.
 * Price IDs are configurable via STRIPE_PRICE_IDS env (JSON) or Super Admin UI.
 * No hardcoded price IDs in code.
 */

const fs = require("fs");
const path = require("path");
const db = require("../db");

const PLANS_PATH = path.join(__dirname, "..", "data", "plans.json");

function loadPlans() {
  try {
    const raw = fs.readFileSync(PLANS_PATH, "utf8");
    const data = JSON.parse(raw);
    return data.plans || [];
  } catch (err) {
    console.warn("[planSeed] Could not load plans.json:", err.message);
    return [];
  }
}

function parsePriceIdsEnv() {
  try {
    const raw = process.env.STRIPE_PRICE_IDS;
    if (!raw) return {};
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Upsert plans from plans.json; optionally apply Stripe price IDs from env. */
async function ensureStripePlans() {
  const plans = loadPlans();
  if (plans.length === 0) return;

  const priceIds = parsePriceIdsEnv();

  for (const plan of plans) {
    const {
      code,
      name,
      description,
      targetRole,
      price,
      priceYear,
      sortOrder,
      trialDays,
      popular,
      limits,
      features,
    } = plan;

    const featuresJson = features ? JSON.stringify(features) : "[]";

    const existing = await db.query(
      `SELECT id FROM subscription_products WHERE code = $1`,
      [code]
    );

    let productId;
    if (existing.rows.length > 0) {
      productId = existing.rows[0].id;
      await db.query(
        `UPDATE subscription_products
         SET name = $1, description = $2, target_role = $3, price = $4, sort_order = $5,
             trial_days = $6, max_properties = $7, max_contacts = $8, max_viewers = $9, max_team_members = $10,
             features = $11, popular = $12, is_active = true, updated_at = NOW()
         WHERE id = $13`,
        [
          name,
          description || `${name} plan for ${targetRole}s`,
          targetRole,
          price ?? 0,
          sortOrder ?? 99,
          trialDays,
          limits?.maxProperties ?? 1,
          limits?.maxContacts ?? 25,
          limits?.maxViewers ?? 2,
          limits?.maxTeamMembers ?? 5,
          featuresJson,
          popular ?? false,
          productId,
        ]
      );
    } else {
      const ins = await db.query(
        `INSERT INTO subscription_products
          (name, description, target_role, price, billing_interval, code, sort_order, trial_days,
           max_properties, max_contacts, max_viewers, max_team_members, features, popular, is_active)
         VALUES ($1, $2, $3, $4, 'month', $5, $6, $7, $8, $9, $10, $11, $12, $13, true)
         RETURNING id`,
        [
          name,
          description || `${name} plan for ${targetRole}s`,
          targetRole,
          price ?? 0,
          code,
          sortOrder ?? 99,
          trialDays,
          limits?.maxProperties ?? 1,
          limits?.maxContacts ?? 25,
          limits?.maxViewers ?? 2,
          limits?.maxTeamMembers ?? 5,
          featuresJson,
          popular ?? false,
        ]
      );
      productId = ins.rows[0].id;
    }

    await db.query(
      `INSERT INTO plan_limits
        (subscription_product_id, max_properties, max_contacts, max_viewers, max_team_members, ai_token_monthly_quota, max_documents_per_system, other_limits, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (subscription_product_id) DO UPDATE SET
         max_properties = EXCLUDED.max_properties,
         max_contacts = EXCLUDED.max_contacts,
         max_viewers = EXCLUDED.max_viewers,
         max_team_members = EXCLUDED.max_team_members,
         ai_token_monthly_quota = EXCLUDED.ai_token_monthly_quota,
         max_documents_per_system = EXCLUDED.max_documents_per_system,
         other_limits = EXCLUDED.other_limits,
         updated_at = NOW()`,
      [
        productId,
        limits?.maxProperties ?? 1,
        limits?.maxContacts ?? 25,
        limits?.maxViewers ?? 2,
        limits?.maxTeamMembers ?? 5,
        limits?.aiTokenMonthlyQuota ?? 50000,
        limits?.maxDocumentsPerSystem ?? 5,
        limits?.otherLimits ? JSON.stringify(limits.otherLimits) : "{}",
      ]
    );

    if (price > 0) {
      const priceKeyMonth = `${code}_month`;
      const priceKeyYear = `${code}_year`;
      const stripeMonth = priceIds[priceKeyMonth] || null;
      const stripeYear = priceYear != null ? (priceIds[priceKeyYear] || null) : null;

      if (stripeMonth) {
        await db.query(
          `INSERT INTO plan_prices (subscription_product_id, stripe_price_id, billing_interval)
           VALUES ($1, $2, 'month')
           ON CONFLICT (subscription_product_id, billing_interval) DO UPDATE SET stripe_price_id = EXCLUDED.stripe_price_id`,
          [productId, stripeMonth]
        );
      }
      if (stripeYear) {
        await db.query(
          `INSERT INTO plan_prices (subscription_product_id, stripe_price_id, billing_interval)
           VALUES ($1, $2, 'year')
           ON CONFLICT (subscription_product_id, billing_interval) DO UPDATE SET stripe_price_id = EXCLUDED.stripe_price_id`,
          [productId, stripeYear]
        );
      }
    }
  }

  console.log(`[planSeed] Ensured ${plans.length} plans from plans.json`);
}

module.exports = { ensureStripePlans, loadPlans };
