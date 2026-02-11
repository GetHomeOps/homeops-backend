"use strict";

const express = require("express");
const { ensureSuperAdmin } = require("../middleware/auth");
const PlatformMetrics = require("../models/platformMetrics");

const router = express.Router();

/** GET /summary => { summary }
 *
 * Get a high-level platform summary with totals, growth, averages, and distributions.
 *
 * Returns:
 *   { totalUsers, totalDatabases, totalProperties, totalSystems,
 *     totalMaintenanceRecords, totalSubscriptions,
 *     newUsersLast30d, newDatabasesLast30d, newPropertiesLast30d,
 *     avgPropertiesPerDatabase, avgUsersPerDatabase, avgHpsScore,
 *     usersByRole, subscriptionsByStatus }
 *
 * Authorization: super_admin only
 */
router.get("/summary", ensureSuperAdmin, async function (req, res, next) {
  try {
    const summary = await PlatformMetrics.getPlatformSummary();
    return res.json({ summary });
  } catch (err) {
    return next(err);
  }
});

/** GET /daily => { metrics: [...] }
 *
 * Get daily platform metric snapshots from the daily_platform_metrics view.
 *   ?startDate=2025-01-01&endDate=2025-12-31
 *
 * Authorization: super_admin only
 */
router.get("/daily", ensureSuperAdmin, async function (req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const metrics = await PlatformMetrics.getDailyMetrics({ startDate, endDate });
    return res.json({ metrics });
  } catch (err) {
    return next(err);
  }
});

/** GET /growth/:entity => { growth: [...] }
 *
 * Get monthly growth data for a given entity.
 *
 * Path params:
 *   :entity — "users" | "databases" | "properties" | "subscriptions"
 *
 * Query params (optional):
 *   ?months=12  (number of months to look back, default 12)
 *
 * Returns [{ month: "YYYY-MM", count }, ...]
 *
 * Authorization: super_admin only
 */
router.get("/growth/:entity", ensureSuperAdmin, async function (req, res, next) {
  try {
    const { entity } = req.params;
    const months = req.query.months ? Number(req.query.months) : 12;
    const growth = await PlatformMetrics.getMonthlyGrowth(entity, months);
    return res.json({ growth });
  } catch (err) {
    return next(err);
  }
});

/** GET /databases => { analytics: [...] }
 *
 * Get analytics for all databases from the database_analytics view.
 *
 * Authorization: super_admin only
 */
router.get("/databases", ensureSuperAdmin, async function (req, res, next) {
  try {
    const analytics = await PlatformMetrics.getDatabaseAnalytics();
    return res.json({ analytics });
  } catch (err) {
    return next(err);
  }
});

/** GET /databases/:databaseId => { analytics }
 *
 * Get analytics for a single database.
 *
 * Authorization: super_admin only
 */
router.get("/databases/:databaseId", ensureSuperAdmin, async function (req, res, next) {
  try {
    const analytics = await PlatformMetrics.getDatabaseAnalyticsById(Number(req.params.databaseId));
    return res.json({ analytics });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
