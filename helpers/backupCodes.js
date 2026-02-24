"use strict";

/**
 * Backup Codes Helper
 *
 * Generate and hash one-time backup codes for MFA.
 * Codes are 8-char alphanumeric, stored as SHA-256 hashes only.
 */

const crypto = require("crypto");

const CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CHARS_LEN = CHARS.length;
const DEFAULT_COUNT = 8;

function generateCode() {
  const bytes = crypto.randomBytes(8);
  let code = "";
  for (let i = 0; i < 8; i++) {
    code += CHARS[bytes[i] % CHARS_LEN];
  }
  return code;
}

function hashCode(code) {
  return crypto.createHash("sha256").update(code.toUpperCase().replace(/\s/g, "")).digest("hex");
}

/**
 * Generate backup codes and their hashes.
 * @param {number} count
 * @returns {{ codes: string[], hashes: string[] }}
 */
function generateBackupCodes(count = DEFAULT_COUNT) {
  const codes = [];
  const seen = new Set();
  while (codes.length < count) {
    const c = generateCode();
    if (!seen.has(c)) {
      seen.add(c);
      codes.push(c);
    }
  }
  const hashes = codes.map((c) => hashCode(c));
  return { codes, hashes };
}

module.exports = { generateBackupCodes, hashCode };
