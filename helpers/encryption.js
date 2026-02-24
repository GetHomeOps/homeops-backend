"use strict";

/**
 * Encryption Helper
 *
 * AES-256-GCM encryption for sensitive data (e.g. TOTP secrets).
 * Key from MFA_ENCRYPTION_KEY env var (32 bytes hex or base64).
 * Never log secrets.
 */

const crypto = require("crypto");

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const KEY_LENGTH = 32;

function getKey() {
  const raw = process.env.MFA_ENCRYPTION_KEY;
  if (!raw || typeof raw !== "string") {
    if (process.env.NODE_ENV === "production") {
      throw new Error("MFA_ENCRYPTION_KEY is required in production");
    }
    return crypto.scryptSync("dev-mfa-key-fallback", "salt", KEY_LENGTH);
  }
  const buf = Buffer.from(raw, "hex");
  if (buf.length < KEY_LENGTH) {
    const buf64 = Buffer.from(raw, "base64");
    if (buf64.length >= KEY_LENGTH) {
      return buf64.slice(0, KEY_LENGTH);
    }
  }
  if (buf.length >= KEY_LENGTH) {
    return buf.slice(0, KEY_LENGTH);
  }
  throw new Error("MFA_ENCRYPTION_KEY must be 32 bytes (hex or base64)");
}

/**
 * Encrypt plaintext. Returns format: iv:authTag:ciphertext (hex)
 */
function encrypt(plaintext) {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted.toString("hex")}`;
}

/**
 * Decrypt ciphertext in format iv:authTag:ciphertext (hex)
 */
function decrypt(encrypted) {
  const key = getKey();
  const parts = encrypted.split(":");
  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format");
  }
  const [ivHex, authTagHex, cipherHex] = parts;
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  return decipher.update(cipherHex, "hex", "utf8") + decipher.final("utf8");
}

module.exports = { encrypt, decrypt };
