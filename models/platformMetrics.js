"use strict";

const db = require("../db");

/**
 * Model for platform-level analytics queries.
 *
 * Provides aggregated metrics across the entire platform:
 *   - daily_platform_metrics view  → growth snapshots, active counts
 *   - database_analytics view      → per-database rollups
 *   - ad-hoc summary queries       → totals, averages, distributions
 */
class PlatformMetrics {

  // ─── Daily Platform Metrics (view) ──────────────────────────────

  /** Get daily platform metric snapshots.
   *
   * Accepted filters (all optional):
   *   - startDate: only rows on or after this date (default: 30 days ago)
   *   - endDate:   only rows on or before this date
   *
   * Returns [{ date, totalUsers, totalDatabases, totalProperties, newUsers, newDatabases, newProperties }, ...]
   */
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
      `SELECT * FROM daily_platform_metrics ${where} ORDER BY date ASC`,
      values
    );

    return result.rows;
  }

  // ─── Database Analytics (view) ──────────────────────────────────

  /** Get analytics for all databases.
   *
   * Returns [{ databaseId, databaseName, totalProperties, totalUsers, totalSystems,
   *            totalMaintenanceRecords, avgHpsScore, lastActiveAt }, ...]
   */
  static async getDatabaseAnalytics() {
    const result = await db.query(
      `SELECT * FROM database_analytics ORDER BY total_properties DESC`
    );

    return result.rows;
  }

  /** Get analytics for a single database.
   *
   * Returns { databaseId, databaseName, totalProperties, totalUsers, ... }
   */
  static async getDatabaseAnalyticsById(databaseId) {
    const result = await db.query(
      `SELECT * FROM database_analytics WHERE database_id = $1`,
      [databaseId]
    );

    return result.rows[0] || null;
  }

  // ─── Ad-hoc Platform Summary ────────────────────────────────────

  /** Get a high-level platform summary with totals and growth indicators.
   *
   * Returns {
   *   totalUsers, totalDatabases, totalProperties, totalSystems,
   *   totalMaintenanceRecords, totalSubscriptions,
   *   newUsersLast30d, newDatabasesLast30d, newPropertiesLast30d,
   *   avgPropertiesPerDatabase, avgUsersPerDatabase, avgHpsScore,
   *   usersByRole: [{ role, count }],
   *   subscriptionsByStatus: [{ status, count }]
   * }
   */
  static async getPlatformSummary() {
    // Totals
    const [usersRes, dbsRes, propsRes, sysRes, maintRes, subsRes] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM users`),
      db.query(`SELECT COUNT(*)::int AS count FROM databases`),
      db.query(`SELECT COUNT(*)::int AS count FROM properties`),
      db.query(`SELECT COUNT(*)::int AS count FROM property_systems`),
      db.query(`SELECT COUNT(*)::int AS count FROM property_maintenance`),
      db.query(`SELECT COUNT(*)::int AS count FROM subscriptions`),
    ]);

    const totalUsers = usersRes.rows[0].count;
    const totalDatabases = dbsRes.rows[0].count;
    const totalProperties = propsRes.rows[0].count;
    const totalSystems = sysRes.rows[0].count;
    const totalMaintenanceRecords = maintRes.rows[0].count;
    const totalSubscriptions = subsRes.rows[0].count;

    // Growth (last 30 days)
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    const [newUsersRes, newDbsRes, newPropsRes] = await Promise.all([
      db.query(`SELECT COUNT(*)::int AS count FROM users WHERE created_at >= $1`, [thirtyDaysAgo]),
      db.query(`SELECT COUNT(*)::int AS count FROM databases WHERE created_at >= $1`, [thirtyDaysAgo]),
      db.query(`SELECT COUNT(*)::int AS count FROM properties WHERE created_at >= $1`, [thirtyDaysAgo]),
    ]);

    // Averages
    const avgPropertiesPerDatabase = totalDatabases > 0
      ? +(totalProperties / totalDatabases).toFixed(1)
      : 0;
    const avgUsersPerDatabase = totalDatabases > 0
      ? +(totalUsers / totalDatabases).toFixed(1)
      : 0;

    const avgHpsRes = await db.query(
      `SELECT ROUND(AVG(hps_score))::int AS avg FROM properties WHERE hps_score IS NOT NULL`
    );

    // Users by role
    const roleRes = await db.query(
      `SELECT role::text AS role, COUNT(*)::int AS count
       FROM users GROUP BY role ORDER BY count DESC`
    );

    // Subscriptions by status
    const subStatusRes = await db.query(
      `SELECT subscription_status AS status, COUNT(*)::int AS count
       FROM subscriptions GROUP BY subscription_status ORDER BY count DESC`
    );

    return {
      totalUsers,
      totalDatabases,
      totalProperties,
      totalSystems,
      totalMaintenanceRecords,
      totalSubscriptions,
      newUsersLast30d: newUsersRes.rows[0].count,
      newDatabasesLast30d: newDbsRes.rows[0].count,
      newPropertiesLast30d: newPropsRes.rows[0].count,
      avgPropertiesPerDatabase,
      avgUsersPerDatabase,
      avgHpsScore: avgHpsRes.rows[0]?.avg || 0,
      usersByRole: roleRes.rows,
      subscriptionsByStatus: subStatusRes.rows,
    };
  }

  /** Get monthly growth data for a given entity.
   *
   * entity: "users" | "databases" | "properties" | "subscriptions"
   * months: number of months to look back (default: 12)
   *
   * Returns [{ month (YYYY-MM), count }, ...]
   */
  static async getMonthlyGrowth(entity, months = 12) {
    const allowedEntities = ["users", "databases", "properties", "subscriptions"];
    if (!allowedEntities.includes(entity)) {
      entity = "users"; // safe fallback
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
}

module.exports = PlatformMetrics;
