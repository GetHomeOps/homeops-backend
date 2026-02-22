"use strict";

/**
 * UserInvitation Model
 *
 * Manages user activation invitations in the `user_invitations` table.
 * Token-based flow for inviting users to set password and activate account.
 *
 * Key operations:
 * - create: Create invitation with hashed token
 * - findValid / findValidByUserId: Fetch valid (unused, unexpired) invitations
 * - markUsed / invalidateAllForUser: Update invitation status
 * - validateInvitationToken: Verify token and return invitation
 */

const db = require("../db");
const crypto = require("crypto");
const { BadRequestError, NotFoundError, UnauthorizedError } = require("../expressError");

class UserInvitation {
  /**
   * Create a new invitation
   */
  static async create({ userId, tokenHash, expiresAt }) {
    const result = await db.query(
      `INSERT INTO user_invitations
        (user_id, token_hash, expires_at)
      VALUES ($1, $2, $3)
      RETURNING id, user_id, expires_at`,
      [userId, tokenHash, expiresAt]
    );

    return result.rows[0];
  }

  /**
   * Find a valid (unused, unexpired) invitation by token hash
   */
  static async findValid(token) {
    const result = await db.query(
      `
      SELECT id,
             user_id,
             expires_at,
             used_at
      FROM user_invitations
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()
      `,
      [token]
    );

    return result.rows[0] || null;
  }

  /**
   * Find a valid (unused, unexpired) invitation by user ID
   */
  static async findValidByUserId(userId) {
    const result = await db.query(
      `
      SELECT id,
             user_id,
             token_hash,
             expires_at,
             used_at
      FROM user_invitations
      WHERE user_id = $1
        AND used_at IS NULL
        AND expires_at > now()
      ORDER BY expires_at DESC
      LIMIT 1
      `,
      [userId]
    );

    return result.rows[0];
  }


  /**
   * Mark invitation as used
   */
  static async markUsed(id) {
    await db.query(
      `
      UPDATE user_invitations
      SET used_at = now()
      WHERE id = $1
      `,
      [id]
    );
  }

  /**
   * Optional: invalidate all existing invitations for a user
   * (useful when resending an invite)
   */
  static async invalidateAllForUser(userId) {
    await db.query(
      `UPDATE user_invitations
      SET used_at = now()
      WHERE user_id = $1
        AND used_at IS NULL`,
      [userId]
    );
  }

  /**
   * Validate an invitation token
   *
   * - Hashes the raw token
   * - Finds a valid (unused, unexpired) invitation
   * - Returns the invitation row
   *
   * Token is the ONLY source of truth for identity.
   */
  static async validateInvitationToken(token) {
    if (!token) {
      throw new BadRequestError("Invitation token required");
    }

    const tokenHash = crypto
      .createHash("sha256")
      .update(token)
      .digest("hex");

    const result = await db.query(
      `SELECT id,
             user_id,
             expires_at,
             used_at
      FROM user_invitations
      WHERE token_hash = $1
        AND used_at IS NULL
        AND expires_at > now()`,
      [tokenHash]
    );

    console.log("Result:", result.rows);

    const invitation = result.rows[0];

    if (!invitation) {
      throw new UnauthorizedError("Invalid or expired invitation token");
    }

    return invitation;
  }
}

module.exports = UserInvitation;

