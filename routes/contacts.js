"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureSuperAdmin, ensurePlatformAdmin, ensureLoggedIn, ensureUserCanAccessAccountByParam } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const Contact = require("../models/contact");
const contactUpdateSchema = require("../schemas/contactUpdate.json");
const { addPresignedUrlToItem, addPresignedUrlsToItems } = require("../helpers/presignedUrls");

const router = express.Router();

/** GET /all - List all contacts. Platform admin only. */
router.get("/all", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const contacts = await Contact.getAll();
    const contactsWithUrls = await addPresignedUrlsToItems(contacts, "image", "image_url");
    return res.json({ contacts: contactsWithUrls });
  } catch (err) {
    return next(err);
  }
});

/** GET /account/:accountId - List contacts for an account. Requires account access. */
router.get("/account/:accountId", ensureLoggedIn, ensureUserCanAccessAccountByParam("accountId"), async function (req, res, next) {
  try {
    const contacts = await Contact.getByAccountId(req.params.accountId);
    const contactsWithUrls = await addPresignedUrlsToItems(contacts, "image", "image_url");
    return res.json({ contacts: contactsWithUrls });
  } catch (err) {
    return next(err);
  }
});

/** GET /:id - Get single contact by id. */
router.get("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    const contact = await Contact.get(req.params.id);
    const contactWithUrl = await addPresignedUrlToItem(contact, "image", "image_url");
    return res.json({ contact: contactWithUrl });
  } catch (err) {
    return next(err);
  }
});

/** POST / - Create contact. Optionally link to account via accountId in body. */
router.post("/", ensureLoggedIn, async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, contactUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }
    const { accountId, ...contactData } = req.body;
    const contact = await Contact.create(contactData);
    const contactWithUrl = await addPresignedUrlToItem(contact, "image", "image_url");
    let contactAccount = null;
    if (accountId) {
      contactAccount = await Contact.addToAccount({ contactId: contact.id, accountId });
    }
    const response = { contact: contactWithUrl };
    if (contactAccount) response.contactAccount = contactAccount;
    return res.status(201).json(response);
  } catch (err) {
    return next(err);
  }
});

/** POST /account_contacts - Link contact to account. Body: { contactId, accountId }. */
router.post("/account_contacts", ensureLoggedIn, async function (req, res, next) {
  try {
    const contactAccount = await Contact.addToAccount(req.body);
    return res.status(201).json({ contactAccount });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /:id - Update contact. */
router.patch("/:id", ensureLoggedIn, async function (req, res, next) {
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

/** DELETE /:id - Remove contact. */
router.delete("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    await Contact.remove(req.params.id);
    return res.json({ deleted: req.params.id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
