"use strict";

/**
 * MFA Routes
 *
 * TOTP enrollment, verification, disable, and backup code management.
 * All routes require JWT auth except login MFA verify (handled in auth.js).
 */

const express = require("express");
const speakeasy = require("speakeasy");
const QRCode = require("qrcode");
const { ensureLoggedIn } = require("../middleware/auth");
const { BadRequestError, UnauthorizedError } = require("../expressError");
const User = require("../models/user");
const MfaBackupCode = require("../models/mfaBackupCode");
const PlatformEngagement = require("../models/platformEngagement");
const { encrypt, decrypt } = require("../helpers/encryption");
const { generateBackupCodes } = require("../helpers/backupCodes");
const { APP_NAME } = require("../config");
const db = require("../db");

const router = new express.Router();

const ENROLLMENT_TTL_MINUTES = 10;

/** POST /mfa/setup or /mfa/totp/start
 * Start TOTP enrollment. Generates secret, stores in temp table, returns otpauthUrl, qrCodeDataUrl, manualCode.
 */
async function handleMfaSetup(req, res, next) {
  try {
    const userId = res.locals.user?.id;
    const email = res.locals.user?.email;
    if (!userId || !email) throw new UnauthorizedError("Authentication required");

    const user = await User.getById(userId);
    if (user?.mfaEnabled) return res.status(409).json({ error: { message: "MFA is already enabled" } });

    const gen = speakeasy.generateSecret({ length: 20 });
    const secret = gen.base32;
    const encrypted = encrypt(secret);
    const expiresAt = new Date(Date.now() + ENROLLMENT_TTL_MINUTES * 60 * 1000);

    await db.query(
      `INSERT INTO mfa_enrollment_temp (user_id, secret_encrypted, expires_at)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET secret_encrypted = $2, expires_at = $3`,
      [userId, encrypted, expiresAt]
    );

    const otpauthUrl = speakeasy.otpauthURL({
      secret,
      label: `${APP_NAME} (${email})`,
      issuer: APP_NAME,
      encoding: "base32",
    });

    let qrCodeDataUrl = null;
    try {
      qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);
    } catch (qrErr) {
      /* optional; frontend can generate from otpauthUrl */
    }

    return res.json({ otpauthUrl, qrCodeDataUrl, manualCode: secret });
  } catch (err) {
    return next(err);
  }
}

/** GET /mfa/status - MFA status and backup codes remaining */
router.get("/status", async function (req, res, next) {
  try {
    const userId = res.locals.user?.id;
    if (!userId) throw new UnauthorizedError("Authentication required");

    const user = await User.getById(userId);
    const mfaEnabled = !!user?.mfaEnabled;
    let backupCodesRemaining = 0;
    if (mfaEnabled) {
      backupCodesRemaining = await MfaBackupCode.countUnused(userId);
    }
    return res.json({ mfaEnabled, backupCodesRemaining });
  } catch (err) {
    return next(err);
  }
});

router.post("/setup", handleMfaSetup);
router.post("/totp/start", handleMfaSetup);

/** POST /mfa/confirm or /mfa/totp/verify
 * Verify TOTP code and complete enrollment. Persists secret, returns backup codes.
 */
async function handleMfaConfirm(req, res, next) {
  try {
    const userId = res.locals.user?.id;
    const email = res.locals.user?.email;
    if (!userId || !email) throw new UnauthorizedError("Authentication required");

    const { token, code } = req.body;
    const totpCode = token || code;
    if (!totpCode || typeof totpCode !== "string") throw new BadRequestError("Code is required");

    const result = await db.query(
      `SELECT secret_encrypted FROM mfa_enrollment_temp
       WHERE user_id = $1 AND expires_at > NOW()`,
      [userId]
    );
    const row = result.rows[0];
    if (!row) throw new BadRequestError("Enrollment expired or not started. Please start again.");

    const secret = decrypt(row.secret_encrypted);
    const valid = speakeasy.totp.verify({
      secret,
      encoding: "base32",
      token: totpCode.trim(),
      window: 1,
    });
    if (!valid) throw new UnauthorizedError("Invalid code");

    await db.query(`DELETE FROM mfa_enrollment_temp WHERE user_id = $1`, [userId]);

    await User.setMfaEnrolled(userId, row.secret_encrypted);

    const { codes, hashes } = generateBackupCodes(8);
    await MfaBackupCode.createMany(userId, hashes);

    try {
      await PlatformEngagement.logEvent({ userId, eventType: "mfa_enabled", eventData: {} });
    } catch (logErr) { /* don't block */ }

    return res.json({ backupCodes: codes });
  } catch (err) {
    return next(err);
  }
}

router.post("/confirm", handleMfaConfirm);
router.post("/totp/verify", handleMfaConfirm);

/** POST /mfa/disable
 * Disable MFA. Requires valid TOTP, backup code, or current password.
 */
router.post("/disable", async function (req, res, next) {
  try {
    const userId = res.locals.user?.id;
    if (!userId) throw new UnauthorizedError("Authentication required");

    const { codeOrBackupCode, password } = req.body;
    const code = codeOrBackupCode != null ? String(codeOrBackupCode).trim() : "";
    const pwd = password != null ? String(password) : "";

    if (!code && !pwd) {
      throw new BadRequestError("Code, backup code, or password is required");
    }

    const secret = await User.getMfaSecret(userId);
    if (!secret) throw new BadRequestError("MFA is not enabled");

    let valid = false;

    if (pwd) {
      const bcrypt = require("bcrypt");
      const result = await db.query(
        `SELECT password_hash AS "passwordHash" FROM users WHERE id = $1`,
        [userId]
      );
      const row = result.rows[0];
      if (row?.passwordHash) {
        valid = await bcrypt.compare(pwd, row.passwordHash);
      }
    }

    if (!valid && code) {
      if (code.length === 6 && /^\d+$/.test(code)) {
        valid = speakeasy.totp.verify({
          secret,
          encoding: "base32",
          token: code,
          window: 1,
        });
      }
      if (!valid) {
        valid = await MfaBackupCode.verifyAndConsume(userId, code);
      }
    }

    if (!valid) throw new UnauthorizedError("Invalid code");

    await MfaBackupCode.deleteByUserId(userId);
    await User.clearMfa(userId);

    try {
      await PlatformEngagement.logEvent({ userId, eventType: "mfa_disabled", eventData: {} });
    } catch (logErr) { /* don't block */ }

    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
});

/** POST /mfa/backup/regenerate
 * Regenerate backup codes. Requires valid TOTP code.
 */
router.post("/backup/regenerate", async function (req, res, next) {
  try {
    const userId = res.locals.user?.id;
    if (!userId) throw new UnauthorizedError("Authentication required");

    const { code } = req.body;
    if (!code || typeof code !== "string") throw new BadRequestError("TOTP code is required");

    const secret = await User.getMfaSecret(userId);
    if (!secret) throw new BadRequestError("MFA is not enabled");

    const valid = speakeasy.totp.verify({
      secret,
      encoding: "base32",
      token: code.trim(),
      window: 1,
    });
    if (!valid) throw new UnauthorizedError("Invalid verification code");

    await MfaBackupCode.deleteByUserId(userId);
    const { codes, hashes } = generateBackupCodes(8);
    await MfaBackupCode.createMany(userId, hashes);

    return res.json({ backupCodes: codes });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
