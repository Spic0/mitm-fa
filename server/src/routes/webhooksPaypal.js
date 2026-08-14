const express = require("express");
const { prisma } = require("../db");
const paypal = require("../lib/paypal");
const { fulfillFromPaypalCapture } = require("../lib/paypalFulfillment");
const { logEvent } = require("../lib/adminLog");
const { logPaymentEvent } = require("../lib/paymentLog");

const router = express.Router();

// Mounted with express.raw() in index.js — PayPal's signature is verified
// against the exact bytes delivered, so this must not go through the global
// JSON parser first.
//
// Why this exists at all: PayPal fulfillment used to happen only in the
// browser's capture call. That works right up until the browser doesn't come
// back — the buyer closes the tab on PayPal's own approval screen, loses
// signal on the redirect, or the capture response is lost in flight after
// PayPal has already moved the money. In every one of those cases the
// customer has paid and there is no order. This is the server-authoritative
// path that closes it, and it is the exact PayPal counterpart to what the
// Stripe webhook already does.
router.post("/", async (req, res) => {
  if (!paypal.isPaypalConfigured) return res.status(503).send("PayPal not configured");

  let event;
  try {
    event = JSON.parse(req.body.toString("utf8"));
  } catch (err) {
    return res.status(400).send("Malformed payload");
  }
  if (!event || typeof event.id !== "string" || typeof event.event_type !== "string") {
    return res.status(400).send("Malformed payload");
  }

  const verified = await paypal.verifyWebhookSignature(req.headers, req.body);
  if (!verified) {
    console.error("PayPal webhook signature verification failed for event", event.id);
    return res.status(400).send("Invalid signature");
  }

  // Same atomic claim as the Stripe webhook, sharing the same table: PayPal
  // retries a delivery it didn't get a 2xx for, and does so for up to three
  // days. Claiming the event id before any processing means a redelivery
  // can't double-log or race the original.
  try {
    await prisma.webhookEvent.create({
      data: { provider: "paypal", eventId: event.id, eventType: event.event_type },
    });
  } catch (err) {
    if (err.code === "P2002") return res.json({ received: true, duplicate: true });
    throw err;
  }

  try {
    if (event.event_type === "PAYMENT.CAPTURE.COMPLETED") {
      await handleCaptureCompleted(event);
    } else if (event.event_type === "PAYMENT.CAPTURE.DENIED" || event.event_type === "PAYMENT.CAPTURE.DECLINED") {
      await handleCaptureFailed(event);
    } else if (event.event_type === "PAYMENT.CAPTURE.REFUNDED" || event.event_type === "PAYMENT.CAPTURE.REVERSED") {
      await handleRefund(event);
    }
  } catch (err) {
    console.error("PayPal webhook processing failed:", err);
    // Releasing the claim lets PayPal's retry actually reprocess this event
    // rather than being swallowed as a duplicate — the difference between a
    // transient failure that self-heals and a paid customer with no order.
    await prisma.webhookEvent
      .deleteMany({ where: { provider: "paypal", eventId: event.id } })
      .catch(() => {});
    return res.status(500).send("Processing failed");
  }

  res.json({ received: true });
});

// The capture resource carries `supplementary_data.related_ids.order_id`,
// which is the v2 checkout order id we store as Order.providerRef. Older
// payloads don't, in which case the capture's own links are walked to find
// it. Without that id there is nothing to reconcile against, so the event is
// recorded and dropped rather than guessed at.
function orderIdFromCapture(resource) {
  const related = resource.supplementary_data && resource.supplementary_data.related_ids;
  if (related && related.order_id) return related.order_id;
  const up = (resource.links || []).find((l) => l.rel === "up");
  if (up && up.href) {
    const m = /\/checkout\/orders\/([^/?]+)/.exec(up.href);
    if (m) return m[1];
  }
  return null;
}

async function handleCaptureCompleted(event) {
  const resource = event.resource || {};
  const orderId = orderIdFromCapture(resource);
  if (!orderId) {
    await logPaymentEvent({
      provider: "paypal",
      eventType: event.event_type,
      status: "failed",
      providerRef: resource.id || null,
      providerResponse: { error: "No checkout order id on capture resource" },
    });
    return;
  }

  // Already fulfilled by the browser's capture call, which is the common
  // case — nothing to do, and fulfillFromPaypalCapture would no-op anyway.
  const existing = await prisma.order.findUnique({ where: { providerRef: orderId } });
  if (existing) return;

  // Read the order back through PayPal rather than trusting the event body
  // to be a complete capture response. This is the same shape the browser
  // path passes, so both go through identical fulfillment.
  const order = await paypal.getOrder(orderId);
  await fulfillFromPaypalCapture(order, orderId);
}

async function handleCaptureFailed(event) {
  const resource = event.resource || {};
  const orderId = orderIdFromCapture(resource);
  await logEvent({
    category: "payment",
    message: `PayPal capture ${event.event_type.split(".").pop().toLowerCase()} for order ${orderId || "(unknown)"}`,
    metadata: { paypalOrderId: orderId, captureId: resource.id },
  });
  await logPaymentEvent({
    provider: "paypal",
    eventType: event.event_type,
    status: "failed",
    providerRef: orderId,
    providerResponse: { captureId: resource.id, status: resource.status },
  });
}

// A refund resource references the CAPTURE it reverses, never the checkout
// order — but Order.providerRef is the checkout order id. These are the two
// ways back, in order of reliability:
//
//   1. custom_id: our own PendingCheckout id, which PayPal propagates from
//      the purchase unit through to the refund on most flows. It records the
//      checkout order id at create time, so this needs no outbound call.
//   2. the capture itself: read it back from PayPal and take
//      supplementary_data.related_ids.order_id. Authoritative, but costs a
//      round trip, so it's the fallback.
async function orderIdFromRefund(resource) {
  if (resource.custom_id) {
    const pending = await prisma.pendingCheckout.findUnique({ where: { id: resource.custom_id } });
    if (pending && pending.providerRef) return pending.providerRef;
  }

  const up = (resource.links || []).find((l) => l.rel === "up");
  const m = up && up.href ? /\/payments\/captures\/([^/?]+)/.exec(up.href) : null;
  if (!m) return null;

  try {
    const capture = await paypal.getCapture(m[1]);
    const related = capture.supplementary_data && capture.supplementary_data.related_ids;
    return (related && related.order_id) || null;
  } catch (err) {
    console.error("Could not resolve PayPal refund to an order:", err.message);
    return null;
  }
}

// Mirrors the Stripe charge.refunded handler exactly: any refund, full or
// partial, revokes access entirely rather than trying to prorate it.
async function handleRefund(event) {
  const resource = event.resource || {};
  const orderId = await orderIdFromRefund(resource);
  const order = orderId ? await prisma.order.findUnique({ where: { providerRef: orderId } }) : null;
  if (order && order.status !== "refunded") {
    await prisma.order.update({ where: { id: order.id }, data: { status: "refunded" } });
    await logEvent({
      category: "payment",
      message: `Order ${order.id} refunded via PayPal — access revoked`,
      metadata: { paypalOrderId: orderId, refundId: resource.id },
    });
  }

  await logPaymentEvent({
    provider: "paypal",
    eventType: event.event_type,
    status: "succeeded",
    providerRef: orderId,
    orderId: order ? order.id : null,
    providerResponse: { refundId: resource.id, amount: resource.amount, status: resource.status },
  });
}

module.exports = router;
