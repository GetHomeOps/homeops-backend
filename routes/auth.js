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
 * - GET /google/signin, /google/signup: Start Google OAuth flow
 * - GET /google/callback/signin, /google/callback/signup: Google OAuth callbacks
 */

const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const jsonschema = require("jsonschema");
const jwt = require("jsonwebtoken");
const User = require("../models/user");
const express = require("express");
const router = new express.Router();
const { createAccessToken, createRefreshToken, getRefreshTokenExpiresAt } = require("../helpers/tokens");
const { createMfaTicket, verifyMfaTicket } = require("../helpers/mfaTicket");
const { buildAuthUrl, exchangeCodeForTokens, verifyIdToken } = require("../helpers/googleOAuth");
const { ensureLoggedIn } = require("../middleware/auth");
const {
  SECRET_KEY,
  GOOGLE_CLIENT_ID,
  GOOGLE_REDIRECT_URI_SIGNIN,
  GOOGLE_REDIRECT_URI_SIGNUP,
  AUTH_SUCCESS_REDIRECT,
} = require("../config");
const userAuthSchema = require("../schemas/userAuth.json");
const userRegisterSchema = require("../schemas/userRegister.json");
const { BadRequestError, UnauthorizedError } = require("../expressError");
const { acceptInvitation } = require("../services/invitationService");
const { onUserCreated } = require("../services/resourceAutoSend");
const Account = require("../models/account");
const Contact = require("../models/contact");
const Subscription = require("../models/subscription");
const SubscriptionProduct = require("../models/subscriptionProduct");
const PlatformEngagement = require("../models/platformEngagement");
const RefreshToken = require("../models/refreshToken");
const db = require("../db");

const OAUTH_STATE_COOKIE = "oauth_state";
const OAUTH_STATE_MAX_AGE = 10 * 60; // 10 minutes

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

    if (user.mfaEnabled) {
      const mfaTicket = createMfaTicket(user.id, user.email);
      return res.json({ mfaRequired: true, mfaTicket, mfaPendingToken: mfaTicket });
    }

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
    role: "homeowner",
    is_active: true,
    onboarding_completed: false,
  };

  await db.query("BEGIN");
  try {
    const newUser = await User.register(normalized);
    await User.activateUser(newUser.id);
    const account = await Account.linkNewUserToAccount({
      name: newUser.name,
      userId: newUser.id,
    });
    // Skip createDefaultSubscription; role/tier set during onboarding

    const contact = await Contact.create({
      name: newUser.name,
      email: newUser.email,
      phone: newUser.phone || null,
    });
    await Contact.addToAccount({ contactId: contact.id, accountId: account.id });
    await User.update({ id: newUser.id, contact: contact.id });

    await db.query("COMMIT");

    try {
      await onUserCreated({ userId: newUser.id, role: "homeowner" });
    } catch (autoErr) {
      console.error("[resourceAutoSend] register:", autoErr.message);
    }

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

const mfaVerifyLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: { message: "Too many MFA attempts. Please try again later.", status: 429 } },
});

router.post("/mfa/verify", mfaVerifyLimiter, async function (req, res, next) {
  try {
    const authHeader = req.headers?.authorization;
    const bearerToken = authHeader?.replace(/^[Bb]earer /, "").trim();
    const { mfaTicket, codeOrBackupCode, tokenOrBackupCode } = req.body;
    const ticket = bearerToken || mfaTicket;
    const code = String(codeOrBackupCode || tokenOrBackupCode || "").trim();

    if (!ticket || !code) {
      throw new BadRequestError("MFA ticket and code are required");
    }

    let userId;
    try {
      const payload = verifyMfaTicket(ticket);
      userId = payload.id;
    } catch (err) {
      throw new UnauthorizedError("Invalid or expired MFA session. Please sign in again.");
    }

    const user = await User.getById(userId);
    if (!user || !user.isActive) {
      throw new UnauthorizedError("User not found or inactive");
    }

    const MfaBackupCode = require("../models/mfaBackupCode");
    const speakeasy = require("speakeasy");

    const secret = await User.getMfaSecret(userId);
    if (!secret) throw new UnauthorizedError("Invalid code");

    let valid = false;

    if (code.length === 6 && /^\d+$/.test(code)) {
      valid = speakeasy.totp.verify({
        secret,
        encoding: "base32",
        token: code,
        window: 1,
      });
    }
    if (!valid) {
      valid = await MfaBackupCode.verifyAndConsume(userId, code);
    }

    if (!valid) {
      try {
        await PlatformEngagement.logEvent({ userId, eventType: "mfa_failure", eventData: {} });
      } catch (logErr) { /* don't block */ }
      throw new UnauthorizedError("Invalid code");
    }

    try {
      await PlatformEngagement.logEvent({ userId: user.id, eventType: "mfa_success", eventData: {} });
    } catch (logErr) { /* don't block */ }

    const tokens = await issueTokenPair(user);

    try {
      await PlatformEngagement.logEvent({ userId: user.id, eventType: "login", eventData: {} });
    } catch (logErr) { /* don't block login */ }

    return res.json(tokens);
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

/* ----- Google OAuth ----- */

function redirectWithError(code) {
  const origin = process.env.APP_WEB_ORIGIN || "http://localhost:5173";
  const base = (AUTH_SUCCESS_REDIRECT || `${origin}/#/auth/callback`).replace(/\/$/, "");
  // HashRouter: #/auth/callback?error=...
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}error=${encodeURIComponent(code)}`;
}

function redirectWithToken(accessToken, refreshToken) {
  const origin = process.env.APP_WEB_ORIGIN || "http://localhost:5173";
  const base = AUTH_SUCCESS_REDIRECT || `${origin}/#/auth/callback`;
  const params = new URLSearchParams({ token: accessToken, provider: "google" });
  if (refreshToken) params.set("refreshToken", refreshToken);
  const sep = base.includes("?") ? "&" : "?";
  return `${base}${sep}${params.toString()}`;
}

router.get("/google/signin", function (req, res, next) {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: { message: "Google sign-in is not configured" } });
  }
  try {
    const state = crypto.randomBytes(24).toString("hex");
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: OAUTH_STATE_MAX_AGE * 1000,
      path: "/",
    });
    const url = buildAuthUrl({ redirectUri: GOOGLE_REDIRECT_URI_SIGNIN, state });
    return res.redirect(url);
  } catch (err) {
    console.error("Google signin start error:", err.message);
    return next(err);
  }
});

router.get("/google/signup", function (req, res, next) {
  if (!GOOGLE_CLIENT_ID) {
    return res.status(503).json({ error: { message: "Google sign-up is not configured" } });
  }
  try {
    const state = crypto.randomBytes(24).toString("hex");
    res.cookie(OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: OAUTH_STATE_MAX_AGE * 1000,
      path: "/",
    });
    const url = buildAuthUrl({ redirectUri: GOOGLE_REDIRECT_URI_SIGNUP, state });
    return res.redirect(url);
  } catch (err) {
    console.error("Google signup start error:", err.message);
    return next(err);
  }
});

async function handleGoogleCallback(req, res, next, intent) {
  const redirectUri = intent === "signin" ? GOOGLE_REDIRECT_URI_SIGNIN : GOOGLE_REDIRECT_URI_SIGNUP;
  const { code, state } = req.query;

  if (!code || !state) {
    return res.redirect(redirectWithError("missing_params"));
  }

  const storedState = req.cookies?.[OAUTH_STATE_COOKIE];
  res.clearCookie(OAUTH_STATE_COOKIE, { path: "/" });
  if (!storedState || storedState !== state) {
    return res.redirect(redirectWithError("invalid_state"));
  }

  try {
    const tokens = await exchangeCodeForTokens(code, redirectUri);
    const claims = await verifyIdToken(tokens.id_token);

    const { sub, email, email_verified, name, picture } = claims;
    if (!email) {
      return res.redirect(redirectWithError("no_email"));
    }

    let user = await User.findByGoogleSub(sub);
    const userByEmail = user ? null : await User.findByEmailOrNull(email);

    if (intent === "signup") {
      if (user || userByEmail) {
        return res.redirect(redirectWithError("account_exists"));
      }
      await db.query("BEGIN");
      try {
        const newUser = await User.registerGoogle({
          email,
          name,
          avatarUrl: picture,
          emailVerified: email_verified,
          googleSub: sub,
        });
        const account = await Account.linkNewUserToAccount({
          name: newUser.name,
          userId: newUser.id,
        });
        // Skip createDefaultSubscription for Google signup; role/tier set during onboarding
        const contact = await Contact.create({
          name: newUser.name,
          email: newUser.email,
          phone: null,
        });
        await Contact.addToAccount({ contactId: contact.id, accountId: account.id });
        await User.update({ id: newUser.id, contact: contact.id });
        await db.query("COMMIT");
        user = await User.getById(newUser.id);
        try {
          await onUserCreated({ userId: user.id, role: user.role || null });
        } catch (autoErr) {
          console.error("[resourceAutoSend] Google signup:", autoErr.message);
        }
      } catch (err) {
        await db.query("ROLLBACK");
        throw err;
      }
    } else {
      if (user) {
        // Sign in OK
      } else if (userByEmail && !userByEmail.googleSub) {
        await User.linkGoogle(userByEmail.id, sub);
        user = await User.getById(userByEmail.id);
      } else {
        return res.redirect(redirectWithError("no_account"));
      }
    }

    if (!user) {
      user = await User.findByGoogleSub(sub) || await User.findByEmailOrNull(email);
    }
    if (!user || !user.isActive) {
      return res.redirect(redirectWithError("inactive"));
    }

    const { accessToken, refreshToken } = await issueTokenPair(user);
    try {
      await PlatformEngagement.logEvent({ userId: user.id, eventType: "login", eventData: { provider: "google" } });
    } catch (logErr) { /* don't block */ }

    return res.redirect(redirectWithToken(accessToken, refreshToken));
  } catch (err) {
    console.error("Google callback error:", err.message);
    return res.redirect(redirectWithError("oauth_failed"));
  }
}

router.get("/google/callback/signin", function (req, res, next) {
  return handleGoogleCallback(req, res, next, "signin");
});

router.get("/google/callback/signup", function (req, res, next) {
  return handleGoogleCallback(req, res, next, "signup");
});

/** POST /auth/complete-onboarding - Complete onboarding for Google OAuth signup.
 * Requires auth. Updates user with role and subscriptionTier, sets onboardingCompleted = true. */
router.post("/complete-onboarding", ensureLoggedIn, async function (req, res, next) {
  try {
    const userId = res.locals.user?.id;
    if (!userId) throw new BadRequestError("User authentication required");

    const { role, subscriptionTier } = req.body;
    if (!role || !["homeowner", "agent"].includes(role)) {
      throw new BadRequestError("Valid role (homeowner or agent) is required");
    }
    const validTiers = ["free", "maintain", "win", "basic", "pro", "premium"];
    if (!subscriptionTier || !validTiers.includes(subscriptionTier)) {
      throw new BadRequestError("Valid subscriptionTier is required");
    }

    const existingUser = await User.getById(userId);
    const hadNoRole = !existingUser?.role;
    const user = await User.completeOnboarding(userId, { role, subscriptionTier });

    if (hadNoRole) {
      try {
        await onUserCreated({ userId, role });
      } catch (autoErr) {
        console.error("[resourceAutoSend] complete-onboarding:", autoErr.message);
      }
    }

    // Create default subscription based on tier (for account linking)
    const accountResult = await db.query(
      `SELECT account_id FROM account_users WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    if (accountResult.rows[0]) {
      try {
        await createDefaultSubscription(accountResult.rows[0].account_id, role);
      } catch (subErr) {
        console.error("Warning: failed to create subscription after onboarding", subErr.message);
      }
    }

    return res.json({ user, success: true });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
