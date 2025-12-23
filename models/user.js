"use strict";

const db = require("../db");
const bcrypt = require("bcrypt");
const {
  NotFoundError,
  BadRequestError,
  UnauthorizedError
} = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");


const { BCRYPT_WORK_FACTOR } = require("../config.js");

//Model for user-related functions
class User {

  /** authenticate user with username, password.
  *
  * Returns {  email, fullName, role }
  *
  * Throws UnauthorizedError is user not found or wrong password.
  **/
  static async authenticate(email, password) {
    // try to find the user first
    const result = await db.query(`
      SELECT id,
             email,
             password_hash AS "password",
             full_name,
             role
      FROM users
      WHERE email = $1`,
      [email]
    );

    const user = result.rows[0];

    if (user) {
      // compare hashed password to a new hash from password
      const isValid = await bcrypt.compare(password, user.password);
      if (isValid === true) {
        delete user.password;
        return user;
      }
    }
    throw new UnauthorizedError("Invalid username/password");
  }

  /** Register user with data.
 *
 * Returns { email, fullName, role  }
 *
 * Throws BadRequestError on duplicates.
 **/
  static async register({ email, password, fullName, role = 'admin' }) {

    const duplicateCheck = await db.query(`
      SELECT email
      FROM users
      WHERE email =$1`,
      [email]
    );

    if (duplicateCheck.rows.length > 0) {
      throw new BadRequestError(`Duplicate user: ${email}`);
    }

    const hashedPassword = await bcrypt.hash(password, BCRYPT_WORK_FACTOR);

    const result = await db.query(`
        INSERT INTO users (
              email,
              password_hash,
              full_name,
              role)
        VALUES ($1,$2,$3,$4)
        RETURNING
              id,
              email,
              full_name AS "fullName",
              role,
              is_active AS "isActive"`, [
      email,
      hashedPassword,
      fullName,
      role,
    ]
    );

    const user = result.rows[0];

    return user;
  }

  /** Given an email, return data about user.
   *
   * Returns { email, fullName, role }
   *
   * Throws NotFoundError if user not found.
   **/
  static async get(email) {
    const userRes = await db.query(`
        SELECT id,
               email,
               full_name AS "fullName",
               role
        FROM users
        WHERE email=$1`,
      [email]
    );

    const user = userRes.rows[0];

    if (!user) throw new NotFoundError(`No user: ${email}`);

    return user;
  }

  /* Get all users by database id */
  static async getByDatabaseId(databaseId) {
    const userRes = await db.query(`
      SELECT u.id,
             u.email,
             u.full_name AS "fullName",
             ud.role
      FROM user_databases ud
      JOIN users u ON u.id = ud.user_id
      WHERE ud.database_id = $1`,
      [databaseId]
    );

    return userRes.rows;
  }

  /** Return data of ALL users.
   *
   * Returns { email, fullName, role, isActive }
   *
   * Throws NotFoundError if user not found.
   **/
  static async getAll() {
    const userRes = await db.query(`
        SELECT id,
               email,
               full_name AS "fullName",
               role,
               is_active AS "isActive",
               created_at AS "createdAt",
               updated_at AS "updatedAt"
        FROM users`
    );

    const users = userRes.rows;

    if (!users) throw new NotFoundError(`No users found`);

    return users;
  }

  /** Update user data with `data`.
     *
     * This is a "partial update" --- it's fine if data doesn't contain
     * all the fields; this only changes provided ones.
     *
     * Data can include:
     *   { fullName, password, isActive }
     *
     * Returns { email, fullName, isActive }
     *
     * Throws NotFoundError if not found.
     *
     * WARNING: this function can set a new password or make a user inactive.
     * Callers of this function must be certain they have validated inputs to this
     * or serious security risks are opened.
     */
  static async update(email, data) {
    if (data.password) {
      data.password = await bcrypt.hash(data.password, BCRYPT_WORK_FACTOR);
    }

    const { setCols, values } = sqlForPartialUpdate(
      data,
      {
        fullName: "full_name",
        isActive: "is_active",
      });
    const emailVarIdx = "$" + (values.length + 1);

    const querySql = `
      UPDATE users
      SET ${setCols}
      WHERE email = ${emailVarIdx}
      RETURNING email,
                full_name AS "fullName",
                is_active AS "isActive"`;
    const result = await db.query(querySql, [...values, email]);
    const user = result.rows[0];

    if (!user) throw new NotFoundError(`No user: ${email}`);

    return user;
  }


  /** Remove user. Returns removed user
   *
   * Returns { email }
   *
   * Throws NotFoundError if user not found.
   **/
  static async remove(email) {
    const result = await db.query(`
      DELETE
      FROM users
      WHERE email = $1
      RETURNING email`,
      [email]
    );
    const user = result.rows[0];

    if (!user) throw new NotFoundError(`No user: ${email}`);

    return user;
  }

  /**
   * Initialize Super Admin if none exists.
   *
   * This function should be called once during the application's startup
   * process to ensure that at least one super admin account exists in the system.
   */
  static async initializeSuperAdmin() {
    try {
      const result = await db.query(
        `SELECT id FROM users WHERE role='super_admin'`
      );

      if (result.rows.length === 0) {
        const res = await this.register({
          email: process.env.SUPER_ADMIN_EMAIL,
          password: process.env.SUPER_ADMIN_PASSWORD,
          fullName: process.env.SUPER_ADMIN_FULL_NAME,
          role: 'super_admin',
        });

        console.log("Super admin initialized");
        return res;
      }

    } catch (err) {
      console.error("Error initializing super admin:", err);
    }
  }
}

module.exports = User;