"use strict";

const db = require("../db.js");
const { BadRequestError, NotFoundError } = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

class Contact {
  /** Create a contact (from data), update db, return new contact data.
   *
   * data should be { name (required), image, type, phone, email, website, street1, street2, city, state, zip_code, country, country_code, notes, role }
   *
   * Returns { id, name, image, type, phone, email, website, street1, street2, city, state, zip_code, country, country_code, notes, role, created_at, updated_at }
   **/
  static async create(data) {
    const {
      name,
      image = null,
      type = null,
      phone = null,
      email = null,
      website = null,
      street1 = null,
      street2 = null,
      city = null,
      state = null,
      zip_code = null,
      country = null,
      country_code = null,
      notes = null,
      role = null
    } = data;

    const result = await db.query(
      `INSERT INTO contacts (name, image, type, phone, email, website, street1, street2, city, state, zip_code, country, country_code, notes, role)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
       RETURNING id,
                 name,
                 image,
                 type,
                 phone,
                 email,
                 website,
                 street1,
                 street2,
                 city,
                 state,
                 zip_code,
                 country,
                 country_code,
                 notes,
                 role,
                 created_at,
                 updated_at`,
      [name, image, type, phone, email, website, street1, street2, city, state, zip_code, country, country_code, notes, role]
    );

    return result.rows[0];
  }

  /* Add a contact to a database.
   *
   * Data should include:
   *   { contactId, databaseId }
   *
   * Returns { contactId, databaseId, createdAt, updatedAt }
   *
   * Throws BadRequestError if contact already exists in database.
   **/
  static async addToDatabase({ contactId, databaseId }) {
    const result = await db.query(
      `INSERT INTO contacts_databases (contact_id, database_id)
       VALUES ($1, $2)
       RETURNING contact_id,
                 database_id,
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [contactId, databaseId]
    );

    return result.rows[0];
  }

  /** Find all contacts.
   *
   * Returns [{ id, name, image, type, phone, email, website, street1, street2, city, state, zip_code, country, country_code, notes, role, created_at, updated_at }, ...]
   **/
  static async getAll() {
    const result = await db.query(
      `SELECT id,
              name,
              image,
              type,
              phone,
              email,
              website,
              street1,
              street2,
              city,
              state,
              zip_code,
              country,
              country_code,
              notes,
              role,
              created_at,
              updated_at
       FROM contacts
       ORDER BY name`
    );

    return result.rows;
  }

  /** Get all contacts for a specific database.
   *
   * Returns [{ id, name, image, type, phone, email, website, street1, street2, city, state, zip_code, country, country_code, notes, role, created_at, updated_at }, ...]
   * Returns empty array if no contacts found.
   **/
  static async getByDatabaseId(databaseId) {
    const result = await db.query(
      `SELECT c.id,
              c.name,
              c.image,
              c.type,
              c.phone,
              c.email,
              c.website,
              c.street1,
              c.street2,
              c.city,
              c.state,
              c.zip_code,
              c.country,
              c.country_code,
              c.notes,
              c.role,
              c.created_at,
              c.updated_at
       FROM contacts c
       JOIN contacts_databases cd ON cd.contact_id = c.id
       WHERE cd.database_id = $1
       ORDER BY c.name`,
      [databaseId]
    );

    return result.rows;
  }

  /** Given a contact id, return data about contact.
   *
   * Returns { id, name, image, type, phone, email, website, street1, street2, city, state, zip_code, country, country_code, notes, role, created_at, updated_at }
   *
   * Throws NotFoundError if not found.
   **/
  static async get(id) {
    const result = await db.query(
      `SELECT id,
              name,
              image,
              type,
              phone,
              email,
              website,
              street1,
              street2,
              city,
              state,
              zip_code,
              country,
              country_code,
              notes,
              role,
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
   * Data can include: { name, image, type, phone, email, website, street1, street2, city, state, zip_code, country, country_code, notes, role }
   *
   * Returns { id, name, image, type, phone, email, website, street1, street2, city, state, zip_code, country, country_code, notes, role, created_at, updated_at }
   *
   * Throws NotFoundError if not found.
   */
  static async update(id, data) {
    const { setCols, values } = sqlForPartialUpdate(data, {
      zip_code: "zip_code",
      country_code: "country_code"
    });
    const idVarIdx = "$" + (values.length + 1);

    const querySql = `UPDATE contacts
                      SET ${setCols}
                      WHERE id = ${idVarIdx}
                      RETURNING id,
                                name,
                                image,
                                type,
                                phone,
                                email,
                                website,
                                street1,
                                street2,
                                city,
                                state,
                                zip_code,
                                country,
                                country_code,
                                notes,
                                role,
                                created_at,
                                updated_at`;
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

  /** Remove contact from all databases and then delete the contact.
   *
   * First removes all records from contacts_databases for this contact,
   * then deletes the contact itself by calling remove().
   *
   * Returns undefined.
   *
   * Throws NotFoundError if contact not found.
   **/
  static async removeWithDatabaseLinks(id) {
    // Remove all database associations
    await db.query(
      `DELETE FROM contacts_databases WHERE contact_id = $1`,
      [id]
    );

    // Then delete the contact using the existing remove function
    await this.remove(id);
  }
}

module.exports = Contact;
