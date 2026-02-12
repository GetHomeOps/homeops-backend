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
const Subscription = require("../models/subscription");
const SubscriptionProduct = require("../models/subscriptionProduct");
const PlatformEngagement = require("../models/platformEngagement");

/**
 * Helper: auto-create a "basic" subscription for a newly registered user.
 *
 * Looks up the "basic" subscription product by name; if it exists, the
 * subscription_product_id is set accordingly and subscription_type mirrors
 * the product name. Falls back gracefully if the product row is missing.
 *
 * Dates: start_date = today, end_date = today + 1 month.
 */
async function createDefaultSubscription(userId) {
  try {
    const today = new Date();
    const endDate = new Date(today);
    endDate.setMonth(endDate.getMonth() + 1);

    const formatDate = (d) => d.toISOString().split("T")[0];

    // Try to find the "basic" product
    const basicProduct = await SubscriptionProduct.getByName("basic");

    await Subscription.create({
      userId,
      subscriptionProductId: basicProduct ? basicProduct.id : null,
      subscriptionType: basicProduct ? basicProduct.name : "basic",
      subscriptionStatus: "active",
      subscriptionStartDate: formatDate(today),
      subscriptionEndDate: formatDate(endDate),
    });
  } catch (err) {
    // Log but don't block user creation if subscription creation fails
    console.error("Warning: failed to auto-create subscription for user", userId, err.message);
  }
}

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

  try {
    const { email, password } = req.body;
    const user = await User.authenticate(email, password);
    const token = createToken(user);
    try {
      await PlatformEngagement.logEvent({ userId: user.id, eventType: "login", eventData: {} });
    } catch (logErr) {
      // Don't block login if engagement logging fails
    }
    return res.json({ token });
  } catch (err) {
    return next(err);
  }

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

  const { createdBy, createdByRole, databaseId, userData } = req.body;

  const validator = jsonschema.validate(
    userData,
    userRegisterSchema,
    { required: true }
  );
  if (!validator.valid) {
    const errs = validator.errors.map(e => e.stack);
    throw new BadRequestError(errs);
  }
  try {
    const newUser = await User.register({ ...userData });

    const userDb = await Database.linkNewUserToDatabase(
      {
        newUser,
        databaseId,
        createdBy,
        createdByRole
      }
    );

    /* if (createdByRole === "agent") {
      await Database.linkUserToDatabase(
        {
          userId: createdBy,
          databaseId: userDb.database_id,
          role: 'agent'
        }
      );
    } */

    // Auto-create a default "basic" subscription for the new user
    await createDefaultSubscription(newUser.id);

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

    const userId = result.id;
    const existingDbs = await Database.getUserDatabases(userId);
    // Only create a database if the user has none (e.g. invite-to-join flow).
    // Users created via /register already have a database from linkNewUserToDatabase.
    if (!existingDbs || existingDbs.length === 0) {
      const database = await Database.create({ name });
      await Database.addUserToDatabase({
        userId,
        databaseId: database.id,
        role: 'admin'
      });
    }

    return res.json({
      success: true,
      message: "Account activated successfully"
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;