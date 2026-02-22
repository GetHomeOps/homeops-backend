"use strict";

const express = require("express");
const { ensurePlatformAdmin } = require("../middleware/auth");
const PlatformMetrics = require("../models/platformMetrics");

const router = express.Router();

/** GET /summary - Platform totals (users, accounts, properties, etc.). Platform admin only. */
router.get("/summary", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const summary = await PlatformMetrics.getPlatformSummary();
    return res.json({ summary });
  } catch (err) {
    return next(err);
  }
});

/** GET /daily - Daily metrics by date range. Query: startDate, endDate. Platform admin only. */
router.get("/daily", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const metrics = await PlatformMetrics.getDailyMetrics({ startDate, endDate });
    return res.json({ metrics });
  } catch (err) {
    return next(err);
  }
});

/** GET /growth/:entity - Monthly growth. Entity: users, accounts, properties. Query: months. Platform admin only. */
router.get("/growth/:entity", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const { entity } = req.params;
    const months = req.query.months ? Number(req.query.months) : 12;
    const growth = await PlatformMetrics.getMonthlyGrowth(entity, months);
    return res.json({ growth });
  } catch (err) {
    return next(err);
  }
});

/** GET /accounts - Account analytics snapshot. Platform admin only. */
router.get("/accounts", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const analytics = await PlatformMetrics.getAccountAnalytics();
    return res.json({ analytics });
  } catch (err) {
    return next(err);
  }
});

/** GET /accounts/:accountId - Single account analytics. Platform admin only. */
router.get("/accounts/:accountId", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const analytics = await PlatformMetrics.getAccountAnalyticsById(Number(req.params.accountId));
    return res.json({ analytics });
  } catch (err) {
    return next(err);
  }
});

/** GET /costs/summary - Usage cost summary. Query: startDate, endDate. Platform admin only. */
router.get("/costs/summary", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const summary = await PlatformMetrics.getCostSummary({ startDate, endDate });
    return res.json({ summary });
  } catch (err) {
    return next(err);
  }
});

/** GET /costs/per-account - Cost per account. Query: startDate, endDate. Platform admin only. */
router.get("/costs/per-account", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    const data = await PlatformMetrics.getCostPerAccount({ startDate, endDate });
    return res.json({ accounts: data });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
