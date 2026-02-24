"use strict";

/**
 * Application Configuration
 *
 * Central config for the backend. Loads from environment variables.
 * Exports: SECRET_KEY, PORT, BCRYPT_WORK_FACTOR, getDatabaseUri,
 *          AWS_REGION, AWS_S3_BUCKET
 */

require("dotenv").config();
require("colors");

const SECRET_KEY = process.env.SECRET_KEY || process.env.JWT_SECRET || "secret-dev";
const MFA_ENCRYPTION_KEY = process.env.MFA_ENCRYPTION_KEY;
const MFA_ENCRYPTION_KEY_ID = process.env.MFA_ENCRYPTION_KEY_ID || "default";
const APP_NAME = process.env.APP_NAME || "HomeOps";

const PORT = +process.env.PORT || 3000;

// Google OAuth (optional; validated when used)
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_REDIRECT_URI_SIGNIN = process.env.GOOGLE_REDIRECT_URI_SIGNIN;
const GOOGLE_REDIRECT_URI_SIGNUP = process.env.GOOGLE_REDIRECT_URI_SIGNUP;
const APP_WEB_ORIGIN = process.env.APP_WEB_ORIGIN;
// HashRouter uses #/path; redirect must be origin + #/auth/callback
const AUTH_SUCCESS_REDIRECT = process.env.AUTH_SUCCESS_REDIRECT || (process.env.APP_WEB_ORIGIN ? `${process.env.APP_WEB_ORIGIN}/#/auth/callback` : null);

// Use dev database, testing database, or via env var, production database
function getDatabaseUri() {
  return (process.env.NODE_ENV === "test")
    ? "postgresql:///posdb_test"
    : process.env.DATABASE_URL || "postgresql:///posdb";
}
// Speed up bcrypt during tests, since the algorithm safety isn't being tested
//
// WJB: Evaluate in 2021 if this should be increased to 13 for non-test use
const BCRYPT_WORK_FACTOR = process.env.NODE_ENV === "test" ? 1 : 12;

if (process.env.NODE_ENV !== "test") {
  console.log(`
${"PosDB Config:".green}
${"NODE_ENV:".yellow}           ${process.env.NODE_ENV}
${"SECRET_KEY:".yellow}         ${SECRET_KEY}
${"PORT:".yellow}               ${PORT}
${"BCRYPT_WORK_FACTOR:".yellow} ${BCRYPT_WORK_FACTOR}
${"Database:".yellow}           ${getDatabaseUri()}
---`);
}

/** Validate Google OAuth config at server start. Skips if not configured. */
function validateGoogleOAuthConfig() {
  if (!GOOGLE_CLIENT_ID) return; // Google auth disabled
  const missing = [];
  if (!GOOGLE_CLIENT_SECRET) missing.push("GOOGLE_CLIENT_SECRET");
  if (!GOOGLE_REDIRECT_URI_SIGNIN) missing.push("GOOGLE_REDIRECT_URI_SIGNIN");
  if (!GOOGLE_REDIRECT_URI_SIGNUP) missing.push("GOOGLE_REDIRECT_URI_SIGNUP");
  if (!APP_WEB_ORIGIN) missing.push("APP_WEB_ORIGIN");
  if (missing.length > 0) {
    throw new Error(`Google OAuth enabled but missing env: ${missing.join(", ")}`);
  }
}

module.exports = {
  SECRET_KEY,
  MFA_ENCRYPTION_KEY,
  MFA_ENCRYPTION_KEY_ID,
  APP_NAME,
  PORT,
  BCRYPT_WORK_FACTOR,
  getDatabaseUri,
  validateGoogleOAuthConfig,
  GOOGLE_CLIENT_ID,
  GOOGLE_CLIENT_SECRET,
  GOOGLE_REDIRECT_URI_SIGNIN,
  GOOGLE_REDIRECT_URI_SIGNUP,
  APP_WEB_ORIGIN,
  AUTH_SUCCESS_REDIRECT,
  // S3 config;
  AWS_REGION: process.env.AWS_REGION || "us-east-2",
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
};