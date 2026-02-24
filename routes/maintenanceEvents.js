"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureLoggedIn, ensurePropertyAccess } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const MaintenanceEvent = require("../models/maintenanceEvent");
const maintenanceEventNewSchema = require("../schemas/maintenanceEventNew.json");
const maintenanceEventUpdateSchema = require("../schemas/maintenanceEventUpdate.json");

const router = express.Router();

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
