"use strict";

/* ----- Authentication Routes ----- */

const jsonschema = require("jsonschema");

const User = require("../models/user");
const express = require("express");
const router = new express.Router();
const { createToken } = require("../helpers/tokens");
const userAuthSchema = require("../schemas/userAuth.json");
const userRegisterSchema = require("../schemas/userRegister.json");
const { BadRequestError } = require("../expressError");
const { acceptInvitation, validateInvitationToken } = require("../services/invitationService");
const UserInvitation = require("../models/userInvitation");
const Database = require("../models/database");
const dbService = require("../services/databaseService");

/** POST /auth/token:  { email, password } => { token }
 *
 * Returns JWT token which can be used to authenticate further requests.
 *
 * Authorization required: none
 */
router.post("/token", async function (req, res, next) {
  const validator = jsonschema.validate(
    req.body,
    userAuthSchema,
    { required: true }
  );
  if (!validator.valid) {
    const errs = validator.errors.map(e => e.stack);
    throw new BadRequestError(errs);
  }

  const { email, password } = req.body;
  const user = await User.authenticate(email, password);
  const token = createToken(user);
  return res.json({ token });
});


/** POST /auth/register:   { user } => { token }
 *
 * user must include { email, password, name }
 *
 * Returns JWT token which can be used to authenticate further requests.
 *
 * Authorization required: none
 */
router.post("/register", async function (req, res, next) {
  const validator = jsonschema.validate(
    req.body,
    userRegisterSchema,
    { required: true }
  );
  if (!validator.valid) {
    const errs = validator.errors.map(e => e.stack);
    throw new BadRequestError(errs);
  }
  try {
    const newUser = await User.register({ ...req.body });
    const token = createToken(newUser);
    return res.status(201).json({ token });
  } catch (err) {
    return next(err);
  }
});

/* -----Invitation Routes ----- */

/** POST /auth/confirm: { token, password, email } => { success: true }
 *
 * Validates invitation token and email, activates user and sets password and marks invitation as used.
 *
 * Authorization required: none
 */
router.post("/confirm", async function (req, res, next) {
  try {
    const { token, password, name } = req.body;

    if (!token || !password) {
      throw new BadRequestError("Token and password are required");
    }

    console.log("Token 1:", token);
    // 1. Validate invitation token (ONLY input)
    const invitation =
      await UserInvitation.validateInvitationToken(token);

    console.log("Invitation:", invitation);

    // 2. Activate the user tied to this invitation
    const result = await User.activateFromInvitation(
      invitation.user_id,
      password
    );

    const database = await Database.create({ name });

    // 4. Link user to database
    await Database.addUserToDatabase({
      userId: result.id,
      databaseId: database.id,
      role: 'admin'
    });
    return res.json({
      success: true,
      message: "Account activated successfully"
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;