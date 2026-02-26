"use strict";

const db = require("../db");
const { NotFoundError } = require("../expressError");

class Notification {
  /** Create a notification for a user */
  static async create(data) {
    const { userId, type = "resource_sent", resourceId, title } = data;
    const result = await db.query(
      `INSERT INTO notifications (user_id, type, resource_id, title)
       VALUES ($1, $2, $3, $4)
       RETURNING id, user_id AS "userId", type, resource_id AS "resourceId", title, read_at AS "readAt", created_at AS "createdAt"`,
      [userId, type, resourceId || null, title || null]
    );
    return result.rows[0];
  }

  /** Create notifications for multiple users (e.g. when resource is sent) */
  static async createForUsers(userIds, data) {
    if (!userIds?.length) return [];
    const { type = "resource_sent", resourceId, title } = data;
    const rows = [];
    for (const userId of userIds) {
      const r = await db.query(
        `INSERT INTO notifications (user_id, type, resource_id, title)
         VALUES ($1, $2, $3, $4)
         RETURNING id, user_id AS "userId", type, resource_id AS "resourceId", title, read_at AS "readAt", created_at AS "createdAt"`,
        [userId, type, resourceId || null, title || null]
      );
      rows.push(r.rows[0]);
    }
    return rows;
  }

  /** List notifications for a user (unread first, then by date) */
  static async listForUser(userId, { limit = 20 } = {}) {
    const result = await db.query(
      `SELECT n.id, n.user_id AS "userId", n.type, n.resource_id AS "resourceId", n.title, n.read_at AS "readAt", n.created_at AS "createdAt",
              r.subject AS "resourceSubject", r.type AS "resourceType"
       FROM notifications n
       LEFT JOIN resources r ON r.id = n.resource_id
       WHERE n.user_id = $1
       ORDER BY n.read_at IS NULL DESC, n.created_at DESC
       LIMIT $2`,
      [userId, limit]
    );
    return result.rows;
  }

  /** Count unread for user */
  static async countUnread(userId) {
    const result = await db.query(
      `SELECT COUNT(*)::int AS count FROM notifications WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
    return result.rows[0].count;
  }

  /** Mark notification as read */
  static async markRead(id, userId) {
    const result = await db.query(
      `UPDATE notifications SET read_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId]
    );
    if (!result.rows[0]) throw new NotFoundError(`Notification not found: ${id}`);
    return result.rows[0];
  }

  /** Mark all as read for user */
  static async markAllRead(userId) {
    await db.query(
      `UPDATE notifications SET read_at = NOW() WHERE user_id = $1 AND read_at IS NULL`,
      [userId]
    );
  }
}

module.exports = Notification;
