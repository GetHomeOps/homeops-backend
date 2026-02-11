"use strict";

const db = require("../db");
const { NotFoundError, BadRequestError } = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

/** Model for subscription-product-related operations (subscription_products table). */
class SubscriptionProduct {

  /** Create a new subscription product.
   *
   * Data should include:
   *   { name, description, price }
   *
   * Returns { id, name, description, price, createdAt, updatedAt }
   *
   * Throws BadRequestError if required fields are missing or name is duplicate.
   */
  static async create({ name, description, price }) {
    if (!name) {
      throw new BadRequestError("Name is required.");
    }

    // Check for duplicate name
    const duplicateCheck = await db.query(
      `SELECT id FROM subscription_products WHERE LOWER(name) = LOWER($1)`,
      [name]
    );
    if (duplicateCheck.rows.length > 0) {
      throw new BadRequestError(`Subscription product with name "${name}" already exists.`);
    }

    const finalPrice = (price !== undefined && price !== null) ? price : 0;

    const result = await db.query(
      `INSERT INTO subscription_products (name, description, price)
       VALUES ($1, $2, $3)
       RETURNING id,
                 name,
                 description,
                 price,
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [name, description || null, finalPrice]
    );

    return result.rows[0];
  }

  /** Get a subscription product by id.
   *
   * Returns { id, name, description, price, createdAt, updatedAt }
   *
   * Throws NotFoundError if not found.
   */
  static async get(id) {
    const result = await db.query(
      `SELECT id,
              name,
              description,
              price,
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM subscription_products
       WHERE id = $1`,
      [id]
    );

    const product = result.rows[0];
    if (!product) throw new NotFoundError(`No subscription product with id: ${id}`);

    return product;
  }

  /** Get all subscription products.
   *
   * Returns [{ id, name, description, price, createdAt, updatedAt }, ...]
   */
  static async getAll() {
    const result = await db.query(
      `SELECT id,
              name,
              description,
              price,
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM subscription_products
       ORDER BY name ASC`
    );

    return result.rows;
  }

  /** Get a subscription product by name (case-insensitive).
   *
   * Returns { id, name, description, price, createdAt, updatedAt } or null.
   */
  static async getByName(name) {
    const result = await db.query(
      `SELECT id,
              name,
              description,
              price,
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM subscription_products
       WHERE LOWER(name) = LOWER($1)`,
      [name]
    );

    return result.rows[0] || null;
  }

  /** Update a subscription product with partial data.
   *
   * Data can include: { name, description, price }
   *
   * Returns updated subscription product object.
   *
   * Throws NotFoundError if not found.
   */
  static async update(id, data) {
    const jsToSql = {
      name: "name",
      description: "description",
      price: "price",
    };

    const { setCols, values } = sqlForPartialUpdate(data, jsToSql);
    const idVarIdx = "$" + (values.length + 1);

    const querySql = `
      UPDATE subscription_products
      SET ${setCols}, updated_at = NOW()
      WHERE id = ${idVarIdx}
      RETURNING id,
                name,
                description,
                price,
                created_at AS "createdAt",
                updated_at AS "updatedAt"`;
    const result = await db.query(querySql, [...values, id]);
    const product = result.rows[0];

    if (!product) throw new NotFoundError(`No subscription product with id: ${id}`);

    return product;
  }

  /** Remove a subscription product by id.
   *
   * Returns { deleted: id }
   *
   * Throws NotFoundError if not found.
   * Throws BadRequestError if product is referenced by active subscriptions.
   */
  static async remove(id) {
    // Check if any subscriptions reference this product
    const usageCheck = await db.query(
      `SELECT COUNT(*)::int AS count FROM subscriptions WHERE subscription_product_id = $1`,
      [id]
    );
    if (usageCheck.rows[0].count > 0) {
      throw new BadRequestError(
        `Cannot delete product: ${usageCheck.rows[0].count} subscription(s) reference it.`
      );
    }

    const result = await db.query(
      `DELETE FROM subscription_products
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    const product = result.rows[0];
    if (!product) throw new NotFoundError(`No subscription product with id: ${id}`);

    return { deleted: id };
  }

  /** Initialize default subscription products if none exist.
   *
   * Creates the four default products (free, basic, professional, enterprise)
   * with only the name populated. Price defaults to 0.00 — the admin can
   * fill in description and pricing later through the UI.
   *
   * Safe to call on every server start; skips creation when products
   * already exist.
   */
  static async initializeDefaultProducts() {
    const DEFAULT_PRODUCTS = ["free", "basic", "professional", "enterprise"];

    try {
      const existing = await this.getAll();

      if (existing.length > 0) {
        console.log(`Subscription products already exist (${existing.length}). Skipping seed.`);
        return existing;
      }

      const created = [];
      for (const name of DEFAULT_PRODUCTS) {
        const product = await this.create({ name });
        created.push(product);
      }

      console.log(`Default subscription products created: ${created.map(p => p.name).join(", ")}`);
      return created;
    } catch (err) {
      console.error("Error initializing default subscription products:", err.message);
      throw err;
    }
  }
}

module.exports = SubscriptionProduct;
