"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureLoggedIn, ensurePropertyAccess } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const MaintenanceRecord = require("../models/maintenanceRecord");
const maintenanceRecordNewSchema = require("../schemas/maintenanceRecordNew.json");
const maintenanceRecordsBatchSchema = require("../schemas/maintenanceRecordsBatch.json");
const maintenanceRecordUpdateSchema = require("../schemas/maintenanceRecord.json");
const router = express.Router();

/** Set req.params.propertyId from maintenance record id so ensurePropertyAccess can run. */
async function loadPropertyIdFromRecord(req, res, next) {
  try {
    const record = await MaintenanceRecord.getByRecordId(req.params.recordId);
    req.params.propertyId = record.property_id;
    return next();
  } catch (err) {
    return next(err);
  }
}

/** POST /:PropertyId - Create multiple maintenance records (batch). Body: { maintenanceRecords: [...] }. */
router.post("/:PropertyId", ensureLoggedIn, ensurePropertyAccess({ param: "PropertyId" }), async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, maintenanceRecordsBatchSchema);
    if (!validator.valid) {
      const errs = validator.errors.map((e) => e.stack);
      throw new BadRequestError(errs);
    }
    const { maintenanceRecords } = req.body;
    const created = await MaintenanceRecord.createMany(maintenanceRecords);
    return res.status(201).json({ maintenanceRecords: created });
  } catch (err) {
    return next(err);
  }
});

/** POST /record/:PropertyId - Create single maintenance record. */
router.post("/record/:PropertyId", ensureLoggedIn, ensurePropertyAccess({ param: "PropertyId" }), async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, maintenanceRecordNewSchema);
    if (!validator.valid) {
      const errs = validator.errors.map((e) => e.stack);
      throw new BadRequestError(errs);
    }
    const propertyId = req.params.PropertyId;
    const maintenanceRecord = await MaintenanceRecord.create({
      ...req.body,
      property_id: propertyId,
    });
    return res.status(201).json({ maintenanceRecord });
  } catch (err) {
    return next(err);
  }
});

/** GET /:PropertyId - List maintenance records for property. */
router.get("/:PropertyId", ensureLoggedIn, ensurePropertyAccess({ param: "PropertyId" }), async function (req, res, next) {
  try {
    const { PropertyId } = req.params;
    const maintenanceRecords = await MaintenanceRecord.getByPropertyId(PropertyId);
    return res.json({ maintenanceRecords });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /:recordId - Update maintenance record. Body: property_id, system_key, completed_at, etc. */
router.patch("/:recordId", ensureLoggedIn, loadPropertyIdFromRecord, ensurePropertyAccess({ param: "propertyId" }), async function (req, res, next) {
  try {
    const { recordId } = req.params;
    const validator = jsonschema.validate(req.body, maintenanceRecordUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map((e) => e.stack);
      throw new BadRequestError(errs);
    }
    const maintenance = await MaintenanceRecord.update(recordId, req.body);
    return res.json({ maintenance });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /:recordId - Delete maintenance record. */
router.delete("/:recordId", ensureLoggedIn, loadPropertyIdFromRecord, ensurePropertyAccess({ param: "propertyId" }), async function (req, res, next) {
  try {
    const { recordId } = req.params;
    await MaintenanceRecord.delete(recordId);
    return res.json({ deleted: recordId });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;