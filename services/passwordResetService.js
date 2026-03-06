"use strict";

/**
 * Password Reset Service
 *
 * Creates and validates password reset tokens. Sends reset email via configured
 * email provider (AWS SES). When email is not configured, logs the link to console
 * for development.
 */

const crypto = require("crypto");
const db = require("../db");
const User = require("../models/user");
const { BadRequestError, UnauthorizedError } = require("../expressError");
const { sendPasswordResetEmail } = require("./emailService");
const { BCRYPT_WORK_FACTOR } = require("../config");
const bcrypt = require("bcrypt");

const TOKEN_EXPIRY_HOURS = 1;

function generateResetToken() {
  const token = crypto.randomBytes(32).toString("hex");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  return { token, tokenHash };
}

/**
 * Request a password reset. Sends email with reset link.
 * Always returns success to prevent email enumeration.
 */
async function requestPasswordReset(email) {
  const emailLower = (email || "").trim().toLowerCase();
  if (!emailLower) {
    throw new BadRequestError("Email is required");
  }

  const user = await User.findByEmailOrNull(emailLower);
  if (!user) {
    // Don't reveal whether email exists
    return { success: true, message: "If that email exists, you will receive a reset link shortly." };
  }

  const { token, tokenHash } = generateResetToken();
  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + TOKEN_EXPIRY_HOURS);

  await db.query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, $3)`,
    [user.id, tokenHash, expiresAt]
  );

  const { APP_WEB_ORIGIN, APP_BASE_URL } = require("../config");
  const baseUrl = APP_BASE_URL || APP_WEB_ORIGIN || "http://localhost:5173";
  const resetUrl = `${baseUrl}/#/reset-password?token=${token}`;

  try {
    await sendPasswordResetEmail({ to: user.email, resetUrl, userName: user.name });
  } catch (err) {
    console.error("[passwordResetService] Failed to send email:", err.message);
    // In development without email, log the link
    if (process.env.NODE_ENV !== "production") {
      console.log("\n--- Password reset link (dev, email not sent) ---");
      console.log(resetUrl);
      console.log("---\n");
    }
    // Still return success - don't reveal email delivery failure
  }

  return { success: true, message: "If that email exists, you will receive a reset link shortly." };
}

/**
 * Reset password using a valid token.
 */
async function resetPasswordWithToken(token, newPassword) {
  if (!token || typeof token !== "string" || !token.trim()) {
    throw new BadRequestError("Reset token is required");
  }
  if (!newPassword || newPassword.length < 4) {
    throw new BadRequestError("New password must be at least 4 characters");
  }

  const tokenHash = crypto.createHash("sha256").update(token.trim()).digest("hex");

  const result = await db.query(
    `SELECT prt.id, prt.user_id, prt.expires_at, prt.used_at
     FROM password_reset_tokens prt
     WHERE prt.token_hash = $1`,
    [tokenHash]
  );

  const row = result.rows[0];
  if (!row) {
    throw new UnauthorizedError("Invalid or expired reset link. Please request a new one.");
  }

  if (row.used_at) {
    throw new UnauthorizedError("This reset link has already been used. Please request a new one.");
  }

  if (new Date(row.expires_at) <= new Date()) {
    throw new UnauthorizedError("This reset link has expired. Please request a new one.");
  }

  const hashedPassword = await bcrypt.hash(newPassword, BCRYPT_WORK_FACTOR);

  await db.query("BEGIN");
  try {
    await db.query(
      `UPDATE users SET password_hash = $1, updated_at = NOW() WHERE id = $2`,
      [hashedPassword, row.user_id]
    );
    await db.query(
      `UPDATE password_reset_tokens SET used_at = NOW() WHERE id = $1`,
      [row.id]
    );
    await db.query("COMMIT");
  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }

  return { success: true, message: "Password has been reset successfully. You can now sign in." };
}

/**
 * Clean up expired tokens (call periodically).
 */
async function cleanupExpiredTokens() {
  await db.query(
    `DELETE FROM password_reset_tokens WHERE expires_at < NOW() OR used_at IS NOT NULL`
  );
}

module.exports = {
  requestPasswordReset,
  resetPasswordWithToken,
  cleanupExpiredTokens,
};
