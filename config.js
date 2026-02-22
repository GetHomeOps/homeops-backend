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

const SECRET_KEY = process.env.SECRET_KEY || "secret-dev";

const PORT = +process.env.PORT || 3000;

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

module.exports = {
  SECRET_KEY,
  PORT,
  BCRYPT_WORK_FACTOR,
  getDatabaseUri,
  // S3 config;
  AWS_REGION: process.env.AWS_REGION || "us-east-2",
  AWS_S3_BUCKET: process.env.AWS_S3_BUCKET,
};