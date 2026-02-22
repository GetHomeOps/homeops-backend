"use strict";

/**
 * Subscription Model
 *
 * Manages account subscriptions in the `account_subscriptions` table. Links
 * accounts to subscription products with status, billing period, and Stripe IDs.
 *
 * Key operations:
 * - create / get / getAll / getByAccountId: CRUD and filtering
 * - update / remove: Modify or cancel subscriptions
 * - getSummary: Aggregate counts by status and product
 */

const db = require("../db");
const { NotFoundError, BadRequestError } = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

class Subscription {
  static async create({ accountId, subscriptionProductId, status = 'active', currentPeriodStart, currentPeriodEnd }) {
    if (!accountId || !subscriptionProductId) {
      throw new BadRequestError("accountId and subscriptionProductId are required.");
    }
    const result = await db.query(
      `INSERT INTO account_subscriptions
              (account_id, subscription_product_id, status, current_period_start, current_period_end)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id,
                 account_id AS "accountId",
                 subscription_product_id AS "subscriptionProductId",
                 status,
                 current_period_start AS "currentPeriodStart",
                 current_period_end AS "currentPeriodEnd",
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [accountId, subscriptionProductId, status, currentPeriodStart || null, currentPeriodEnd || null]
    );
    return result.rows[0];
  }

  static async get(id) {
    const result = await db.query(
      `SELECT s.id,
              s.account_id AS "accountId",
              a.name AS "accountName",
              a.url AS "accountUrl",
              u.name AS "ownerName",
              u.email AS "ownerEmail",
              s.subscription_product_id AS "subscriptionProductId",
              sp.name AS "productName",
              sp.price AS "productPrice",
              sp.target_role AS "targetRole",
              s.stripe_subscription_id AS "stripeSubscriptionId",
              s.status,
              s.current_period_start AS "currentPeriodStart",
              s.current_period_end AS "currentPeriodEnd",
              s.created_at AS "createdAt",
              s.updated_at AS "updatedAt"
       FROM account_subscriptions s
       LEFT JOIN accounts a ON a.id = s.account_id
       LEFT JOIN users u ON u.id = a.owner_user_id
       LEFT JOIN subscription_products sp ON sp.id = s.subscription_product_id
       WHERE s.id = $1`,
      [id]
    );
    const subscription = result.rows[0];
    if (!subscription) throw new NotFoundError(`No subscription with id: ${id}`);
    return subscription;
  }

  static async getAll({ status, accountId } = {}) {
    const clauses = [];
    const values = [];
    if (status) {
      values.push(status);
      clauses.push(`s.status = $${values.length}`);
    }
    if (accountId) {
      values.push(accountId);
      clauses.push(`s.account_id = $${values.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
    const result = await db.query(
      `SELECT s.id,
              s.account_id AS "accountId",
              a.name AS "accountName",
              a.url AS "accountUrl",
              u.name AS "ownerName",
              u.email AS "ownerEmail",
              s.subscription_product_id AS "subscriptionProductId",
              sp.name AS "productName",
              sp.price AS "productPrice",
              s.status,
              s.current_period_start AS "currentPeriodStart",
              s.current_period_end AS "currentPeriodEnd",
              s.created_at AS "createdAt",
              s.updated_at AS "updatedAt"
       FROM account_subscriptions s
       LEFT JOIN accounts a ON a.id = s.account_id
       LEFT JOIN users u ON u.id = a.owner_user_id
       LEFT JOIN subscription_products sp ON sp.id = s.subscription_product_id
       ${where}
       ORDER BY s.created_at DESC`,
      values
    );
    return result.rows;
  }

  static async getByAccountId(accountId) {
    return this.getAll({ accountId });
  }

  static async update(id, data) {
    const jsToSql = {
      subscriptionProductId: "subscription_product_id",
      status: "status",
      stripeSubscriptionId: "stripe_subscription_id",
      currentPeriodStart: "current_period_start",
      currentPeriodEnd: "current_period_end",
    };
    const { setCols, values } = sqlForPartialUpdate(data, jsToSql);
    const idVarIdx = "$" + (values.length + 1);
    const querySql = `
      UPDATE account_subscriptions
      SET ${setCols}, updated_at = NOW()
      WHERE id = ${idVarIdx}
      RETURNING id,
                account_id AS "accountId",
                subscription_product_id AS "subscriptionProductId",
                status,
                current_period_start AS "currentPeriodStart",
                current_period_end AS "currentPeriodEnd",
                created_at AS "createdAt",
                updated_at AS "updatedAt"`;
    const result = await db.query(querySql, [...values, id]);
    const subscription = result.rows[0];
    if (!subscription) throw new NotFoundError(`No subscription with id: ${id}`);
    return subscription;
  }

  static async remove(id) {
    const result = await db.query(
      `DELETE FROM account_subscriptions WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundError(`No subscription with id: ${id}`);
    return { deleted: id };
  }

  static async getSummary() {
    const totalRes = await db.query(`SELECT COUNT(*)::int AS count FROM account_subscriptions`);
    const byStatusRes = await db.query(
      `SELECT status, COUNT(*)::int AS count FROM account_subscriptions GROUP BY status ORDER BY count DESC`
    );
    const byProductRes = await db.query(
      `SELECT sp.name AS "productName", COUNT(*)::int AS count
       FROM account_subscriptions s
       LEFT JOIN subscription_products sp ON sp.id = s.subscription_product_id
       GROUP BY sp.name ORDER BY count DESC`
    );
    return {
      total: totalRes.rows[0]?.count || 0,
      byStatus: byStatusRes.rows,
      byProduct: byProductRes.rows,
    };
  }
}

module.exports = Subscription;
