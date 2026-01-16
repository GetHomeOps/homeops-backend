"use strict";

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
