"use strict";

const db = require("../db");
const { BadRequestError, NotFoundError } = require("../expressError");

class InspectionAnalysisResult {
  /** Create a result from job. */
  static async create(data) {
    const {
      job_id,
      property_id,
      condition_rating,
      condition_confidence,
      condition_rationale,
      systems_detected,
      needs_attention,
      suggested_systems_to_add,
      maintenance_suggestions,
      summary,
      citations,
    } = data;

    if (!job_id || !property_id || !condition_rating) {
      throw new BadRequestError("job_id, property_id, and condition_rating are required");
    }

    const result = await db.query(
      `INSERT INTO inspection_analysis_results
         (job_id, property_id, condition_rating, condition_confidence, condition_rationale,
          systems_detected, needs_attention, suggested_systems_to_add, maintenance_suggestions,
          summary, citations)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
       RETURNING id, job_id, property_id, condition_rating, condition_confidence, condition_rationale,
                 systems_detected, needs_attention, suggested_systems_to_add, maintenance_suggestions,
                 summary, citations, created_at`,
      [
        job_id,
        property_id,
        condition_rating,
        condition_confidence ?? null,
        condition_rationale ?? null,
        JSON.stringify(systems_detected || []),
        JSON.stringify(needs_attention || []),
        JSON.stringify(suggested_systems_to_add || []),
        JSON.stringify(maintenance_suggestions || []),
        summary ?? null,
        JSON.stringify(citations || []),
      ]
    );
    return result.rows[0];
  }

  /** Get result by job id. */
  static async getByJobId(jobId) {
    const result = await db.query(
      `SELECT id, job_id, property_id, condition_rating, condition_confidence, condition_rationale,
              systems_detected, needs_attention, suggested_systems_to_add, maintenance_suggestions,
              summary, citations, created_at
       FROM inspection_analysis_results
       WHERE job_id = $1`,
      [jobId]
    );
    return result.rows[0] || null;
  }

  /** Get latest result by property id. */
  static async getByPropertyId(propertyId) {
    const result = await db.query(
      `SELECT r.id, r.job_id, r.property_id, r.condition_rating, r.condition_confidence,
              r.condition_rationale, r.systems_detected, r.needs_attention,
              r.suggested_systems_to_add, r.maintenance_suggestions, r.summary, r.citations,
              r.created_at
       FROM inspection_analysis_results r
       WHERE r.property_id = $1
       ORDER BY r.created_at DESC
       LIMIT 1`,
      [propertyId]
    );
    return result.rows[0] || null;
  }

  /** Get result by id. */
  static async get(id) {
    const result = await db.query(
      `SELECT id, job_id, property_id, condition_rating, condition_confidence, condition_rationale,
              systems_detected, needs_attention, suggested_systems_to_add, maintenance_suggestions,
              summary, citations, created_at
       FROM inspection_analysis_results
       WHERE id = $1`,
      [id]
    );
    const row = result.rows[0];
    if (!row) throw new NotFoundError(`No analysis result with id: ${id}`);
    return row;
  }
}

module.exports = InspectionAnalysisResult;
