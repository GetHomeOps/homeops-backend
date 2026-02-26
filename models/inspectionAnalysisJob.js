"use strict";

const db = require("../db");
const { BadRequestError, NotFoundError } = require("../expressError");

class InspectionAnalysisJob {
  /** Create a new analysis job. */
  static async create(data) {
    const { property_id, user_id, s3_key, file_name, mime_type } = data;
    if (!property_id || !user_id || !s3_key) {
      throw new BadRequestError("property_id, user_id, and s3_key are required");
    }
    const result = await db.query(
      `INSERT INTO inspection_analysis_jobs
         (property_id, user_id, s3_key, file_name, mime_type, status)
       VALUES ($1, $2, $3, $4, $5, 'queued')
       RETURNING id, property_id, user_id, s3_key, file_name, mime_type,
                 status, progress, error_message, created_at, updated_at`,
      [property_id, user_id, s3_key, file_name || null, mime_type || null]
    );
    return result.rows[0];
  }

  /** Get job by id. */
  static async get(id) {
    const result = await db.query(
      `SELECT id, property_id, user_id, s3_key, file_name, mime_type,
              status, progress, error_message, created_at, updated_at
       FROM inspection_analysis_jobs
       WHERE id = $1`,
      [id]
    );
    const job = result.rows[0];
    if (!job) throw new NotFoundError(`No analysis job with id: ${id}`);
    return job;
  }

  /** Update job status. */
  static async updateStatus(id, { status, progress, error_message }) {
    const result = await db.query(
      `UPDATE inspection_analysis_jobs
       SET status = COALESCE($2, status),
           progress = COALESCE($3, progress),
           error_message = COALESCE($4, error_message),
           updated_at = NOW()
       WHERE id = $1
       RETURNING id, property_id, user_id, s3_key, status, progress, error_message, created_at, updated_at`,
      [id, status, progress, error_message]
    );
    const job = result.rows[0];
    if (!job) throw new NotFoundError(`No analysis job with id: ${id}`);
    return job;
  }

  /** Get latest result for a property (if any). */
  static async getLatestResultByProperty(propertyId) {
    const result = await db.query(
      `SELECT r.* FROM inspection_analysis_results r
       JOIN inspection_analysis_jobs j ON j.id = r.job_id
       WHERE r.property_id = $1 AND j.status = 'completed'
       ORDER BY r.created_at DESC LIMIT 1`,
      [propertyId]
    );
    return result.rows[0] || null;
  }
}

module.exports = InspectionAnalysisJob;
