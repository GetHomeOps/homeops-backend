"use strict";

const db = require("../db");
const crypto = require("crypto");

class RefreshToken {
  static hash(token) {
    return crypto.createHash("sha256").update(token).digest("hex");
  }

  static async store({ userId, tokenHash, expiresAt }) {
    await db.query(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
       VALUES ($1, $2, $3)`,
      [userId, tokenHash, expiresAt]
    );
  }

  static async findByHash(tokenHash) {
    const result = await db.query(
      `SELECT id, user_id, token_hash, expires_at
       FROM refresh_tokens
       WHERE token_hash = $1 AND expires_at > NOW()`,
      [tokenHash]
    );
    return result.rows[0] || null;
  }

  static async deleteByHash(tokenHash) {
    await db.query(
      `DELETE FROM refresh_tokens WHERE token_hash = $1`,
      [tokenHash]
    );
  }

  static async deleteAllForUser(userId) {
    await db.query(
      `DELETE FROM refresh_tokens WHERE user_id = $1`,
      [userId]
    );
  }

  static async cleanupExpired() {
    await db.query(
      `DELETE FROM refresh_tokens WHERE expires_at < NOW()`
    );
  }
}

module.exports = RefreshToken;
