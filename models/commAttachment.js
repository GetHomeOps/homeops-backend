"use strict";

const db = require("../db");
const { NotFoundError } = require("../expressError");

const COLS = `id, communication_id AS "communicationId", type, file_key AS "fileKey",
  url, filename, sort_order AS "sortOrder", created_at AS "createdAt"`;

class CommAttachment {
  static async create(data) {
    const { communication_id, type, file_key = null, url = null, filename = null, sort_order = 0 } = data;
    const result = await db.query(
      `INSERT INTO comm_attachments (communication_id, type, file_key, url, filename, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING ${COLS}`,
      [communication_id, type, file_key, url, filename, sort_order]
    );
    return result.rows[0];
  }

  static async listForComm(communicationId) {
    const result = await db.query(
      `SELECT ${COLS} FROM comm_attachments WHERE communication_id = $1 ORDER BY sort_order, id`,
      [communicationId]
    );
    return result.rows;
  }

  static async delete(id) {
    const result = await db.query(
      `DELETE FROM comm_attachments WHERE id = $1 RETURNING id, file_key AS "fileKey"`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundError(`Attachment not found: ${id}`);
    return result.rows[0];
  }

  static async syncForComm(communicationId, attachments = []) {
    await db.query(`DELETE FROM comm_attachments WHERE communication_id = $1`, [communicationId]);
    const rows = [];
    for (let i = 0; i < attachments.length; i++) {
      const a = attachments[i];
      const r = await db.query(
        `INSERT INTO comm_attachments (communication_id, type, file_key, url, filename, sort_order)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING ${COLS}`,
        [communicationId, a.type, a.fileKey || null, a.url || null, a.filename || null, i]
      );
      rows.push(r.rows[0]);
    }
    return rows;
  }
}

module.exports = CommAttachment;
