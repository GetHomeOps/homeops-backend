"use strict";

const db = require("../db");
const { BadRequestError, NotFoundError } = require("../expressError");

/* Model for maintenance records */
class MaintenanceRecord {

  /* Create a new maintenance record */
  static async create(maintenanceRecord) {
    const { property_id, system_key, completed_at, next_service_date, data = {}, status = "pending" } = maintenanceRecord;
    try {
      const result = await db.query(
        `INSERT INTO property_maintenance (
                  property_id,
                  system_key,
                  completed_at,
                  next_service_date,
                  data,
                  status)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id,
                  property_id,
                  system_key,
                  completed_at,
                  next_service_date,
                  data,
                  status`,
        [property_id, system_key, completed_at || null, next_service_date || null, JSON.stringify(data), status]
      );
      return result.rows[0];
    }
    catch (err) {
      throw new BadRequestError(err);
    }
  }

  /* Create multiple maintenance records */
  static async createMany(maintenanceRecords) {
    const created = await Promise.all(
      maintenanceRecords.map((record) => this.create(record))
    );
    return created;
  }

  /* Get maintenance records by property id */
  static async getByPropertyId(propertyId) {
    const result = await db.query(
      `SELECT id,
              property_id,
              system_key,
              completed_at,
              next_service_date,
              data,
              status
       FROM property_maintenance WHERE property_id = $1`,
      [propertyId]
    );
    return result.rows;
  }

  /* Get a maintenance record by recordid */
  static async getByRecordId(recordId) {
    const result = await db.query(
      `SELECT id,
              property_id,
              system_key,
              completed_at,
              next_service_date,
              data,
              status
       FROM property_maintenance WHERE id = $1`,
      [recordId]
    );
    const maintenanceRecord = result.rows[0];
    if (!maintenanceRecord) throw new NotFoundError(`No maintenance record with id: ${recordId}`);
    return maintenanceRecord;
  }

  /* Update a maintenance record */
  static async update(recordId, maintenanceRecord) {
    const { property_id, system_key, completed_at, next_service_date, data = {}, status } = maintenanceRecord;

    const result = await db.query(
      `UPDATE property_maintenance
     SET property_id = $1,
         system_key = $2,
         completed_at = $3,
         next_service_date = $4,
         data = $5,
         status = $6,
         updated_at = NOW()
     WHERE id = $7
     RETURNING id,
               property_id,
               system_key,
               completed_at,
               next_service_date,
               data,
               status,
               created_at,
               updated_at`,
      [
        property_id,
        system_key,
        completed_at || null,
        next_service_date || null,
        JSON.stringify(data),
        status || "pending",
        recordId,
      ]
    );

    const row = result.rows[0];
    if (!row) throw new NotFoundError(`No maintenance record with id: ${recordId}`);
    return row;
  }

  /* Delete a maintenance record */
  static async delete(recordId) {
    const result = await db.query(
      `DELETE FROM property_maintenance WHERE id = $1 RETURNING id`,
      [recordId]
    );
    if (result.rows.length === 0) {
      throw new NotFoundError(`No maintenance record with id: ${recordId}`);
    }
    return { deleted: recordId };
  }
}

module.exports = MaintenanceRecord;