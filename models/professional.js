"use strict";

const db = require("../db.js");
const { NotFoundError } = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

class Professional {
  static async create(data) {
    const {
      first_name, last_name, company_name, category_id, subcategory_id,
      description, phone, email, website,
      street1, street2, city, state, zip_code, country, service_area,
      budget_level, languages = [], years_in_business,
      is_verified = false, license_number, profile_photo, account_id,
    } = data;

    const result = await db.query(
      `INSERT INTO professionals
         (first_name, last_name, company_name, category_id, subcategory_id,
          description, phone, email, website,
          street1, street2, city, state, zip_code, country, service_area,
          budget_level, languages, years_in_business,
          is_verified, license_number, profile_photo, account_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
       RETURNING *`,
      [
        first_name, last_name, company_name || null, category_id || null, subcategory_id || null,
        description || null, phone || null, email || null, website || null,
        street1 || null, street2 || null, city || null, state || null,
        zip_code || null, country || null, service_area || null,
        budget_level || null, languages, years_in_business || null,
        is_verified, license_number || null, profile_photo || null, account_id || null,
      ],
    );
    return result.rows[0];
  }

  static async getAll(filters = {}) {
    const conditions = ["p.is_active = true"];
    const values = [];
    let idx = 1;

    let savedJoin = "";
    let savedCol = "FALSE AS saved";
    if (filters.user_id) {
      savedJoin = `LEFT JOIN saved_professionals sp ON sp.professional_id = p.id AND sp.user_id = $${idx}`;
      savedCol = "(sp.user_id IS NOT NULL) AS saved";
      values.push(filters.user_id);
      idx++;
    }

    if (filters.category_id) {
      conditions.push(`(p.category_id = $${idx} OR p.subcategory_id = $${idx})`);
      values.push(filters.category_id);
      idx++;
    }
    if (filters.city) {
      conditions.push(`p.city ILIKE $${idx}`);
      values.push(`%${filters.city}%`);
      idx++;
    }
    if (filters.state) {
      conditions.push(`p.state ILIKE $${idx}`);
      values.push(filters.state);
      idx++;
    }
    if (filters.budget_level) {
      conditions.push(`p.budget_level = $${idx}`);
      values.push(filters.budget_level);
      idx++;
    }
    if (filters.min_rating) {
      conditions.push(`p.rating >= $${idx}`);
      values.push(filters.min_rating);
      idx++;
    }
    if (filters.language) {
      conditions.push(`$${idx} = ANY(p.languages)`);
      values.push(filters.language);
      idx++;
    }
    if (filters.is_verified) {
      conditions.push(`p.is_verified = true`);
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const result = await db.query(
      `SELECT p.*,
              pc.name AS category_name,
              sc.name AS subcategory_name,
              ${savedCol}
       FROM professionals p
       LEFT JOIN professional_categories pc ON pc.id = p.category_id
       LEFT JOIN professional_categories sc ON sc.id = p.subcategory_id
       ${savedJoin}
       ${where}
       ORDER BY p.rating DESC, p.review_count DESC`,
      values,
    );
    return result.rows;
  }

  static async get(id, userId = null) {
    const savedCol = userId
      ? `(EXISTS (SELECT 1 FROM saved_professionals sp WHERE sp.professional_id = p.id AND sp.user_id = $2)) AS saved`
      : "false AS saved";
    const values = userId ? [id, userId] : [id];
    const result = await db.query(
      `SELECT p.*,
              pc.name AS category_name,
              sc.name AS subcategory_name,
              ${savedCol}
       FROM professionals p
       LEFT JOIN professional_categories pc ON pc.id = p.category_id
       LEFT JOIN professional_categories sc ON sc.id = p.subcategory_id
       WHERE p.id = $1`,
      values,
    );
    const pro = result.rows[0];
    if (!pro) throw new NotFoundError(`No professional: ${id}`);
    return pro;
  }

  static async update(id, data) {
    const { setCols, values } = sqlForPartialUpdate(data, {
      first_name: "first_name",
      last_name: "last_name",
      company_name: "company_name",
      category_id: "category_id",
      subcategory_id: "subcategory_id",
      zip_code: "zip_code",
      service_area: "service_area",
      budget_level: "budget_level",
      years_in_business: "years_in_business",
      is_verified: "is_verified",
      license_number: "license_number",
      profile_photo: "profile_photo",
      is_active: "is_active",
      account_id: "account_id",
    });
    const idx = "$" + (values.length + 1);
    const result = await db.query(
      `UPDATE professionals SET ${setCols}, updated_at = NOW()
       WHERE id = ${idx} RETURNING *`,
      [...values, id],
    );
    const pro = result.rows[0];
    if (!pro) throw new NotFoundError(`No professional: ${id}`);
    return pro;
  }

  static async remove(id) {
    const result = await db.query(
      `DELETE FROM professionals WHERE id = $1 RETURNING id`,
      [id],
    );
    if (!result.rows[0]) throw new NotFoundError(`No professional: ${id}`);
  }

  /* ─── Project Photos ──────────────────────────────────────── */

  static async addPhoto(professionalId, photoKey, caption, sortOrder = 0) {
    const result = await db.query(
      `INSERT INTO professional_photos (professional_id, photo_key, caption, sort_order)
       VALUES ($1, $2, $3, $4)
       RETURNING id, professional_id, photo_key, caption, sort_order, created_at`,
      [professionalId, photoKey, caption || null, sortOrder],
    );
    return result.rows[0];
  }

  static async getPhotos(professionalId) {
    const result = await db.query(
      `SELECT id, professional_id, photo_key, caption, sort_order, created_at
       FROM professional_photos
       WHERE professional_id = $1
       ORDER BY sort_order, created_at`,
      [professionalId],
    );
    return result.rows;
  }

  static async removePhoto(photoId) {
    const result = await db.query(
      `DELETE FROM professional_photos WHERE id = $1 RETURNING id`,
      [photoId],
    );
    if (!result.rows[0]) throw new NotFoundError(`No photo: ${photoId}`);
  }
}

module.exports = Professional;
