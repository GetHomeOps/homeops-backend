"use strict";

const { ulid } = require("ulid");
const db = require("../db");
const { BadRequestError, NotFoundError } = require("../expressError");
const { generatePassportId } = require("../helpers/properties");
const { sqlForPartialUpdate } = require("../helpers/sql");

/** Insertable columns for properties (matches pos-schema.sql; excludes id, created_at, updated_at) */
const PROPERTY_INSERT_COLUMNS = [
  "property_uid",
  "passport_id", "property_name", "main_photo", "tax_id", "county",
  "address", "address_line_1", "address_line_2", "city", "state", "zip",
  "owner_name", "owner_name_2", "owner_city", "occupant_name", "occupant_type",
  "owner_phone", "phone_to_show", "property_type", "sub_type", "roof_type",
  "year_built", "effective_year_built", "effective_year_built_source",
  "sq_ft_total", "sq_ft_finished", "sq_ft_unfinished", "garage_sq_ft",
  "total_dwelling_sq_ft", "sq_ft_source", "lot_size", "lot_size_source",
  "lot_dim", "price_per_sq_ft", "total_price_per_sq_ft",
  "bed_count", "bath_count", "full_baths", "three_quarter_baths", "half_baths",
  "number_of_showers", "number_of_bathtubs", "fireplaces", "fireplace_types",
  "basement", "parking_type", "total_covered_parking", "total_uncovered_parking",
  "school_district", "elementary_school", "junior_high_school", "senior_high_school",
  "school_district_websites", "list_date", "expire_date",
];

/** Integer columns – coerce string to int; default 0 when missing/invalid */
const PROPERTY_INTEGER_COLUMNS = new Set([
  "year_built", "effective_year_built", "bed_count", "bath_count", "full_baths",
  "three_quarter_baths", "half_baths", "number_of_showers", "number_of_bathtubs",
  "fireplaces", "total_covered_parking", "total_uncovered_parking",
]);
/** Numeric (decimal) columns – coerce string to number; default 0 when missing/invalid */
const PROPERTY_NUMBER_COLUMNS = new Set([
  "sq_ft_total", "sq_ft_finished", "sq_ft_unfinished", "garage_sq_ft", "total_dwelling_sq_ft",
]);

const DEFAULT_YEAR = 0;  // use 0 for unknown year; set to e.g. new Date().getFullYear() for "current year"

function coerceValue(key, val) {
  if (val === undefined || val === null || val === "") return null;
  if (PROPERTY_INTEGER_COLUMNS.has(key)) {
    const n = Number(val);
    return Number.isNaN(n) ? DEFAULT_YEAR : Math.floor(n);
  }
  if (PROPERTY_NUMBER_COLUMNS.has(key)) {
    const n = Number(val);
    return Number.isNaN(n) ? 0 : n;
  }
  return val;
}

class Property {
  /* Get all properties */
  static async getAll() {
    const result = await db.query(
      `SELECT * FROM properties`
    );
    return result.rows;
  }

  /* Create a new property from provided data (any subset of columns) */
  static async create(data = {}) {
    const withUid = { ...data, property_uid: data.property_uid || ulid() };
    if (!withUid.passport_id && withUid.state != null && withUid.zip != null) {
      withUid.passport_id = generatePassportId({ state: withUid.state, zip: withUid.zip });
    }
    const keys = Object.keys(withUid).filter((k) => PROPERTY_INSERT_COLUMNS.includes(k));
    if (keys.length === 0) {
      throw new BadRequestError("No valid property data provided");
    }
    const values = keys.map((k) => (k === "property_uid" ? withUid.property_uid : coerceValue(k, withUid[k])));
    const cols = keys.map((k) => `"${k}"`).join(", ");
    const placeholders = values.map((_, i) => `$${i + 1}`).join(", ");
    const result = await db.query(
      `INSERT INTO properties (${cols})
       VALUES (${placeholders})
       RETURNING id, property_uid, passport_id, address, city, state, zip`,
      values
    );
    return result.rows[0];
  }

  /* Add user to property (upsert: update role if already exists) */
  static async addUserToProperty({ property_id, user_id, role }) {
    const result = await db.query(
      `INSERT INTO property_users (property_id, user_id, role)
       VALUES ($1, $2, $3)
       ON CONFLICT (property_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()
       RETURNING property_id, user_id, role`,
      [property_id, user_id, role]
    );
    return result.rows[0];
  }

  /* Get property by property uid */
  static async get(uid) {
    try {
      const result = await db.query(
        `SELECT * FROM properties WHERE property_uid = $1`,
        [uid]
      );
      const property = result.rows[0];
      if (!property) throw new NotFoundError(`No property with uid: ${uid}`);
      return property;
    } catch (err) {
      throw err;
    }
  }

  /* Get Property agent by Database ID */
  static async getAgentByDbId(database_id) {
    const result = await db.query(
      `SELECT u.id,
              u.email,
              u.name,
              u.phone,
              u.role
       FROM agent_databases ad
       JOIN users u ON u.id = ad.agent_id
       WHERE ad.database_id = $1
       ORDER BY u.name`,
      [database_id]
    );
    console.log("result.rows:", result.rows);
    return result.rows;
  }

  /* Get properties by users's id */
  static async getPropertiesByUserId(userId) {
    const result = await db.query(
      `SELECT p.* FROM properties p
       JOIN property_users pu ON p.id = pu.property_id
       WHERE pu.user_id = $1`,
      [userId]
    );
    return result.rows;
  }

  /* Get team for property: returns actual user records with their role on this property */
  static async getPropertyTeam(propertyId) {
    const result = await db.query(
      `SELECT u.id, u.email, u.name, u.phone, u.role, u.is_active, u.contact_id, u.image,
              pu.role AS property_role
       FROM property_users pu
       JOIN users u ON u.id = pu.user_id
       WHERE pu.property_id = $1
       ORDER BY u.name`,
      [propertyId]
    );
    return result.rows;
  }

  /* Update property */
  static async updateProperty(id, data) {
    const { setCols, values } = sqlForPartialUpdate(data, {
      passport_id: "passport_id",
      property_name: "property_name",
      main_photo: "main_photo",
      tax_id: "tax_id",
      county: "county",
      address: "address",
      address_line_1: "address_line_1",
      address_line_2: "address_line_2",
      city: "city",
      state: "state",
      zip: "zip",
      owner_name: "owner_name",
      owner_name_2: "owner_name_2",
      owner_city: "owner_city",
      occupant_name: "occupant_name",
      occupant_type: "occupant_type",
      owner_phone: "owner_phone",
      phone_to_show: "phone_to_show",
      property_type: "property_type",
      sub_type: "sub_type",
      roof_type: "roof_type",
      year_built: "year_built",
      effective_year_built: "effective_year_built",
      effective_year_built_source: "effective_year_built_source",
      sq_ft_total: "sq_ft_total",
      sq_ft_finished: "sq_ft_finished",
      sq_ft_unfinished: "sq_ft_unfinished",
      garage_sq_ft: "garage_sq_ft",
      total_dwelling_sq_ft: "total_dwelling_sq_ft",
      sq_ft_source: "sq_ft_source",
      lot_size: "lot_size",
      lot_size_source: "lot_size_source",
      lot_dim: "lot_dim",
      price_per_sq_ft: "price_per_sq_ft",
      total_price_per_sq_ft: "total_price_per_sq_ft",
      bed_count: "bed_count",
      bath_count: "bath_count",
      full_baths: "full_baths",
      three_quarter_baths: "three_quarter_baths",
      half_baths: "half_baths",
      number_of_showers: "number_of_showers",
      number_of_bathtubs: "number_of_bathtubs",
      fireplaces: "fireplaces",
      fireplace_types: "fireplace_types",
      basement: "basement",
      parking_type: "parking_type",
      total_covered_parking: "total_covered_parking",
      total_uncovered_parking: "total_uncovered_parking",
      school_district: "school_district",
      elementary_school: "elementary_school",
      junior_high_school: "junior_high_school",
      senior_high_school: "senior_high_school",
      school_district_websites: "school_district_websites",
      list_date: "list_date",
      expire_date: "expire_date",
    });
    const idVarIdx = "$" + (values.length + 1);

    const querySql = `UPDATE properties
                      SET ${setCols}
                      WHERE id = ${idVarIdx}
                      RETURNING id,
                                property_uid,
                                passport_id,
                                address,
                                city,
                                state,
                                zip`;
    const result = await db.query(querySql, [...values, id]);
    const property = result.rows[0];

    if (!property) throw new NotFoundError(`No property: ${id}`);

    return property;
  }

  /** Sync property_users to the given array of users.
   *  1. Load current (property_id, user_id) pairs for this property.
   *  2. Diff: remove pairs that are not in the new array; add/update pairs that are in the new array.
   *  Preserves created_at for users that stay; only DELETE removed, INSERT/UPDATE the rest.
   *
   *  Time: O(M + N) — M = current rows for property, N = desired list size. Constant 3–4 queries.
   *
   *  @param {number} propertyId - internal property id
   *  @param {Array<{ id: number, role?: string }>} users - desired team (id = user_id, role defaults to 'agent')
   *  @returns {Promise<Array>} rows from property_users for this property after sync
   */
  static async updatePropertyUsers(propertyId, users) {
    if (!Array.isArray(users)) throw new BadRequestError("users must be an array");
    const ALLOWED_ROLES = ["admin", "agent", "homeowner"];
    const normalizeRole = (r) => (ALLOWED_ROLES.includes(r) ? r : r === "super_admin" ? "admin" : "agent");

    const byId = new Map();
    for (const u of users) byId.set(u.id, u);
    const uniqueUsers = Array.from(byId.values());
    const newIds = new Set(uniqueUsers.map((u) => u.id));

    await db.query("BEGIN");
    try {
      const current = await db.query(
        "SELECT user_id FROM property_users WHERE property_id = $1",
        [propertyId]
      );
      const currentIds = new Set(current.rows.map((r) => r.user_id));
      const toRemove = [...currentIds].filter((id) => !newIds.has(id));

      if (toRemove.length > 0) {
        await db.query(
          "DELETE FROM property_users WHERE property_id = $1 AND user_id = ANY($2::int[])",
          [propertyId, toRemove]
        );
      }

      if (uniqueUsers.length === 0) {
        await db.query("COMMIT");
        return [];
      }

      const placeholders = uniqueUsers.map((_, i) => `($1, $${2 + i * 2}, $${3 + i * 2})`).join(", ");
      const values = [propertyId, ...uniqueUsers.flatMap((u) => [u.id, normalizeRole(u.role || "agent")])];
      const result = await db.query(
        `INSERT INTO property_users (property_id, user_id, role)
         VALUES ${placeholders}
         ON CONFLICT (property_id, user_id) DO UPDATE SET role = EXCLUDED.role, updated_at = NOW()
         RETURNING property_id, user_id, role`,
        values
      );
      await db.query("COMMIT");
      return result.rows;
    } catch (err) {
      await db.query("ROLLBACK");
      throw err;
    }
  }
}

module.exports = Property;