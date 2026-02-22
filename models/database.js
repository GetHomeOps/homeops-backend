"use strict";

/**
 * Database Model
 *
 * Manages user databases in the `databases` table. Represents logical
 * data containers with unique URLs, linked to users via user_databases.
 *
 * Key operations:
 * - create / get / getAll / getUserDatabases: CRUD and user associations
 * - addUserToDatabase / removeUserFromDatabase: Manage user access
 * - linkNewUserToDatabase / linkUserToDatabase: Associate users
 * - linkAgentToDatabase: Link agents to databases
 */

const db = require("../db");
const {
  NotFoundError,
  BadRequestError
} = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");
const { generateDatabaseName } = require("../services/databaseService");
const { isDatabaseLinkedToUser } = require("../helpers/usersDatabases");

// Model for database-related functions
class Database {

  /** Create a new database with data.
   *
   * Data should include:
   *   { name } - User's name (used to generate unique URL)
   *
   * The URL is automatically generated using generateDatabaseName(name).
   * The name parameter is used as the display name for the database.
   *
   * Returns { id, name, url, createdAt, updatedAt }
   *
   * Throws BadRequestError if name is missing or URL generation fails.
   **/
  static async create({ name }) {
    if (!name) {
      throw new BadRequestError("Name is required to create a database");
    }

    // Generate unique URL from name
    const url = await generateDatabaseName(name);

    const result = await db.query(
      `INSERT INTO databases (
              name,
              url)
       VALUES ($1, $2)
       RETURNING id,
              name,
              url,
              created_at AS "createdAt",
              updated_at AS "updatedAt"`,
      [name, url]
    );

    const database = result.rows[0];
    return database;
  }


  /** Get a specific database by id.
   *
   * Returns { id, name, url, createdAt, updatedAt }
   *
   * Throws NotFoundError if database not found.
   **/
  static async get(id) {
    const result = await db.query(
      `SELECT id,
              name,
              url,
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM databases
       WHERE id = $1`,
      [id]
    );

    const database = result.rows[0];
    if (!database) throw new NotFoundError(`No database with id: ${id}`);

    return database;
  }


  /** Get all databases.
   *
   * Returns [{ id, name, url, createdAt, updatedAt }, ...]
   *
   * Throws NotFoundError if no databases are found.
   **/
  static async getAll() {
    const result = await db.query(
      `SELECT id,
              name,
              url,
              created_at AS "createdAt",
              updated_at AS "updatedAt"
       FROM databases`
    );

    const databases = result.rows;
    if (databases.length === 0) throw new NotFoundError(`No databases found`);

    return databases;
  }

  /** Get all databases associated with a specific user.
     *
     * @param {number} userId - The ID of the user.
     * @returns [{ id, name, url, createdAt, updatedAt }, ...]
     *
     * Throws NotFoundError if the user has no associated databases.
     **/
  static async getUserDatabases(userId) {
    const result = await db.query(
      `SELECT d.id,
              d.name,
              d.url,
              d.created_at AS "createdAt",
              d.updated_at AS "updatedAt"
       FROM databases d
       JOIN user_databases ud ON d.id=ud.database_id
       WHERE ud.user_id = $1`,
      [userId]
    );

    const databases = result.rows;
    if (databases.length === 0) throw new NotFoundError(`No databases found for user with ID: ${userId}`);

    return databases;
  }


  /** Update database data with `data`.
   *
   * Data can include:
   *   { name, url }
   *
   * Returns { id, name, url, createdAt, updatedAt }
   *
   * Throws NotFoundError if database not found.
   **/
  static async update(id, data) {
    const { setCols, values } = sqlForPartialUpdate(
      data,
      {}
    );
    const idVarIdx = "$" + (values.length + 1);

    const querySql = `
      UPDATE databases
      SET ${setCols}
      WHERE id = ${idVarIdx}
      RETURNING id,
                name,
                url,
                created_at AS "createdAt",
                updated_at AS "updatedAt"`;
    const result = await db.query(querySql, [...values, id]);
    const database = result.rows[0];

    if (!database) throw new NotFoundError(`No database with id: ${id}`);

    return database;
  }


  /** Remove a database.
   *
   * Returns { deleted: id }
   *
   * Throws NotFoundError if database not found.
   **/
  static async remove(id) {
    const result = await db.query(
      `DELETE
       FROM databases
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    const database = result.rows[0];
    if (!database) throw new NotFoundError(`No database with id: ${id}`);

    return { deleted: id };
  }

  /**
 * Create a new 'main' database for super_user.
 * This method will create a new database called 'main' for a user.
 *
 * @param {number} userId - The ID of the user for whom the database will be created.
 */
  static async createMainDatabase(userId) {
    try {
      // Check if the 'main' database already exists for this user
      const userDb = await db.query(
        `SELECT d.id
        FROM databases d
        JOIN user_databases ud ON d.id=ud.database_id
        WHERE d.name = $1 AND ud.user_id = $2`,
        ['main', userId]
      );

      // If the 'main' database doesn't exist, create it
      if (userDb.rows.length === 0) {
        // Create the main database (URL will be auto-generated from name)
        const mainDb = await this.create({
          name: 'main'
        });

        console.log("Main database created:", mainDb);

        // Add the user to the main database
        // await this.addUserToDatabase(userId, mainDb.id);

        // console.log("User added to main database successfully.");
        return mainDb; // Make sure to return the database
      } else {
        console.log("Main database already exists for user with ID:", userId);
        return userDb.rows[0]; // Return the existing database
      }
    } catch (err) {
      console.error("Error creating main database:", err);
      throw err;
    }
  }

  /* Add a user to a database.
   *
   * Data should include:
   *   { userId, databaseId, role }
   *
   * Returns { id, userId, databaseId, createdAt, updatedAt }
   *
   * Throws BadRequestError if user already exists in database.
   **/
  static async addUserToDatabase({ userId, databaseId, role = 'admin' }) {
    /* Check if the database is linked to any user - if it is not, role should be admin, otherwise, whatever role is passed in*/
    const isLinked = await isDatabaseLinkedToUser(databaseId);
    let dbAdmin = false;

    if (!isLinked) {
      dbAdmin = true;
    } else {
      dbAdmin = false;
    }
    try {
      const result = await db.query(
        `INSERT INTO user_databases (
            user_id,
            database_id,
            role,
            db_admin)
        VALUES ($1, $2, $3, $4)
        RETURNING user_id,
                  database_id,
                  role,
                  created_at AS "createdAt",
                  updated_at AS "updatedAt",
                  db_admin AS "dbAdmin"`,
        [userId,
          databaseId,
          role,
          dbAdmin]
      );

      return result.rows[0];
    } catch (err) {
      console.error("Error adding user to database:", err);
      throw err;
    }
  }

  /** Checks if a user is linked to a specific database.
  *  Returns `true` if authorized, `false` otherwise.
  */
  static async isUserLinkedToDatabase(userId, databaseId) {
    try {
      const result = await db.query(
        `SELECT user_id
        FROM user_databases
        WHERE user_id = $1 AND database_id = $2`,
        [userId, databaseId]
      );

      return result.rows.length > 0;
    } catch (err) {
      console.error("Error checking if user is linked to database:", err);
      throw err;
    }
  }

  /* Link new user to database */
  static async linkNewUserToDatabase(data) {

    const name = data.newUser.name;
    try {
      const database = await this.create({ name: name });
      const userDb = await this.addUserToDatabase({ userId: data.newUser.id, databaseId: database.id, role: 'admin' });

      if (data.createdByRole === "agent") {
        const createdBy = data.createdBy;

        await this.linkAgentToDatabase({ userId: createdBy, databaseId: database.id });
      }
      return userDb;

    } catch (err) {
      console.error("Error linking new user to database:", err);
      throw err;
    }
  }

  /* Link an existing user to a database */
  static async linkUserToDatabase(data) {
    console.log("data: ", data);
    try {
      const { userId, databaseId, role } = data;
      await this.addUserToDatabase({ userId: userId, databaseId: databaseId, role: role });
      return { success: true, message: "User linked to database successfully" };
    } catch (err) {
      console.error("Error linking user to database:", err);
      throw err;
    }
  }

  /* Remove user from database */
  static async removeUserFromDatabase(data) {
    const { userId, databaseId } = data;
    try {
      const result = await db.query(
        `DELETE FROM user_databases
        WHERE user_id = $1 AND database_id = $2`,
        [userId, databaseId]
      );
      console.log("User removed from database successfully");
      return result.rows[0];
    } catch (err) {
      console.error("Error removing user from database:", err);
      throw err;
    }
  }

  /* Link Agent to Database */
  static async linkAgentToDatabase(data) {
    const { userId, databaseId } = data;
    const result = await db.query(
      `INSERT INTO agent_databases (
          agent_id,
          database_id)
        VALUES ($1, $2)
        RETURNING agent_id, database_id`,
      [userId, databaseId]
    );
    console.log("Agent linked to database successfully");
    return result.rows[0];
  }


}


module.exports = Database;
