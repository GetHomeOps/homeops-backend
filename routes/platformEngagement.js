"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const db = require("../db");
const { ensureLoggedIn, ensureSuperAdmin } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const PlatformEngagement = require("../models/platformEngagement");
const engagementEventNewSchema = require("../schemas/engagementEventNew.json");

const router = express.Router();

/** Get user IDs that share a database with the given userId (for scoping engagement to agent's databases). */
async function getUserIdsInSameDatabases(userId) {
  const result = await db.query(
    `SELECT DISTINCT ud2.user_id AS id
     FROM user_databases ud1
     JOIN user_databases ud2 ON ud1.database_id = ud2.database_id
     WHERE ud1.user_id = $1`,
    [userId]
  );
  return result.rows.map((r) => r.id).filter(Boolean);
}

/** POST / { event } => { event }
 *
 * Log a new platform engagement event.
 *
 * Body: { eventType, eventData (optional) } — userId defaults to current user.
 * Super_admin may pass userId to log on behalf of another user.
 *
 * Authorization: logged in (any authenticated user can log events)
 */
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

/** GET / => { events: [...] }
 *
 * Get engagement events with optional filters:
 *   ?userId=1&eventType=login&startDate=2025-01-01&endDate=2025-12-31&limit=50&offset=0
 *
 * Authorization: super_admin only
 */
router.get("/", ensureSuperAdmin, async function (req, res, next) {
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

/** GET /counts => { counts: [...] }
 *
 * Get aggregated event counts grouped by event_type.
 *   ?startDate=2025-01-01&endDate=2025-12-31
 *
 * Authorization: logged in. Super_admin sees all; others see events for users in their databases.
 */
router.get("/counts", ensureLoggedIn, async function (req, res, next) {
  try {
    const { startDate, endDate } = req.query;
    let userIds;
    if (res.locals.user?.role !== "super_admin") {
      userIds = await getUserIdsInSameDatabases(res.locals.user.id);
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

/** GET /trend => { trend: [...] }
 *
 * Get daily event counts for trend analysis.
 *   ?startDate=2025-01-01&endDate=2025-12-31&eventType=login
 *
 * Authorization: logged in. Super_admin sees all; others see events for users in their databases.
 */
router.get("/trend", ensureLoggedIn, async function (req, res, next) {
  try {
    const { startDate, endDate, eventType } = req.query;
    let userIds;
    if (res.locals.user?.role !== "super_admin") {
      userIds = await getUserIdsInSameDatabases(res.locals.user.id);
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

/** GET /:id => { event }
 *
 * Get a single engagement event by id.
 *
 * Authorization: super_admin only
 */
router.get("/:id", ensureSuperAdmin, async function (req, res, next) {
  try {
    const event = await PlatformEngagement.get(Number(req.params.id));
    return res.json({ event });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
