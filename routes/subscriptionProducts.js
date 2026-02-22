"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureLoggedIn, ensureSuperAdmin } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const SubscriptionProduct = require("../models/subscriptionProduct");
const subscriptionProductNewSchema = require("../schemas/subscriptionProductNew.json");
const subscriptionProductUpdateSchema = require("../schemas/subscriptionProductUpdate.json");

const router = express.Router();

/** GET /for-role/:role - Get active products for role (homeowner, agent). */
router.get("/for-role/:role", ensureLoggedIn, async function (req, res, next) {
  try {
    const products = await SubscriptionProduct.getByRole(req.params.role);
    return res.json({ products });
  } catch (err) {
    return next(err);
  }
});

/** GET / - List all products. Super admin only. */
router.get("/", ensureSuperAdmin, async function (req, res, next) {
  try {
    const products = await SubscriptionProduct.getAll();
    return res.json({ products });
  } catch (err) {
    return next(err);
  }
});

/** GET /:id - Get single product. */
router.get("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    const product = await SubscriptionProduct.get(Number(req.params.id));
    return res.json({ product });
  } catch (err) {
    return next(err);
  }
});

/** POST / - Create product. Super admin only. */
router.post("/", ensureSuperAdmin, async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, subscriptionProductNewSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }
    const product = await SubscriptionProduct.create(req.body);
    return res.status(201).json({ product });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /:id - Update product. Super admin only. */
router.patch("/:id", ensureSuperAdmin, async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, subscriptionProductUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }
    const product = await SubscriptionProduct.update(Number(req.params.id), req.body);
    return res.json({ product });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /:id - Remove product. Super admin only. */
router.delete("/:id", ensureSuperAdmin, async function (req, res, next) {
  try {
    await SubscriptionProduct.remove(Number(req.params.id));
    return res.json({ deleted: Number(req.params.id) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
