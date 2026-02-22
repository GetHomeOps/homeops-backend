"use strict";

/**
 * Invitation Tokens Helper
 *
 * Generates secure invitation tokens. Returns raw token (for email) and
 * SHA-256 hash (for database storage). Used by invitation service.
 *
 * Exports: generateInvitationToken
 */

const crypto = require("crypto");

function generateInvitationToken() {
  const token = crypto.randomBytes(32).toString("hex");

  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  return { token, tokenHash };
}

module.exports = { generateInvitationToken };
