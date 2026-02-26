"use strict";

const db = require("../db");
const { NotFoundError, BadRequestError } = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

const COLS = `id, subject, type, recipient_mode AS "recipientMode", recipient_ids AS "recipientIds",
  content_format AS "contentFormat", body_text AS "bodyText", url, image_key AS "imageKey",
  pdf_key AS "pdfKey", delivery_channel AS "deliveryChannel", auto_send_triggers AS "autoSendTriggers",
  auto_send_enabled AS "autoSendEnabled", status, created_by AS "createdBy", sent_at AS "sentAt",
  recipient_count AS "recipientCount", created_at AS "createdAt", updated_at AS "updatedAt"`;

class Resource {
  static async create(data) {
    const {
      subject,
      type = "post",
      recipient_mode = null,
      recipient_ids = [],
      content_format = "text",
      body_text = null,
      url = null,
      image_key = null,
      pdf_key = null,
      delivery_channel = "both",
      auto_send_triggers = [],
      auto_send_enabled = false,
      status = "draft",
      created_by = null,
    } = data;

    if (!subject?.trim()) throw new BadRequestError("subject is required");

    const result = await db.query(
      `INSERT INTO resources
         (subject, type, recipient_mode, recipient_ids, content_format, body_text, url, image_key, pdf_key, delivery_channel, auto_send_triggers, auto_send_enabled, status, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
       RETURNING ${COLS}`,
      [
        subject.trim(),
        type || "post",
        recipient_mode || null,
        JSON.stringify(Array.isArray(recipient_ids) ? recipient_ids : []),
        content_format || "text",
        body_text?.trim() || null,
        url?.trim() || null,
        image_key?.trim() || null,
        pdf_key?.trim() || null,
        ["email", "in_app", "both"].includes(delivery_channel) ? delivery_channel : "both",
        JSON.stringify(Array.isArray(auto_send_triggers) ? auto_send_triggers : []),
        Boolean(auto_send_enabled),
        status || "draft",
        created_by || null,
      ],
    );
    return result.rows[0];
  }

  static async getById(id) {
    const result = await db.query(
      `SELECT r.id, r.subject, r.type, r.recipient_mode AS "recipientMode", r.recipient_ids AS "recipientIds",
              r.content_format AS "contentFormat", r.body_text AS "bodyText", r.url, r.image_key AS "imageKey",
              r.pdf_key AS "pdfKey", r.delivery_channel AS "deliveryChannel", r.auto_send_triggers AS "autoSendTriggers",
              r.auto_send_enabled AS "autoSendEnabled", r.status, r.created_by AS "createdBy", r.sent_at AS "sentAt",
              r.recipient_count AS "recipientCount", r.created_at AS "createdAt", r.updated_at AS "updatedAt",
              u.name AS "createdByName"
       FROM resources r
       LEFT JOIN users u ON u.id = r.created_by
       WHERE r.id = $1`,
      [id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError(`Resource not found: ${id}`);
    return row;
  }

  static async listSent(filters = {}) {
    const { limit = 50 } = filters;
    const result = await db.query(
      `SELECT r.id, r.subject, r.type, r.content_format AS "contentFormat", r.body_text AS "bodyText",
              r.url, r.image_key AS "imageKey", r.pdf_key AS "pdfKey", r.sent_at AS "sentAt"
       FROM resources r
       WHERE r.status = 'sent'
       ORDER BY r.sent_at DESC NULLS LAST
       LIMIT $1`,
      [limit],
    );
    return result.rows;
  }

  static async listAll(filters = {}) {
    const { status, limit = 100 } = filters;
    const conditions = [];
    const values = [];
    let idx = 1;

    if (status) {
      conditions.push(`r.status = $${idx}`);
      values.push(status);
      idx++;
    }

    const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
    const result = await db.query(
      `SELECT r.id, r.subject, r.type, r.status, r.sent_at AS "sentAt", r.recipient_count AS "recipientCount",
              r.created_at AS "createdAt", u.name AS "createdByName"
       FROM resources r
       LEFT JOIN users u ON u.id = r.created_by
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${idx}`,
      [...values, limit],
    );
    return result.rows;
  }

  static async update(id, data) {
    const jsToSql = {
      subject: "subject",
      type: "type",
      recipient_mode: "recipient_mode",
      recipient_ids: "recipient_ids",
      content_format: "content_format",
      body_text: "body_text",
      url: "url",
      image_key: "image_key",
      pdf_key: "pdf_key",
      delivery_channel: "delivery_channel",
      auto_send_triggers: "auto_send_triggers",
      auto_send_enabled: "auto_send_enabled",
      status: "status",
      sent_at: "sent_at",
      recipient_count: "recipient_count",
    };
    const dataToUpdate = { ...data };
    if (dataToUpdate.recipient_ids !== undefined) {
      dataToUpdate.recipient_ids = JSON.stringify(Array.isArray(dataToUpdate.recipient_ids) ? dataToUpdate.recipient_ids : []);
    }
    if (dataToUpdate.auto_send_triggers !== undefined) {
      dataToUpdate.auto_send_triggers = JSON.stringify(Array.isArray(dataToUpdate.auto_send_triggers) ? dataToUpdate.auto_send_triggers : []);
    }
    const { setCols, values } = sqlForPartialUpdate(dataToUpdate, jsToSql);
    const idx = "$" + (values.length + 1);

    const result = await db.query(
      `UPDATE resources SET ${setCols}, updated_at = NOW()
       WHERE id = ${idx}
       RETURNING ${COLS}`,
      [...values, id],
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError(`Resource not found: ${id}`);
    return row;
  }

  static async delete(id) {
    const result = await db.query(
      `DELETE FROM resources WHERE id = $1 RETURNING id`,
      [id],
    );
    if (!result.rows[0]) throw new NotFoundError(`Resource not found: ${id}`);
  }
}

module.exports = Resource;
