"use strict";

const db = require("../db");
const {
  NotFoundError,
  BadRequestError
} = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

// Model for database-related functions
class Database {

  /** Create a new database with data.
   *
   * Returns { id, name, url, createdAt, updatedAt }
   *
   * Throws BadRequestError on duplicates.
   **/
  static async create({ name, url }) {
    const duplicateCheck = await db.query(
      `SELECT id
       FROM databases
       WHERE url = $1`,
      [url]
    );

    if (duplicateCheck.rows.length > 0) {
      throw new BadRequestError(`Duplicate database name or URL`);
    }

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
        // Create the main database
        const mainDb = await this.create({
          name: 'main',
          url: 'main'
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
    console.log("userId from Database file: ", userId);
    console.log("databaseId: ", databaseId);
    console.log("role: ", role);
    try {
      const result = await db.query(
        `INSERT INTO user_databases (
            user_id,
            database_id,
            role)
        VALUES ($1, $2, $3)
        RETURNING user_id,
                  database_id,
                  role,
                  created_at AS "createdAt",
                  updated_at AS "updatedAt"`,
        [userId,
          databaseId,
          role]
      );
      console.log(`User ${userId} added to database ${databaseId} as ${role}`);
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
}


module.exports = Database;
