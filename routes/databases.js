"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureLoggedIn, ensureSuperAdmin, ensureAdminOrSuperAdmin } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const Database = require("../models/database");
const databaseUpdateSchema = require("../schemas/databaseUpdate.json");

const router = express.Router();

/** GET / - List all databases. Super admin only. */
router.get("/", ensureSuperAdmin, async function (req, res, next) {
  try {
    const databases = await Database.getAll();
    return res.json({ databases });
  } catch (err) {
    return next(err);
  }
});

/** GET /user/:userId - List databases for user. */
router.get("/user/:userId", ensureLoggedIn, async function (req, res, next) {
  try {
    const databases = await Database.getUserDatabases(req.params.userId);
    return res.json({ databases });
  } catch (err) {
    return next(err);
  }
});



/** GET /:id - Get single database. */
router.get("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    const database = await Database.get(req.params.id);
    return res.json({ database });
  } catch (err) {
    return next(err);
  }
});

/** POST / - Create database. Body: { name }. */
router.post("/", ensureLoggedIn, async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, databaseUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }

    const database = await Database.create(req.body);
    return res.status(201).json({ database });
  } catch (err) {
    return next(err);
  }
});

/** POST /user_databases - Add user to database. Body: { userId, databaseId, role }. Admin/super admin only. */
router.post("/user_databases", ensureAdminOrSuperAdmin, async function (req, res, next) {
  try {
    const userDatabase = await Database.addUserToDatabase(req.body);
    return res.status(201).json({ userDatabase });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /:id - Update database. Body: { name, url }. */
router.patch("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, databaseUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }

    const database = await Database.update(req.params.id, req.body);
    return res.json({ database });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /:id - Remove database. */
router.delete("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    await Database.remove(req.params.id);
    return res.json({ deleted: req.params.id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
