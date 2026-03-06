"use strict";

/**
 * ContractorReportToken Model
 *
 * Manages tokens that allow contractors to fill out maintenance reports
 * via a public link (no login required). Tokens are hashed before storage
 * and validated with expiry/status checks.
 *
 * Key operations:
 * - create: Generate a token entry for a maintenance record
 * - validateToken: Verify a raw token and return associated data
 * - markCompleted: Mark token as used after contractor submits
 * - getByRecordId: Find active token for a maintenance record
 * - revoke: Cancel a pending token
 */

const db = require("../db");
const crypto = require("crypto");
const { BadRequestError, NotFoundError, UnauthorizedError } = require("../expressError");

class ContractorReportToken {

  static async create({ maintenanceRecordId, propertyId, contractorEmail, contractorName, tokenHash, expiresAt, createdBy }) {
    const result = await db.query(
      `INSERT INTO contractor_report_tokens
        (maintenance_record_id, property_id, contractor_email, contractor_name, token_hash, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, maintenance_record_id AS "maintenanceRecordId", property_id AS "propertyId",
                 contractor_email AS "contractorEmail", contractor_name AS "contractorName",
                 status, expires_at AS "expiresAt", created_at AS "createdAt"`,
      [maintenanceRecordId, propertyId, contractorEmail, contractorName || null, tokenHash, expiresAt, createdBy || null]
    );
    return result.rows[0];
  }

  static async findByToken(tokenHash) {
    const result = await db.query(
      `SELECT crt.id, crt.maintenance_record_id AS "maintenanceRecordId",
              crt.property_id AS "propertyId",
              crt.contractor_email AS "contractorEmail",
              crt.contractor_name AS "contractorName",
              crt.status, crt.expires_at AS "expiresAt",
              crt.created_at AS "createdAt",
              pm.system_key AS "systemKey",
              pm.data AS "recordData",
              pm.status AS "recordStatus",
              pm.completed_at AS "completedAt",
              p.address AS "propertyAddress",
              p.city AS "propertyCity",
              p.state AS "propertyState",
              p.property_name AS "propertyName"
       FROM contractor_report_tokens crt
       JOIN property_maintenance pm ON pm.id = crt.maintenance_record_id
       JOIN properties p ON p.id = crt.property_id
       WHERE crt.token_hash = $1 AND crt.status = 'pending' AND crt.expires_at > NOW()`,
      [tokenHash]
    );
    return result.rows[0] || null;
  }

  static async validateToken(rawToken) {
    if (!rawToken) throw new BadRequestError("Report token required");
    const tokenHash = crypto.createHash("sha256").update(rawToken).digest("hex");
    const record = await this.findByToken(tokenHash);
    if (!record) throw new UnauthorizedError("Invalid or expired report link");
    return record;
  }

  static async markCompleted(id) {
    const result = await db.query(
      `UPDATE contractor_report_tokens
       SET status = 'completed', completed_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND status = 'pending'
       RETURNING id, maintenance_record_id AS "maintenanceRecordId"`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundError(`No pending token: ${id}`);
    return result.rows[0];
  }

  static async getByRecordId(maintenanceRecordId, { status } = {}) {
    const clauses = [`maintenance_record_id = $1`];
    const values = [maintenanceRecordId];
    if (status) {
      values.push(status);
      clauses.push(`status = $${values.length}`);
    }
    const result = await db.query(
      `SELECT id, maintenance_record_id AS "maintenanceRecordId",
              contractor_email AS "contractorEmail",
              contractor_name AS "contractorName",
              status, expires_at AS "expiresAt",
              completed_at AS "completedAt",
              created_at AS "createdAt"
       FROM contractor_report_tokens
       WHERE ${clauses.join(" AND ")}
       ORDER BY created_at DESC`,
      values
    );
    return result.rows;
  }

  static async revoke(id) {
    const result = await db.query(
      `UPDATE contractor_report_tokens SET status = 'revoked', updated_at = NOW()
       WHERE id = $1 AND status = 'pending' RETURNING id`,
      [id]
    );
    if (!result.rows[0]) throw new NotFoundError(`No pending token: ${id}`);
    return { revoked: id };
  }

  static async expirePending() {
    const result = await db.query(
      `UPDATE contractor_report_tokens SET status = 'expired', updated_at = NOW()
       WHERE status = 'pending' AND expires_at <= NOW()
       RETURNING id`
    );
    return result.rows.length;
  }
}

module.exports = ContractorReportToken;
