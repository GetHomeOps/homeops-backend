"use strict";

/**
 * PlatformMetrics Model
 *
 * Provides analytics and metrics for the platform. Reads from snapshots
 * (daily_metrics_snapshot, account_analytics_snapshot) and raw tables.
 *
 * Key operations:
 * - getDailyMetrics: Time-series metrics by date range
 * - getAccountAnalytics / getAccountAnalyticsById: Per-account analytics
 * - getPlatformSummary: Totals for users, accounts, properties, subscriptions
 * - getMonthlyGrowth: Growth trends by entity type
 * - refreshDailySnapshot / refreshAccountAnalytics: Update snapshot tables
 * - getCostSummary / getCostPerAccount: Usage cost analytics
 */

const db = require("../db");

class PlatformMetrics {
  static async getDailyMetrics({ startDate, endDate } = {}) {
    const clauses = [];
    const values = [];
    values.push(startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString());
    clauses.push(`date >= $${values.length}`);
    if (endDate) {
      values.push(endDate);
      clauses.push(`date <= $${values.length}`);
    }
    const where = `WHERE ${clauses.join(" AND ")}`;
    const result = await db.query(
      `SELECT * FROM daily_metrics_snapshot ${where} ORDER BY date ASC`,
      values
    );
    return result.rows;
  }

  static async getAccountAnalytics() {
    const result = await db.query(
      `SELECT * FROM account_analytics_snapshot ORDER BY total_properties DESC`
    );
    return result.rows;
  }

  static async getAccountAnalyticsById(accountId) {
    const result = await db.query(
      `SELECT * FROM account_analytics_snapshot WHERE account_id = $1`,
      [accountId]
    );
    return result.rows[0] || null;
  }

  static async getPlatformSummary() {
    const [usersRes, accountsRes, propsRes, sysRes, maintRes, subsRes] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM users`),
      db.query(`SELECT COUNT(*)::int AS count FROM accounts`),
      db.query(`SELECT COUNT(*)::int AS count FROM properties`),
      db.query(`SELECT COUNT(*)::int AS count FROM property_systems`),
      db.query(`SELECT COUNT(*)::int AS count FROM property_maintenance`),
      db.query(`SELECT COUNT(*)::int AS count FROM account_subscriptions`),
    ]);

    const totalUsers = usersRes.rows[0].count;
    const totalAccounts = accountsRes.rows[0].count;
    const totalProperties = propsRes.rows[0].count;
    const totalSystems = sysRes.rows[0].count;
    const totalMaintenanceRecords = maintRes.rows[0].count;
    const totalSubscriptions = subsRes.rows[0].count;

    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [newUsersRes, newAccountsRes, newPropsRes] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM users WHERE created_at >= $1`, [thirtyDaysAgo]),
      db.query(`SELECT COUNT(*)::int AS count FROM accounts WHERE created_at >= $1`, [thirtyDaysAgo]),
      db.query(`SELECT COUNT(*)::int AS count FROM properties WHERE created_at >= $1`, [thirtyDaysAgo]),
    ]);

    const avgPropertiesPerAccount = totalAccounts > 0
      ? +(totalProperties / totalAccounts).toFixed(1)
      : 0;
    const avgUsersPerAccount = totalAccounts > 0
      ? +(totalUsers / totalAccounts).toFixed(1)
      : 0;

    const avgHpsRes = await db.query(
      `SELECT ROUND(AVG(hps_score))::int AS avg FROM properties WHERE hps_score IS NOT NULL`
    );

    const roleRes = await db.query(
      `SELECT role::text AS role, COUNT(*)::int AS count FROM users GROUP BY role ORDER BY count DESC`
    );

    const subStatusRes = await db.query(
      `SELECT status, COUNT(*)::int AS count FROM account_subscriptions GROUP BY status ORDER BY count DESC`
    );

    return {
      totalUsers,
      totalAccounts,
      totalProperties,
      totalSystems,
      totalMaintenanceRecords,
      totalSubscriptions,
      newUsersLast30d: newUsersRes.rows[0].count,
      newAccountsLast30d: newAccountsRes.rows[0].count,
      newPropertiesLast30d: newPropsRes.rows[0].count,
      avgPropertiesPerAccount,
      avgUsersPerAccount,
      avgHpsScore: avgHpsRes.rows[0]?.avg || 0,
      usersByRole: roleRes.rows,
      subscriptionsByStatus: subStatusRes.rows,
    };
  }

  static async getMonthlyGrowth(entity, months = 12) {
    const allowedEntities = ["users", "accounts", "properties", "account_subscriptions"];
    if (!allowedEntities.includes(entity)) {
      entity = "users";
    }
    const result = await db.query(
      `SELECT TO_CHAR(DATE_TRUNC('month', created_at), 'YYYY-MM') AS month,
              COUNT(*)::int AS count
       FROM ${entity}
       WHERE created_at >= DATE_TRUNC('month', NOW()) - INTERVAL '${months} months'
       GROUP BY DATE_TRUNC('month', created_at)
       ORDER BY month ASC`
    );
    return result.rows;
  }

  static async refreshDailySnapshot() {
    const today = new Date().toISOString().split('T')[0];
    const [usersRes, accountsRes, propsRes] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM users WHERE created_at::date <= $1`, [today]),
      db.query(`SELECT COUNT(*)::int AS count FROM accounts WHERE created_at::date <= $1`, [today]),
      db.query(`SELECT COUNT(*)::int AS count FROM properties WHERE created_at::date <= $1`, [today]),
    ]);
    const [newUsersRes, newAccountsRes, newPropsRes] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM users WHERE created_at::date = $1`, [today]),
      db.query(`SELECT COUNT(*)::int AS count FROM accounts WHERE created_at::date = $1`, [today]),
      db.query(`SELECT COUNT(*)::int AS count FROM properties WHERE created_at::date = $1`, [today]),
    ]);
    await db.query(
      `INSERT INTO daily_metrics_snapshot (date, total_users, total_accounts, total_properties, new_users, new_accounts, new_properties)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (date) DO UPDATE SET
         total_users = EXCLUDED.total_users,
         total_accounts = EXCLUDED.total_accounts,
         total_properties = EXCLUDED.total_properties,
         new_users = EXCLUDED.new_users,
         new_accounts = EXCLUDED.new_accounts,
         new_properties = EXCLUDED.new_properties`,
      [today, usersRes.rows[0].count, accountsRes.rows[0].count, propsRes.rows[0].count,
       newUsersRes.rows[0].count, newAccountsRes.rows[0].count, newPropsRes.rows[0].count]
    );
  }

  static async refreshAccountAnalytics() {
    await db.query(`DELETE FROM account_analytics_snapshot`);
    await db.query(
      `INSERT INTO account_analytics_snapshot
        (account_id, account_name, total_properties, total_users, total_systems,
         total_maintenance_records, avg_hps_score, last_active_at)
       SELECT
         a.id,
         a.name,
         COUNT(DISTINCT p.id)::int,
         COUNT(DISTINCT au.user_id)::int,
         COUNT(DISTINCT ps.system_key)::int,
         COUNT(DISTINCT pm.id)::int,
         ROUND(AVG(p.hps_score))::int,
         MAX(GREATEST(p.updated_at, a.updated_at))
       FROM accounts a
       LEFT JOIN account_users au ON au.account_id = a.id
       LEFT JOIN properties p ON p.account_id = a.id
       LEFT JOIN property_systems ps ON ps.property_id = p.id
       LEFT JOIN property_maintenance pm ON pm.property_id = p.id
       GROUP BY a.id, a.name`
    );
  }

  static async getCostSummary({ startDate, endDate } = {}) {
    const clauses = [];
    const values = [];
    if (startDate) {
      values.push(startDate);
      clauses.push(`created_at >= $${values.length}`);
    }
    if (endDate) {
      values.push(endDate);
      clauses.push(`created_at <= $${values.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const totalRes = await db.query(
      `SELECT COALESCE(SUM(total_cost), 0)::numeric(12,6) AS "totalCost",
              COUNT(DISTINCT account_id)::int AS "accountCount",
              COUNT(DISTINCT user_id)::int AS "userCount"
       FROM account_usage_events ${where}`,
      values
    );

    const breakdownRes = await db.query(
      `SELECT category, COALESCE(SUM(total_cost), 0)::numeric(12,6) AS cost
       FROM account_usage_events ${where}
       GROUP BY category ORDER BY cost DESC`,
      values
    );

    const row = totalRes.rows[0];
    return {
      totalCost: parseFloat(row.totalCost),
      accountCount: row.accountCount,
      userCount: row.userCount,
      avgCostPerAccount: row.accountCount > 0 ? parseFloat((row.totalCost / row.accountCount).toFixed(6)) : 0,
      avgCostPerUser: row.userCount > 0 ? parseFloat((row.totalCost / row.userCount).toFixed(6)) : 0,
      breakdown: breakdownRes.rows,
    };
  }

  static async getCostPerAccount({ startDate, endDate } = {}) {
    const clauses = [];
    const values = [];
    if (startDate) {
      values.push(startDate);
      clauses.push(`ue.created_at >= $${values.length}`);
    }
    if (endDate) {
      values.push(endDate);
      clauses.push(`ue.created_at <= $${values.length}`);
    }
    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const result = await db.query(
      `SELECT a.id AS "accountId", a.name AS "accountName",
              u.name AS "ownerName", u.email AS "ownerEmail",
              sp.name AS "tier",
              sp.price AS "revenue",
              COALESCE(SUM(ue.total_cost), 0)::numeric(12,6) AS "totalCost",
              (sp.price - COALESCE(SUM(ue.total_cost), 0))::numeric(12,2) AS "margin"
       FROM accounts a
       LEFT JOIN users u ON u.id = a.owner_user_id
       LEFT JOIN account_subscriptions asub ON asub.account_id = a.id AND asub.status = 'active'
       LEFT JOIN subscription_products sp ON sp.id = asub.subscription_product_id
       LEFT JOIN account_usage_events ue ON ue.account_id = a.id ${where ? 'AND ' + clauses.join(' AND ') : ''}
       GROUP BY a.id, a.name, u.name, u.email, sp.name, sp.price
       ORDER BY "totalCost" DESC`,
      values
    );
    return result.rows;
  }
}

module.exports = PlatformMetrics;
