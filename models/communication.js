"use strict";

const db = require("../db");
const { NotFoundError, BadRequestError } = require("../expressError");

const BARE_COLS = `id, account_id AS "accountId", template_id AS "templateId",
  subject, content, image_key AS "imageKey", recipient_mode AS "recipientMode",
  recipient_ids AS "recipientIds", delivery_channel AS "deliveryChannel",
  status, scheduled_at AS "scheduledAt", sent_at AS "sentAt",
  recipient_count AS "recipientCount", created_by AS "createdBy",
  created_at AS "createdAt", updated_at AS "updatedAt"`;

const COLS = `c.id, c.account_id AS "accountId", c.template_id AS "templateId",
  c.subject, c.content, c.image_key AS "imageKey", c.recipient_mode AS "recipientMode",
  c.recipient_ids AS "recipientIds", c.delivery_channel AS "deliveryChannel",
  c.status, c.scheduled_at AS "scheduledAt", c.sent_at AS "sentAt",
  c.recipient_count AS "recipientCount", c.created_by AS "createdBy",
  c.created_at AS "createdAt", c.updated_at AS "updatedAt"`;

class Communication {
  static async create(data) {
    const {
      account_id,
      template_id = null,
      subject,
      content = { body: "" },
      image_key = null,
      recipient_mode = null,
      recipient_ids = [],
      delivery_channel = "in_app",
      status = "draft",
      scheduled_at = null,
      created_by = null,
    } = data;

    if (!subject?.trim()) throw new BadRequestError("subject is required");

    const result = await db.query(
      `INSERT INTO communications
         (account_id, template_id, subject, content, image_key, recipient_mode, recipient_ids,
          delivery_channel, status, scheduled_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING ${BARE_COLS}`,
      [
        account_id,
        template_id,
        subject.trim(),
        JSON.stringify(content),
        image_key || null,
        recipient_mode,
        JSON.stringify(Array.isArray(recipient_ids) ? recipient_ids : []),
        ["email", "in_app", "both"].includes(delivery_channel) ? delivery_channel : "in_app",
        status,
        scheduled_at,
        created_by,
      ]
    );
    return result.rows[0];
  }

  static async getById(id) {
    const result = await db.query(
      `SELECT ${COLS}, u.name AS "createdByName"
       FROM communications c
       LEFT JOIN users u ON u.id = c.created_by
       WHERE c.id = $1`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundError(`Communication not found: ${id}`);
    return result.rows[0];
  }

  static async listForAccount(accountId, filters = {}) {
    const { status, limit = 100 } = filters;
    const conditions = ["c.account_id = $1"];
    const values = [accountId];
    let idx = 2;

    if (status) {
      conditions.push(`c.status = $${idx}`);
      values.push(status);
      idx++;
    }

    const where = conditions.join(" AND ");
    const result = await db.query(
      `SELECT ${COLS}, u.name AS "createdByName"
       FROM communications c
       LEFT JOIN users u ON u.id = c.created_by
       WHERE ${where}
       ORDER BY c.updated_at DESC
       LIMIT $${idx}`,
      [...values, limit]
    );
    return result.rows;
  }

  static async update(id, data) {
    const allowed = {
      template_id: "template_id",
      subject: "subject",
      content: "content",
      image_key: "image_key",
      recipient_mode: "recipient_mode",
      recipient_ids: "recipient_ids",
      delivery_channel: "delivery_channel",
      status: "status",
      scheduled_at: "scheduled_at",
      sent_at: "sent_at",
      recipient_count: "recipient_count",
    };

    const sets = [];
    const values = [];
    let idx = 1;

    for (const [key, col] of Object.entries(allowed)) {
      if (data[key] !== undefined) {
        let val = data[key];
        if (key === "content" && typeof val === "object") val = JSON.stringify(val);
        if (key === "recipient_ids") val = JSON.stringify(Array.isArray(val) ? val : []);
        sets.push(`${col} = $${idx}`);
        values.push(val);
        idx++;
      }
    }

    if (sets.length === 0) throw new BadRequestError("No data to update");

    sets.push("updated_at = NOW()");
    values.push(id);

    const result = await db.query(
      `UPDATE communications SET ${sets.join(", ")}
       WHERE id = $${idx}
       RETURNING ${BARE_COLS}`,
      values
    );
    if (!result.rows[0]) throw new NotFoundError(`Communication not found: ${id}`);
    return result.rows[0];
  }

  static async delete(id) {
    const result = await db.query(
      `DELETE FROM communications WHERE id = $1 RETURNING id`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundError(`Communication not found: ${id}`);
  }

  static async getScheduledReady() {
    const result = await db.query(
      `SELECT ${COLS}
       FROM communications c
       WHERE c.status = 'scheduled' AND c.scheduled_at <= NOW()
       ORDER BY c.scheduled_at`
    );
    return result.rows;
  }

  /** List communications sent to the given user (for Discover feed). */
  static async listForRecipient(userId, filters = {}) {
    const { limit = 50 } = filters;
    const result = await db.query(
      `SELECT c.id, c.subject, c.content, c.image_key AS "imageKey", c.sent_at AS "sentAt", c.account_id AS "accountId",
              u.name AS "createdByName"
       FROM communications c
       INNER JOIN comm_recipients cr ON cr.communication_id = c.id AND cr.user_id = $1
       LEFT JOIN users u ON u.id = c.created_by
       WHERE c.status = 'sent'
       ORDER BY c.sent_at DESC NULLS LAST
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }
}

module.exports = Communication;
