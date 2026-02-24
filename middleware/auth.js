"use strict";

const jwt = require("jsonwebtoken");
const { SECRET_KEY } = require("../config");
const { UnauthorizedError, ForbiddenError } = require("../expressError");
const Account = require("../models/account");
const User = require("../models/user");
const db = require("../db");

/** Verify Bearer token, set res.locals.user (optional). Ignores invalid tokens. */
function authenticateJWT(req, res, next) {
  const authHeader = req.headers?.authorization;
  if (authHeader) {
    const token = authHeader.replace(/^[Bb]earer /, "").trim();
    try {
      res.locals.user = jwt.verify(token, SECRET_KEY);
    } catch (err) {
      /* ignore invalid tokens */
    }
  }
  return next();
}

/** Require super_admin role. Re-fetches user from DB if JWT role is stale. */
async function ensureSuperAdmin(req, res, next) {
  try {
    if (res.locals.user?.role === "super_admin") return next();
    const userId = res.locals.user?.id;
    if (!userId) throw new UnauthorizedError();
    const user = await User.getById(userId);
    if (user?.role === "super_admin") {
      res.locals.user.role = user.role;
      return next();
    }
    throw new UnauthorizedError();
  } catch (err) {
    next(err);
  }
}

/** Require super_admin or admin role. */
function ensurePlatformAdmin(req, res, next) {
  const role = res.locals.user?.role;
  if (role === 'super_admin' || role === 'admin') return next();
  throw new UnauthorizedError();
}

/** Require authenticated user (res.locals.user.email must exist). */
function ensureLoggedIn(req, res, next) {
  if (res.locals.user?.email) return next();
  throw new UnauthorizedError();
}

/** Require current user matches params.email. */
async function ensureCorrectUser(req, res, next) {
  const currentUser = res.locals.user?.email;
  if (currentUser && currentUser === req.params.email) return next();
  throw new UnauthorizedError();
}

/** Require property_users membership or admin. Options: scope, param, fromBody. */
function ensurePropertyAccess(options = {}) {
  const scope = options.scope === "user" ? "user" : "property";
  const param = options.param ?? (scope === "user" ? "userId" : "uid");

  if (scope === "user") {
    return function _ensurePropertyAccessByUser(req, res, next) {
      const user = res.locals.user;
      if (!user?.id) throw new UnauthorizedError();
      if (user.role === "super_admin" || user.role === "admin") return next();
      if (String(user.id) === String(req.params[param])) return next();
      throw new ForbiddenError("You may only access properties for your own user.");
    };
  }

  const fromBody = options.fromBody;

  return async function _ensurePropertyAccessByProperty(req, res, next) {
    try {
      const user = res.locals.user;
      if (!user?.id) throw new UnauthorizedError();
      if (user.role === "super_admin" || user.role === "admin") return next();

      const raw = (fromBody && req.body && req.body[fromBody] != null)
        ? req.body[fromBody]
        : (req.params[param] || req.params.uid || req.params.propertyId || req.params.PropertyId);
      if (!raw) throw new ForbiddenError("Property identifier missing.");

      let propertyId = raw;

      if (/^[0-9A-Z]{26}$/i.test(raw)) {
        const propRes = await db.query(
          `SELECT id FROM properties WHERE property_uid = $1`,
          [raw],
        );
        if (propRes.rows.length === 0) throw new ForbiddenError("Property not found.");
        propertyId = propRes.rows[0].id;
      }

      const result = await db.query(
        `SELECT 1 FROM property_users WHERE property_id = $1 AND user_id = $2`,
        [propertyId, user.id],
      );

      if (result.rows.length > 0) return next();
      throw new ForbiddenError("You do not have access to this property.");
    } catch (err) {
      return next(err);
    }
  };
}

/** Require owner role on property. */
function ensurePropertyOwner(paramName = "propertyId") {
  return async function _ensurePropertyOwner(req, res, next) {
    try {
      const user = res.locals.user;
      if (!user?.id) throw new UnauthorizedError();
      if (user.role === "super_admin") return next();

      const raw = req.params[paramName];
      if (!raw) throw new ForbiddenError("Property identifier missing.");

      let propertyId = raw;
      if (/^[0-9A-Z]{26}$/i.test(raw)) {
        const propRes = await db.query(
          `SELECT id FROM properties WHERE property_uid = $1`, [raw]
        );
        if (propRes.rows.length === 0) throw new ForbiddenError("Property not found.");
        propertyId = propRes.rows[0].id;
      }

      const result = await db.query(
        `SELECT 1 FROM property_users WHERE property_id = $1 AND user_id = $2 AND role = 'owner'`,
        [propertyId, user.id]
      );
      if (result.rows.length > 0) return next();
      throw new ForbiddenError("Only the property owner can perform this action.");
    } catch (err) {
      return next(err);
    }
  };
}

/** Require account_users membership for the account in params. */
function ensureUserCanAccessAccountByParam(paramName = "accountId") {
  return async function _ensureUserCanAccessAccountByParam(req, res, next) {
    try {
      const userId = res.locals.user?.id;
      if (!userId) throw new UnauthorizedError("Authentication required.");
      if (res.locals.user.role === "super_admin" || res.locals.user.role === "admin") return next();
      const accountId = req.params[paramName];
      if (!accountId) throw new UnauthorizedError("Account identifier required.");
      const isAuthorized = await Account.isUserLinkedToAccount(userId, accountId);
      if (!isAuthorized) throw new UnauthorizedError("Not authorized to access this account.");
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Require account_users membership for the account in req.body. Used for POST routes. */
function ensureUserCanAccessAccountFromBody(bodyKey = "account_id") {
  return async function _ensureUserCanAccessAccountFromBody(req, res, next) {
    try {
      const userId = res.locals.user?.id;
      if (!userId) throw new UnauthorizedError("Authentication required.");
      if (res.locals.user.role === "super_admin" || res.locals.user.role === "admin") return next();
      const accountId = req.body?.[bodyKey];
      if (!accountId) throw new UnauthorizedError("Account identifier required.");
      const isAuthorized = await Account.isUserLinkedToAccount(userId, accountId);
      if (!isAuthorized) throw new UnauthorizedError("Not authorized to access this account.");
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Require agent or self for agent-scoped routes. */
function ensureAgentOrSelf(paramName = "agentId") {
  return function _ensureAgentOrSelf(req, res, next) {
    const user = res.locals.user;
    if (!user?.id) throw new UnauthorizedError("Authentication required.");
    if (user.role === "super_admin" || user.role === "admin") return next();
    if (String(user.id) === String(req.params[paramName])) return next();
    throw new ForbiddenError("You may only access your own profile.");
  };
}

/** Require shared account to view user. */
function ensureCanViewUser(paramName = "email") {
  return async function _ensureCanViewUser(req, res, next) {
    try {
      const user = res.locals.user;
      if (!user?.id) throw new UnauthorizedError("Authentication required.");
      if (user.role === "super_admin" || user.role === "admin") return next();
      const targetUser = await User.get(req.params[paramName]);
      if (!targetUser?.id) throw new ForbiddenError("User not found.");
      const shared = await db.query(
        `SELECT 1 FROM account_users a
         JOIN account_users b ON a.account_id = b.account_id
         WHERE a.user_id = $1 AND b.user_id = $2 LIMIT 1`,
        [user.id, targetUser.id]
      );
      if (shared.rows.length === 0) throw new ForbiddenError("You may only view users in your accounts.");
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Require super_admin, admin, or agent role. */
function ensureAdminOrSuperAdmin(req, res, next) {
  const userRole = res.locals.user?.role;
  if (userRole === 'super_admin' || userRole === 'admin' || userRole === 'agent') {
    return next();
  }
  throw new UnauthorizedError("Not authorized.");
}

module.exports = {
  authenticateJWT,
  ensureLoggedIn,
  ensureCorrectUser,
  ensureSuperAdmin,
  ensurePlatformAdmin,
  ensureAdminOrSuperAdmin,
  ensurePropertyAccess,
  ensurePropertyOwner,
  ensureUserCanAccessAccountByParam,
  ensureUserCanAccessAccountFromBody,
  ensureAgentOrSelf,
  ensureCanViewUser,
};
