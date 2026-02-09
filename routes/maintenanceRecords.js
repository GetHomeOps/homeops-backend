"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureSuperAdmin } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const MaintenanceRecord = require("../models/maintenanceRecord");
const maintenanceRecordNewSchema = require("../schemas/maintenanceRecordNew.json");
const maintenanceRecordsBatchSchema = require("../schemas/maintenanceRecordsBatch.json");
const maintenanceRecordUpdateSchema = require("../schemas/maintenanceRecord.json");
const router = express.Router();

/* POST / => { maintenanceRecords }
 *
 * Creates multiple maintenance records. Body: { maintenanceRecords: [{ property_id, system_key, ... }, ...] }
 * Returns all created records.
 **/
router.post("/:PropertyId", async function (req, res, next) {
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

/* POST /:PropertyId => { maintenanceRecord }
 *
 * Creates a single maintenance record for the given property.
 **/
router.post("/record/:PropertyId", async function (req, res, next) {
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

/* GET /:PropertyId => { maintenanceRecords } */
router.get("/:PropertyId", async function (req, res, next) {
  try {
    const { PropertyId } = req.params;
    const maintenanceRecords = await MaintenanceRecord.getByPropertyId(PropertyId);
    return res.json({ maintenanceRecords });
  } catch (err) {
    return next(err);
  }
});

/* PATCH /:recordId => { maintenance }
 *
 * Updates a maintenance record by id.
 * Body: { property_id, system_key, completed_at, next_service_date, data, status }
 **/
router.patch("/:recordId", async function (req, res, next) {
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

/* DELETE /:recordId => { deleted }
 *
 * Deletes a maintenance record by id.
 **/
router.delete("/:recordId", async function (req, res, next) {
  try {
    const { recordId } = req.params;
    await MaintenanceRecord.delete(recordId);
    return res.json({ deleted: recordId });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;