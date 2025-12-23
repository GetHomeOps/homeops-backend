"use strict";

/** Convenience middleware to handle common auth cases in routes. */
const jwt = require("jsonwebtoken");
const { SECRET_KEY } = require("../config");
const { UnauthorizedError } = require("../expressError");
const Database = require("../models/database");


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
};