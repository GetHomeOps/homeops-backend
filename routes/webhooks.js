"use strict";

/**
 * Webhook Routes
 *
 * Stripe webhook - MUST use raw body for signature verification.
 * Mount with express.raw({ type: "application/json" }) BEFORE express.json() in app.js.
 */

const express = require("express");
const stripeService = require("../services/stripeService");

const router = express.Router();

/** POST /webhooks/stripe - Stripe webhook handler */
router.post("/stripe", async function (req, res) {
  const signature = req.headers["stripe-signature"];
  const payload = req.body;

  if (!payload || !signature) {
    return res.status(400).send("Missing signature or payload");
  }

  const rawBody = Buffer.isBuffer(payload) ? payload.toString("utf8") : (typeof payload === "string" ? payload : "");
  const event = stripeService.constructWebhookEvent(rawBody, signature);

  if (!event) {
    return res.status(400).send("Invalid signature");
  }

  try {
    await stripeService.processWebhookEvent(event);
    return res.json({ received: true });
  } catch (err) {
    console.error("[webhooks/stripe] Error:", err.message);
    return res.status(500).json({ error: "Webhook processing failed" });
  }
});

module.exports = router;
