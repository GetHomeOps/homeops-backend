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

const PRODUCT_COLUMNS = `id, name, description, target_role AS "targetRole",
  stripe_product_id AS "stripeProductId", stripe_price_id AS "stripePriceId",
  price, billing_interval AS "billingInterval",
  max_properties AS "maxProperties", max_contacts AS "maxContacts",
  max_viewers AS "maxViewers", max_team_members AS "maxTeamMembers",
  is_active AS "isActive",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

class SubscriptionProduct {
  static async create({ name, description, targetRole, price, billingInterval,
    maxProperties, maxContacts, maxViewers, maxTeamMembers,
    stripeProductId, stripePriceId }) {
    if (!name) throw new BadRequestError("Name is required.");
    if (!targetRole) throw new BadRequestError("Target role is required.");

    const duplicateCheck = await db.query(
      `SELECT id FROM subscription_products WHERE LOWER(name) = LOWER($1)`,
      [name]
    );
    if (duplicateCheck.rows.length > 0) {
      throw new BadRequestError(`Product "${name}" already exists.`);
    }

    const result = await db.query(
      `INSERT INTO subscription_products
        (name, description, target_role, price, billing_interval,
         max_properties, max_contacts, max_viewers, max_team_members,
         stripe_product_id, stripe_price_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${PRODUCT_COLUMNS}`,
      [name, description || null, targetRole, price ?? 0, billingInterval || 'month',
       maxProperties ?? 1, maxContacts ?? 25, maxViewers ?? 2, maxTeamMembers ?? 5,
       stripeProductId || null, stripePriceId || null]
    );
    return result.rows[0];
  }

  static async get(id) {
    const result = await db.query(
      `SELECT ${PRODUCT_COLUMNS} FROM subscription_products WHERE id = $1`,
      [id]
    );
    const product = result.rows[0];
    if (!product) throw new NotFoundError(`No product with id: ${id}`);
    return product;
  }

  static async getAll() {
    const result = await db.query(
      `SELECT ${PRODUCT_COLUMNS} FROM subscription_products ORDER BY name ASC`
    );
    return result.rows;
  }

  static async getByName(name) {
    const result = await db.query(
      `SELECT ${PRODUCT_COLUMNS} FROM subscription_products WHERE LOWER(name) = LOWER($1)`,
      [name]
    );
    return result.rows[0] || null;
  }

  /** Get active products for a target role (e.g. homeowner, agent) */
  static async getByRole(role) {
    const result = await db.query(
      `SELECT ${PRODUCT_COLUMNS} FROM subscription_products
       WHERE target_role = $1 AND (is_active IS NULL OR is_active = true)
       ORDER BY price ASC`,
      [role]
    );
    return result.rows;
  }

  static async update(id, data) {
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
      isActive: "is_active",
    };
    const { setCols, values } = sqlForPartialUpdate(data, jsToSql);
    const idVarIdx = "$" + (values.length + 1);
    const querySql = `
      UPDATE subscription_products
      SET ${setCols}, updated_at = NOW()
      WHERE id = ${idVarIdx}
      RETURNING ${PRODUCT_COLUMNS}`;
    const result = await db.query(querySql, [...values, id]);
    const product = result.rows[0];
    if (!product) throw new NotFoundError(`No product with id: ${id}`);
    return product;
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
