"use strict";

/**
 * Database Client
 *
 * PostgreSQL client (pg) configured from config.getDatabaseUri().
 * Connects on load. Used by all models for queries.
 */
const { Client } = require("pg");
const { getDatabaseUri } = require("./config");

const databaseUri = getDatabaseUri();

const db = new Client({
  connectionString: databaseUri,
});

async function connectDb() {
  // Jest replaces console.* with custom methods; get the real ones for this
  const { log, error } = require("console");
  try {
    await db.connect();
    log(`Connected to ${databaseUri}`);

  } catch (err) {
    error(`Couldn't connect to ${databaseUri}`, err.message);
    process.exit(1);
  }
}
connectDb();

module.exports = db;