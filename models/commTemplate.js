"use strict";

const db = require("../db");
const { NotFoundError, BadRequestError } = require("../expressError");

const COLS = `id, account_id AS "accountId", name, logo_key AS "logoKey",
  primary_color AS "primaryColor", secondary_color AS "secondaryColor",
  footer_text AS "footerText", is_default AS "isDefault",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

class CommTemplate {
  static async getOrCreateDefault(accountId) {
    const existing = await db.query(
      `SELECT ${COLS} FROM comm_templates WHERE account_id = $1 AND is_default = true LIMIT 1`,
      [accountId]
    );
    if (existing.rows[0]) return existing.rows[0];

    const result = await db.query(
      `INSERT INTO comm_templates (account_id, name, is_default)
       VALUES ($1, 'Default', true)
       RETURNING ${COLS}`,
      [accountId]
    );
    return result.rows[0];
  }

  static async getById(id) {
    const result = await db.query(
      `SELECT ${COLS} FROM comm_templates WHERE id = $1`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundError(`Template not found: ${id}`);
    return result.rows[0];
  }

  static async listForAccount(accountId) {
    const result = await db.query(
      `SELECT ${COLS} FROM comm_templates WHERE account_id = $1 ORDER BY is_default DESC, name`,
      [accountId]
    );
    return result.rows;
  }

  static async update(id, data) {
    const allowed = ["name", "logo_key", "primary_color", "secondary_color", "footer_text"];
    const sets = [];
    const values = [];
    let idx = 1;

    for (const col of allowed) {
      const camel = col.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
      if (data[camel] !== undefined) {
        sets.push(`${col} = $${idx}`);
        values.push(data[camel]);
        idx++;
      }
    }

    if (sets.length === 0) throw new BadRequestError("No data to update");

    sets.push("updated_at = NOW()");
    values.push(id);

    const result = await db.query(
      `UPDATE comm_templates SET ${sets.join(", ")} WHERE id = $${idx} RETURNING ${COLS}`,
      values
    );
    if (!result.rows[0]) throw new NotFoundError(`Template not found: ${id}`);
    return result.rows[0];
  }
}

module.exports = CommTemplate;
