"use strict";

const db = require("../db.js");
const { NotFoundError } = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

class ProfessionalCategory {
  static async create({ name, description, type = "child", parent_id, icon, image_key, sort_order = 0 }) {
    const result = await db.query(
      `INSERT INTO professional_categories
         (name, description, type, parent_id, icon, image_key, sort_order)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, name, description, type, parent_id, icon, image_key,
                 sort_order, is_active, created_at, updated_at`,
      [name, description || null, type, parent_id || null, icon || null, image_key || null, sort_order],
    );
    return result.rows[0];
  }

  static async getAll() {
    const result = await db.query(
      `SELECT id, name, description, type, parent_id, icon, image_key,
              sort_order, is_active, created_at, updated_at
       FROM professional_categories
       ORDER BY sort_order, name`,
    );
    return result.rows;
  }

  static async getHierarchy() {
    const all = await this.getAll();
    const parents = all.filter((c) => c.type === "parent");
    const children = all.filter((c) => c.type === "child");

    const countsResult = await db.query(
      `SELECT category_id AS id, COUNT(*)::int AS cnt FROM professionals
       WHERE is_active = true AND category_id IS NOT NULL
       GROUP BY category_id
       UNION ALL
       SELECT subcategory_id AS id, COUNT(*)::int AS cnt FROM professionals
       WHERE is_active = true AND subcategory_id IS NOT NULL
       GROUP BY subcategory_id`
    );
    const counts = {};
    for (const row of countsResult.rows) {
      counts[row.id] = (counts[row.id] || 0) + row.cnt;
    }

    return parents.map((p) => ({
      ...p,
      professional_count: counts[p.id] || 0,
      children: children
        .filter((c) => c.parent_id === p.id)
        .map((c) => ({ ...c, professional_count: counts[c.id] || 0 })),
    }));
  }

  static async get(id) {
    const result = await db.query(
      `SELECT id, name, description, type, parent_id, icon, image_key,
              sort_order, is_active, created_at, updated_at
       FROM professional_categories
       WHERE id = $1`,
      [id],
    );
    const cat = result.rows[0];
    if (!cat) throw new NotFoundError(`No category: ${id}`);
    return cat;
  }

  static async getChildren(parentId) {
    const result = await db.query(
      `SELECT id, name, description, type, parent_id, icon, image_key,
              sort_order, is_active, created_at, updated_at
       FROM professional_categories
       WHERE parent_id = $1
       ORDER BY sort_order, name`,
      [parentId],
    );
    return result.rows;
  }

  static async update(id, data) {
    const { setCols, values } = sqlForPartialUpdate(data, {
      parent_id: "parent_id",
      image_key: "image_key",
      sort_order: "sort_order",
      is_active: "is_active",
    });
    const idx = "$" + (values.length + 1);
    const result = await db.query(
      `UPDATE professional_categories SET ${setCols}, updated_at = NOW()
       WHERE id = ${idx}
       RETURNING id, name, description, type, parent_id, icon, image_key,
                 sort_order, is_active, created_at, updated_at`,
      [...values, id],
    );
    const cat = result.rows[0];
    if (!cat) throw new NotFoundError(`No category: ${id}`);
    return cat;
  }

  static async remove(id) {
    const result = await db.query(
      `DELETE FROM professional_categories WHERE id = $1 RETURNING id`,
      [id],
    );
    if (!result.rows[0]) throw new NotFoundError(`No category: ${id}`);
  }
}

module.exports = ProfessionalCategory;
