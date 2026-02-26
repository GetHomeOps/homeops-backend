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
    try {
      const pgvector = require("pgvector/pg");
      await pgvector.registerTypes(db);
    } catch (e) {
      // pgvector optional; run migration 013 to enable RAG over documents
      if (process.env.NODE_ENV !== "test") {
        const { warn } = require("console");
        warn("pgvector not available (run migration 013). Document RAG disabled.");
      }
    }
    log(`Connected to ${databaseUri}`);
  } catch (err) {
    error(`Couldn't connect to ${databaseUri}`, err.message);
    process.exit(1);
  }
}
connectDb();

module.exports = db;