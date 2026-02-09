"use strict";

/* Routes for systems */
const express = require("express");
const jsonschema = require("jsonschema");
const { ensureCorrectUser, ensureSuperAdmin, ensureAdminOrSuperAdmin, ensureDatabaseUser } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const System = require("../models/system");
const systemNewSchema = require("../schemas/systemNew.json");
const systemUpdateSchema = require("../schemas/systemUpdate.json");

const router = express.Router();

/* POST [propertyId]   / => { system }
*
* Creates a new system for a property.
*
* Authorization required: DatabaseUser
**/
router.post("/:propertyId", async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, systemNewSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }
    const system = await System.create(req.body);
    return res.status(201).json({ system });
  } catch (err) {
    return next(err);
  }
});

/* GET [propertyId] / => { systems }
*
* Returns all systems for a property.
*
* Authorization required: DatabaseUser
**/
router.get("/:propertyId", async function (req, res, next) {
  try {
    const systems = await System.get(req.params.propertyId);
    return res.json({ systems });
  } catch (err) {
    return next(err);
  }
});

/* PATCH [propertyId] { system } => { system }
*
* Updates a system for a property.
*
* Authorization required: DatabaseUser
**/
router.patch("/:propertyId", async function (req, res, next) {
  try {
    const { propertyId } = req.params;
    if (!propertyId || propertyId === "undefined" || propertyId === "null") {
      throw new BadRequestError("Valid property ID is required");
    }

    const validator = jsonschema.validate(req.body, systemUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }

    const system_key = req.body.system_key;
    if (!system_key) {
      throw new BadRequestError("system_key is required");
    }

    const body = { ...req.body };
    if (body.next_service_date == null || body.next_service_date === "") {
      body.next_service_date = null;
    }
    const system = await System.update({
      property_id: propertyId,
      system_key,
      ...body,
    });
    return res.json({ system });

  } catch (err) {
    return next(err);
  }
});

module.exports = router;