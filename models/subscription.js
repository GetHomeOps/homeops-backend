"use strict";

const db = require("../db");
const { NotFoundError, BadRequestError } = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

/** Model for subscription-related operations (subscriptions table). */
class Subscription {

  /** Create a new subscription.
   *
   * Data should include:
   *   { userId, subscriptionProductId, subscriptionType, subscriptionStatus, subscriptionStartDate, subscriptionEndDate }
   *
   * Returns { id, userId, subscriptionProductId, subscriptionType, subscriptionStatus, subscriptionStartDate, subscriptionEndDate, createdAt, updatedAt }
   *
   * Throws BadRequestError if required fields are missing.
   */
  static async create({ userId, subscriptionProductId, subscriptionType, subscriptionStatus, subscriptionStartDate, subscriptionEndDate }) {
    if (!userId || !subscriptionType || !subscriptionStatus || !subscriptionStartDate || !subscriptionEndDate) {
      throw new BadRequestError("All subscription fields are required.");
    }

    const result = await db.query(
      `INSERT INTO subscriptions
              (user_id, subscription_product_id, subscription_type, subscription_status, subscription_start_date, subscription_end_date)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id,
                 user_id          AS "userId",
                 subscription_product_id AS "subscriptionProductId",
                 subscription_type   AS "subscriptionType",
                 subscription_status AS "subscriptionStatus",
                 subscription_start_date AS "subscriptionStartDate",
                 subscription_end_date   AS "subscriptionEndDate",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [userId, subscriptionProductId || null, subscriptionType, subscriptionStatus, subscriptionStartDate, subscriptionEndDate]
    );

    return result.rows[0];
  }

  /** Get a subscription by id (with user, database, and product info).
   *
   * Returns { id, userId, userName, userEmail, databaseName, databaseId,
   *           subscriptionProductId, subscriptionProductName,
   *           subscriptionType, subscriptionStatus, subscriptionStartDate,
   *           subscriptionEndDate, createdAt, updatedAt }
   *
   * Throws NotFoundError if not found.
   */
  static async get(id) {
    const result = await db.query(
      `SELECT s.id,
              s.user_id             AS "userId",
              u.name                AS "userName",
              u.email               AS "userEmail",
              d.name                AS "databaseName",
              d.id                  AS "databaseId",
              s.subscription_product_id AS "subscriptionProductId",
              sp.name               AS "subscriptionProductName",
              sp.price              AS "subscriptionProductPrice",
              s.subscription_type   AS "subscriptionType",
              s.subscription_status AS "subscriptionStatus",
              s.subscription_start_date AS "subscriptionStartDate",
              s.subscription_end_date   AS "subscriptionEndDate",
              s.created_at AS "createdAt",
              s.updated_at AS "updatedAt"
       FROM subscriptions s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN user_databases ud ON ud.user_id = u.id
       LEFT JOIN databases d ON d.id = ud.database_id
       LEFT JOIN subscription_products sp ON sp.id = s.subscription_product_id
       WHERE s.id = $1`,
      [id]
    );

    const subscription = result.rows[0];
    if (!subscription) throw new NotFoundError(`No subscription with id: ${id}`);

    return subscription;
  }

  /** Get all subscriptions with user, database, and product info.
   *
   * Accepted filters (all optional):
   *   - status:  filter by subscription_status
   *   - type:    filter by subscription_type
   *   - userId:  filter by user_id
   *
   * Returns [{ id, userId, userName, userEmail, databaseName, databaseId,
   *            subscriptionProductId, subscriptionProductName,
   *            subscriptionType, subscriptionStatus, ... }, ...]
   */
  static async getAll({ status, type, userId } = {}) {
    const clauses = [];
    const values = [];

    if (status) {
      values.push(status);
      clauses.push(`s.subscription_status = $${values.length}`);
    }
    if (type) {
      values.push(type);
      clauses.push(`s.subscription_type = $${values.length}`);
    }
    if (userId) {
      values.push(userId);
      clauses.push(`s.user_id = $${values.length}`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const result = await db.query(
      `SELECT s.id,
              s.user_id             AS "userId",
              u.name                AS "userName",
              u.email               AS "userEmail",
              d.name                AS "databaseName",
              d.id                  AS "databaseId",
              s.subscription_product_id AS "subscriptionProductId",
              sp.name               AS "subscriptionProductName",
              s.subscription_type   AS "subscriptionType",
              s.subscription_status AS "subscriptionStatus",
              s.subscription_start_date AS "subscriptionStartDate",
              s.subscription_end_date   AS "subscriptionEndDate",
              s.created_at AS "createdAt",
              s.updated_at AS "updatedAt"
       FROM subscriptions s
       LEFT JOIN users u ON u.id = s.user_id
       LEFT JOIN user_databases ud ON ud.user_id = u.id AND ud.db_admin = TRUE
       LEFT JOIN databases d ON d.id = ud.database_id
       LEFT JOIN subscription_products sp ON sp.id = s.subscription_product_id
       ${where}
       ORDER BY s.created_at DESC`,
      values
    );

    return result.rows;
  }

  /** Get subscriptions for a specific user.
   *
   * Returns [{ id, userId, subscriptionType, subscriptionStatus, ... }, ...]
   */
  static async getByUserId(userId) {
    return this.getAll({ userId });
  }

  /** Update a subscription with partial data.
   *
   * Data can include: { subscriptionProductId, subscriptionType, subscriptionStatus, subscriptionStartDate, subscriptionEndDate }
   *
   * Returns updated subscription object.
   *
   * Throws NotFoundError if not found.
   */
  static async update(id, data) {
    // Map camelCase input keys to snake_case column names
    const jsToSql = {
      subscriptionProductId: "subscription_product_id",
      subscriptionType: "subscription_type",
      subscriptionStatus: "subscription_status",
      subscriptionStartDate: "subscription_start_date",
      subscriptionEndDate: "subscription_end_date",
    };

    const { setCols, values } = sqlForPartialUpdate(data, jsToSql);
    const idVarIdx = "$" + (values.length + 1);

    const querySql = `
      UPDATE subscriptions
      SET ${setCols}, updated_at = NOW()
      WHERE id = ${idVarIdx}
      RETURNING id,
                user_id             AS "userId",
                subscription_product_id AS "subscriptionProductId",
                subscription_type   AS "subscriptionType",
                subscription_status AS "subscriptionStatus",
                subscription_start_date AS "subscriptionStartDate",
                subscription_end_date   AS "subscriptionEndDate",
                created_at AS "createdAt",
                updated_at AS "updatedAt"`;
    const result = await db.query(querySql, [...values, id]);
    const subscription = result.rows[0];

    if (!subscription) throw new NotFoundError(`No subscription with id: ${id}`);

    return subscription;
  }

  /** Remove a subscription by id.
   *
   * Returns { deleted: id }
   *
   * Throws NotFoundError if not found.
   */
  static async remove(id) {
    const result = await db.query(
      `DELETE FROM subscriptions
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    const subscription = result.rows[0];
    if (!subscription) throw new NotFoundError(`No subscription with id: ${id}`);

    return { deleted: id };
  }

  /** Get a summary of subscription counts by type and status.
   *
   * Returns { total, byType: { free: n, ... }, byStatus: { active: n, ... } }
   */
  static async getSummary() {
    const totalRes = await db.query(`SELECT COUNT(*)::int AS count FROM subscriptions`);

    const byTypeRes = await db.query(
      `SELECT subscription_type AS "type", COUNT(*)::int AS count
       FROM subscriptions
       GROUP BY subscription_type
       ORDER BY count DESC`
    );

    const byStatusRes = await db.query(
      `SELECT subscription_status AS "status", COUNT(*)::int AS count
       FROM subscriptions
       GROUP BY subscription_status
       ORDER BY count DESC`
    );

    return {
      total: totalRes.rows[0]?.count || 0,
      byType: byTypeRes.rows,
      byStatus: byStatusRes.rows,
    };
  }

  /** Get all subscription products.
   *
   * Returns [{ id, name, description, price, createdAt, updatedAt }, ...]
   */
  static async getAllProducts() {
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
}

module.exports = Subscription;
