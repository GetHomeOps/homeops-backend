"use strict";

/**
 * Stripe Billing Service
 *
 * Creates Checkout sessions, Customer Portal sessions, and processes webhooks.
 * All billing state is source-of-truth via webhooks; never trust client for paid status.
 */

const Stripe = require("stripe");
const db = require("../db");
const {
  STRIPE_SECRET_KEY,
  STRIPE_WEBHOOK_SECRET,
  STRIPE_SUCCESS_URL,
  STRIPE_CANCEL_URL,
  BILLING_MOCK_MODE,
} = require("../config");

const stripe = STRIPE_SECRET_KEY ? new Stripe(STRIPE_SECRET_KEY) : null;

/** Get or create Stripe customer for account. */
async function getOrCreateStripeCustomer(accountId, email, name) {
  if (BILLING_MOCK_MODE) return { id: "cus_mock" };

  const acc = await db.query(
    `SELECT a.id, a.stripe_customer_id, a.name
     FROM accounts a WHERE a.id = $1`,
    [accountId]
  );
  if (!acc.rows[0]) throw new Error("Account not found");

  const existing = acc.rows[0].stripe_customer_id;
  if (existing) return { id: existing };

  const customer = await stripe.customers.create({
    email: email || undefined,
    name: name || acc.rows[0].name,
    metadata: { account_id: String(accountId) },
  });

  await db.query(
    `UPDATE accounts SET stripe_customer_id = $1, updated_at = NOW() WHERE id = $2`,
    [customer.id, accountId]
  );
  return { id: customer.id };
}

/** Create Checkout Session for subscription. Returns { url }. */
async function createCheckoutSession({ accountId, userId, planCode, billingInterval = "month", successUrl, cancelUrl, customerEmail, customerName }) {
  if (BILLING_MOCK_MODE) {
    const base = successUrl || STRIPE_SUCCESS_URL;
    const sep = base.includes("?") ? "&" : "?";
    return { url: `${base}${sep}mock=1` };
  }

  const plan = await db.query(
    `SELECT sp.id, sp.code, sp.trial_days, pp.stripe_price_id
     FROM subscription_products sp
     LEFT JOIN plan_prices pp ON pp.subscription_product_id = sp.id AND pp.billing_interval = $1
     WHERE sp.code = $2 AND sp.is_active = true`,
    [billingInterval, planCode]
  );
  if (!plan.rows[0] || !plan.rows[0].stripe_price_id) {
    throw new Error(`Plan ${planCode} (${billingInterval}) not found or has no Stripe price configured`);
  }

  const accountRes = await db.query(
    `SELECT a.id, a.stripe_customer_id, a.name, u.email, u.name AS user_name
     FROM accounts a
     JOIN account_users au ON au.account_id = a.id AND au.user_id = $1
     JOIN users u ON u.id = $1
     WHERE a.id = $2`,
    [userId, accountId]
  );
  if (!accountRes.rows[0]) throw new Error("Account access denied");

  const acc = accountRes.rows[0];
  const customer = await getOrCreateStripeCustomer(accountId, customerEmail || acc.email, customerName || acc.user_name);

  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customer.id,
    line_items: [{
      price: plan.rows[0].stripe_price_id,
      quantity: 1,
    }],
    subscription_data: plan.rows[0].trial_days
      ? { trial_period_days: plan.rows[0].trial_days }
      : undefined,
    success_url: successUrl || STRIPE_SUCCESS_URL,
    cancel_url: cancelUrl || STRIPE_CANCEL_URL,
    metadata: {
      account_id: String(accountId),
      user_id: String(userId),
      plan_code: planCode,
      subscription_product_id: String(plan.rows[0].id),
      billing_interval: billingInterval,
    },
    allow_promotion_codes: true,
  });

  return { url: session.url, sessionId: session.id };
}

/** Create Customer Portal session. Returns { url }. */
async function createPortalSession(accountId, userId, returnUrl) {
  if (BILLING_MOCK_MODE) {
    return { url: returnUrl || `${process.env.APP_BASE_URL || "http://localhost:5173"}/#/billing` };
  }

  const acc = await db.query(
    `SELECT a.stripe_customer_id
     FROM accounts a
     JOIN account_users au ON au.account_id = a.id AND au.user_id = $1
     WHERE a.id = $2`,
    [userId, accountId]
  );
  if (!acc.rows[0]) throw new Error("Account access denied");
  const stripeCustomerId = acc.rows[0].stripe_customer_id;
  if (!stripeCustomerId) throw new Error("No billing account found. Subscribe to a plan first.");

  const session = await stripe.billingPortal.sessions.create({
    customer: stripeCustomerId,
    return_url: returnUrl || `${process.env.APP_BASE_URL || "http://localhost:5173"}/#/billing`,
  });

  return { url: session.url };
}

/** Verify webhook signature and return event or null if invalid. */
function constructWebhookEvent(payload, signature) {
  if (!stripe || !STRIPE_WEBHOOK_SECRET) return null;
  try {
    return stripe.webhooks.constructEvent(payload, signature, STRIPE_WEBHOOK_SECRET);
  } catch {
    return null;
  }
}

/** Check if event was already processed (idempotency). */
async function isEventProcessed(stripeEventId) {
  const r = await db.query(
    `SELECT 1 FROM stripe_webhook_events WHERE stripe_event_id = $1`,
    [stripeEventId]
  );
  return r.rows.length > 0;
}

/** Mark event as processed. */
async function markEventProcessed(stripeEventId) {
  await db.query(
    `INSERT INTO stripe_webhook_events (stripe_event_id) VALUES ($1) ON CONFLICT (stripe_event_id) DO NOTHING`,
    [stripeEventId]
  );
}

/** Process checkout.session.completed */
async function handleCheckoutCompleted(session) {
  const accountId = session.metadata?.account_id;
  const subscriptionProductId = session.metadata?.subscription_product_id;
  if (!accountId || !subscriptionProductId) return;

  const sub = session.subscription;
  if (!sub) return;

  const subscription = await stripe.subscriptions.retrieve(sub, { expand: ["items.data.price"] });
  const priceId = subscription.items?.data?.[0]?.price?.id;
  const status = subscription.status;
  const periodStart = new Date(subscription.current_period_start * 1000);
  const periodEnd = new Date(subscription.current_period_end * 1000);
  const cancelAtPeriodEnd = subscription.cancel_at_period_end || false;

  await db.query(
    `INSERT INTO account_subscriptions
      (account_id, subscription_product_id, stripe_subscription_id, stripe_customer_id, stripe_price_id, status,
       current_period_start, current_period_end, cancel_at_period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL
     DO UPDATE SET status = EXCLUDED.status, stripe_price_id = EXCLUDED.stripe_price_id,
       current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end, updated_at = NOW()`,
    [accountId, subscriptionProductId, subscription.id, session.customer, priceId, status, periodStart, periodEnd, cancelAtPeriodEnd]
  );
}

/** Process customer.subscription.updated / deleted */
async function handleSubscriptionUpdated(subscription) {
  const subId = subscription.id;
  const accountRes = await db.query(
    `SELECT id, account_id, subscription_product_id FROM account_subscriptions WHERE stripe_subscription_id = $1`,
    [subId]
  );

  const status = subscription.status;
  const periodStart = new Date(subscription.current_period_start * 1000);
  const periodEnd = new Date(subscription.current_period_end * 1000);
  const cancelAtPeriodEnd = subscription.cancel_at_period_end || false;
  const priceId = subscription.items?.data?.[0]?.price?.id || null;

  if (accountRes.rows.length > 0) {
    if (status === "canceled" || status === "unpaid") {
      await db.query(
        `UPDATE account_subscriptions SET status = $1, updated_at = NOW() WHERE stripe_subscription_id = $2`,
        [status, subId]
      );
    } else {
      await db.query(
        `UPDATE account_subscriptions SET status = $1, stripe_price_id = COALESCE($2, stripe_price_id),
         current_period_start = $3, current_period_end = $4, cancel_at_period_end = $5, updated_at = NOW()
         WHERE stripe_subscription_id = $6`,
        [status, priceId, periodStart, periodEnd, cancelAtPeriodEnd, subId]
      );
    }
    return;
  }

  const customerId = subscription.customer;
  const accountByCustomer = await db.query(
    `SELECT id FROM accounts WHERE stripe_customer_id = $1`,
    [customerId]
  );
  if (accountByCustomer.rows.length === 0) return;

  const productByPrice = priceId
    ? await db.query(`SELECT subscription_product_id FROM plan_prices WHERE stripe_price_id = $1`, [priceId])
    : { rows: [] };
  const subscriptionProductId = productByPrice.rows[0]?.subscription_product_id
    || (await db.query(`SELECT id FROM subscription_products WHERE code = 'homeowner_free' LIMIT 1`)).rows[0]?.id;
  if (!subscriptionProductId) return;

  await db.query(
    `INSERT INTO account_subscriptions
      (account_id, subscription_product_id, stripe_subscription_id, stripe_customer_id, stripe_price_id, status,
       current_period_start, current_period_end, cancel_at_period_end)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     ON CONFLICT (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL
     DO UPDATE SET status = EXCLUDED.status, stripe_price_id = EXCLUDED.stripe_price_id,
       current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end,
       cancel_at_period_end = EXCLUDED.cancel_at_period_end, updated_at = NOW()`,
    [accountByCustomer.rows[0].id, subscriptionProductId, subId, customerId, priceId, status, periodStart, periodEnd, cancelAtPeriodEnd]
  );
}

/** Process invoice.payment_succeeded / invoice.payment_failed */
async function handleInvoicePayment(invoice) {
  const subId = invoice.subscription;
  if (!subId) return;

  const subscription = await stripe.subscriptions.retrieve(subId, { expand: ["items.data.price"] });
  const accountRes = await db.query(
    `SELECT id FROM account_subscriptions WHERE stripe_subscription_id = $1`,
    [subId]
  );
  if (accountRes.rows.length === 0) return;

  const status = subscription.status;
  const periodStart = new Date(subscription.current_period_start * 1000);
  const periodEnd = new Date(subscription.current_period_end * 1000);
  const priceId = subscription.items?.data?.[0]?.price?.id || null;

  await db.query(
    `UPDATE account_subscriptions SET status = $1, stripe_price_id = COALESCE($2, stripe_price_id),
     current_period_start = $3, current_period_end = $4, updated_at = NOW()
     WHERE stripe_subscription_id = $5`,
    [status, priceId, periodStart, periodEnd, subId]
  );
}

/** Process webhook event (idempotent). */
async function processWebhookEvent(event) {
  if (await isEventProcessed(event.id)) return;
  await markEventProcessed(event.id);

  switch (event.type) {
    case "checkout.session.completed":
      await handleCheckoutCompleted(event.data.object);
      break;
    case "customer.subscription.created":
    case "customer.subscription.updated":
    case "customer.subscription.deleted":
      await handleSubscriptionUpdated(event.data.object);
      break;
    case "invoice.payment_succeeded":
    case "invoice.payment_failed":
      await handleInvoicePayment(event.data.object);
      break;
    default:
      break;
  }
}

/** List active Stripe prices with product info (for admin dropdown). */
async function listActivePrices() {
  if (BILLING_MOCK_MODE || !stripe) {
    return [];
  }

  const prices = await stripe.prices.list({
    active: true,
    expand: ["data.product"],
    limit: 100,
  });

  return (prices.data || []).map((p) => ({
    id: p.id,
    nickname: p.nickname || "",
    unitAmount: p.unit_amount,
    currency: p.currency,
    interval: p.recurring?.interval || null,
    intervalCount: p.recurring?.interval_count || null,
    productId: typeof p.product === "string" ? p.product : p.product?.id,
    productName: typeof p.product === "object" ? p.product?.name : null,
  }));
}

module.exports = {
  stripe,
  getOrCreateStripeCustomer,
  createCheckoutSession,
  createPortalSession,
  constructWebhookEvent,
  processWebhookEvent,
  isEventProcessed,
  handleSubscriptionUpdated,
  listActivePrices,
};
