"use strict";

const crypto = require("crypto");

/**
 * Generate a unique passport ID for a property.
 * Format: STATE-ZIP-NNNNN (e.g. TX-78701-38472).
 *
 * @param {Object} opts
 * @param {string} opts.state - State code (e.g. "TX", "tx")
 * @param {string} opts.zip  - Zip code (e.g. "78701", "78701-1234")
 * @returns {string} Unique passport ID
 */
function generatePassportId({ state, zip }) {
  const statePart = String(state || "")
    .trim()
    .toUpperCase()
    .slice(0, 2);
  const zipPart = String(zip || "")
    .trim()
    .replace(/\D/g, "")
    .slice(0, 5);
  const uniquePart = String(crypto.randomInt(10000, 100000));
  return [statePart, zipPart, uniquePart].filter(Boolean).join("-");
}

module.exports = { generatePassportId };
