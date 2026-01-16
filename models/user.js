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
  * Returns {  email, fullName, phone, role, contact, isActive }
  *
  * Throws UnauthorizedError is user not found or wrong password.
  **/
  static async authenticate(email, password) {
    // try to find the user first
    const result = await db.query(`
      SELECT id,
             email,
             password_hash AS "password",
             name,
             phone,
             role,
             contact_id AS "contact",
             is_active AS "isActive"
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
 * Data should include: { name (required), email (required), password, phone, role, contact, isActive }
 *
 * Returns { email, fullName, phone, role, contact, isActive }
 *
 * Throws BadRequestError on duplicates.
 **/
  static async register({ name, email, password, phone = null, role = 'admin', contact = 0, is_active = false }) {

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

    // Ensure contact is an integer, defaulting to 0 if null/undefined
    const contactId = contact === null || contact === undefined ? 0 : parseInt(contact, 10) || 0;

    const result = await db.query(`
        INSERT INTO users (
              email,
              password_hash,
              name,
              phone,
              role,
              contact_id,
              is_active)
        VALUES ($1,$2,$3,$4,$5,$6,$7)
        RETURNING
              id,
              email,
              name,
              phone,
              role,
              contact_id AS "contact",
              is_active`, [
      email,
      hashedPassword,
      name,
      phone,
      role,
      contactId,
      is_active
    ]
    );

    const user = result.rows[0];

    return user;
  }

  /** Given an email, return data about user.
   *
   * Returns { email, fullName, phone, role, contact, isActive }
   *
   * Throws NotFoundError if user not found.
   **/
  static async get(email) {
    const userRes = await db.query(`
        SELECT id,
               email,
               name,
               phone,
               role,
               contact_id AS "contact",
               is_active AS "isActive"
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
             u.name,
             u.phone,
             u.contact_id AS "contact",
             u.is_active AS "isActive",
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
   * Returns { email, fullName, phone, role, contact, isActive }
   *
   * Throws NotFoundError if user not found.
   **/
  static async getAll() {
    const userRes = await db.query(`
        SELECT id,
               email,
               name,
               phone,
               role,
               contact_id AS "contact",
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
     *   { name, email, phone, role, contact, password, isActive }
     *
     * Returns { email, fullName, phone, role, contact, isActive }
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
        isActive: "is_active",
        contact: "contact_id",
        password: "password_hash",
      });
    const emailVarIdx = "$" + (values.length + 1);

    const querySql = `
      UPDATE users
      SET ${setCols}
      WHERE email = ${emailVarIdx}
      RETURNING email,
                name AS "fullName",
                phone,
                role,
                contact_id AS "contact",
                is_active AS "isActive"`;
    const result = await db.query(querySql, [...values, email]);
    const user = result.rows[0];

    if (!user) throw new NotFoundError(`No user: ${email}`);

    return user;
  }


  /** Remove user. Returns removed user id
   *
   * Returns { id }
   *
   * Throws NotFoundError if user not found.
   **/
  static async remove(id) {
    const result = await db.query(`
      DELETE
      FROM users
      WHERE id = $1
      RETURNING id`,
      [id]
    );
    const user = result.rows[0];

    if (!user) throw new NotFoundError(`No user: ${id}`);

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
          name: process.env.SUPER_ADMIN_FULL_NAME,
          email: process.env.SUPER_ADMIN_EMAIL,
          password: process.env.SUPER_ADMIN_PASSWORD,
          role: 'super_admin',
          is_active: true,
        });

        console.log("Super admin initialized");
        return res;
      }

    } catch (err) {
      console.error("Error initializing super admin:", err);
    }
  }

  /* Check if user is linked to any database and return the database ids */
  static async userHasDatabase(userId) {
    const result = await db.query(
      `SELECT database_id
      FROM user_databases
      WHERE user_id = $1
      RETURNING database_id`,
      [userId]
    );
    return result;
  }

  /* ----- Invitation functions ----- */

  /* Activate user from invitation */
  static async activateFromInvitation(userId, password) {
    const hashedPassword = await bcrypt.hash(password, BCRYPT_WORK_FACTOR);

    const result = await db.query(
      `UPDATE users
      SET password_hash = $1,
          is_active = true
      WHERE id = $2
      RETURNING id,
       email,
       name AS "fullName",
       phone,
       role,
       contact_id AS "contact",
       is_active AS "isActive"`,
      [hashedPassword, userId]
    );

    return result.rows[0];
  }

  /* Activate Signup User */
  static async activateUser(userId) {
    const result = await db.query(
      `UPDATE users
      SET is_active = true
      WHERE id = $1
      RETURNING id, email, name, phone, role, contact_id AS "contact", is_active AS "isActive"`,
      [userId]
    );
    return result.rows[0];
  }
}

module.exports = User;