"use strict";

const db = require("../db");
const { NotFoundError } = require("../expressError");

class SavedProfessional {

  /** Save a professional for a user. Idempotent (ON CONFLICT DO NOTHING). */
  static async save(userId, professionalId) {
    await db.query(
      `INSERT INTO saved_professionals (user_id, professional_id)
       VALUES ($1, $2)
       ON CONFLICT DO NOTHING`,
      [userId, professionalId],
    );
  }

  /** Remove a saved professional for a user. */
  static async unsave(userId, professionalId) {
    const result = await db.query(
      `DELETE FROM saved_professionals
       WHERE user_id = $1 AND professional_id = $2
       RETURNING professional_id`,
      [userId, professionalId],
    );
    if (!result.rows[0]) {
      throw new NotFoundError(`No saved professional: ${professionalId}`);
    }
  }

  /** Get all saved professionals for a user, with full professional data. */
  static async getByUserId(userId) {
    const result = await db.query(
      `SELECT p.*,
              pc.name AS category_name,
              sc.name AS subcategory_name,
              TRUE AS saved
       FROM saved_professionals sp
       JOIN professionals p ON p.id = sp.professional_id
       LEFT JOIN professional_categories pc ON pc.id = p.category_id
       LEFT JOIN professional_categories sc ON sc.id = p.subcategory_id
       WHERE sp.user_id = $1
       ORDER BY p.first_name, p.last_name`,
      [userId],
    );
    return result.rows;
  }

  /** Check if a specific professional is saved by a user. */
  static async isSaved(userId, professionalId) {
    const result = await db.query(
      `SELECT 1 FROM saved_professionals
       WHERE user_id = $1 AND professional_id = $2`,
      [userId, professionalId],
    );
    return result.rows.length > 0;
  }
}

module.exports = SavedProfessional;
