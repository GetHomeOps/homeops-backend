"use strict";

const db = require("../db");
const { BadRequestError, NotFoundError } = require("../expressError");

class PropertyDocument {
  /** Create a new property document.
   *
   * Data should include:
   *   { property_id, document_name, document_date, document_key, document_type, system_key }
   *
   * Returns the created document row.
   */
  static async create(data) {
    const { property_id, document_name, document_date, document_key, document_type, system_key } = data;

    if (!property_id || !document_name || !document_date || !document_key || !document_type || !system_key) {
      throw new BadRequestError("property_id, document_name, document_date, document_key, document_type, and system_key are required");
    }

    try {
      const result = await db.query(
        `INSERT INTO property_documents (
          property_id,
          document_name,
          document_date,
          document_key,
          document_type,
          system_key)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id,
                  property_id,
                  document_name,
                  document_date,
                  document_key,
                  document_type,
                  system_key,
                  created_at,
                  updated_at`,
        [property_id, document_name, document_date, document_key, document_type, system_key]
      );
      return result.rows[0];
    } catch (err) {
      throw new BadRequestError(err.message);
    }
  }

  /** Get a property document by id.
   *
   * Returns the document row.
   * Throws NotFoundError if not found.
   */
  static async get(id) {
    const result = await db.query(
      `SELECT id,
              property_id,
              document_name,
              document_date,
              document_key,
              document_type,
              system_key,
              created_at,
              updated_at
       FROM property_documents
       WHERE id = $1`,
      [id]
    );

    const document = result.rows[0];
    if (!document) throw new NotFoundError(`No property document with id: ${id}`);

    return document;
  }

  /** Get all property documents for a property.
   *
   * Returns array of document rows.
   */
  static async getByPropertyId(propertyId) {
    const result = await db.query(
      `SELECT id,
              property_id,
              document_name,
              document_date,
              document_key,
              document_type,
              system_key,
              created_at,
              updated_at
       FROM property_documents
       WHERE property_id = $1
       ORDER BY document_date DESC, document_name`,
      [propertyId]
    );
    return result.rows;
  }

  /** Delete a property document by id.
   *
   * Returns { deleted: id }.
   * Throws NotFoundError if not found.
   */
  static async remove(id) {
    const result = await db.query(
      `DELETE FROM property_documents
       WHERE id = $1
       RETURNING id`,
      [id]
    );

    const document = result.rows[0];
    if (!document) throw new NotFoundError(`No property document with id: ${id}`);

    return { deleted: id };
  }
}

module.exports = PropertyDocument;
