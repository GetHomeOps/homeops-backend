"use strict";

const db = require("../db");
const { BadRequestError, NotFoundError } = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

const COLUMNS = `
  id, property_id, system_key, system_name,
  contractor_id, contractor_source, contractor_name,
  scheduled_date, scheduled_time,
  recurrence_type, recurrence_interval_value, recurrence_interval_unit,
  alert_timing, alert_custom_days, email_reminder,
  message_enabled, message_body,
  status, timezone, created_by,
  created_at, updated_at`;

class MaintenanceEvent {

  static async create(data) {
    const {
      property_id, system_key, system_name,
      contractor_id = null, contractor_source = null, contractor_name = null,
      scheduled_date, scheduled_time = null,
      recurrence_type = "one-time", recurrence_interval_value = null, recurrence_interval_unit = null,
      alert_timing = "3d", alert_custom_days = null, email_reminder = false,
      message_enabled = false, message_body = null,
      status = "scheduled", timezone = null, created_by = null,
    } = data;

    const result = await db.query(
      `INSERT INTO maintenance_events
         (property_id, system_key, system_name,
          contractor_id, contractor_source, contractor_name,
          scheduled_date, scheduled_time,
          recurrence_type, recurrence_interval_value, recurrence_interval_unit,
          alert_timing, alert_custom_days, email_reminder,
          message_enabled, message_body,
          status, timezone, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
       RETURNING ${COLUMNS}`,
      [
        property_id, system_key, system_name || null,
        contractor_id, contractor_source, contractor_name,
        scheduled_date, scheduled_time,
        recurrence_type, recurrence_interval_value, recurrence_interval_unit,
        alert_timing, alert_custom_days, email_reminder,
        message_enabled, message_body,
        status, timezone, created_by,
      ],
    );
    return result.rows[0];
  }

  static async getByPropertyId(propertyId) {
    const result = await db.query(
      `SELECT ${COLUMNS}
       FROM maintenance_events
       WHERE property_id = $1
       ORDER BY scheduled_date ASC, scheduled_time ASC NULLS LAST`,
      [propertyId],
    );
    return result.rows;
  }

  static async getById(id) {
    const result = await db.query(
      `SELECT ${COLUMNS} FROM maintenance_events WHERE id = $1`,
      [id],
    );
    const event = result.rows[0];
    if (!event) throw new NotFoundError(`No maintenance event: ${id}`);
    return event;
  }

  static async update(id, data) {
    const jsToSql = {
      property_id: "property_id",
      system_key: "system_key",
      system_name: "system_name",
      contractor_id: "contractor_id",
      contractor_source: "contractor_source",
      contractor_name: "contractor_name",
      scheduled_date: "scheduled_date",
      scheduled_time: "scheduled_time",
      recurrence_type: "recurrence_type",
      recurrence_interval_value: "recurrence_interval_value",
      recurrence_interval_unit: "recurrence_interval_unit",
      alert_timing: "alert_timing",
      alert_custom_days: "alert_custom_days",
      email_reminder: "email_reminder",
      message_enabled: "message_enabled",
      message_body: "message_body",
      status: "status",
      timezone: "timezone",
    };

    const { setCols, values } = sqlForPartialUpdate(data, jsToSql);
    const idx = "$" + (values.length + 1);

    const result = await db.query(
      `UPDATE maintenance_events
       SET ${setCols}, updated_at = NOW()
       WHERE id = ${idx}
       RETURNING ${COLUMNS}`,
      [...values, id],
    );
    const event = result.rows[0];
    if (!event) throw new NotFoundError(`No maintenance event: ${id}`);
    return event;
  }

  static async delete(id) {
    const result = await db.query(
      `DELETE FROM maintenance_events WHERE id = $1 RETURNING id`,
      [id],
    );
    if (!result.rows[0]) throw new NotFoundError(`No maintenance event: ${id}`);
  }

  /** Get upcoming maintenance events for a user (across all their properties).
   * Returns events with scheduled_date >= today and status = 'scheduled'.
   * Also includes property_systems with next_service_date >= today as inspection reminders.
   */
  static async getUpcomingForUser(userId) {
    const today = new Date().toISOString().slice(0, 10);

    const eventsResult = await db.query(
      `SELECT me.id, me.property_id, me.system_key, me.system_name,
              me.scheduled_date, me.scheduled_time, me.status,
              p.property_uid, p.property_name, p.address, p.city, p.state
       FROM maintenance_events me
       JOIN properties p ON p.id = me.property_id
       JOIN property_users pu ON pu.property_id = me.property_id
       WHERE pu.user_id = $1
         AND me.scheduled_date >= $2
         AND me.status = 'scheduled'
       ORDER BY me.scheduled_date ASC, me.scheduled_time ASC NULLS LAST`,
      [userId, today],
    );

    const systemsResult = await db.query(
      `SELECT ps.id, ps.property_id, ps.system_key, ps.next_service_date,
              p.property_uid, p.property_name, p.address, p.city, p.state
       FROM property_systems ps
       JOIN properties p ON p.id = ps.property_id
       JOIN property_users pu ON pu.property_id = ps.property_id
       WHERE pu.user_id = $1
         AND ps.next_service_date >= $2
         AND ps.next_service_date IS NOT NULL
       ORDER BY ps.next_service_date ASC`,
      [userId, today],
    );

    const SYSTEM_LABELS = {
      roof: "Roof",
      gutters: "Gutters",
      foundation: "Foundation",
      exterior: "Exterior",
      windows: "Windows",
      heating: "Heating",
      ac: "Air Conditioning",
      waterHeating: "Water Heating",
      electrical: "Electrical",
      plumbing: "Plumbing",
      safety: "Safety",
      inspections: "Inspections",
    };

    const toDateKey = (d) => {
      if (d == null) return "";
      const date = d instanceof Date ? d : new Date(d);
      return date.toISOString().slice(0, 10);
    };

    const maintenanceEvents = eventsResult.rows.map((r) => ({
      type: "maintenance",
      id: r.id,
      propertyId: r.property_id,
      propertyUid: r.property_uid,
      propertyName: r.property_name,
      address: [r.address, r.city, r.state].filter(Boolean).join(", "),
      systemKey: r.system_key,
      systemName: r.system_name || SYSTEM_LABELS[r.system_key] || r.system_key,
      scheduledDate: r.scheduled_date,
      scheduledTime: r.scheduled_time,
      status: r.status,
    }));

    const maintenanceKeys = new Set(
      maintenanceEvents.map((e) => `${e.propertyId}-${e.systemKey}-${toDateKey(e.scheduledDate)}`),
    );

    const inspectionEvents = systemsResult.rows
      .filter((r) => !maintenanceKeys.has(`${r.property_id}-${r.system_key}-${toDateKey(r.next_service_date)}`))
      .map((r) => ({
        type: "inspection",
        id: `system-${r.property_id}-${r.system_key}`,
        propertyId: r.property_id,
        propertyUid: r.property_uid,
        propertyName: r.property_name,
        address: [r.address, r.city, r.state].filter(Boolean).join(", "),
        systemKey: r.system_key,
        systemName: SYSTEM_LABELS[r.system_key] || r.system_key,
        scheduledDate: r.next_service_date,
        scheduledTime: null,
        status: "due",
      }));

    const combined = [...maintenanceEvents, ...inspectionEvents].sort(
      (a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate),
    );

    return combined.slice(0, 20);
  }

  /** Get calendar events (maintenance + inspections) for a user in a date range.
   * Used by the Calendar page to display all scheduled events in a month.
   */
  static async getCalendarEventsForUser(userId, startDate, endDate) {
    const eventsResult = await db.query(
      `SELECT me.id, me.property_id, me.system_key, me.system_name,
              me.contractor_name, me.message_body, me.recurrence_type,
              me.scheduled_date, me.scheduled_time, me.status,
              p.property_uid, p.property_name, p.address, p.city, p.state
       FROM maintenance_events me
       JOIN properties p ON p.id = me.property_id
       JOIN property_users pu ON pu.property_id = me.property_id
       WHERE pu.user_id = $1
         AND me.scheduled_date >= $2
         AND me.scheduled_date <= $3
       ORDER BY me.scheduled_date ASC, me.scheduled_time ASC NULLS LAST`,
      [userId, startDate, endDate],
    );

    const systemsResult = await db.query(
      `SELECT ps.id, ps.property_id, ps.system_key, ps.next_service_date,
              p.property_uid, p.property_name, p.address, p.city, p.state
       FROM property_systems ps
       JOIN properties p ON p.id = ps.property_id
       JOIN property_users pu ON pu.property_id = ps.property_id
       WHERE pu.user_id = $1
         AND ps.next_service_date >= $2
         AND ps.next_service_date <= $3
         AND ps.next_service_date IS NOT NULL
       ORDER BY ps.next_service_date ASC`,
      [userId, startDate, endDate],
    );

    const SYSTEM_LABELS = {
      roof: "Roof",
      gutters: "Gutters",
      foundation: "Foundation",
      exterior: "Exterior",
      windows: "Windows",
      heating: "Heating",
      ac: "Air Conditioning",
      waterHeating: "Water Heating",
      electrical: "Electrical",
      plumbing: "Plumbing",
      safety: "Safety",
      inspections: "Inspections",
    };

    const toDateKey = (d) => {
      if (d == null) return "";
      const date = d instanceof Date ? d : new Date(d);
      return date.toISOString().slice(0, 10);
    };

    const maintenanceEvents = eventsResult.rows.map((r) => ({
      type: "maintenance",
      id: r.id,
      propertyId: r.property_id,
      propertyUid: r.property_uid,
      propertyName: r.property_name,
      address: [r.address, r.city, r.state].filter(Boolean).join(", "),
      systemKey: r.system_key,
      systemName: r.system_name || SYSTEM_LABELS[r.system_key] || r.system_key,
      contractorName: r.contractor_name,
      notes: r.message_body,
      scheduledDate: r.scheduled_date,
      scheduledTime: r.scheduled_time,
      status: r.status,
      recurrenceType: r.recurrence_type,
    }));

    const maintenanceKeys = new Set(
      maintenanceEvents.map((e) => `${e.propertyId}-${e.systemKey}-${toDateKey(e.scheduledDate)}`),
    );

    const inspectionEvents = systemsResult.rows
      .filter((r) => !maintenanceKeys.has(`${r.property_id}-${r.system_key}-${toDateKey(r.next_service_date)}`))
      .map((r) => ({
        type: "inspection",
        id: `system-${r.property_id}-${r.system_key}`,
        propertyId: r.property_id,
        propertyUid: r.property_uid,
        propertyName: r.property_name,
        address: [r.address, r.city, r.state].filter(Boolean).join(", "),
        systemKey: r.system_key,
        systemName: SYSTEM_LABELS[r.system_key] || r.system_key,
        contractorName: null,
        notes: null,
        scheduledDate: r.next_service_date,
        scheduledTime: null,
        status: "due",
        recurrenceType: null,
      }));

    return [...maintenanceEvents, ...inspectionEvents].sort(
      (a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate),
    );
  }
}

module.exports = MaintenanceEvent;
