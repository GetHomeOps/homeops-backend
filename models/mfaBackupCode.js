"use strict";

/**
 * MFA Backup Code Model
 *
 * One-time backup codes for MFA. Stored as SHA-256 hashes only.
 */

const db = require("../db");
const { hashCode } = require("../helpers/backupCodes");

class MfaBackupCode {
  /**
   * Insert backup code hashes for a user.
   * @param {number} userId
   * @param {string[]} hashes
   */
  static async createMany(userId, hashes) {
    for (const h of hashes) {
      await db.query(
        `INSERT INTO mfa_backup_codes (user_id, code_hash) VALUES ($1, $2)`,
        [userId, h]
      );
    }
  }

  /**
   * Verify a backup code and consume it (set used_at).
   * @param {number} userId
   * @param {string} code - plaintext code
   * @returns {boolean}
   */
  static async verifyAndConsume(userId, code) {
    const codeHash = hashCode(code);
    const result = await db.query(
      `UPDATE mfa_backup_codes
       SET used_at = NOW()
       WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL
       RETURNING id`,
      [userId, codeHash]
    );
    return result.rowCount > 0;
  }

  /**
   * Delete all backup codes for a user.
   * @param {number} userId
   */
  static async deleteByUserId(userId) {
    await db.query(`DELETE FROM mfa_backup_codes WHERE user_id = $1`, [userId]);
  }

  /**
   * Count unused backup codes for a user.
   * @param {number} userId
   * @returns {Promise<number>}
   */
  static async countUnused(userId) {
    const result = await db.query(
      `SELECT COUNT(*)::int AS count FROM mfa_backup_codes WHERE user_id = $1 AND used_at IS NULL`,
      [userId]
    );
    return result.rows[0]?.count ?? 0;
  }
}

module.exports = MfaBackupCode;
