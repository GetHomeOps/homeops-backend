"use strict";

/* Routes for users */
const express = require("express");
const jsonschema = require("jsonschema");
const { ensureCorrectUser, ensureSuperAdmin, ensureAdminOrSuperAdmin, ensureDatabaseUser } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const User = require("../models/user");
const userUpdateSchema = require("../schemas/userUpdate.json");

const router = express.Router();


/* GET ALL users => {users: [user, ...]}
*
* Returns {email, fullName, role}
*
* Authorization required: superAdmin
**/
router.get("/", ensureSuperAdmin, async function (req, res, next) {
  const users = await User.getAll();
  return res.json({ users });
});


/* GET /[databaseId] => {users: [user, ...]}
*
* Returns {email, fullName, role}
*
* Authorization required: database admin or superAdmin
**/
router.get("/db/:databaseId", ensureAdminOrSuperAdmin, async function (req, res, next) {
  const users = await User.getByDatabaseId(req.params.databaseId);
  return res.json({ users });
});

/* GET /[email] =>{user}
*
* Returns {email, fullName, role}
*
* Authorization required: current user
**/
router.get("/:email", ensureCorrectUser, async function (req, res, next) {
  const user = await User.get(req.params.email);
  return res.json({ user });
});

/** PATCH /[email] { user } => { user }
 *
 * Data can include:
 *   { fullName, password, isActive }
 *
 * Returns { email, fullName, isActive }
 *
 * Authorization required: current user or SuperAdmin
 **/
router.patch("/:email", ensureCorrectUser, async function (req, res, next) {
  const validator = jsonschema.validate(req.body, userUpdateSchema);
  if (!validator.valid) {
    const errs = validator.errors.map(e => e.stack);
    throw new BadRequestError(errs);
  }

  const user = await User.update(req.params.email, req.body);
  return res.json({ user });
});


/** DELETE /:email
 *
 * Deletes the user identified by the given email.
 *
 * Returns { deleted: email }
 *
 * Authorization required: correct user or SuperAdmin
 **/
router.delete("/:email", ensureSuperAdmin, async function (req, res, next) {
  await User.remove(req.params.email);
  return res.json({ deleted: req.params.email });
});

module.exports = router;