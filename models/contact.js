"use strict";

/**
 * Contact Model
 *
 * Manages contacts in the `contacts` table. Contacts represent people or
 * organizations (e.g., vendors, tenants) and can be linked to accounts.
 * Tags are many-to-many via contact_tags.
 *
 * Key operations:
 * - create / get / getAll: CRUD for contacts
 * - addToAccount: Associate contact with an account
 * - getByAccountId: List contacts for a given account
 * - removeWithAccountLinks: Delete contact and all account associations
 */

const db = require("../db.js");
const { NotFoundError } = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

const TAGS_SUBQUERY = `COALESCE(
  (SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color))
   FROM contact_tags ct
   JOIN tags t ON t.id = ct.tag_id
   WHERE ct.contact_id = c.id),
  '[]'::json
)`;

class Contact {
  /** Sync contact_tags for a contact. Replaces existing assignments. */
  static async _syncContactTags(contactId, tagIds) {
    await db.query(
      `DELETE FROM contact_tags WHERE contact_id = $1`,
      [contactId]
    );
    const ids = Array.isArray(tagIds) ? tagIds.filter((id) => id != null) : [];
    if (ids.length === 0) return;
    const values = ids.map((_, i) => `($1, $${i + 2})`).join(", ");
    await db.query(
      `INSERT INTO contact_tags (contact_id, tag_id) VALUES ${values}`,
      [contactId, ...ids]
    );
  }

  /** Create a contact (from data), update db, return new contact data.
   *
   * data should be { name (required), image, type, phone, email, website, street1, street2, city, state, zip_code, country, country_code, notes, role, tagIds? }
   *
   * Returns contact with tags array.
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
      role = null,
      tagIds,
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

    const contact = result.rows[0];
    await this._syncContactTags(contact.id, tagIds);
    contact.tags = await this._getTagsForContact(contact.id);
    return contact;
  }

  /** Get tags array for a contact. */
  static async _getTagsForContact(contactId) {
    const res = await db.query(
      `SELECT t.id, t.name, t.color
       FROM contact_tags ct
       JOIN tags t ON t.id = ct.tag_id
       WHERE ct.contact_id = $1
       ORDER BY t.name`,
      [contactId]
    );
    return res.rows;
  }

  /** Add a contact to an account.
   *
   * Data: { contactId, accountId }
   *
   * Returns { contact_id, account_id, createdAt, updatedAt }
   **/
  static async addToAccount({ contactId, accountId }) {
    const result = await db.query(
      `INSERT INTO account_contacts (contact_id, account_id)
       VALUES ($1, $2)
       RETURNING contact_id,
                 account_id,
                 created_at AS "createdAt",
                 updated_at AS "updatedAt"`,
      [contactId, accountId]
    );

    return result.rows[0];
  }

  /** Find all contacts with tags. */
  static async getAll() {
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
              c.updated_at,
              ${TAGS_SUBQUERY} AS tags
       FROM contacts c
       ORDER BY c.name`
    );
    return result.rows.map((r) => ({ ...r, tags: r.tags || [] }));
  }

  /** Get all contacts for a specific account with tags. */
  static async getByAccountId(accountId) {
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
              c.updated_at,
              ${TAGS_SUBQUERY} AS tags
       FROM contacts c
       JOIN account_contacts ac ON ac.contact_id = c.id
       WHERE ac.account_id = $1
       ORDER BY c.name`,
      [accountId]
    );
    return result.rows.map((r) => ({ ...r, tags: r.tags || [] }));
  }

  /** Given a contact id, return data about contact with tags. */
  static async get(id) {
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
              c.updated_at,
              ${TAGS_SUBQUERY} AS tags
       FROM contacts c
       WHERE c.id = $1`,
      [id]
    );

    const contact = result.rows[0];
    if (!contact) throw new NotFoundError(`No contact: ${id}`);
    contact.tags = contact.tags || [];
    return contact;
  }

  /** Update contact data with `data`.
   *
   * Data can include: { name, image, type, phone, email, website, street1, street2, city, state, zip_code, country, country_code, notes, role, tagIds }
   * tagIds replaces contact_tags.
   *
   * Returns contact with tags array.
   */
  static async update(id, data) {
    const { tagIds } = data;
    const updateData = { ...data };
    delete updateData.tagIds;

    const keys = Object.keys(updateData);
    if (keys.length > 0) {
      const { setCols, values } = sqlForPartialUpdate(updateData, {
        zip_code: "zip_code",
        country_code: "country_code",
      });
      const idVarIdx = "$" + (values.length + 1);
      await db.query(
        `UPDATE contacts SET ${setCols} WHERE id = ${idVarIdx}`,
        [...values, id]
      );
    }

    if (tagIds !== undefined) {
      await this._syncContactTags(id, tagIds);
    }

    return this.get(id);
  }

  /** Find a contact by email within a specific account. */
  static async getByEmailAndAccount(email, accountId) {
    const result = await db.query(
      `SELECT c.id, c.name, c.email
       FROM contacts c
       JOIN account_contacts ac ON ac.contact_id = c.id
       WHERE c.email = $1 AND ac.account_id = $2
       LIMIT 1`,
      [email, accountId]
    );
    return result.rows[0] || null;
  }

  /** Delete given contact from database. */
  static async remove(id) {
    const result = await db.query(
      `DELETE FROM contacts WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundError(`No contact: ${id}`);
  }

  /** Remove contact from all accounts and then delete the contact. */
  static async removeWithAccountLinks(id) {
    await db.query(
      `DELETE FROM account_contacts WHERE contact_id = $1`,
      [id]
    );
    await db.query(`DELETE FROM contact_tags WHERE contact_id = $1`, [id]);
    await this.remove(id);
  }
}

module.exports = Contact;
