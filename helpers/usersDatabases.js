"use strict";

/**
 * Users Databases Helper
 *
 * Checks database-user relationships. Used to determine if a database
 * has any linked users (for role assignment) and if a user is a db admin.
 *
 * Exports: isDatabaseLinkedToUser, isDatabaseAdmin
 */

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

/* Link user to database */
/* async function linkUserToDatabase(createdBy, createdByRole, userId, databaseId) {
  console.log("createdBy: ", createdBy);
  console.log("createdByRole: ", createdByRole);
  console.log("userId: ", userId);
  console.log("databaseId: ", databaseId);
  console.log("name: ", name);
  const name = createdBy.name;

  if (createdByRole === "super_admin" || createdByRole === "agent") {
    const database = await Database.create({ name });
    console.log("Db name: ", database.name);

  }
  return database;
} */



module.exports = { isDatabaseLinkedToUser, isDatabaseAdmin };