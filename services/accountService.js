"use strict";

/**
 * Account Service
 *
 * Generates unique account URLs from names. Used when creating new accounts
 * to ensure URL uniqueness (e.g., "john doe" -> "johndoe" or "johndoe1").
 *
 * Exports: generateAccountUrl
 */

const db = require("../db");

async function generateAccountUrl(name) {
  const allWords = name.trim().toLowerCase().split(/\s+/);
  const baseUrl = allWords.join("").replace(/[^a-z0-9]/g, "");
  let finalUrl = baseUrl;
  let counter = 1;
  let isAvailable = false;
  const maxRetries = 1000;

  while (!isAvailable && counter <= maxRetries) {
    const existingCheck = await db.query(
      `SELECT id FROM accounts WHERE url = $1`,
      [finalUrl]
    );
    if (existingCheck.rows.length === 0) {
      isAvailable = true;
    } else {
      finalUrl = `${baseUrl}${counter}`;
      counter++;
    }
  }

  if (!isAvailable) {
    throw new Error(`Could not generate unique account URL after ${maxRetries} attempts`);
  }

  return finalUrl;
}

module.exports = { generateAccountUrl };
