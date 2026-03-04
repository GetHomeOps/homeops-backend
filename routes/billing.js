"use strict";

/**
 * Billing Routes
 *
 * - POST /checkout-session: Create Stripe Checkout URL for subscription
 * - POST /portal-session: Create Stripe Customer Portal URL
 * - GET /status: Current user/account billing status
 * - POST /webhooks/stripe: Stripe webhook (raw body, no JSON middleware)
 */

const express = require("express");
const { ensureLoggedIn, ensureSuperAdmin } = require("../middleware/auth");
const { BadRequestError, ForbiddenError } = require("../expressError");
const db = require("../db");
const stripeService = require("../services/stripeService");
const planModel = require("../models/plan");
const { BILLING_MOCK_MODE } = require("../config");

const router = express.Router();

/** POST /billing/checkout-session
 *  Body: { planCode, billingInterval?, accountId?, successUrl?, cancelUrl? }
 *  Returns: { url }
 */
router.post("/checkout-session", ensureLoggedIn, async function (req, res, next) {
  try {
    const userId = res.locals.user?.id;
    if (!userId) throw new ForbiddenError("Authentication required");

    const { planCode, billingInterval = "month", accountId, successUrl, cancelUrl } = req.body || {};
    if (!planCode) throw new BadRequestError("planCode is required");

    let accountIdToUse = accountId;
    if (!accountIdToUse) {
      const acc = await db.query(
        `SELECT account_id FROM account_users WHERE user_id = $1 ORDER BY (account_id IN (SELECT id FROM accounts WHERE owner_user_id = $1)) DESC LIMIT 1`,
        [userId, userId]
      );
      if (!acc.rows[0]) throw new BadRequestError("No account found. Complete signup first.");
      accountIdToUse = acc.rows[0].account_id;
    }

    const hasAccess = await db.query(
      `SELECT 1 FROM account_users WHERE account_id = $1 AND user_id = $2`,
      [accountIdToUse, userId]
    );
    if (!hasAccess.rows[0]) throw new ForbiddenError("Access denied to this account");

    const userRes = await db.query(
      `SELECT email, name FROM users WHERE id = $1`,
      [userId]
    );
    const user = userRes.rows[0];

    const { url } = await stripeService.createCheckoutSession({
      accountId: accountIdToUse,
      userId,
      planCode,
      billingInterval,
      successUrl,
      cancelUrl,
      customerEmail: user?.email,
      customerName: user?.name,
    });

    return res.json({ url });
  } catch (err) {
    return next(err);
  }
});

/** POST /billing/portal-session
 *  Body: { accountId?, returnUrl? }
 *  Returns: { url }
 */
router.post("/portal-session", ensureLoggedIn, async function (req, res, next) {
  try {
    const userId = res.locals.user?.id;
    if (!userId) throw new ForbiddenError("Authentication required");

    const { accountId, returnUrl } = req.body || {};
    let accountIdToUse = accountId;
    if (!accountIdToUse) {
      const acc = await db.query(
        `SELECT account_id FROM account_users WHERE user_id = $1 LIMIT 1`,
        [userId]
      );
      if (!acc.rows[0]) throw new BadRequestError("No account found");
      accountIdToUse = acc.rows[0].account_id;
    }

    const hasAccess = await db.query(
      `SELECT 1 FROM account_users WHERE account_id = $1 AND user_id = $2`,
      [accountIdToUse, userId]
    );
    if (!hasAccess.rows[0]) throw new ForbiddenError("Access denied to this account");

    const { url } = await stripeService.createPortalSession(accountIdToUse, userId, returnUrl);
    return res.json({ url });
  } catch (err) {
    return next(err);
  }
});

/** GET /billing/status
 *  Query: accountId (optional) - defaults to user's primary account.
 *  Returns current subscription, plan, limits, usage.
 */
router.get("/status", ensureLoggedIn, async function (req, res, next) {
  try {
    const userId = res.locals.user?.id;
    if (!userId) throw new ForbiddenError("Authentication required");

    let accountId = req.query.accountId ? parseInt(req.query.accountId, 10) : null;
    if (!accountId) {
      const accRes = await db.query(
        `SELECT account_id FROM account_users WHERE user_id = $1 ORDER BY (account_id IN (SELECT id FROM accounts WHERE owner_user_id = $1)) DESC LIMIT 1`,
        [userId, userId]
      );
      accountId = accRes.rows[0]?.account_id;
    }
    if (!accountId) {
      return res.json({ subscription: null, plan: null, limits: null, usage: null, mockMode: BILLING_MOCK_MODE });
    }

    const hasAccess = await db.query(
      `SELECT 1 FROM account_users WHERE account_id = $1 AND user_id = $2`,
      [accountId, userId]
    );
    if (!hasAccess.rows[0]) throw new ForbiddenError("Access denied to this account");

    const acc = await db.query(
      `SELECT a.id, a.name, a.stripe_customer_id
       FROM accounts a WHERE a.id = $1`,
      [accountId]
    );
    if (!acc.rows[0]) {
      return res.json({ subscription: null, plan: null, limits: null, usage: null, mockMode: BILLING_MOCK_MODE });
    }

    if (BILLING_MOCK_MODE) {
      const plan = await planModel.getByCode("homeowner_maintain").catch(() => null);
      return res.json({
        subscription: { status: "active", mockMode: true },
        plan: plan || null,
        limits: plan?.limits || null,
        usage: { propertiesCount: 0, contactsCount: 0, aiTokensUsed: 0 },
        mockMode: true,
      });
    }

    const subRes = await db.query(
      `SELECT asub.id, asub.status, asub.current_period_start AS "currentPeriodStart",
              asub.current_period_end AS "currentPeriodEnd", asub.cancel_at_period_end AS "cancelAtPeriodEnd",
              sp.code, sp.name, sp.trial_days AS "trialDays"
       FROM account_subscriptions asub
       JOIN subscription_products sp ON sp.id = asub.subscription_product_id
       WHERE asub.account_id = $1 AND asub.status IN ('active', 'trialing')
       ORDER BY asub.current_period_end DESC NULLS LAST
       LIMIT 1`,
      [accountId]
    );

    const subscription = subRes.rows[0] || null;
    let plan = null;
    let limits = null;

    if (subscription) {
      plan = { code: subscription.code, name: subscription.name, trialDays: subscription.trialDays };
      const limRes = await db.query(
        `SELECT max_properties AS "maxProperties", max_contacts AS "maxContacts",
                max_viewers AS "maxViewers", max_team_members AS "maxTeamMembers",
                ai_token_monthly_quota AS "aiTokenMonthlyQuota",
                max_documents_per_system AS "maxDocumentsPerSystem"
         FROM plan_limits pl
         JOIN subscription_products sp ON sp.id = pl.subscription_product_id
         WHERE sp.code = $1`,
        [subscription.code]
      );
      limits = limRes.rows[0] || null;
    } else {
      const freePlan = await db.query(
        `SELECT sp.code, sp.name FROM subscription_products sp WHERE sp.code = 'homeowner_free' LIMIT 1`
      );
      if (freePlan.rows[0]) {
        plan = { code: freePlan.rows[0].code, name: freePlan.rows[0].name };
        const limRes = await db.query(
          `SELECT max_properties AS "maxProperties", max_contacts AS "maxContacts",
                  max_viewers AS "maxViewers", max_team_members AS "maxTeamMembers",
                  ai_token_monthly_quota AS "aiTokenMonthlyQuota",
                  max_documents_per_system AS "maxDocumentsPerSystem"
           FROM plan_limits pl
           JOIN subscription_products sp ON sp.id = pl.subscription_product_id
           WHERE sp.code = 'homeowner_free'`
        );
        limits = limRes.rows[0] || null;
      }
    }

    const usageRes = await db.query(
      `SELECT
         (SELECT COUNT(*)::int FROM properties WHERE account_id = $1) AS "propertiesCount",
         (SELECT COUNT(*)::int FROM account_contacts WHERE account_id = $1) AS "contactsCount"`,
      [accountId]
    );
    const usage = usageRes.rows[0] || { propertiesCount: 0, contactsCount: 0 };

    const tokensRes = await db.query(
      `SELECT COALESCE(SUM(prompt_tokens + completion_tokens), 0)::bigint AS "aiTokensUsed"
       FROM user_api_usage WHERE user_id = $1 AND created_at >= date_trunc('month', CURRENT_TIMESTAMP)`,
      [userId]
    );
    usage.aiTokensUsed = Number(tokensRes.rows[0]?.aiTokensUsed || 0);

    return res.json({
      subscription: subscription ? {
        status: subscription.status,
        currentPeriodStart: subscription.currentPeriodStart,
        currentPeriodEnd: subscription.currentPeriodEnd,
        cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
      } : null,
      plan,
      limits,
      usage,
      mockMode: false,
    });
  } catch (err) {
    return next(err);
  }
});

/** GET /billing/plans/:audience - Get plans for homeowner or agent (for plan selection UI) */
router.get("/plans/:audience", ensureLoggedIn, async function (req, res, next) {
  try {
    const audience = req.params.audience;
    if (!["homeowner", "agent"].includes(audience)) {
      throw new BadRequestError("audience must be homeowner or agent");
    }
    const plans = await planModel.getPlansForAudience(audience);
    return res.json({ plans });
  } catch (err) {
    return next(err);
  }
});

/** GET /billing/plans - List all plans (Super Admin only) */
router.get("/plans", ensureLoggedIn, ensureSuperAdmin, async function (req, res, next) {
  try {
    const plans = await planModel.getAll();
    return res.json({ plans });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /billing/plans/:id - Update plan (Super Admin only) */
router.patch("/plans/:id", ensureLoggedIn, ensureSuperAdmin, async function (req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new BadRequestError("Invalid plan ID");
    const plan = await planModel.updatePlan(id, req.body);
    return res.json({ plan });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /billing/plans/:id/limits - Update plan limits (Super Admin only) */
router.patch("/plans/:id/limits", ensureLoggedIn, ensureSuperAdmin, async function (req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new BadRequestError("Invalid plan ID");
    const plan = await planModel.updatePlanLimits(id, req.body);
    return res.json({ plan });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /billing/plans/:id/popular - Toggle "most popular" (Super Admin only). Clears siblings of same role. */
router.patch("/plans/:id/popular", ensureLoggedIn, ensureSuperAdmin, async function (req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new BadRequestError("Invalid plan ID");
    const { popular } = req.body;
    if (typeof popular !== "boolean") throw new BadRequestError("popular must be a boolean");
    const plan = await planModel.setPopular(id, popular);
    return res.json({ plan });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /billing/plans/:id/prices - Update plan price (Super Admin only) */
router.patch("/plans/:id/prices", ensureLoggedIn, ensureSuperAdmin, async function (req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new BadRequestError("Invalid plan ID");
    const { billingInterval, stripePriceId } = req.body;
    if (!billingInterval) throw new BadRequestError("billingInterval is required");
    const plan = await planModel.updatePlanPrice(id, billingInterval, stripePriceId || null);
    return res.json({ plan });
  } catch (err) {
    return next(err);
  }
});

/** GET /billing/stripe/prices - List active Stripe prices for admin dropdown */
router.get("/stripe/prices", ensureLoggedIn, ensureSuperAdmin, async function (req, res, next) {
  try {
    const prices = await stripeService.listActivePrices();
    return res.json({ prices });
  } catch (err) {
    return next(err);
  }
});

/** PATCH /billing/plans/:id/features - Update plan features (Super Admin only) */
router.patch("/plans/:id/features", ensureLoggedIn, ensureSuperAdmin, async function (req, res, next) {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) throw new BadRequestError("Invalid plan ID");
    const { features } = req.body;
    if (!features) throw new BadRequestError("features array is required");
    const plan = await planModel.updatePlanFeatures(id, features);
    return res.json({ plan });
  } catch (err) {
    return next(err);
  }
});

/** POST /billing/sync - Force sync subscription from Stripe (Super Admin debug only) */
router.post("/sync", ensureLoggedIn, ensureSuperAdmin, async function (req, res, next) {
  try {
    if (BILLING_MOCK_MODE || !stripeService.stripe) {
      return res.json({ message: "Stripe not configured or mock mode enabled" });
    }
    const { accountId } = req.body || {};
    if (!accountId) throw new BadRequestError("accountId required");
    const acc = await db.query(
      `SELECT stripe_customer_id FROM accounts WHERE id = $1`,
      [accountId]
    );
    if (!acc.rows[0]?.stripe_customer_id) {
      return res.json({ message: "No Stripe customer for this account" });
    }
    const subscriptions = await stripeService.stripe.subscriptions.list({
      customer: acc.rows[0].stripe_customer_id,
      status: "all",
      limit: 10,
    });
    if (!subscriptions?.data?.length) {
      return res.json({ message: "No subscriptions found in Stripe" });
    }
    for (const sub of subscriptions.data) {
      const full = await stripeService.stripe.subscriptions.retrieve(sub.id, { expand: ["items.data.price"] });
      await stripeService.handleSubscriptionUpdated(full);
    }
    return res.json({ message: "Sync complete", count: subscriptions.data.length });
  } catch (err) {
    return next(err);
  }
});

module.exports = router;
