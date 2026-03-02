"use strict";

/**
 * SubscriptionProduct Model
 *
 * Manages subscription plan definitions in the `subscription_products` table.
 * Defines pricing, limits (properties, contacts, etc.), and Stripe integration.
 *
 * Key operations:
 * - create / get / getAll / getByName: CRUD for products
 * - getByRole: Fetch active products for a target role (homeowner, agent)
 * - initializeDefaultProducts: Seed free, basic, professional, enterprise tiers
 */

const db = require("../db");
const { NotFoundError, BadRequestError } = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

async function upsertPlanLimits(productId, limits) {
  const { maxProperties, maxContacts, maxViewers, maxTeamMembers, aiTokenMonthlyQuota } = limits || {};
  await db.query(
    `INSERT INTO plan_limits (subscription_product_id, max_properties, max_contacts, max_viewers, max_team_members, ai_token_monthly_quota, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (subscription_product_id) DO UPDATE SET
       max_properties = COALESCE(EXCLUDED.max_properties, plan_limits.max_properties),
       max_contacts = COALESCE(EXCLUDED.max_contacts, plan_limits.max_contacts),
       max_viewers = COALESCE(EXCLUDED.max_viewers, plan_limits.max_viewers),
       max_team_members = COALESCE(EXCLUDED.max_team_members, plan_limits.max_team_members),
       ai_token_monthly_quota = COALESCE(EXCLUDED.ai_token_monthly_quota, plan_limits.ai_token_monthly_quota),
       updated_at = NOW()`,
    [productId, maxProperties ?? 1, maxContacts ?? 25, maxViewers ?? 2, maxTeamMembers ?? 5, aiTokenMonthlyQuota ?? 50000]
  );
}

async function upsertPlanPrice(productId, billingInterval, stripePriceId) {
  if (!stripePriceId) return;
  await db.query(
    `INSERT INTO plan_prices (subscription_product_id, stripe_price_id, billing_interval)
     VALUES ($1, $2, $3)
     ON CONFLICT (subscription_product_id, billing_interval) DO UPDATE SET stripe_price_id = EXCLUDED.stripe_price_id`,
    [productId, stripePriceId, billingInterval]
  );
}

const PRODUCT_COLUMNS_BASE = `id, name, description, target_role AS "targetRole",
  stripe_product_id AS "stripeProductId", stripe_price_id AS "stripePriceId",
  price, billing_interval AS "billingInterval",
  max_properties AS "maxProperties", max_contacts AS "maxContacts",
  max_viewers AS "maxViewers", max_team_members AS "maxTeamMembers",
  is_active AS "isActive",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const PRODUCT_COLUMNS_FULL = `${PRODUCT_COLUMNS_BASE},
  code, sort_order AS "sortOrder", trial_days AS "trialDays"`;

let _hasBillingColumns = null;
async function hasBillingColumns() {
  if (_hasBillingColumns !== null) return _hasBillingColumns;
  try {
    await db.query(`SELECT code FROM subscription_products LIMIT 0`);
    _hasBillingColumns = true;
  } catch {
    _hasBillingColumns = false;
  }
  return _hasBillingColumns;
}

async function getProductColumns() {
  await hasBillingColumns();
  return _hasBillingColumns ? PRODUCT_COLUMNS_FULL : PRODUCT_COLUMNS_BASE;
}

class SubscriptionProduct {
  static async create({ name, description, targetRole, price, billingInterval,
    maxProperties, maxContacts, maxViewers, maxTeamMembers,
    stripeProductId, stripePriceId, code, sortOrder, trialDays,
    aiTokenMonthlyQuota, stripePriceIdMonth, stripePriceIdYear }) {
    if (!name) throw new BadRequestError("Name is required.");
    if (!targetRole) throw new BadRequestError("Target role is required.");

    const duplicateCheck = await db.query(
      `SELECT id FROM subscription_products WHERE LOWER(name) = LOWER($1)`,
      [name]
    );
    if (duplicateCheck.rows.length > 0) {
      throw new BadRequestError(`Product "${name}" already exists.`);
    }
    const hasBilling = await hasBillingColumns();
    if (hasBilling && code) {
      const codeCheck = await db.query(
        `SELECT id FROM subscription_products WHERE code = $1`,
        [code]
      );
      if (codeCheck.rows.length > 0) {
        throw new BadRequestError(`Product with code "${code}" already exists.`);
      }
    }

    const cols = await getProductColumns();
    let result;
    if (hasBilling) {
      result = await db.query(
        `INSERT INTO subscription_products
          (name, description, target_role, price, billing_interval,
           max_properties, max_contacts, max_viewers, max_team_members,
           stripe_product_id, stripe_price_id, code, sort_order, trial_days)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
         RETURNING ${cols}`,
        [name, description || null, targetRole, price ?? 0, billingInterval || 'month',
         maxProperties ?? 1, maxContacts ?? 25, maxViewers ?? 2, maxTeamMembers ?? 5,
         stripeProductId || null, stripePriceId || null,
         code || null, sortOrder ?? 0, trialDays ?? null]
      );
    } else {
      result = await db.query(
        `INSERT INTO subscription_products
          (name, description, target_role, price, billing_interval,
           max_properties, max_contacts, max_viewers, max_team_members,
           stripe_product_id, stripe_price_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${cols}`,
        [name, description || null, targetRole, price ?? 0, billingInterval || 'month',
         maxProperties ?? 1, maxContacts ?? 25, maxViewers ?? 2, maxTeamMembers ?? 5,
         stripeProductId || null, stripePriceId || null]
      );
    }
    const product = result.rows[0];
    try {
      await upsertPlanLimits(product.id, { maxProperties, maxContacts, maxViewers, maxTeamMembers, aiTokenMonthlyQuota });
      if (stripePriceIdMonth) await upsertPlanPrice(product.id, 'month', stripePriceIdMonth);
      if (stripePriceIdYear) await upsertPlanPrice(product.id, 'year', stripePriceIdYear);
    } catch (e) { /* plan_limits/plan_prices may not exist */ }
    return SubscriptionProduct.get(product.id);
  }

  static async get(id) {
    const cols = await getProductColumns();
    const result = await db.query(
      `SELECT ${cols} FROM subscription_products WHERE id = $1`,
      [id]
    );
    const product = result.rows[0];
    if (!product) throw new NotFoundError(`No product with id: ${id}`);
    try {
      const [limRes, priceRes] = await Promise.all([
        db.query(`SELECT max_properties AS "maxProperties", max_contacts AS "maxContacts", max_viewers AS "maxViewers",
                  max_team_members AS "maxTeamMembers", ai_token_monthly_quota AS "aiTokenMonthlyQuota"
                  FROM plan_limits WHERE subscription_product_id = $1`, [id]),
        db.query(`SELECT billing_interval AS "billingInterval", stripe_price_id AS "stripePriceId"
                  FROM plan_prices WHERE subscription_product_id = $1`, [id]),
      ]);
      product.limits = limRes.rows[0] || null;
      product.prices = priceRes.rows || [];
    } catch {
      product.limits = null;
      product.prices = [];
    }
    return product;
  }

  static async getAll() {
    const cols = await getProductColumns();
    const result = await db.query(
      `SELECT ${cols} FROM subscription_products ORDER BY name ASC`
    );
    return result.rows;
  }

  static async getByName(name) {
    const cols = await getProductColumns();
    const result = await db.query(
      `SELECT ${cols} FROM subscription_products WHERE LOWER(name) = LOWER($1)`,
      [name]
    );
    return result.rows[0] || null;
  }

  /** Get active products for a target role (e.g. homeowner, agent) */
  static async getByRole(role) {
    const cols = await getProductColumns();
    const result = await db.query(
      `SELECT ${cols} FROM subscription_products
       WHERE target_role = $1 AND (is_active IS NULL OR is_active = true)
       ORDER BY price ASC`,
      [role]
    );
    return result.rows;
  }

  static async update(id, data) {
    const { limits, prices, ...productData } = data;
    const hasBilling = await hasBillingColumns();
    const jsToSql = {
      name: "name",
      description: "description",
      targetRole: "target_role",
      price: "price",
      billingInterval: "billing_interval",
      maxProperties: "max_properties",
      maxContacts: "max_contacts",
      maxViewers: "max_viewers",
      maxTeamMembers: "max_team_members",
      stripeProductId: "stripe_product_id",
      stripePriceId: "stripe_price_id",
      ...(hasBilling && { code: "code", sortOrder: "sort_order", trialDays: "trial_days" }),
      isActive: "is_active",
    };
    const { setCols, values } = sqlForPartialUpdate(productData, jsToSql);
    if (setCols) {
      const idVarIdx = "$" + (values.length + 1);
      await db.query(
        `UPDATE subscription_products SET ${setCols}, updated_at = NOW() WHERE id = ${idVarIdx}`,
        [...values, id]
      );
    }
    try {
      if (limits) await upsertPlanLimits(id, limits);
      if (prices?.month) await upsertPlanPrice(id, 'month', prices.month);
      if (prices?.year) await upsertPlanPrice(id, 'year', prices.year);
    } catch (e) { /* plan_limits/plan_prices may not exist */ }
    return SubscriptionProduct.get(id);
  }

  static async remove(id) {
    const usageCheck = await db.query(
      `SELECT COUNT(*)::int AS count FROM account_subscriptions WHERE subscription_product_id = $1`,
      [id]
    );
    if (usageCheck.rows[0].count > 0) {
      throw new BadRequestError(
        `Cannot delete: ${usageCheck.rows[0].count} subscription(s) reference this product.`
      );
    }
    const result = await db.query(
      `DELETE FROM subscription_products WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundError(`No product with id: ${id}`);
    return { deleted: id };
  }

  static async initializeDefaultProducts() {
    const DEFAULT_PRODUCTS = [
      { name: "free", targetRole: "homeowner", price: 0, maxProperties: 1, maxContacts: 10, maxViewers: 1, maxTeamMembers: 2 },
      { name: "basic", targetRole: "homeowner", price: 9.99, maxProperties: 3, maxContacts: 50, maxViewers: 3, maxTeamMembers: 5 },
      { name: "professional", targetRole: "agent", price: 29.99, maxProperties: 25, maxContacts: 200, maxViewers: 10, maxTeamMembers: 15 },
      { name: "enterprise", targetRole: "agent", price: 99.99, maxProperties: 100, maxContacts: 1000, maxViewers: 50, maxTeamMembers: 50 },
    ];
    try {
      const existing = await this.getAll();
      if (existing.length > 0) {
        console.log(`Subscription products already exist (${existing.length}). Skipping seed.`);
        return existing;
      }
      const created = [];
      for (const prod of DEFAULT_PRODUCTS) {
        const product = await this.create(prod);
        created.push(product);
      }
      console.log(`Default products created: ${created.map(p => p.name).join(", ")}`);
      return created;
    } catch (err) {
      console.error("Error initializing default products:", err.message);
      throw err;
    }
  }
}

module.exports = SubscriptionProduct;
