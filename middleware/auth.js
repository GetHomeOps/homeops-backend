"use strict";

/** Convenience middleware to handle common auth cases in routes. */
const jwt = require("jsonwebtoken");
const { SECRET_KEY } = require("../config");
const { UnauthorizedError, ForbiddenError } = require("../expressError");
const Database = require("../models/database");
const User = require("../models/user");
const db = require("../db");


/** Middleware: Authenticate user.
 *
 * If a token was provided, verify it, and, if valid, store the token payload
 * on res.locals (This will include ...)
 *
 * It's not an error if no token was provided or if the token is not valid.
 */
function authenticateJWT(req, res, next) {
  const authHeader = req.headers?.authorization;
  if (authHeader) {
    const token = authHeader.replace(/^[Bb]earer /, "").trim();

    try {
      res.locals.user = jwt.verify(token, SECRET_KEY);
    } catch (err) {
      /* ignore invalid tokens (but don't store user!) */
    }
  }
  return next();

}

/** Middleware to use when they must be superAdmin.
 *
 * If not, raises Unauthorized.
 */
function ensureSuperAdmin(req, res, next) {
  if (res.locals.user?.role === 'super_admin') return next();
  throw new UnauthorizedError();
}


/** Middleware to use when they must be logged in.
 *
 * If not, raises Unauthorized.
 */
function ensureLoggedIn(req, res, next) {
  if (res.locals.user?.email) return next();
  throw new UnauthorizedError();
}

/** Middleware to ensure the user is correct (matches the email in the request params).
 *
 * If the emails don't match, raises Unauthorized.
 */
async function ensureCorrectUser(req, res, next) {
  const currentUser = res.locals.user?.email;

  if (
    currentUser && (currentUser === req.params.email))
    return next();
  throw new UnauthorizedError();
}

/** Middleware to ensure the user is connected to a database and authorized to access it.
 *
 * Checks if the user has a valid `databaseId` in the request headers or params.
 * Then verifies if the user is linked to that database.
 *
 * If not, raises Unauthorized.
 */
async function ensureDatabaseUser(req, res, next) {
  console.log("res.locals.user: ", res.locals.user);
  console.log("databaseId: ", req.headers);
  try {
    const userId = res.locals.user?.id;
    const databaseId = req.headers["database-id"];

    if (!userId) {
      throw new UnauthorizedError("User authentication required.");
    }

    if (!databaseId) {
      throw new UnauthorizedError("Database connection required.");
    }

    // Check if the user is linked to the database
    const isAuthorized = await Database.isUserLinkedToDatabase(userId, databaseId);

    if (!isAuthorized) {
      throw new UnauthorizedError("User not authorized to access this database.");
    }

    //res.locals.databaseId = databaseId;
    return next();
  } catch (err) {
    return next(err);
  }
}

/**
 * Middleware: ensurePropertyAccess
 *
 * Ensures the user is logged in and either super_admin or allowed to access
 * the property-related resource. Two modes:
 *
 * 1) By property (default): single property by uid/id.
 *    Use: ensurePropertyAccess() or ensurePropertyAccess({ param: 'uid' })
 *    Reads property from req.params.uid / propertyId / PropertyId, resolves
 *    ULID to id if needed, and checks property_users. Use for GET /:uid,
 *    PATCH /:propertyId, etc.
 *
 * 2) By user: list keyed by userId (e.g. GET /user/:userId).
 *    Use: ensurePropertyAccess({ scope: 'user', param: 'userId' })
 *    Allows only if super_admin or req.params[param] === current user, so
 *    users only fetch their own team-member list (no DB hit).
 */
function ensurePropertyAccess(options = {}) {
  const scope = options.scope === "user" ? "user" : "property";
  const param = options.param ?? (scope === "user" ? "userId" : "uid");

  if (scope === "user") {
    return function _ensurePropertyAccessByUser(req, res, next) {
      const user = res.locals.user;
      if (!user?.id) throw new UnauthorizedError();
      if (user.role === "super_admin") return next();
      if (String(user.id) === String(req.params[param])) return next();
      throw new ForbiddenError("You may only access properties for your own user.");
    };
  }

  const fromBody = options.fromBody;

  return async function _ensurePropertyAccessByProperty(req, res, next) {
    try {
      const user = res.locals.user;
      if (!user?.id) throw new UnauthorizedError();
      if (user.role === "super_admin") return next();

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
        `SELECT 1 FROM property_users
         WHERE property_id = $1 AND user_id = $2`,
        [propertyId, user.id],
      );

      if (result.rows.length > 0) return next();
      throw new ForbiddenError("You do not have access to this property.");
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Middleware: ensure the logged-in user is linked to the database in req.params.
 * Use for routes like GET /db/:databaseId so users only see users in their databases.
 * If not linked, raises Unauthorized.
 */
function ensureUserCanAccessDatabaseByParam(paramName = "databaseId") {
  return async function _ensureUserCanAccessDatabaseByParam(req, res, next) {
    try {
      const userId = res.locals.user?.id;
      if (!userId) throw new UnauthorizedError("Authentication required.");
      const databaseId = req.params[paramName];
      if (!databaseId) throw new UnauthorizedError("Database identifier required.");
      const isAuthorized = await Database.isUserLinkedToDatabase(userId, databaseId);
      if (!isAuthorized) throw new UnauthorizedError("Not authorized to access this database.");
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/**
 * Middleware: allow only super_admin or the agent themselves (req.params[paramName] === current user id).
 * Use for GET /agent/:agentId.
 */
function ensureAgentOrSelf(paramName = "agentId") {
  return function _ensureAgentOrSelf(req, res, next) {
    const user = res.locals.user;
    if (!user?.id) throw new UnauthorizedError("Authentication required.");
    if (user.role === "super_admin") return next();
    if (String(user.id) === String(req.params[paramName])) return next();
    throw new ForbiddenError("You may only access users for your own agent profile.");
  };
}

/**
 * Middleware: ensure the logged-in user can view the user identified by req.params[paramName] (email).
 * Allows super_admin to view any user; others may only view users that share a database with them.
 */
function ensureCanViewUser(paramName = "email") {
  return async function _ensureCanViewUser(req, res, next) {
    try {
      const user = res.locals.user;
      if (!user?.id) throw new UnauthorizedError("Authentication required.");
      if (user.role === "super_admin") return next();
      const targetUser = await User.get(req.params[paramName]);
      if (!targetUser?.id) throw new ForbiddenError("User not found.");
      const shared = await db.query(
        `SELECT 1 FROM user_databases a
         JOIN user_databases b ON a.database_id = b.database_id
         WHERE a.user_id = $1 AND b.user_id = $2 LIMIT 1`,
        [user.id, targetUser.id]
      );
      if (shared.rows.length === 0) throw new ForbiddenError("You may only view users in your databases.");
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

/** Middleware to ensure the user is a database admin or super admin.
 *
 * If not, raises Unauthorized.
 */
function ensureAdminOrSuperAdmin(req, res, next) {
  const userRole = res.locals.user?.role;
  const isSuperAdmin = userRole === 'super_admin';
  const isAdmin = userRole === 'admin' || userRole === 'agent';

  console.log("userRole: ", userRole);
  console.log("isSuperAdmin: ", isSuperAdmin);
  console.log("isAdmin: ", isAdmin);

  if (isSuperAdmin || isAdmin) {
    return next();
  }
  throw new UnauthorizedError("User not authorized to access this database.");
}


module.exports = {
  authenticateJWT,
  ensureLoggedIn,
  ensureCorrectUser,
  ensureSuperAdmin,
  ensureDatabaseUser,
  ensureAdminOrSuperAdmin,
  ensurePropertyAccess,
  ensureUserCanAccessDatabaseByParam,
  ensureAgentOrSelf,
  ensureCanViewUser,
};