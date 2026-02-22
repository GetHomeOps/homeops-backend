"use strict";

/**
 * Invitation Model
 *
 * Manages invitations in the `invitations` table. Supports account and property
 * invitations with token-based validation, expiry, and status lifecycle.
 *
 * Key operations:
 * - create: Create invitation with hashed token
 * - findByToken / validateToken: Verify and fetch valid invitations
 * - getByAccount / getByProperty / getSentByUser: List invitations by scope
 * - accept / decline / revoke: Update invitation status
 * - expirePending: Mark expired invitations
 */

const db = require("../db");
const crypto = require("crypto");
const { BadRequestError, NotFoundError, UnauthorizedError } = require("../expressError");

class Invitation {
  static async create({ type, inviterUserId, inviteeEmail, accountId, propertyId, intendedRole, tokenHash, expiresAt }) {
    const result = await db.query(
      `INSERT INTO invitations
        (type, inviter_user_id, invitee_email, account_id, property_id, intended_role, token_hash, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, type, inviter_user_id AS "inviterUserId", invitee_email AS "inviteeEmail",
                 account_id AS "accountId", property_id AS "propertyId",
                 intended_role AS "intendedRole", status, expires_at AS "expiresAt",
                 created_at AS "createdAt"`,
      [type, inviterUserId, inviteeEmail, accountId, propertyId || null, intendedRole, tokenHash, expiresAt]
    );
    return result.rows[0];
  }

  static async findByToken(tokenHash) {
    const result = await db.query(
      `SELECT id, type, inviter_user_id AS "inviterUserId", invitee_email AS "inviteeEmail",
              account_id AS "accountId", property_id AS "propertyId",
              intended_role AS "intendedRole", status, expires_at AS "expiresAt",
              accepted_at AS "acceptedAt", accepted_by_user_id AS "acceptedByUserId",
              created_at AS "createdAt"
       FROM invitations
       WHERE token_hash = $1 AND status = 'pending' AND expires_at > NOW()`,
      [tokenHash]
    );
    return result.rows[0] || null;
  }

  static async get(id) {
    const result = await db.query(
      `SELECT id, type, inviter_user_id AS "inviterUserId", invitee_email AS "inviteeEmail",
              account_id AS "accountId", property_id AS "propertyId",
              intended_role AS "intendedRole", status, expires_at AS "expiresAt",
              accepted_at AS "acceptedAt", accepted_by_user_id AS "acceptedByUserId",
              created_at AS "createdAt"
       FROM invitations WHERE id = $1`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundError(`No invitation with id: ${id}`);
    return result.rows[0];
  }

  static async getByAccount(accountId, { status } = {}) {
    const clauses = [`i.account_id = $1`];
    const values = [accountId];
    if (status) {
      values.push(status);
      clauses.push(`i.status = $${values.length}`);
    }
    const result = await db.query(
      `SELECT i.id, i.type, i.inviter_user_id AS "inviterUserId",
              u.name AS "inviterName",
              i.invitee_email AS "inviteeEmail",
              i.account_id AS "accountId", i.property_id AS "propertyId",
              i.intended_role AS "intendedRole", i.status,
              i.expires_at AS "expiresAt", i.created_at AS "createdAt"
       FROM invitations i
       LEFT JOIN users u ON u.id = i.inviter_user_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY i.created_at DESC`,
      values
    );
    return result.rows;
  }

  static async getByProperty(propertyId, { status } = {}) {
    const clauses = [`i.property_id = $1`];
    const values = [propertyId];
    if (status) {
      values.push(status);
      clauses.push(`i.status = $${values.length}`);
    }
    const result = await db.query(
      `SELECT i.id, i.type,
              i.inviter_user_id AS "inviterUserId",
              u.name AS "inviterName",
              i.invitee_email AS "inviteeEmail",
              i.intended_role AS "intendedRole", i.status,
              i.expires_at AS "expiresAt", i.created_at AS "createdAt"
       FROM invitations i
       LEFT JOIN users u ON u.id = i.inviter_user_id
       WHERE ${clauses.join(" AND ")}
       ORDER BY i.created_at DESC`,
      values
    );
    return result.rows;
  }

  static async getSentByUser(userId) {
    const result = await db.query(
      `SELECT i.id, i.type, i.invitee_email AS "inviteeEmail",
              a.name AS "accountName",
              i.intended_role AS "intendedRole", i.status,
              i.expires_at AS "expiresAt", i.accepted_at AS "acceptedAt",
              i.created_at AS "createdAt"
       FROM invitations i
       LEFT JOIN accounts a ON a.id = i.account_id
       WHERE i.inviter_user_id = $1
       ORDER BY i.created_at DESC`,
      [userId]
    );
    return result.rows;
  }

  static async accept(id, acceptedByUserId) {
    const result = await db.query(
      `UPDATE invitations
       SET status = 'accepted', accepted_at = NOW(), accepted_by_user_id = $2
       WHERE id = $1 AND status = 'pending'
       RETURNING id, type, account_id AS "accountId", property_id AS "propertyId",
                 intended_role AS "intendedRole", invitee_email AS "inviteeEmail"`,
      [id, acceptedByUserId]
    );
    if (!result.rows[0]) throw new NotFoundError(`No pending invitation with id: ${id}`);
    return result.rows[0];
  }

  static async decline(id) {
    const result = await db.query(
      `UPDATE invitations SET status = 'declined' WHERE id = $1 AND status = 'pending' RETURNING id`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundError(`No pending invitation with id: ${id}`);
    return { declined: id };
  }

  static async revoke(id) {
    const result = await db.query(
      `UPDATE invitations SET status = 'revoked' WHERE id = $1 AND status = 'pending' RETURNING id`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundError(`No pending invitation with id: ${id}`);
    return { revoked: id };
  }

  static async expirePending() {
    const result = await db.query(
      `UPDATE invitations SET status = 'expired'
       WHERE status = 'pending' AND expires_at <= NOW()
       RETURNING id`
    );
    return result.rows.length;
  }

  static async validateToken(rawToken) {
    if (!rawToken) throw new BadRequestError("Invitation token required");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const invitation = await this.findByToken(tokenHash);
    if (!invitation) throw new UnauthorizedError("Invalid or expired invitation token");
    return invitation;
  }
}

module.exports = Invitation;
