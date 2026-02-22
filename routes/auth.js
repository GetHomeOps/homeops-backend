"use strict";

/**
 * Auth Routes
 *
 * Handles authentication and account lifecycle endpoints.
 *
 * Endpoints:
 * - POST /token: Authenticate with email/password, returns access + refresh tokens
 * - POST /register: Create user, account, contact, and default subscription
 * - POST /refresh: Exchange a valid refresh token for a new access + refresh pair
 * - POST /logout: Revoke a refresh token
 * - POST /change-password: Update password (requires current password)
 * - POST /confirm: Accept invitation token and activate account with password
 */

const jsonschema = require("jsonschema");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const express = require("express");
const router = new express.Router();
const { createAccessToken, createRefreshToken, getRefreshTokenExpiresAt } = require("../helpers/tokens");
const { ensureLoggedIn } = require("../middleware/auth");
const { SECRET_KEY } = require("../config");
const userAuthSchema = require("../schemas/userAuth.json");
const userRegisterSchema = require("../schemas/userRegister.json");
const { BadRequestError, UnauthorizedError } = require("../expressError");
const { acceptInvitation } = require("../services/invitationService");
const Account = require("../models/account");
const Contact = require("../models/contact");
const Subscription = require("../models/subscription");
const SubscriptionProduct = require("../models/subscriptionProduct");
const PlatformEngagement = require("../models/platformEngagement");
const RefreshToken = require("../models/refreshToken");
const db = require("../db");

async function createDefaultSubscription(accountId, userRole) {
  try {
    const productName = (userRole === 'agent') ? 'professional' : 'basic';
    const product = await SubscriptionProduct.getByName(productName)
      || await SubscriptionProduct.getByName("basic");
    if (!product) return;

    const today = new Date();
    const endDate = new Date(today);
    endDate.setMonth(endDate.getMonth() + 1);

    await Subscription.create({
      accountId,
      subscriptionProductId: product.id,
      status: "active",
      currentPeriodStart: today.toISOString(),
      currentPeriodEnd: endDate.toISOString(),
    });
  } catch (err) {
    console.error("Warning: failed to auto-create subscription for account", accountId, err.message);
  }
}

async function issueTokenPair(user) {
  const accessToken = createAccessToken(user);
  const refreshToken = createRefreshToken(user);

  const tokenHash = RefreshToken.hash(refreshToken);
  const expiresAt = getRefreshTokenExpiresAt();
  await RefreshToken.store({ userId: user.id, tokenHash, expiresAt });

  return { accessToken, refreshToken };
}

router.post("/token", async function (req, res, next) {
  const body = req.body || {};
  const validator = jsonschema.validate(body, userAuthSchema, { required: true });
  if (!validator.valid) {
    const errs = validator.errors.map(e => e.stack);
    throw new BadRequestError(errs);
  }
  try {
    const { email, password } = body;
    const user = await User.authenticate(email, password);
    const tokens = await issueTokenPair(user);

    try {
      await PlatformEngagement.logEvent({ userId: user.id, eventType: "login", eventData: {} });
    } catch (logErr) { /* don't block login */ }

    return res.json(tokens);
  } catch (err) {
    return next(err);
  }
});

router.post("/register", async function (req, res, next) {
  const userData = req.body.userData || req.body;
  if (!userData || typeof userData !== "object") {
    throw new BadRequestError("User data (name, email, password) is required");
  }
  const validator = jsonschema.validate(userData, userRegisterSchema, { required: true });
  if (!validator.valid) {
    const errs = validator.errors.map(e => e.stack);
    throw new BadRequestError(errs);
  }
  const normalized = {
    name: (userData.name || "").trim(),
    email: (userData.email || "").trim(),
    password: userData.password,
    phone: userData.phone || null,
    role: userData.role || "homeowner",
    is_active: true,
  };

  await db.query("BEGIN");
  try {
    const newUser = await User.register(normalized);
    await User.activateUser(newUser.id);
    const account = await Account.linkNewUserToAccount({
      name: newUser.name,
      userId: newUser.id,
    });
    await createDefaultSubscription(account.id, newUser.role);

    const contact = await Contact.create({
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone || null,
    });
    await Contact.addToAccount({ contactId: contact.id, accountId: account.id });
    await User.update({ id: newUser.id, contact: contact.id });

    await db.query("COMMIT");

    const tokens = await issueTokenPair(newUser);
    return res.status(201).json(tokens);
  } catch (err) {
    await db.query("ROLLBACK");
    return next(err);
  }
});

router.post("/refresh", async function (req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (!refreshToken) throw new BadRequestError("Refresh token is required");

    let payload;
    try {
      payload = jwt.verify(refreshToken, SECRET_KEY);
    } catch (err) {
      throw new UnauthorizedError("Invalid or expired refresh token");
    }

    if (payload.type !== "refresh") {
      throw new UnauthorizedError("Invalid token type");
    }

    const tokenHash = RefreshToken.hash(refreshToken);
    const stored = await RefreshToken.findByHash(tokenHash);
    if (!stored) {
      throw new UnauthorizedError("Refresh token has been revoked or is invalid");
    }

    await RefreshToken.deleteByHash(tokenHash);

    const user = await User.getById(payload.id);
    if (!user || !user.isActive) {
      throw new UnauthorizedError("User account is inactive or not found");
    }

    const tokens = await issueTokenPair(user);

    RefreshToken.cleanupExpired().catch(() => {});

    return res.json(tokens);
  } catch (err) {
    return next(err);
  }
});

router.post("/logout", async function (req, res, next) {
  try {
    const { refreshToken } = req.body;
    if (refreshToken) {
      const tokenHash = RefreshToken.hash(refreshToken);
      await RefreshToken.deleteByHash(tokenHash);
    }
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

router.post("/change-password", ensureLoggedIn, async function (req, res, next) {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = res.locals.user?.id;
    if (!userId) throw new BadRequestError("User authentication required");
    if (!currentPassword || !newPassword) {
      throw new BadRequestError("Current password and new password are required");
    }
    if (newPassword.length < 4) {
      throw new BadRequestError("New password must be at least 4 characters");
    }
    await User.changePassword(userId, currentPassword, newPassword);
    return res.json({ success: true, message: "Password updated successfully" });
  } catch (err) {
    return next(err);
  }
});

router.post("/confirm", async function (req, res, next) {
  try {
    const { token, password, name } = req.body;
    if (!token || !password) {
      throw new BadRequestError("Token and password are required");
    }
    const result = await acceptInvitation({ rawToken: token, password, name });
    return res.json({
      success: true,
      message: "Account activated successfully",
    });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
