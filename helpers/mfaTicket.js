"use strict";

/**
 * MFA Ticket Helper
 *
 * Short-lived JWT for MFA step after password login.
 * Used when user has mfa_enabled and must complete TOTP/backup verification.
 */

const jwt = require("jsonwebtoken");
const { SECRET_KEY } = require("../config");

const MFA_TICKET_EXPIRY = "5m";

/**
 * Create a short-lived MFA ticket for a user who passed password auth.
 * @param {number} userId
 * @param {string} email
 * @returns {string} JWT
 */
function createMfaTicket(userId, email) {
  return jwt.sign(
    { type: "mfa", id: userId, email },
    SECRET_KEY,
    { expiresIn: MFA_TICKET_EXPIRY }
  );
}

/**
 * Verify MFA ticket and return payload.
 * @param {string} token
 * @returns {{ id: number, email: string }}
 */
function verifyMfaTicket(token) {
  const payload = jwt.verify(token, SECRET_KEY);
  if (payload.type !== "mfa") {
    throw new Error("Invalid MFA ticket type");
  }
  return { id: payload.id, email: payload.email };
}

module.exports = { createMfaTicket, verifyMfaTicket };
