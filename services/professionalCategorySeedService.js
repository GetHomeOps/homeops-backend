"use strict";

/**
 * Professional Category Seed Service
 *
 * Ensures professional categories/subcategories from data/professionalCategoriesSeed.json
 * exist in the database on startup. Skips if categories already exist.
 */

const path = require("path");
const ProfessionalCategory = require("../models/professionalCategory");

const SEED_PATH = path.join(__dirname, "..", "data", "professionalCategoriesSeed.json");

function loadSeedData() {
  try {
    return require(SEED_PATH);
  } catch (err) {
    console.warn("[categorySeed] Could not load professionalCategoriesSeed.json:", err.message);
    return [];
  }
}

/**
 * Seed professional categories from JSON if none exist.
 * @returns {{ created: number, skipped: boolean, existingCount?: number }}
 */
async function ensureProfessionalCategories() {
  const seedData = loadSeedData();
  if (seedData.length === 0) return { created: 0, skipped: false };

  const existing = await ProfessionalCategory.getAll();
  if (existing.length > 0) {
    return { created: 0, skipped: true, existingCount: existing.length };
  }

  let created = 0;
  for (const parent of seedData) {
    const parentCat = await ProfessionalCategory.create({
      name: parent.name,
      description: parent.description,
      type: "parent",
      parent_id: null,
      icon: parent.icon || null,
      sort_order: parent.sort_order || 0,
    });
    created++;

    for (const child of parent.children || []) {
      await ProfessionalCategory.create({
        name: child.name,
        description: child.description,
        type: "child",
        parent_id: parentCat.id,
        icon: null,
        sort_order: child.sort_order || 0,
      });
      created++;
    }
  }

  console.log(`[categorySeed] Seeded ${created} professional categories from professionalCategoriesSeed.json`);
  return { created, skipped: false };
}

module.exports = { ensureProfessionalCategories, loadSeedData };
