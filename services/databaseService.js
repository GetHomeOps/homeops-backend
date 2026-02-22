"use strict";

/**
 * Database Service
 *
 * Generates unique database names/URLs from user names. Used when creating
 * new databases to ensure URL uniqueness (e.g., "john doe" -> "johndoe").
 *
 * Exports: generateDatabaseName
 */

const db = require("../db");

/** Generate a unique database name and URL based on user information.
 *
 * If a database with the generated name already exists, appends a number
 * (1, 2, 3, etc.) until a unique name is found.
 *
 * @param {string} name - User's name
 * @returns {Promise<string>} Unique database name (e.g., "johndoe1")
 *
 * @example
 * // For name "john doe" with existing "johndoe" database
 * // Returns "johndoe1"
 */
async function generateDatabaseName(name) {
  // Combine all words and convert to lowercase
  const allWords = name.trim().toLowerCase().split(/\s+/);

  // Clean all words (remove special characters, keep only alphanumeric)
  const baseUrl = allWords.join("").replace(/[^a-z0-9]/g, "");

  // Check if a database with this URL already exists
  // If it exists, append a number until we find an available URL
  let finalUrl = baseUrl;
  let counter = 1;
  let isAvailable = false;
  const maxRetries = 1000; // Safety limit to prevent infinite loops

  while (!isAvailable && counter <= maxRetries) {
    const existingCheck = await db.query(
      `SELECT id FROM databases WHERE url = $1`,
      [finalUrl]
    );

    if (existingCheck.rows.length === 0) {
      // URL is available, use it
      isAvailable = true;
    } else {
      // URL exists, append counter and try again
      finalUrl = `${baseUrl}${counter}`;
      counter++;
    }
  }

  if (!isAvailable) {
    throw new Error(`Could not generate unique database URL after ${maxRetries} attempts`);
  }

  return finalUrl;
}

module.exports = { db, generateDatabaseName };