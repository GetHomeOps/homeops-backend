"use strict";

/**
 * AccountUsageEvent Model
 *
 * Tracks usage and cost events per account in the `account_usage_events` table.
 * Used for metering, billing, and budget enforcement.
 *
 * Key operations:
 * - log: Record a usage event with quantity and cost
 * - getMonthlySpend / getMonthlySpendByCategory: Aggregate spend
 * - checkBudget: Verify spend against a category cap
 * - getHistory: Paginated event history
 */

const db = require("../db");

class AccountUsageEvent {
  static async log({ accountId, userId, category, resource, quantity, unit, unitCost, metadata = {} }) {
    const totalCost = quantity * unitCost;
    const result = await db.query(
      `INSERT INTO account_usage_events
        (account_id, user_id, category, resource, quantity, unit, unit_cost, total_cost, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, account_id AS "accountId", user_id AS "userId",
                 category, resource, quantity, unit, unit_cost AS "unitCost",
                 total_cost AS "totalCost", created_at AS "createdAt"`,
      [accountId, userId, category, resource, quantity, unit, unitCost, totalCost, JSON.stringify(metadata)]
    );
    return result.rows[0];
  }

  static async getMonthlySpend(accountId) {
    const result = await db.query(
      `SELECT COALESCE(SUM(total_cost), 0)::numeric(12,6) AS spend
       FROM account_usage_events
       WHERE account_id = $1
         AND created_at >= DATE_TRUNC('month', NOW())`,
      [accountId]
    );
    return parseFloat(result.rows[0].spend);
  }

  static async getMonthlySpendByCategory(accountId) {
    const result = await db.query(
      `SELECT category, COALESCE(SUM(total_cost), 0)::numeric(12,6) AS spend
       FROM account_usage_events
       WHERE account_id = $1
         AND created_at >= DATE_TRUNC('month', NOW())
       GROUP BY category`,
      [accountId]
    );
    return result.rows;
  }

  static async checkBudget(accountId, category, cap) {
    const result = await db.query(
      `SELECT COALESCE(SUM(total_cost), 0)::numeric(12,6) AS spend
       FROM account_usage_events
       WHERE account_id = $1
         AND category = $2
         AND created_at >= DATE_TRUNC('month', NOW())`,
      [accountId, category]
    );
    const spend = parseFloat(result.rows[0].spend);
    return { spend, remaining: cap - spend, withinBudget: spend < cap };
  }

  static async getHistory(accountId, { limit = 50, offset = 0, category } = {}) {
    const clauses = [`account_id = $1`];
    const values = [accountId];
    if (category) {
      values.push(category);
      clauses.push(`category = $${values.length}`);
    }
    values.push(limit);
    values.push(offset);
    const result = await db.query(
      `SELECT id, user_id AS "userId", category, resource, quantity, unit,
              unit_cost AS "unitCost", total_cost AS "totalCost",
              metadata, created_at AS "createdAt"
       FROM account_usage_events
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC
       LIMIT $${values.length - 1} OFFSET $${values.length}`,
      values
    );
    return result.rows;
  }
}

module.exports = AccountUsageEvent;
