"use strict";

const db = require("../db.js");
const { BadRequestError, NotFoundError } = require("../expressError");
const { sqlForPartialUpdate } = require("../helpers/sql");

/** Related functions for products. */

class Product {
  /** Create a product (from data), update db, return new product data.
   *
   * data should be { database_id, name, for_sale, for_purchase, type_id, track_inventory, quantity_on_hand, sales_price, cost, reference, barcode, responsible_id, weight, weight_unit, volume, volume_unit, lead_time, lead_time_unit, delivery_note }
   *
   * Returns { id, database_id, name, for_sale, for_purchase, type_id, track_inventory, quantity_on_hand, sales_price, cost, reference, barcode, responsible_id, weight, weight_unit, volume, volume_unit, lead_time, lead_time_unit, delivery_note, created_at, updated_at }
   *
   * Throws BadRequestError if product already exists.
   **/

  static async create(data) {
    const result = await db.query(
      `INSERT INTO products
           (database_id, name, for_sale, for_purchase, type_id, track_inventory,
            quantity_on_hand, sales_price, cost, reference, barcode, responsible_id,
            weight, weight_unit, volume, volume_unit, lead_time, lead_time_unit, delivery_note)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
           RETURNING id, database_id, name, for_sale, for_purchase, type_id, track_inventory,
                     quantity_on_hand, sales_price, cost, reference, barcode, responsible_id,
                     weight, weight_unit, volume, volume_unit, lead_time, lead_time_unit,
                     delivery_note, created_at, updated_at`,
      [
        data.database_id, data.name, data.for_sale, data.for_purchase, data.type_id,
        data.track_inventory, data.quantity_on_hand, data.sales_price, data.cost,
        data.reference, data.barcode, data.responsible_id, data.weight, data.weight_unit,
        data.volume, data.volume_unit, data.lead_time, data.lead_time_unit, data.delivery_note
      ]);
    let product = result.rows[0];

    // Add categories if provided
    if (data.categories) {
      await this.addCategories(product.id, data.categories);
    }

    // Add sales taxes if provided
    if (data.sales_taxes) {
      await this.addSalesTaxes(product.id, data.sales_taxes);
    }

    // Add purchase taxes if provided
    if (data.purchase_taxes) {
      await this.addPurchaseTaxes(product.id, data.purchase_taxes);
    }

    // Add vendors if provided
    if (data.vendors) {
      await this.addVendors(product.id, data.vendors);
    }

    return product;
  }

  /** Find all products for a specific database.
   *
   * Returns [{ id, database_id, name, for_sale, for_purchase, type_id, track_inventory,
   *           quantity_on_hand, sales_price, cost, reference, barcode, responsible_id,
   *           weight, weight_unit, volume, volume_unit, lead_time, lead_time_unit,
   *           delivery_note, created_at, updated_at }, ...]
   **/

  static async getAll(databaseId) {
    const result = await db.query(
      `SELECT id, database_id, name, for_sale, for_purchase, type_id, track_inventory,
                  quantity_on_hand, sales_price, cost, reference, barcode, responsible_id,
                  weight, weight_unit, volume, volume_unit, lead_time, lead_time_unit,
                  delivery_note, created_at, updated_at
           FROM products
           WHERE database_id = $1
           ORDER BY name`,
      [databaseId]);
    return result.rows;
  }

  /** Given a product id, return data about product.
   *
   * Returns { id, database_id, name, for_sale, for_purchase, type_id, track_inventory,
   *           quantity_on_hand, sales_price, cost, reference, barcode, responsible_id,
   *           weight, weight_unit, volume, volume_unit, lead_time, lead_time_unit,
   *           delivery_note, created_at, updated_at, categories, sales_taxes, purchase_taxes, vendors }
   *
   * Throws NotFoundError if not found.
   **/

  static async get(id) {
    const productRes = await db.query(
      `SELECT id, database_id, name, for_sale, for_purchase, type_id, track_inventory,
                  quantity_on_hand, sales_price, cost, reference, barcode, responsible_id,
                  weight, weight_unit, volume, volume_unit, lead_time, lead_time_unit,
                  delivery_note, created_at, updated_at
           FROM products
           WHERE id = $1`,
      [id]);

    const product = productRes.rows[0];

    if (!product) throw new NotFoundError(`No product: ${id}`);

    // Get categories
    const categoriesRes = await db.query(
      `SELECT c.id, c.name
           FROM prod_categories c
           JOIN products_categories pc ON pc.category_id = c.id
           WHERE pc.product_id = $1`,
      [id]);
    product.categories = categoriesRes.rows;

    // Get sales taxes
    const salesTaxesRes = await db.query(
      `SELECT t.id, t.name, t.rate
           FROM taxes t
           JOIN products_sales_taxes pst ON pst.tax_id = t.id
           WHERE pst.product_id = $1`,
      [id]);
    product.sales_taxes = salesTaxesRes.rows;

    // Get purchase taxes
    const purchaseTaxesRes = await db.query(
      `SELECT t.id, t.name, t.rate
           FROM taxes t
           JOIN products_purchase_taxes ppt ON ppt.tax_id = t.id
           WHERE ppt.product_id = $1`,
      [id]);
    product.purchase_taxes = purchaseTaxesRes.rows;

    // Get vendors
    const vendorsRes = await db.query(
      `SELECT c.id, c.name, c.type
           FROM contacts c
           JOIN products_vendors pv ON pv.vendor_id = c.id
           WHERE pv.product_id = $1`,
      [id]);
    product.vendors = vendorsRes.rows;

    return product;
  }

  /** Update product data with `data`.
   *
   * This is a "partial update" --- it's fine if data doesn't contain all the
   * fields; this only changes provided ones.
   *
   * Data can include: { name, for_sale, for_purchase, type_id, track_inventory,
   *                    quantity_on_hand, sales_price, cost, reference, barcode,
   *                    responsible_id, weight, weight_unit, volume, volume_unit,
   *                    lead_time, lead_time_unit, delivery_note }
   *
   * Returns { id, database_id, name, for_sale, for_purchase, type_id, track_inventory,
   *           quantity_on_hand, sales_price, cost, reference, barcode, responsible_id,
   *           weight, weight_unit, volume, volume_unit, lead_time, lead_time_unit,
   *           delivery_note, created_at, updated_at }
   *
   * Throws NotFoundError if not found.
   */

  static async update(id, data) {
    const { setCols, values } = sqlForPartialUpdate(
      data,
      {
        database_id: "database_id",
        for_sale: "for_sale",
        for_purchase: "for_purchase",
        type_id: "type_id",
        track_inventory: "track_inventory",
        quantity_on_hand: "quantity_on_hand",
        sales_price: "sales_price",
        cost: "cost",
        reference: "reference",
        barcode: "barcode",
        responsible_id: "responsible_id",
        weight: "weight",
        weight_unit: "weight_unit",
        volume: "volume",
        volume_unit: "volume_unit",
        lead_time: "lead_time",
        lead_time_unit: "lead_time_unit",
        delivery_note: "delivery_note"
      });
    const idVarIdx = "$" + (values.length + 1);

    const querySql = `UPDATE products
                      SET ${setCols}
                      WHERE id = ${idVarIdx}
                      RETURNING id, database_id, name, for_sale, for_purchase, type_id,
                                track_inventory, quantity_on_hand, sales_price, cost,
                                reference, barcode, responsible_id, weight, weight_unit,
                                volume, volume_unit, lead_time, lead_time_unit,
                                delivery_note, created_at, updated_at`;
    const result = await db.query(querySql, [...values, id]);
    const product = result.rows[0];

    if (!product) throw new NotFoundError(`No product: ${id}`);

    // Update categories if provided
    if (data.categories) {
      await this.removeCategories(id);
      await this.addCategories(id, data.categories);
    }

    // Update sales taxes if provided
    if (data.sales_taxes) {
      await this.removeSalesTaxes(id);
      await this.addSalesTaxes(id, data.sales_taxes);
    }

    // Update purchase taxes if provided
    if (data.purchase_taxes) {
      await this.removePurchaseTaxes(id);
      await this.addPurchaseTaxes(id, data.purchase_taxes);
    }

    // Update vendors if provided
    if (data.vendors) {
      await this.removeVendors(id);
      await this.addVendors(id, data.vendors);
    }

    return product;
  }

  /** Delete given product from database; returns undefined.
   *
   * Throws NotFoundError if product not found.
   **/

  static async remove(id) {
    const result = await db.query(
      `DELETE
           FROM products
           WHERE id = $1
           RETURNING id`,
      [id]);
    const product = result.rows[0];

    if (!product) throw new NotFoundError(`No product: ${id}`);
  }

  /** Add categories to a product.
   *
   * Returns undefined.
   **/

  static async addCategories(productId, categoryIds) {
    const values = categoryIds.map((categoryId, idx) =>
      `($${idx * 2 + 1}, $${idx * 2 + 2})`
    ).join(", ");

    const querySql = `INSERT INTO products_categories (product_id, category_id)
                      VALUES ${values}`;

    await db.query(querySql, categoryIds.flatMap(id => [productId, id]));
  }

  /** Remove all categories from a product.
   *
   * Returns undefined.
   **/

  static async removeCategories(productId) {
    await db.query(
      `DELETE FROM products_categories WHERE product_id = $1`,
      [productId]
    );
  }

  /** Add sales taxes to a product.
   *
   * Returns undefined.
   **/

  static async addSalesTaxes(productId, taxIds) {
    const values = taxIds.map((taxId, idx) =>
      `($${idx * 2 + 1}, $${idx * 2 + 2})`
    ).join(", ");

    const querySql = `INSERT INTO products_sales_taxes (product_id, tax_id)
                      VALUES ${values}`;

    await db.query(querySql, taxIds.flatMap(id => [productId, id]));
  }

  /** Remove all sales taxes from a product.
   *
   * Returns undefined.
   **/

  static async removeSalesTaxes(productId) {
    await db.query(
      `DELETE FROM products_sales_taxes WHERE product_id = $1`,
      [productId]
    );
  }

  /** Add purchase taxes to a product.
   *
   * Returns undefined.
   **/

  static async addPurchaseTaxes(productId, taxIds) {
    const values = taxIds.map((taxId, idx) =>
      `($${idx * 2 + 1}, $${idx * 2 + 2})`
    ).join(", ");

    const querySql = `INSERT INTO products_purchase_taxes (product_id, tax_id)
                      VALUES ${values}`;

    await db.query(querySql, taxIds.flatMap(id => [productId, id]));
  }

  /** Remove all purchase taxes from a product.
   *
   * Returns undefined.
   **/

  static async removePurchaseTaxes(productId) {
    await db.query(
      `DELETE FROM products_purchase_taxes WHERE product_id = $1`,
      [productId]
    );
  }

  /** Add vendors to a product.
   *
   * Returns undefined.
   **/

  static async addVendors(productId, vendorIds) {
    const values = vendorIds.map((vendorId, idx) =>
      `($${idx * 2 + 1}, $${idx * 2 + 2})`
    ).join(", ");

    const querySql = `INSERT INTO products_vendors (product_id, vendor_id)
                      VALUES ${values}`;

    await db.query(querySql, vendorIds.flatMap(id => [productId, id]));
  }

  /** Remove all vendors from a product.
   *
   * Returns undefined.
   **/

  static async removeVendors(productId) {
    await db.query(
      `DELETE FROM products_vendors WHERE product_id = $1`,
      [productId]
    );
  }
}

module.exports = Product;