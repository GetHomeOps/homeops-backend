"use strict";

const db = require("../db");
const { BadRequestError, ForbiddenError, NotFoundError } = require("../expressError");

/**
 * ProfessionalReview model
 *
 * Users can create one review per professional, only if they have at least one
 * COMPLETED maintenance_event associated with that professional (contractor_source='professional',
 * contractor_id=professional_id). Eligibility is validated in the service layer.
 */
class ProfessionalReview {
  /**
   * Check if user is eligible to review a professional:
   * - Has at least one maintenance_event with status='completed', contractor_source='professional',
   *   contractor_id=professionalId, and user has access to the property.
   */
  static async checkEligibility(userId, professionalId) {
    const result = await db.query(
      `SELECT 1
       FROM maintenance_events me
       JOIN property_users pu ON pu.property_id = me.property_id AND pu.user_id = $1
       WHERE me.status = 'completed'
         AND me.contractor_source = 'professional'
         AND me.contractor_id = $2
       LIMIT 1`,
      [userId, professionalId],
    );
    return result.rows.length > 0;
  }

  /**
   * Check if user has already submitted a review for this professional.
   */
  static async hasUserReviewed(userId, professionalId) {
    const result = await db.query(
      `SELECT id FROM professional_reviews
       WHERE user_id = $1 AND professional_id = $2`,
      [userId, professionalId],
    );
    return result.rows.length > 0;
  }

  /**
   * Create a review. Validates eligibility and one-review-per-user before insert.
   */
  static async create({ professionalId, userId, rating, comment }) {
    if (!professionalId || !userId || rating == null) {
      throw new BadRequestError("professionalId, userId, and rating are required");
    }
    const ratingNum = Number(rating);
    if (ratingNum < 1 || ratingNum > 5 || !Number.isInteger(ratingNum)) {
      throw new BadRequestError("rating must be an integer between 1 and 5");
    }

    const eligible = await this.checkEligibility(userId, professionalId);
    if (!eligible) {
      throw new ForbiddenError(
        "You must have at least one completed maintenance record with this professional to submit a review.",
      );
    }

    const alreadyReviewed = await this.hasUserReviewed(userId, professionalId);
    if (alreadyReviewed) {
      throw new ForbiddenError(
        "You have already submitted a review for this professional.",
      );
    }

    await db.query(
      `INSERT INTO professional_reviews (professional_id, user_id, rating, comment)
       VALUES ($1, $2, $3, $4)`,
      [professionalId, userId, ratingNum, comment?.trim() || null],
    );
    const fetchResult = await db.query(
      `SELECT pr.id, pr.professional_id AS "professionalId", pr.user_id AS "userId",
              pr.rating, pr.comment, pr.created_at AS "createdAt",
              u.name AS "authorName"
       FROM professional_reviews pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.professional_id = $1 AND pr.user_id = $2
       ORDER BY pr.created_at DESC LIMIT 1`,
      [professionalId, userId],
    );
    return fetchResult.rows[0];
  }

  /**
   * Get all reviews for a professional.
   */
  static async getByProfessionalId(professionalId) {
    const result = await db.query(
      `SELECT pr.id, pr.professional_id AS "professionalId", pr.user_id AS "userId",
              pr.rating, pr.comment, pr.created_at AS "createdAt",
              u.name AS "authorName"
       FROM professional_reviews pr
       JOIN users u ON u.id = pr.user_id
       WHERE pr.professional_id = $1
       ORDER BY pr.created_at DESC`,
      [professionalId],
    );
    return result.rows;
  }

  /**
   * Get aggregate rating and count for a professional (for display).
   */
  static async getAggregate(professionalId) {
    const result = await db.query(
      `SELECT COUNT(*)::int AS count,
              COALESCE(ROUND(AVG(rating)::numeric, 1), 0)::float AS "avgRating"
       FROM professional_reviews
       WHERE professional_id = $1`,
      [professionalId],
    );
    const row = result.rows[0];
    return {
      count: row?.count ?? 0,
      avgRating: parseFloat(row?.avgRating ?? 0) || 0,
    };
  }
}

module.exports = ProfessionalReview;
