"use strict";

/* Routes for users */
const express = require("express");
const jsonschema = require("jsonschema");
const {
  ensureCorrectUser,
  ensureSuperAdmin,
  ensureAdminOrSuperAdmin,
  ensureDatabaseUser,
  ensureLoggedIn,
  ensureUserCanAccessDatabaseByParam,
  ensureAgentOrSelf,
  ensureCanViewUser,
} = require("../middleware/auth");
const { BadRequestError, UnauthorizedError } = require("../expressError");
const User = require("../models/user");
const userUpdateSchema = require("../schemas/userUpdate.json");
const UserInvitation = require("../models/userInvitation");
const { createInvitationForUser, getInvitationForFrontend } = require("../services/invitationService");
const { addPresignedUrlToItem, addPresignedUrlsToItems } = require("../helpers/presignedUrls");

const router = express.Router();


/* GET ALL users => {users: [user, ...]}
*
* Returns {email, fullName, role}
*
* Authorization required: super_admin only
**/
router.get("/", ensureLoggedIn, ensureSuperAdmin, async function (req, res, next) {
  const users = await User.getAll();
  const usersWithUrls = await addPresignedUrlsToItems(users, "image", "image_url");
  return res.json({ users: usersWithUrls });
});


/* GET /[databaseId] => {users: [user, ...]}
*
* Returns {email, fullName, role}
*
* Authorization required: logged in, and user must be linked to this database
**/
router.get("/db/:databaseId", ensureLoggedIn, ensureUserCanAccessDatabaseByParam("databaseId"), async function (req, res, next) {
  const users = await User.getByDatabaseId(req.params.databaseId);
  const usersWithUrls = await addPresignedUrlsToItems(users, "image", "image_url");
  return res.json({ users: usersWithUrls });
});

/* GET /[agentId] => {users: [user, ...]}
*
* Returns {email, fullName, role}
*
* Authorization required: logged in; super_admin or the agent themselves
**/
router.get("/agent/:agentId", ensureLoggedIn, ensureAgentOrSelf("agentId"), async function (req, res, next) {
  const users = await User.getByAgentId(req.params.agentId);
  const usersWithUrls = await addPresignedUrlsToItems(users, "image", "image_url");
  return res.json({ users: usersWithUrls });
});

/* GET /[email] =>{user}
*
* Returns {email, fullName, role}
*
* Authorization required: logged in; super_admin or user must share a database with requested user
**/
router.get("/:email", ensureLoggedIn, ensureCanViewUser("email"), async function (req, res, next) {
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
router.patch("/:id", async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, userUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }

    const user = await User.update({ id: req.params.id, ...req.body });
    const userWithUrl = await addPresignedUrlToItem(user, "image", "image_url");
    return res.json({ user: userWithUrl });
  } catch (err) {
    return next(err);
  }
});


/** DELETE /:id
 *
 * Deletes the user identified by the given id.
 *
 * Returns { deleted: id }
 *
 **/
router.delete("/:id", async function (req, res, next) {
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