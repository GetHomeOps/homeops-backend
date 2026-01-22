"use strict";

const db = require("../db");

/* Check if a database is linked to any user return false if not */
async function isDatabaseLinkedToUser(databaseId) {
  try {
    const result = await db.query(
      `SELECT * FROM user_databases WHERE database_id = $1`,
      [databaseId]
    );
    return result.rows.length > 0 ? true : false;
  } catch (err) {
    console.error("Error checking if database is linked to any user:", err);
    throw err;
  }
}

/* Check if a user is a database admin */
async function isDatabaseAdmin(userId) {
  try {
    const result = await db.query(
      `SELECT * FROM
      user_databases
      WHERE user_id = $1 AND db_admin = true`,
      [userId]
    );
    return result.rows.length > 0 ? true : false;
  } catch (err) {
    console.error("Error checking if user is a database admin:", err);
    throw err;
  }
}


module.exports = { isDatabaseLinkedToUser, isDatabaseAdmin };