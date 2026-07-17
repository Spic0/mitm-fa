const express = require("express");
const { prisma } = require("../db");
const { stripe } = require("../lib/stripe");
const { fulfillFromPaymentIntent } = require("../lib/stripeFulfillment");
const { logEvent } = require("../lib/adminLog");
const { logPaymentEvent } = require("../lib/paymentLog");

const router = express.Router();

// Mounted with express.raw() in index.js — Stripe signature verification
// requires the exact raw request body, not the parsed JSON.
router.post("/", async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers["stripe-signature"],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Stripe explicitly documents that the same event can be delivered more
  // than once (retries, or rare duplicate delivery) — this claims event.id
  // atomically before any processing happens, so two near-simultaneous
  // deliveries of the exact same event can't both proceed. This is a second,
  // independent layer on top of Order.providerRef's own uniqueness
  // (fulfillOrder.js): that one protects the *business outcome* (never two
  // orders for one payment) and already handles concurrent-delivery races
  // for payment_intent.succeeded specifically; this one protects *every*
  // event type — including payment_intent.payment_failed, which only writes
  // log rows and has no uniqueness of its own, so without this a duplicate
  // delivery would silently double up the payment/system logs.
  //
  // Trade-off, deliberate: if processing an event fails after it's been
  // claimed here, a later Stripe retry of that same event.id will be seen
  // as a duplicate and skipped, not reprocessed. That's acceptable only
  // because payment_intent.succeeded fulfillment has a fully independent
  // second path (the browser's POST /stripe/finalize, called right after
  // Stripe confirms payment client-side) that isn't gated by this table at
  // all — so a webhook-side failure doesn't strand the order.
  try {
    await prisma.webhookEvent.create({
      data: { provider: "stripe", eventId: event.id, eventType: event.type },
    });
  } catch (err) {
    if (err.code === "P2002") {
      return res.json({ received: true, duplicate: true });
    }
    throw err;
  }

  if (event.type === "payment_intent.succeeded") {
    const intent = event.data.object;
    try {
      const { order } = await fulfillFromPaymentIntent(intent);
      await logPaymentEvent({
        provider: "stripe",
        eventType: event.type,
        status: "succeeded",
        providerRef: intent.id,
        customerEmail: intent.metadata && intent.metadata.email,
        orderId: order.id,
        providerResponse: { status: intent.status, amount: intent.amount, currency: intent.currency },
      });
    } catch (err) {
      console.error("Failed to fulfill order from webhook:", err);
      await logPaymentEvent({
        provider: "stripe",
        eventType: event.type,
        status: "failed",
        providerRef: intent.id,
        customerEmail: intent.metadata && intent.metadata.email,
        providerResponse: { error: err.message },
      });
      return res.status(500).send("Fulfillment failed");
    }
  }

  if (event.type === "payment_intent.payment_failed") {
    const intent = event.data.object;
    await logEvent({
      category: "payment",
      message: `Stripe payment failed for PaymentIntent ${intent.id}${intent.last_payment_error ? `: ${intent.last_payment_error.message}` : ""}`,
      metadata: { paymentIntentId: intent.id },
    });
    await logPaymentEvent({
      provider: "stripe",
      eventType: event.type,
      status: "failed",
      providerRef: intent.id,
      customerEmail: intent.metadata && intent.metadata.email,
      providerResponse: intent.last_payment_error || { status: intent.status },
    });
  }

  // Fires on both full and partial refunds — deliberately treated the same
  // (any refund revokes access entirely) rather than trying to prorate
  // access for a partial refund, which is a real product a refund policy
  // could want but isn't something to guess at silently. A charge always
  // carries the PaymentIntent id it belongs to, which is our Order.providerRef.
  if (event.type === "charge.refunded") {
    const charge = event.data.object;
    const paymentIntentId = typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id;
    const order = paymentIntentId ? await prisma.order.findUnique({ where: { providerRef: paymentIntentId } }) : null;
    if (order && order.status !== "refunded") {
      await prisma.order.update({ where: { id: order.id }, data: { status: "refunded" } });
      await logEvent({
        category: "payment",
        message: `Order ${order.id} refunded via Stripe — access revoked`,
        metadata: { paymentIntentId, chargeId: charge.id },
      });
    }
    await logPaymentEvent({
      provider: "stripe",
      eventType: event.type,
      status: "succeeded",
      providerRef: paymentIntentId,
      orderId: order ? order.id : null,
      providerResponse: { amountRefunded: charge.amount_refunded, fullyRefunded: charge.refunded },
    });
  }

  res.json({ received: true });
});

module.exports = router;
