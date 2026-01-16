"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureSuperAdmin, ensureAdminOrSuperAdmin } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const Database = require("../models/database");
const databaseUpdateSchema = require("../schemas/databaseUpdate.json");

const router = express.Router();

/* GET ALL databases => {databases: [database, ...]}
 *
 * Returns [{ id, name, url, createdAt, updatedAt }]
 *
 * Authorization required: superAdmin
 **/
router.get("/", async function (req, res, next) {
  const databases = await Database.getAll();
  return res.json({ databases });
});

/** GET /user/[userId] => { databases: [database, ...] }
 *
 * Returns [{ id, name, url, createdAt, updatedAt }]
 *
 * Authorization required: superAdmin or correct user
 **/
router.get("/user/:userId", async function (req, res, next) {
  try {
    const databases = await Database.getUserDatabases(req.params.userId);
    return res.json({ databases });
  } catch (error) {
    return next(error);
  }
});



/* GET /[id] => {database}
 *
 * Returns { id, name, url, createdAt, updatedAt }
 *
 * Authorization required: correct user or SuperAdmin
 **/
router.get("/:id", async function (req, res, next) {
  const database = await Database.get(req.params.id);
  return res.json({ database });
});

/** POST / { database } => { database }
 *
 * Data should include:
 *   { name, url }
 *
 * Returns { id, name, url, createdAt, updatedAt }
 *
 * Authorization required: superAdmin
 **/
router.post("/", async function (req, res, next) {
  console.log("req.body: ", req);
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
 * Authorization required: database admin or super admin
 **/
router.post("/user_databases", async function (req, res, next) {
  const userDatabase = await Database.addUserToDatabase(req.body);
  return res.status(201).json({ userDatabase });
});

/** PATCH /[id] { database } => { database }
 *
 * Data can include:
 *   { name, url }
 *
 * Returns { id, name, url, createdAt, updatedAt }
 *
 * Authorization required: superAdmin or correct user
 **/
router.patch("/:id", async function (req, res, next) {
  const validator = jsonschema.validate(req.body, databaseUpdateSchema);
  if (!validator.valid) {
    const errs = validator.errors.map(e => e.stack);
    throw new BadRequestError(errs);
  }

  const database = await Database.update(req.params.id, req.body);
  return res.json({ database });
});

/** DELETE /[id]
 *
 * Deletes the database identified by the given ID.
 *
 * Returns { deleted: id }
 *
 * Authorization required: superAdmin or correct user
 **/
router.delete("/:id", async function (req, res, next) {
  await Database.remove(req.params.id);
  return res.json({ deleted: req.params.id });
});

module.exports = router;
