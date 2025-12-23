"use strict";

const db = require("../db.js");
const { BadRequestError, NotFoundError } = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

class Contact {
  /** Create a contact (from data), update db, return new contact data.
   *
   * data should be { name, email, phone, website }
   *
   * Returns { id, name, email, phone, website, created_at, updated_at }
   **/
  static async create({ name, email, phone, website }) {
    const result = await db.query(
      `INSERT INTO contacts (name, email, phone, website)
       VALUES ($1, $2, $3, $4)
       RETURNING id, name, email, phone, website, created_at, updated_at`,
      [name, email, phone, website]
    );

    return result.rows[0];
  }

  /** Find all contacts.
   *
   * Returns [{ id, name, email, phone, website, created_at, updated_at }, ...]
   **/
  static async getAll() {
    const result = await db.query(
      `SELECT id,
              name,
              email,
              phone,
              website,
              created_at,
              updated_at
       FROM contacts
       ORDER BY name`
    );

    return result.rows;
  }

  /** Get all contacts for a specific database.
   *
   * Returns [{ id, name, email, phone, website, created_at, updated_at }, ...]
   * Returns empty array if no contacts found.
   **/
  static async getByDatabaseId(databaseId) {
    const result = await db.query(
      `SELECT id,
              name,
              email,
              phone,
              website,
              created_at,
              updated_at
       FROM contacts
       WHERE id = $1
       ORDER BY name`,
      [databaseId]
    );

    return result.rows;
  }

  /** Given a contact id, return data about contact.
   *
   * Returns { id, name, email, phone, website, created_at, updated_at }
   *
   * Throws NotFoundError if not found.
   **/
  static async get(id) {
    const result = await db.query(
      `SELECT id,
              name,
              email,
              phone,
              website,
              created_at,
              updated_at
       FROM contacts
       WHERE id = $1`,
      [id]
    );

    const contact = result.rows[0];

    if (!contact) throw new NotFoundError(`No contact: ${id}`);

    return contact;
  }

  /** Update contact data with `data`.
   *
   * This is a "partial update" --- it's fine if data doesn't contain
   * all the fields; this only changes provided ones.
   *
   * Data can include: { name, email, phone, website }
   *
   * Returns { id, name, email, phone, website, created_at, updated_at }
   *
   * Throws NotFoundError if not found.
   */
  static async update(id, data) {
    const { setCols, values } = sqlForPartialUpdate(data, {});
    const idVarIdx = "$" + (values.length + 1);

    const querySql = `UPDATE contacts
                      SET ${setCols}
                      WHERE id = ${idVarIdx}
                      RETURNING id, name, email, phone, website, created_at, updated_at`;
    const result = await db.query(querySql, [...values, id]);
    const contact = result.rows[0];

    if (!contact) throw new NotFoundError(`No contact: ${id}`);

    return contact;
  }

  /** Delete given contact from database; returns undefined.
   *
   * Throws NotFoundError if contact not found.
   **/
  static async remove(id) {
    const result = await db.query(
      `DELETE
       FROM contacts
       WHERE id = $1
       RETURNING id`,
      [id]
    );
    const contact = result.rows[0];

    if (!contact) throw new NotFoundError(`No contact: ${id}`);
  }
}

module.exports = Contact;
