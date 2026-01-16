"use strict";

/* Routes for users */
const express = require("express");
const jsonschema = require("jsonschema");
const { ensureCorrectUser, ensureSuperAdmin, ensureAdminOrSuperAdmin, ensureDatabaseUser } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const User = require("../models/user");
const userUpdateSchema = require("../schemas/userUpdate.json");
const UserInvitation = require("../models/userInvitation");
const { createInvitationForUser, getInvitationForFrontend } = require("../services/invitationService");

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
router.get("/:email", async function (req, res, next) {
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


/** DELETE /:id
 *
 * Deletes the user identified by the given id.
 *
 * Returns { deleted: id }
 *
 **/
router.delete("/:id", async function (req, res, next) {
  console.log("req.params.id", req.params.id);
  try {
    await User.remove(req.params.id);
    return res.json({ deleted: req.params.id });
  } catch (err) {
    return next(err);
  }
});

/* GET /users/user-databases => { databaseIds }
* Checks if the user is linked to any database and returns the database ids
*
* Returns { databaseIds }
*
* Authorization required: current user
**/
router.get("/user-databases", async function (req, res, next) {
  const userId = res.locals.user?.id;
  if (!userId) {
    throw new UnauthorizedError("User authentication required.");
  }
  const databaseIds = await User.userHasDatabase(userId);
  return res.json({ databaseIds: databaseIds.rows.map(row => row.database_id) });
});

/* ----- Invitation Routes ----- */


/** POST /users/invite
 *
 * { userId } => { token }
 *
 * Sends an invitation email to the user.
 *
 * Authorization required: admin
 */
router.post("/invite", async (req, res) => {
  const { userId } = req.body;

  try {
    const result = await createInvitationForUser(userId);

    return res.status(201).json({ result });

  } catch (err) {
    return res.status(500).json({ error: err.message });
  }

});


/** GET /users/invite/:userId
 *
 * { userId } => { token }
 *
 * Returns the invitation token for the user.
 *
 * Authorization required: admin
 */
router.get("/invite/:userId", async (req, res, next) => {
  try {
    const { userId } = req.params;
    const result = await getInvitationForFrontend(userId);
    return res.json({ result });
  } catch (err) {
    return next(err);
  }
});

/* Activate User */
router.post("/activate/:userId", async (req, res, next) => {
  try {
    const { userId } = req.params;
    const result = await User.activateUser(userId);
    return res.json({ result });
  } catch (err) {
    return next(err);
  }
});






module.exports = router;