"use strict";

/**
 * Tag Model
 *
 * Account-scoped tags for contacts. Many-to-many with contacts via contact_tags.
 */

const db = require("../db.js");
const { NotFoundError } = require("../expressError");

class Tag {
  /** Create a tag for an account.
   *  data: { accountId, name, color? }
   *  Returns { id, account_id, name, color, created_at }
   */
  static async create({ accountId, name, color = null }) {
    const result = await db.query(
      `INSERT INTO tags (account_id, name, color)
       VALUES ($1, $2, $3)
       ON CONFLICT (account_id, name) DO UPDATE SET color = EXCLUDED.color
       RETURNING id, account_id, name, color, created_at`,
      [accountId, name.trim(), color]
    );
    return result.rows[0];
  }

  /** Get all tags for an account. */
  static async getByAccountId(accountId) {
    const result = await db.query(
      `SELECT id, account_id, name, color, created_at
       FROM tags
       WHERE account_id = $1
       ORDER BY name`,
      [accountId]
    );
    return result.rows;
  }

  /** Get a single tag by id. */
  static async get(id) {
    const result = await db.query(
      `SELECT id, account_id, name, color, created_at
       FROM tags WHERE id = $1`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundError(`No tag: ${id}`);
    return result.rows[0];
  }

  /** Delete a tag. */
  static async remove(id) {
    const result = await db.query(
      `DELETE FROM tags WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundError(`No tag: ${id}`);
  }
}

module.exports = Tag;
