"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureLoggedIn, ensureSuperAdmin, ensureAdminOrSuperAdmin } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const Database = require("../models/database");
const databaseUpdateSchema = require("../schemas/databaseUpdate.json");

const router = express.Router();

/* GET ALL databases => { databases: [database, ...] }
 *
 * Returns [{ id, name, url, createdAt, updatedAt }]
 *
 * Authorization required: super_admin only
 */
router.get("/", ensureSuperAdmin, async function (req, res, next) {
  try {
    const databases = await Database.getAll();
    return res.json({ databases });
  } catch (err) {
    return next(err);
  }
});

/** GET /user/:userId => { databases: [database, ...] }
 *
 * Returns databases linked to the given user.
 *
 * Authorization required: logged in
 */
router.get("/user/:userId", ensureLoggedIn, async function (req, res, next) {
  try {
    const databases = await Database.getUserDatabases(req.params.userId);
    return res.json({ databases });
  } catch (err) {
    return next(err);
  }
});



/* GET /:id => { database }
 *
 * Returns { id, name, url, createdAt, updatedAt }
 *
 * Authorization required: logged in
 */
router.get("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    const database = await Database.get(req.params.id);
    return res.json({ database });
  } catch (err) {
    return next(err);
  }
});

/** POST / { database } => { database }
 *
 * Data should include:
 *   { name, url }
 *
 * Returns { id, name, url, createdAt, updatedAt }
 *
 * Authorization required: logged in
 */
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

/** POST /user_databases { userDatabase } => { userDatabase }
 *
 * Data should include:
 *   { userId, databaseId, role }
 *
 * Returns { id, userId, databaseId, createdAt, updatedAt }
 *
 * Authorization required: admin or super_admin
 */
router.post("/user_databases", ensureAdminOrSuperAdmin, async function (req, res, next) {
  try {
    const userDatabase = await Database.addUserToDatabase(req.body);
    return res.status(201).json({ userDatabase });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /:id { database } => { database }
 *
 * Data can include:
 *   { name, url }
 *
 * Returns { id, name, url, createdAt, updatedAt }
 *
 * Authorization required: logged in
 */
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

/** DELETE /:id
 *
 * Deletes the database identified by the given ID.
 *
 * Returns { deleted: id }
 *
 * Authorization required: logged in
 */
router.delete("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    await Database.remove(req.params.id);
    return res.json({ deleted: req.params.id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
