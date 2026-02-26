"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const db = require("../db");
const { ensureLoggedIn, ensurePropertyAccess } = require("../middleware/auth");
const { BadRequestError, ForbiddenError } = require("../expressError");
const MaintenanceEvent = require("../models/maintenanceEvent");
const maintenanceEventNewSchema = require("../schemas/maintenanceEventNew.json");
const maintenanceEventUpdateSchema = require("../schemas/maintenanceEventUpdate.json");
const { onEventScheduled } = require("../services/resourceAutoSend");

const router = express.Router();

/** Resolve property_uid to numeric id so maintenance_events.property_id (integer) works. */
async function resolvePropertyIdForCreate(req, res, next) {
  try {
    const raw = req.params.propertyId;
    if (!raw) return next();
    if (/^\d+$/.test(String(raw))) {
      req.params.propertyId = parseInt(raw, 10);
      return next();
    }
    if (/^[0-9A-Z]{26}$/i.test(raw)) {
      const propRes = await db.query(
        `SELECT id FROM properties WHERE property_uid = $1`,
        [raw],
      );
      if (propRes.rows.length === 0) throw new ForbiddenError("Property not found.");
      req.params.propertyId = propRes.rows[0].id;
      return next();
    }
    return next();
  } catch (err) {
    return next(err);
  }
}

/** GET /calendar - List maintenance & inspection events for current user in date range. */
router.get(
  "/calendar",
  ensureLoggedIn,
  async function (req, res, next) {
    try {
      const userId = res.locals.user?.id;
      if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });
      const { start, end } = req.query;
      if (!start || !end) {
        return res.status(400).json({ error: { message: "Query params start and end (YYYY-MM-DD) are required" } });
      }
      const events = await MaintenanceEvent.getCalendarEventsForUser(userId, start, end);
      return res.json({ events });
    } catch (err) {
      return next(err);
    }
  },
);

/** GET /upcoming - List upcoming maintenance & inspection events for current user. */
router.get(
  "/upcoming",
  ensureLoggedIn,
  async function (req, res, next) {
    try {
      const userId = res.locals.user?.id;
      if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });
      const events = await MaintenanceEvent.getUpcomingForUser(userId);
      return res.json({ events });
    } catch (err) {
      return next(err);
    }
  },
);

/** GET /home-events - Unified events for homepage: reminders, scheduled work, next alert. */
router.get(
  "/home-events",
  ensureLoggedIn,
  async function (req, res, next) {
    try {
      const userId = res.locals.user?.id;
      if (!userId) return res.status(401).json({ error: { message: "Unauthorized" } });
      const data = await MaintenanceEvent.getUnifiedEventsForUser(userId);
      return res.json(data);
    } catch (err) {
      return next(err);
    }
  },
);

async function loadPropertyIdFromEvent(req, res, next) {
  try {
    const event = await MaintenanceEvent.getById(req.params.id);
    req.params.propertyId = event.property_id;
    return next();
  } catch (err) {
    return next(err);
  }
}

/** POST /:propertyId - Create a maintenance event. */
router.post(
  "/:propertyId",
  ensureLoggedIn,
  resolvePropertyIdForCreate,
  ensurePropertyAccess({ param: "propertyId" }),
  async function (req, res, next) {
    try {
      const validator = jsonschema.validate(req.body, maintenanceEventNewSchema);
      if (!validator.valid) {
        const errs = validator.errors.map((e) => e.stack);
        throw new BadRequestError(errs);
      }
      const event = await MaintenanceEvent.create({
        ...req.body,
        property_id: req.params.propertyId,
        created_by: res.locals.user.id,
      });
      const creatorRole = res.locals.user?.role;
      const roleForTrigger = creatorRole === "homeowner" ? "homeowner" : "agent";
      try {
        await onEventScheduled({
          eventId: event.id,
          propertyId: req.params.propertyId,
          createdByUserId: res.locals.user.id,
          creatorRole: roleForTrigger,
        });
      } catch (autoErr) {
        console.error("[resourceAutoSend] event scheduled:", autoErr.message);
      }
      return res.status(201).json({ event });
    } catch (err) {
      return next(err);
    }
  },
);

/** GET /:propertyId - List maintenance events for a property. */
router.get(
  "/:propertyId",
  ensureLoggedIn,
  resolvePropertyIdForCreate,
  ensurePropertyAccess({ param: "propertyId" }),
  async function (req, res, next) {
    try {
      const events = await MaintenanceEvent.getByPropertyId(req.params.propertyId);
      return res.json({ events });
    } catch (err) {
      return next(err);
    }
  },
);

/** PATCH /:id - Update a maintenance event. */
router.patch(
  "/:id",
  ensureLoggedIn,
  loadPropertyIdFromEvent,
  ensurePropertyAccess({ param: "propertyId" }),
  async function (req, res, next) {
    try {
      const validator = jsonschema.validate(req.body, maintenanceEventUpdateSchema);
      if (!validator.valid) {
        const errs = validator.errors.map((e) => e.stack);
        throw new BadRequestError(errs);
      }
      const event = await MaintenanceEvent.update(req.params.id, req.body);
      return res.json({ event });
    } catch (err) {
      return next(err);
    }
  },
);

/** DELETE /:id - Delete a maintenance event. */
router.delete(
  "/:id",
  ensureLoggedIn,
  loadPropertyIdFromEvent,
  ensurePropertyAccess({ param: "propertyId" }),
  async function (req, res, next) {
    try {
      await MaintenanceEvent.delete(req.params.id);
      return res.json({ deleted: req.params.id });
    } catch (err) {
      return next(err);
    }
  },
);

module.exports = router;
