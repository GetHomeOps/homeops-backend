"use strict";

/**
 * System Model
 *
 * Manages property systems in the `property_systems` table. Each system
 * represents a home component (HVAC, plumbing, etc.) with optional
 * next-service dates and JSONB data.
 *
 * Key operations:
 * - create: Add a system to a property
 * - get: List all systems for a property
 * - exists: Check if (property_id, system_key) exists
 * - update: Upsert system (create or update existing)
 */

const db = require("../db");
const { BadRequestError, NotFoundError } = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

class System {
  /** Create a new system for a property.
   *
   * Data should include: { property_id, system_key, data, next_service_date }
   *
   * Returns { id, property_id, system_key, data, next_service_date }
   **/
  static async create(propertyData) {
    const { property_id, system_key, data = {}, next_service_date, included = true } = propertyData;
    const hasDate = next_service_date != null && next_service_date !== "";
    const includedVal = included === undefined ? true : Boolean(included);

    if (hasDate) {
      const result = await db.query(
        `INSERT INTO property_systems (property_id, system_key, data, next_service_date, included)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, property_id, system_key, data, next_service_date, included`,
        [property_id, system_key, JSON.stringify(data), next_service_date, includedVal]
      );
      return result.rows[0];
    }

    const result = await db.query(
      `INSERT INTO property_systems (property_id, system_key, data, next_service_date, included)
       VALUES ($1, $2, $3, NULL, $4)
       RETURNING id, property_id, system_key, data, next_service_date, included`,
      [property_id, system_key, JSON.stringify(data), includedVal]
    );
    return result.rows[0];
  }

  /** Get all systems for a property.
   *
   * Returns { id, property_id, system_key, data, next_service_date }
   **/
  static async get(propertyId) {
    const result = await db.query(
      `SELECT * FROM property_systems
      WHERE property_id = $1`,
      [propertyId]
    );
    return result.rows;
  }

  /** Check if a system exists for a property. */
  static async exists(property_id, system_key) {
    const result = await db.query(
      `SELECT 1 FROM property_systems
       WHERE property_id = $1 AND system_key = $2`,
      [property_id, system_key]
    );
    return result.rows.length > 0;
  }

  /** Update a system for a property (used when system already exists). */
  static async _updateExisting({ property_id, system_key, data, next_service_date, included }) {
    const isDateNull = next_service_date === null || next_service_date === "";
    const updateData = {};
    if (data !== undefined) updateData.data = data;
    if (next_service_date !== undefined && !isDateNull) updateData.next_service_date = next_service_date;
    if (included !== undefined) updateData.included = included;
    let setCols, values;
    if (Object.keys(updateData).length === 0 && isDateNull) {
      setCols = "next_service_date = NULL";
      values = [];
    } else if (Object.keys(updateData).length === 0) {
      throw new BadRequestError("No data to update");
    } else {
      const res = sqlForPartialUpdate(updateData, { data: "data", next_service_date: "next_service_date" });
      setCols = isDateNull ? res.setCols + ", next_service_date = NULL" : res.setCols;
      values = res.values;
    }

    const propIdIdx = values.length + 1;
    const keyIdx = values.length + 2;
    const querySql = `UPDATE property_systems
                      SET ${setCols}
                      WHERE property_id = $${propIdIdx} AND system_key = $${keyIdx}
                      RETURNING id, property_id, system_key, data, next_service_date, included`;

    const result = await db.query(querySql, [...values, property_id, system_key]);
    return result.rows[0];
  }

  /** Upsert a system: update if it exists, create if it doesn't.
   *
   * Data should include: { property_id, system_key, data, next_service_date }
   *
   * Returns { id, property_id, system_key, data, next_service_date }
   **/
  static async update({ property_id, system_key, data, next_service_date = null, included = true }) {
    const exists = await this.exists(property_id, system_key);

    if (exists) {
      const system = await this._updateExisting({ property_id, system_key, data, next_service_date, included });
      if (!system) throw new NotFoundError(`No system found for property: ${property_id} and system: ${system_key}`);
      return system;
    }

    const dateVal = next_service_date === "" || next_service_date == null ? null : next_service_date;
    return this.create({
      property_id,
      system_key,
      data: data !== undefined ? data : {},
      next_service_date: dateVal,
      included,
    });
  }
}

module.exports = System;