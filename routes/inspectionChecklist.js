"use strict";

const express = require("express");
const db = require("../db");
const { ensureLoggedIn, ensurePropertyAccess } = require("../middleware/auth");
const { BadRequestError, ForbiddenError } = require("../expressError");
const InspectionChecklistItem = require("../models/inspectionChecklistItem");

const router = express.Router();

/** Resolve property_uid to numeric id. */
async function resolvePropertyId(req, res, next) {
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

/** GET /properties/:propertyId/inspection-checklist - List items, optionally filtered. */
router.get(
  "/properties/:propertyId/inspection-checklist",
  ensureLoggedIn,
  resolvePropertyId,
  ensurePropertyAccess({ param: "propertyId" }),
  async function (req, res, next) {
    try {
      const { systemKey, status } = req.query;
      const items = await InspectionChecklistItem.getByPropertyId(
        req.params.propertyId,
        { systemKey, status },
      );
      return res.json({ items });
    } catch (err) {
      return next(err);
    }
  }
);

/** GET /properties/:propertyId/inspection-checklist/progress - Progress stats. */
router.get(
  "/properties/:propertyId/inspection-checklist/progress",
  ensureLoggedIn,
  resolvePropertyId,
  ensurePropertyAccess({ param: "propertyId" }),
  async function (req, res, next) {
    try {
      const progress = await InspectionChecklistItem.getProgress(req.params.propertyId);
      return res.json({ progress });
    } catch (err) {
      return next(err);
    }
  }
);

/** Resolve property_id from item for access check. */
async function loadPropertyIdFromItem(req, res, next) {
  try {
    const item = await InspectionChecklistItem.get(req.params.itemId);
    req.params.propertyId = item.property_id;
    req._checklistItem = item;
    return next();
  } catch (err) {
    return next(err);
  }
}

/** PATCH /inspection-checklist/:itemId - Update item (status, notes, linked_maintenance_id). */
router.patch(
  "/inspection-checklist/:itemId",
  ensureLoggedIn,
  loadPropertyIdFromItem,
  ensurePropertyAccess({ param: "propertyId" }),
  async function (req, res, next) {
    try {
      const { status, notes, linked_maintenance_id } = req.body;
      const updateData = {};
      if (status !== undefined) updateData.status = status;
      if (notes !== undefined) updateData.notes = notes;
      if (linked_maintenance_id !== undefined) updateData.linked_maintenance_id = linked_maintenance_id;

      if (status === "completed") {
        updateData.completed_at = new Date().toISOString();
        updateData.completed_by = res.locals.user.id;
      }

      const item = await InspectionChecklistItem.update(req.params.itemId, updateData);
      return res.json({ item });
    } catch (err) {
      return next(err);
    }
  }
);

/** POST /inspection-checklist/:itemId/complete - Mark item completed. */
router.post(
  "/inspection-checklist/:itemId/complete",
  ensureLoggedIn,
  loadPropertyIdFromItem,
  ensurePropertyAccess({ param: "propertyId" }),
  async function (req, res, next) {
    try {
      const { maintenanceId, notes } = req.body || {};
      const item = await InspectionChecklistItem.complete(req.params.itemId, {
        userId: res.locals.user.id,
        maintenanceId: maintenanceId || null,
        notes: notes || null,
      });
      return res.json({ item });
    } catch (err) {
      return next(err);
    }
  }
);

module.exports = router;
