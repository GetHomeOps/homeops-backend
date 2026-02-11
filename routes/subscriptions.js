"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureLoggedIn, ensureSuperAdmin } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const Subscription = require("../models/subscription");
const subscriptionNewSchema = require("../schemas/subscriptionNew.json");
const subscriptionUpdateSchema = require("../schemas/subscriptionUpdate.json");

const router = express.Router();

/** GET / => { subscriptions: [...] }
 *
 * Get all subscriptions. Supports query-string filters:
 *   ?status=active&type=free&userId=1
 *
 * Authorization: super_admin only
 */
router.get("/", ensureSuperAdmin, async function (req, res, next) {
  try {
    const { status, type, userId } = req.query;
    const subscriptions = await Subscription.getAll({
      status,
      type,
      userId: userId ? Number(userId) : undefined,
    });
    return res.json({ subscriptions });
  } catch (err) {
    return next(err);
  }
});

/** GET /products => { products: [...] }
 *
 * Get all subscription products (for dropdown in forms).
 *
 * Authorization: super_admin only
 */
router.get("/products", ensureSuperAdmin, async function (req, res, next) {
  try {
    const products = await Subscription.getAllProducts();
    return res.json({ products });
  } catch (err) {
    return next(err);
  }
});

/** GET /summary => { summary }
 *
 * Get aggregated subscription counts by type and status.
 *
 * Authorization: super_admin only
 */
router.get("/summary", ensureSuperAdmin, async function (req, res, next) {
  try {
    const summary = await Subscription.getSummary();
    return res.json({ summary });
  } catch (err) {
    return next(err);
  }
});

/** GET /user/:userId => { subscriptions: [...] }
 *
 * Get subscriptions for a specific user.
 *
 * Authorization: logged in
 */
router.get("/user/:userId", ensureLoggedIn, async function (req, res, next) {
  try {
    const subscriptions = await Subscription.getByUserId(Number(req.params.userId));
    return res.json({ subscriptions });
  } catch (err) {
    return next(err);
  }
});

/** GET /:id => { subscription }
 *
 * Get a single subscription by id.
 *
 * Authorization: logged in
 */
router.get("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    const subscription = await Subscription.get(Number(req.params.id));
    return res.json({ subscription });
  } catch (err) {
    return next(err);
  }
});

/** POST / { subscription } => { subscription }
 *
 * Create a new subscription.
 *
 * Body: { userId, subscriptionType, subscriptionStatus, subscriptionStartDate, subscriptionEndDate }
 *
 * Authorization: super_admin only
 */
router.post("/", ensureSuperAdmin, async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, subscriptionNewSchema);
    if (!validator.valid) {
      const errs = validator.errors.map((e) => e.stack);
      throw new BadRequestError(errs);
    }

    const subscription = await Subscription.create(req.body);
    return res.status(201).json({ subscription });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /:id { subscription } => { subscription }
 *
 * Update a subscription.
 *
 * Body can include: { subscriptionType, subscriptionStatus, subscriptionStartDate, subscriptionEndDate }
 *
 * Authorization: super_admin only
 */
router.patch("/:id", ensureSuperAdmin, async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, subscriptionUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map((e) => e.stack);
      throw new BadRequestError(errs);
    }

    const subscription = await Subscription.update(Number(req.params.id), req.body);
    return res.json({ subscription });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /:id
 *
 * Remove a subscription.
 *
 * Authorization: super_admin only
 */
router.delete("/:id", ensureSuperAdmin, async function (req, res, next) {
  try {
    await Subscription.remove(Number(req.params.id));
    return res.json({ deleted: Number(req.params.id) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
