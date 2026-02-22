"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const db = require("../db");
const { ensureLoggedIn, ensureSuperAdmin, ensurePlatformAdmin } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const PlatformEngagement = require("../models/platformEngagement");
const engagementEventNewSchema = require("../schemas/engagementEventNew.json");

const router = express.Router();

/** Get user IDs that share an account with the given userId. */
async function getUserIdsInSameAccounts(userId) {
  const result = await db.query(
    `SELECT DISTINCT au2.user_id AS id
     FROM account_users au1
     JOIN account_users au2 ON au1.account_id = au2.account_id
     WHERE au1.user_id = $1`,
    [userId]
  );
  return result.rows.map((r) => r.id).filter(Boolean);
}

/** POST / - Log engagement event. Body: eventType, eventData (optional). Super_admin may pass userId. */
router.post("/", ensureLoggedIn, async function (req, res, next) {
  try {
    const payload = { ...req.body };
    if (payload.userId == null || res.locals.user?.role !== "super_admin") {
      payload.userId = res.locals.user?.id;
    }
    const validator = jsonschema.validate(payload, engagementEventNewSchema);
    if (!validator.valid) {
      const errs = validator.errors.map((e) => e.stack);
      throw new BadRequestError(errs);
    }

    const event = await PlatformEngagement.logEvent(payload);
    return res.status(201).json({ event });
  } catch (err) {
    return next(err);
  }
});

/** GET / - List events. Query: userId, eventType, startDate, endDate, limit, offset. Platform admin only. */
router.get("/", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const { userId, eventType, startDate, endDate, limit, offset } = req.query;
    const events = await PlatformEngagement.getAll({
      userId: userId ? Number(userId) : undefined,
      eventType,
      startDate,
      endDate,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
    return res.json({ events });
  } catch (err) {
    return next(err);
  }
});

/** GET /counts - Event counts by type. Query: startDate, endDate. Non-admin sees own accounts only. */
router.get("/counts", ensureLoggedIn, async function (req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    let userIds;
    if (res.locals.user?.role !== "super_admin") {
      userIds = await getUserIdsInSameAccounts(res.locals.user.id);
      if (!userIds.length) {
        return res.json({ counts: [] });
      }
    }
    const counts = await PlatformEngagement.getCountsByType({ startDate, endDate, userIds });
    return res.json({ counts });
  } catch (err) {
    return next(err);
  }
});

/** GET /trend - Daily event trend. Query: startDate, endDate, eventType. Non-admin sees own accounts only. */
router.get("/trend", ensureLoggedIn, async function (req, res, next) {
  try {
    const { startDate, endDate, eventType } = req.query;
    let userIds;
    if (res.locals.user?.role !== "super_admin") {
      userIds = await getUserIdsInSameAccounts(res.locals.user.id);
      if (!userIds.length) {
        return res.json({ trend: [] });
      }
    }
    const trend = await PlatformEngagement.getDailyTrend({ startDate, endDate, eventType, userIds });
    return res.json({ trend });
  } catch (err) {
    return next(err);
  }
});

/** GET /:id - Get single event. Platform admin only. */
router.get("/:id", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const event = await PlatformEngagement.get(Number(req.params.id));
    return res.json({ event });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
