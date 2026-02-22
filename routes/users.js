"use strict";

/**
 * Users Routes
 *
 * CRUD and listing endpoints for users. Supports account-scoped and
 * agent-scoped queries with role-based access control.
 *
 * Endpoints:
 * - GET /: List all users (platform admin)
 * - GET /account/:accountId: Users in account (platform admin)
 * - GET /agent/:agentId: Users sharing accounts with agent (platform admin)
 * - GET /user-accounts: Current user's account IDs
 * - GET /:email: Single user by email (self or platform admin)
 * - PATCH /:id: Update user profile (self or platform admin)
 * - DELETE /:id: Remove user (super admin)
 * - POST /activate/:userId: Activate user (super admin)
 */

const express = require("express");
const jsonschema = require("jsonschema");
const {
  ensureSuperAdmin,
  ensurePlatformAdmin,
  ensureLoggedIn,
} = require("../middleware/auth");
const { BadRequestError, ForbiddenError } = require("../expressError");
const User = require("../models/user");
const userUpdateSchema = require("../schemas/userUpdate.json");
const { addPresignedUrlToItem, addPresignedUrlsToItems } = require("../helpers/presignedUrls");

const router = express.Router();

/** POST / - Admin-created user. Creates user as pending (is_active=false).
 *  Account linking and activation happen when the user accepts their invitation. */
router.post("/", ensureLoggedIn, ensurePlatformAdmin, async function (req, res, next) {
  try {
    const { name, email, password, phone, role, contact, image } = req.body;

    const newUser = await User.register({
      name,
      email,
      password,
      phone,
      role,
      contact,
      is_active: false,
    });

    if (image) {
      await User.update({ id: newUser.id, image });
    }

    const user = await User.getById(newUser.id);
    return res.status(201).json({ user });
  } catch (err) {
    return next(err);
  }
});

router.get("/", ensureLoggedIn, ensurePlatformAdmin, async function (req, res, next) {
  try {
    const users = await User.getAll();
    const usersWithUrls = await addPresignedUrlsToItems(users, "image", "image_url");
    return res.json({ users: usersWithUrls });
  } catch (err) {
    return next(err);
  }
});

router.get("/account/:accountId", ensureLoggedIn, ensurePlatformAdmin, async function (req, res, next) {
  try {
    const users = await User.getByAccountId(req.params.accountId);
    const usersWithUrls = await addPresignedUrlsToItems(users, "image", "image_url");
    return res.json({ users: usersWithUrls });
  } catch (err) {
    return next(err);
  }
});

router.get("/agent/:agentId", ensureLoggedIn, ensurePlatformAdmin, async function (req, res, next) {
  try {
    const users = await User.getUsersBySharedAccounts(req.params.agentId);
    const usersWithUrls = await addPresignedUrlsToItems(users, "image", "image_url");
    return res.json({ users: usersWithUrls });
  } catch (err) {
    return next(err);
  }
});

router.get("/user-accounts", ensureLoggedIn, async function (req, res, next) {
  try {
    const userId = res.locals.user?.id;
    if (!userId) throw new ForbiddenError("User authentication required.");
    const result = await User.userHasAccount(userId);
    return res.json({ accountIds: result ? [result.account_id] : [] });
  } catch (err) {
    return next(err);
  }
});

router.get("/:email", ensureLoggedIn, async function (req, res, next) {
  try {
    const role = res.locals.user.role;
    const isSelfLookup = res.locals.user.email === req.params.email;
    if (role !== "super_admin" && role !== "admin" && !isSelfLookup) {
      throw new ForbiddenError("You can only view your own profile.");
    }
    const user = await User.get(req.params.email);
    return res.json({ user });
  } catch (err) {
    return next(err);
  }
});

router.patch("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    const requestingUserId = res.locals.user.id;
    const targetUserId = parseInt(req.params.id, 10);
    const role = res.locals.user.role;

    if (role !== "super_admin" && role !== "admin" && requestingUserId !== targetUserId) {
      throw new ForbiddenError("You can only update your own profile.");
    }

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

router.delete("/:id", ensureSuperAdmin, async function (req, res, next) {
  try {
    await User.remove(req.params.id);
    return res.json({ deleted: req.params.id });
  } catch (err) {
    return next(err);
  }
});

router.post("/activate/:userId", ensureSuperAdmin, async function (req, res, next) {
  try {
    const { userId } = req.params;
    const result = await User.activateUser(userId);
    return res.json({ result });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
