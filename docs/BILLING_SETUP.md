# Billing Setup (Stripe)

This document describes how to configure Stripe subscription billing for HomeOps.

## Prerequisites

- Stripe account
- PostgreSQL database with migrations applied

## Environment Variables

Add to `.env`:

```bash
# Stripe (required for live billing)
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxx

# URLs (or derived from APP_BASE_URL)
STRIPE_SUCCESS_URL=https://your-app.com/#/billing/success
STRIPE_CANCEL_URL=https://your-app.com/#/onboarding
APP_BASE_URL=https://your-app.com
```

For local development:

```bash
STRIPE_SECRET_KEY=sk_test_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
STRIPE_PUBLISHABLE_KEY=pk_test_xxx
APP_BASE_URL=http://localhost:5173
```

### Optional: Billing Mock Mode

Set `BILLING_MOCK_MODE=true` to simulate active subscriptions without Stripe. Useful for local dev when Stripe is not configured.

## Database Setup

1. Run the billing migration (if using migrations):

```bash
psql $DATABASE_URL -f migrations/010_billing_stripe.sql
```

2. Plans are seeded automatically on server start from `data/plans.json`. No manual seed required. To re-seed:

```bash
npm run seed:stripe
```

3. (Optional) Provide Stripe Price IDs via env for seed:

```bash
STRIPE_PRICE_IDS='{"homeowner_maintain_month":"price_xxx","homeowner_maintain_year":"price_yyy","homeowner_win_month":"price_zzz",...}'
npm run seed:stripe
```

Or add Price IDs later via **Super Admin > Billing Plans** in the UI. No hardcoded price IDs in code.

## Stripe Dashboard Setup

1. Create Products in Stripe for each plan (Free can skip).
2. Create Prices (monthly + annual) for each product.
3. Copy Price IDs (e.g. `price_xxx`) into the Billing Plans editor or seed env.

## Webhook Setup

1. Install Stripe CLI: https://stripe.com/docs/stripe-cli

2. Login and forward webhooks to local backend:

```bash
stripe login
stripe listen --forward-to localhost:3000/webhooks/stripe
```

3. Copy the webhook signing secret (`whsec_xxx`) to `STRIPE_WEBHOOK_SECRET`.

4. For production, create a webhook endpoint in Stripe Dashboard:
   - URL: `https://your-api.com/webhooks/stripe`
   - Events: `checkout.session.completed`, `customer.subscription.created`, `customer.subscription.updated`, `customer.subscription.deleted`, `invoice.payment_succeeded`, `invoice.payment_failed`

## Testing

- **Webhook idempotency**: Process the same event twice; the second run should be a no-op.
- **Checkout flow**: Select a paid plan during onboarding → redirects to Stripe Checkout → on success, lands on `/billing/success` and polls until subscription is active.
- **Customer Portal**: Existing subscribers use "Manage billing" to update payment method, cancel, or change plan.

## Free Trial

Plans can have a `trial_days` value (editable in Super Admin Billing Plans). Default: 14 days for paid tiers, null for free.
