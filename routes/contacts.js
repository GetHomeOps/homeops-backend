"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureSuperAdmin } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const Contact = require("../models/contact");
const contactUpdateSchema = require("../schemas/contactUpdate.json");

const router = express.Router();

/** GET / => { contacts: [contact, ...] }
 *
 * Returns list of all contacts.
 *
 * Authorization required: SuperAdmin
 **/
router.get("/", ensureSuperAdmin, async function (req, res, next) {
  try {
    const contacts = await Contact.getAll();
    return res.json({ contacts });
  } catch (err) {
    return next(err);
  }
});

/** GET /db/:databaseId => { contacts: [contact, ...] }
 *
 * Returns list of contacts for a specific database.
 * Returns empty array if no contacts found.
 *
 * Authorization required: database admin or superAdmin
 **/
router.get("/db/:databaseId", async function (req, res, next) {
  try {
    const contacts = await Contact.getByDatabaseId(req.params.databaseId);
    return res.json({ contacts });
  } catch (err) {
    return next(err);
  }
});

/** GET /[id] => { contact }
 *
 * Returns details of a specific contact by ID.
 *
 * Authorization required: SuperAdmin
 **/
router.get("/:id", ensureSuperAdmin, async function (req, res, next) {
  try {
    const contact = await Contact.get(req.params.id);
    return res.json({ contact });
  } catch (err) {
    return next(err);
  }
});

/** POST / { contact } => { contact }
 *
 * Create a new contact.
 *
 * Required fields: { name }
 *
 * Authorization required: SuperAdmin
 **/
router.post("/", ensureSuperAdmin, async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, contactUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }

    const contact = await Contact.create(req.body);
    return res.status(201).json({ contact });
  } catch (err) {
    return next(err);
  }
});

/* POST /[id] => { contact } */

router.post("/:id", async function (req, res, next) {
  try {
    const contact = await Contact.create(req.body);
    return res.status(201).json({ contact });
  }
  catch (err) {
    return next(err);
  }
});

/** PATCH /[id] { contact } => { contact }
 *
 * Update contact details.
 *
 * Authorization required: SuperAdmin
 **/
router.patch("/:id", ensureSuperAdmin, async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, contactUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }

    const contact = await Contact.update(req.params.id, req.body);
    return res.json({ contact });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /[id] => { deleted: id }
 *
 * Delete a contact by ID.
 *
 * Authorization required: SuperAdmin
 **/
router.delete("/:id", ensureSuperAdmin, async function (req, res, next) {
  try {
    await Contact.remove(req.params.id);
    return res.json({ deleted: req.params.id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
