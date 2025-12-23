"use strict";

const express = require("express");
const { ensureDatabaseUser } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const Product = require("../models/product");
const productNewSchema = require("../schemas/productNew.json");
const productUpdateSchema = require("../schemas/productUpdate.json");
const jsonschema = require("jsonschema");
const router = new express.Router();

/** POST / { product } =>  { product }
 *
 * product should be { database_id, name, for_sale, for_purchase, type_id, track_inventory,
 *                    quantity_on_hand, sales_price, cost, reference, barcode, responsible_id,
 *                    weight, weight_unit, volume, volume_unit, lead_time, lead_time_unit,
 *                    delivery_note, categories, sales_taxes, purchase_taxes, vendors }
 *
 * Returns { id, database_id, name, for_sale, for_purchase, type_id, track_inventory,
 *           quantity_on_hand, sales_price, cost, reference, barcode, responsible_id,
 *           weight, weight_unit, volume, volume_unit, lead_time, lead_time_unit,
 *           delivery_note, created_at, updated_at }
 *
 * Authorization required: database user
 */

router.post("/", ensureDatabaseUser, async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, productNewSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }

    const product = await Product.create(req.body);
    return res.status(201).json({ product });
  } catch (err) {
    return next(err);
  }
});

/** GET / => { products: [ { id, database_id, name, for_sale, for_purchase, type_id,
 *                          track_inventory, quantity_on_hand, sales_price, cost,
 *                          reference, barcode, responsible_id, weight, weight_unit,
 *                          volume, volume_unit, lead_time, lead_time_unit,
 *                          delivery_note, created_at, updated_at }, ... ] }
 *
 * Returns list of all products for the database.
 *
 * Authorization required: database user
 */

router.get("/", ensureDatabaseUser, async function (req, res, next) {
  try {
    const products = await Product.getAll(res.locals.databaseId);
    return res.json({ products });
  } catch (err) {
    return next(err);
  }
});

/** GET /[id] => { product }
 *
 * Returns { id, database_id, name, for_sale, for_purchase, type_id, track_inventory,
 *           quantity_on_hand, sales_price, cost, reference, barcode, responsible_id,
 *           weight, weight_unit, volume, volume_unit, lead_time, lead_time_unit,
 *           delivery_note, created_at, updated_at, categories, sales_taxes,
 *           purchase_taxes, vendors }
 *
 * Authorization required: database user
 */

router.get("/:id", ensureDatabaseUser, async function (req, res, next) {
  try {
    const product = await Product.get(req.params.id);
    return res.json({ product });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /[id] { fld1, fld2, ... } => { product }
 *
 * Patches product data.
 *
 * fields can be: { name, for_sale, for_purchase, type_id, track_inventory,
 *                 quantity_on_hand, sales_price, cost, reference, barcode,
 *                 responsible_id, weight, weight_unit, volume, volume_unit,
 *                 lead_time, lead_time_unit, delivery_note, categories,
 *                 sales_taxes, purchase_taxes, vendors }
 *
 * Returns { id, database_id, name, for_sale, for_purchase, type_id, track_inventory,
 *           quantity_on_hand, sales_price, cost, reference, barcode, responsible_id,
 *           weight, weight_unit, volume, volume_unit, lead_time, lead_time_unit,
 *           delivery_note, created_at, updated_at }
 *
 * Authorization required: database user
 */

router.patch("/:id", ensureDatabaseUser, async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, productUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }

    const product = await Product.update(req.params.id, req.body);
    return res.json({ product });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /[id]  =>  { deleted: id }
 *
 * Authorization required: database user
 */

router.delete("/:id", ensureDatabaseUser, async function (req, res, next) {
  try {
    await Product.remove(req.params.id);
    return res.json({ deleted: req.params.id });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;