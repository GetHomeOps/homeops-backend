"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureSuperAdmin } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const Contact = require("../models/contact");
const contactUpdateSchema = require("../schemas/contactUpdate.json");
const { addPresignedUrlToItem, addPresignedUrlsToItems } = require("../helpers/presignedUrls");

const router = express.Router();

/** GET / => { contacts: [contact, ...] }
 *
 * Returns list of all contacts.
 *
 * Authorization required: SuperAdmin
 **/
router.get("/all", ensureSuperAdmin, async function (req, res, next) {
  try {
    const contacts = await Contact.getAll();
    const contactsWithUrls = await addPresignedUrlsToItems(contacts, "image", "image_url");
    return res.json({ contacts: contactsWithUrls });
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
    const contactsWithUrls = await addPresignedUrlsToItems(contacts, "image", "image_url");
    return res.json({ contacts: contactsWithUrls });
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
    const contactWithUrl = await addPresignedUrlToItem(contact, "image", "image_url");
    return res.json({ contact: contactWithUrl });
  } catch (err) {
    return next(err);
  }
});

/** POST / { contact, databaseId? } => { contact, contactDatabase? }
 *
 * Create a new contact and optionally add it to a database.
 *
 * Required fields: { name }
 * Optional fields: { email, phone, website, databaseId }
 *
 * If databaseId is provided, the contact will be added to that database.
 *
 * Authorization required: SuperAdmin
 **/
router.post("/", async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, contactUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }

    // Extract databaseId if provided
    const { databaseId, ...contactData } = req.body;

    // Create the contact
    const contact = await Contact.create(contactData);
    const contactWithUrl = await addPresignedUrlToItem(contact, "image", "image_url");

    // If databaseId is provided, add contact to the database
    let contactDatabase = null;
    if (databaseId) {
      contactDatabase = await Contact.addToDatabase({
        contactId: contact.id,
        databaseId: databaseId
      });
    }

    const response = { contact: contactWithUrl };
    if (contactDatabase) {
      response.contactDatabase = contactDatabase;
    }

    return res.status(201).json(response);
  } catch (err) {
    return next(err);
  }
});

/* POST /[id] => { contact } */
router.post("/:id", async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, contactUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }

    const contact = await Contact.create(req.body);
    const contactWithUrl = await addPresignedUrlToItem(contact, "image", "image_url");
    return res.status(201).json({ contact: contactWithUrl });
  }
  catch (err) {
    return next(err);
  }
});

/** POST /contacts_databases { contactDatabase } => { contactDatabase }
 *
 * Data should include:
 *   { contactId, databaseId }
 *
 * Returns { contactId, databaseId, createdAt, updatedAt }
 *
 * Authorization required: database admin or super admin
 **/
router.post("/contacts_databases", async function (req, res, next) {
  try {
    const contactDatabase = await Contact.addToDatabase(req.body);
    return res.status(201).json({ contactDatabase });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /[id] { contact } => { contact }
 *
 * Update contact details.
 *
 * Authorization required: SuperAdmin
 **/
router.patch("/:id", async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, contactUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }

    const contact = await Contact.update(req.params.id, req.body);
    const contactWithUrl = await addPresignedUrlToItem(contact, "image", "image_url");
    return res.json({ contact: contactWithUrl });
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
router.delete("/:id", async function (req, res, next) {
  try {
    await Contact.remove(req.params.id);
    return res.json({ deleted: req.params.id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
