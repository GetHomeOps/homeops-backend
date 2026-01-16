"use strict";

const db = require("../db");
const { generateInvitationToken } =
  require("../helpers/invitationTokens");
const UserInvitation = require("../models/userInvitation");
const { BadRequestError } = require("../expressError");

/**
 * Create an invitation for a user
 * - generates secure token
 * - stores hashed token
 * - returns raw token (for email only)
 */
async function createInvitationForUser(userId) {
  const { token, tokenHash } = generateInvitationToken();

  console.log("Token:", token);
  console.log("Token Hash:", tokenHash);

  const expiresAt = new Date();
  expiresAt.setHours(expiresAt.getHours() + 48); // 48h expiry

  await UserInvitation.create({
    userId,
    tokenHash,
    expiresAt
  });

  return token;
}

/**
 * Get an invitation for the frontend
 * - finds the most recent valid invitation
 * - returns the invitation URL and email
 */
async function getInvitationForFrontend(userId) {
  // Find the most recent valid invitation
  const invitation = await UserInvitation.findValidByUserId(userId);

  if (!invitation) {
    throw new BadRequestError("No valid invitation found for this user");
  }

  return { token: invitation.token_hash };
}


/**
 * Validate an invitation token
 * Returns invitation + userId or null
 */
async function validateInvitationToken(token) {
  if (!token) return null;

  const crypto = require("crypto");
  const tokenHash = crypto
    .createHash("sha256")
    .update(token)
    .digest("hex");

  const invitation =
    await UserInvitation.findValid(tokenHash);

  return invitation || null;
}



/**
 * Accept invitation:
 * - activates user
 * - sets password
 * - marks invitation as used
 */
async function acceptInvitation({ token, password }) {
  const invitation = await validateInvitationToken(token);
  if (!invitation) return null;

  const bcrypt = require("bcrypt");
  const passwordHash = await bcrypt.hash(password, 12);

  await db.query("BEGIN");

  try {
    await db.query(
      `
      UPDATE users
      SET password_hash = $1,
          status = 'active'
      WHERE id = $2
      `,
      [passwordHash, invitation.user_id]
    );

    await UserInvitation.markUsed(invitation.id);

    await db.query("COMMIT");
    return { userId: invitation.user_id };

  } catch (err) {
    await db.query("ROLLBACK");
    throw err;
  }
}

module.exports = {
  createInvitationForUser,
  validateInvitationToken,
  acceptInvitation,
  getInvitationForFrontend
};
