"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureLoggedIn, ensureSuperAdmin, ensurePlatformAdmin, ensureAdminOrSuperAdmin } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const Account = require("../models/account");
const accountUpdateSchema = require("../schemas/accountUpdate.json");

const router = express.Router();

/** GET / - List all accounts. Platform admin only. */
router.get("/", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const accounts = await Account.getAll();
    return res.json({ accounts });
  } catch (err) {
    return next(err);
  }
});

/** GET /user/:userId - List accounts for a user. */
router.get("/user/:userId", ensureLoggedIn, async function (req, res, next) {
  try {
    const accounts = await Account.getUserAccounts(req.params.userId);
    return res.json({ accounts });
  } catch (err) {
    return next(err);
  }
});

/** GET /:id - Get single account. */
router.get("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    const account = await Account.get(req.params.id);
    return res.json({ account });
  } catch (err) {
    return next(err);
  }
});

/** POST / - Create account. */
router.post("/", ensureLoggedIn, async function (req, res, next) {
  try {
    const account = await Account.create(req.body);
    return res.status(201).json({ account });
  } catch (err) {
    return next(err);
  }
});

/** POST /account_users - Add user to account. Body: { userId, accountId, role }. Admin/super admin only. */
router.post("/account_users", ensureAdminOrSuperAdmin, async function (req, res, next) {
  try {
    const accountUser = await Account.addUserToAccount(req.body);
    return res.status(201).json({ accountUser });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /:id - Update account. */
router.patch("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    const account = await Account.update(req.params.id, req.body);
    return res.json({ account });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /:id - Remove account. */
router.delete("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    await Account.remove(req.params.id);
    return res.json({ deleted: req.params.id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
