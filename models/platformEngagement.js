"use strict";

/**
 * PlatformEngagement Model
 *
 * Tracks user engagement events in the `platform_engagement_events` table.
 * Records actions like login, page_view, property_created for analytics.
 *
 * Key operations:
 * - logEvent: Record an engagement event (validates event type)
 * - get / getAll: Retrieve events with optional filters
 * - getCountsByType: Aggregate counts by event type
 * - getDailyTrend: Daily event counts for charts
 */

const db = require("../db");
const { NotFoundError, BadRequestError } = require("../expressError");

/** Valid event types for platform engagement tracking. */
const VALID_EVENT_TYPES = [
  "login",
  "mfa_enabled",
  "mfa_disabled",
  "mfa_success",
  "mfa_failure",
  "page_view",
  "property_created",
  "property_updated",
  "maintenance_logged",
  "document_uploaded",
  "user_invited",
  "system_added",
  "subscription_created",
  "subscription_updated",
];

/** Model for platform engagement event operations (platform_engagement_events table). */
class PlatformEngagement {

  /** Log a new engagement event.
   *
   * Data should include:
   *   { userId, eventType, eventData (optional JSONB) }
   *
   * Returns { id, userId, eventType, eventData, createdAt }
   *
   * Throws BadRequestError if required fields are missing or eventType is invalid.
   */
  static async logEvent({ userId, eventType, eventData = {} }) {
    if (!userId || !eventType) {
      throw new BadRequestError("userId and eventType are required.");
    }

    if (!VALID_EVENT_TYPES.includes(eventType)) {
      throw new BadRequestError(
        `Invalid eventType "${eventType}". Valid types: ${VALID_EVENT_TYPES.join(", ")}`
      );
    }

    const result = await db.query(
      `INSERT INTO platform_engagement_events
              (user_id, event_type, event_data)
       VALUES ($1, $2, $3)
       RETURNING id,
                 user_id    AS "userId",
                 event_type AS "eventType",
                 event_data AS "eventData",
                 created_at AS "createdAt"`,
      [userId, eventType, JSON.stringify(eventData)]
    );

    return result.rows[0];
  }

  /** Get a single engagement event by id.
   *
   * Returns { id, userId, eventType, eventData, createdAt }
   *
   * Throws NotFoundError if not found.
   */
  static async get(id) {
    const result = await db.query(
      `SELECT id,
              user_id    AS "userId",
              event_type AS "eventType",
              event_data AS "eventData",
              created_at AS "createdAt"
       FROM platform_engagement_events
       WHERE id = $1`,
      [id]
    );

    const event = result.rows[0];
    if (!event) throw new NotFoundError(`No engagement event with id: ${id}`);

    return event;
  }

  /** Get engagement events with optional filters.
   *
   * Accepted filters (all optional):
   *   - userId:    filter by user_id
   *   - eventType: filter by event_type
   *   - startDate: only events on or after this date (ISO string)
   *   - endDate:   only events on or before this date (ISO string)
   *   - limit:     max rows (default 100)
   *   - offset:    pagination offset (default 0)
   *
   * Returns [{ id, userId, eventType, eventData, createdAt }, ...]
   */
  static async getAll({ userId, eventType, startDate, endDate, limit = 100, offset = 0 } = {}) {
    const clauses = [];
    const values = [];

    if (userId) {
      values.push(userId);
      clauses.push(`user_id = $${values.length}`);
    }
    if (eventType) {
      values.push(eventType);
      clauses.push(`event_type = $${values.length}`);
    }
    if (startDate) {
      values.push(startDate);
      clauses.push(`created_at >= $${values.length}`);
    }
    if (endDate) {
      values.push(endDate);
      clauses.push(`created_at <= $${values.length}`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    values.push(Math.min(limit, 1000)); // cap at 1000
    const limitIdx = values.length;
    values.push(offset);
    const offsetIdx = values.length;

    const result = await db.query(
      `SELECT id,
              user_id    AS "userId",
              event_type AS "eventType",
              event_data AS "eventData",
              created_at AS "createdAt"
       FROM platform_engagement_events
       ${where}
       ORDER BY created_at DESC
       LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
      values
    );

    return result.rows;
  }

  /** Get aggregated event counts grouped by event_type.
   *
   * Accepted filters (all optional):
   *   - startDate: only events on or after this date (inclusive)
   *   - endDate:   only events on or before this date (inclusive)
   *   - userIds:   only events for these user ids (array of numbers)
   *
   * Returns [{ eventType, count }, ...]
   */
  static async getCountsByType({ startDate, endDate, userIds } = {}) {
    const clauses = [];
    const values = [];

    if (startDate) {
      values.push(startDate);
      clauses.push(`created_at::date >= $${values.length}::date`);
    }
    if (endDate) {
      values.push(endDate);
      clauses.push(`created_at::date <= $${values.length}::date`);
    }
    if (userIds?.length) {
      values.push(userIds);
      clauses.push(`user_id = ANY($${values.length}::int[])`);
    }

    const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";

    const result = await db.query(
      `SELECT event_type AS "eventType",
              COUNT(*)::int AS count
       FROM platform_engagement_events
       ${where}
       GROUP BY event_type
       ORDER BY count DESC`,
      values
    );

    return result.rows;
  }

  /** Get daily event counts for a given period.
   *
   * Accepted filters (all optional):
   *   - startDate: only events on or after this date (default: 30 days ago), inclusive
   *   - endDate:   only events on or before this date (default: now), inclusive
   *   - eventType: filter by event_type
   *   - userIds:   only events for these user ids (array of numbers)
   *
   * Returns [{ date, count }, ...]
   */
  static async getDailyTrend({ startDate, endDate, eventType, userIds } = {}) {
    const clauses = [];
    const values = [];

    const defaultStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const startStr = startDate || defaultStart.toISOString().slice(0, 10);
    values.push(startStr);
    clauses.push(`created_at::date >= $${values.length}::date`);

    if (endDate) {
      values.push(endDate);
      clauses.push(`created_at::date <= $${values.length}::date`);
    }
    if (eventType) {
      values.push(eventType);
      clauses.push(`event_type = $${values.length}`);
    }
    if (userIds?.length) {
      values.push(userIds);
      clauses.push(`user_id = ANY($${values.length}::int[])`);
    }

    const where = `WHERE ${clauses.join(" AND ")}`;

    const result = await db.query(
      `SELECT DATE(created_at) AS date,
              COUNT(*)::int AS count
       FROM platform_engagement_events
       ${where}
       GROUP BY DATE(created_at)
       ORDER BY date ASC`,
      values
    );

    return result.rows;
  }
}

module.exports = PlatformEngagement;
