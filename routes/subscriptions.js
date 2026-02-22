"use strict";

const express = require("express");
const jsonschema = require("jsonschema");
const { ensureLoggedIn, ensureSuperAdmin, ensurePlatformAdmin, ensureUserCanAccessAccountByParam } = require("../middleware/auth");
const { BadRequestError } = require("../expressError");
const Subscription = require("../models/subscription");
const subscriptionNewSchema = require("../schemas/subscriptionNew.json");
const subscriptionUpdateSchema = require("../schemas/subscriptionUpdate.json");

const router = express.Router();

/** GET / - List subscriptions. Query: status, accountId. Platform admin only. */
router.get("/", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const { status, accountId } = req.query;
    const subscriptions = await Subscription.getAll({
      status,
      accountId: accountId ? Number(accountId) : undefined,
    });
    return res.json({ subscriptions });
  } catch (err) {
    return next(err);
  }
});

/** GET /summary - Aggregate counts by status and product. Platform admin only. */
router.get("/summary", ensurePlatformAdmin, async function (req, res, next) {
  try {
    const summary = await Subscription.getSummary();
    return res.json({ summary });
  } catch (err) {
    return next(err);
  }
});

/** GET /account/:accountId - List subscriptions for account. Requires account access. */
router.get("/account/:accountId", ensureLoggedIn, ensureUserCanAccessAccountByParam("accountId"), async function (req, res, next) {
  try {
    const subscriptions = await Subscription.getByAccountId(Number(req.params.accountId));
    return res.json({ subscriptions });
  } catch (err) {
    return next(err);
  }
});

/** POST /account - Create subscription for own account. Body: accountId, subscriptionProductId, etc. */
router.post("/account", ensureLoggedIn, async function (req, res, next) {
  try {
    const { accountId, subscriptionProductId, status, currentPeriodStart, currentPeriodEnd } = req.body;
    if (!accountId || !subscriptionProductId) {
      throw new BadRequestError("accountId and subscriptionProductId are required");
    }
    const userId = res.locals.user?.id;
    const Account = require("../models/account");
    const hasAccess = await Account.isUserLinkedToAccount(userId, Number(accountId));
    if (!hasAccess) {
      const { UnauthorizedError } = require("../expressError");
      throw new UnauthorizedError("You do not have access to this account");
    }
    const validator = jsonschema.validate(
      { accountId, subscriptionProductId, status: status || "active", currentPeriodStart, currentPeriodEnd },
      subscriptionNewSchema
    );
    if (!validator.valid) {
      const errs = validator.errors.map((e) => e.stack);
      throw new BadRequestError(errs);
    }
    const subscription = await Subscription.create({
      accountId: Number(accountId),
      subscriptionProductId: Number(subscriptionProductId),
      status: status || "active",
      currentPeriodStart: currentPeriodStart || new Date().toISOString(),
      currentPeriodEnd: currentPeriodEnd || (() => {
        const d = new Date();
        d.setMonth(d.getMonth() + 1);
        return d.toISOString();
      })(),
    });
    return res.status(201).json({ subscription });
  } catch (err) {
    return next(err);
  }
});

/** GET /:id - Get single subscription. */
router.get("/:id", ensureLoggedIn, async function (req, res, next) {
  try {
    const subscription = await Subscription.get(Number(req.params.id));
    return res.json({ subscription });
  } catch (err) {
    return next(err);
  }
});

/** POST / - Create subscription. Super admin only. */
router.post("/", ensureSuperAdmin, async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, subscriptionNewSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }
    const subscription = await Subscription.create(req.body);
    return res.status(201).json({ subscription });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /:id - Update subscription. Super admin only. */
router.patch("/:id", ensureSuperAdmin, async function (req, res, next) {
  try {
    const validator = jsonschema.validate(req.body, subscriptionUpdateSchema);
    if (!validator.valid) {
      const errs = validator.errors.map(e => e.stack);
      throw new BadRequestError(errs);
    }
    const subscription = await Subscription.update(Number(req.params.id), req.body);
    return res.json({ subscription });
  } catch (err) {
    return next(err);
  }
});

/** DELETE /:id - Remove subscription. Super admin only. */
router.delete("/:id", ensureSuperAdmin, async function (req, res, next) {
  try {
    await Subscription.remove(Number(req.params.id));
    return res.json({ deleted: Number(req.params.id) });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
