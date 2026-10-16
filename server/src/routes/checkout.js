const crypto = require("crypto");
const express = require("express");
const { prisma } = require("../db");
const { stripe, isStripeConfigured } = require("../lib/stripe");
const paypal = require("../lib/paypal");
const { parseCustomerDetails } = require("../lib/customerDetails");
const { fulfillFromPaymentIntent } = require("../lib/stripeFulfillment");
const { fulfillFromPaypalCapture } = require("../lib/paypalFulfillment");
const { createCheckoutSnapshot, updateCheckoutSnapshot } = require("../lib/checkoutSnapshot");
const { setSessionCookie } = require("../lib/session");
const { logPaymentEvent } = require("../lib/paymentLog");
const { apiLimiter } = require("../middleware/rateLimit");

const router = express.Router();
router.use(apiLimiter);

// Every amount in this file is USD. Kept as one constant rather than repeated
// string literals so the currency the order is priced in, the currency sent
// to each provider, and the currency the webhook reconciles against can never
// drift apart.
const CURRENCY = "usd";

function requireStripe(res) {
  if (isStripeConfigured) return true;
  res.status(503).json({
    error: "Card payment isn't available right now. Please try another method or contact support.",
  });
  return false;
}

router.post("/stripe/create-intent", async (req, res) => {
  if (!requireStripe(res)) return;
  try {
    // Full Name / Phone / Email / Country are collected by the checkout form
    // and validated here before any PaymentIntent exists, so an invalid one
    // costs the shopper an inline error rather than a failed payment.
    const customer = parseCustomerDetails(req.body);
    const promoCode = req.body.promoCode ? String(req.body.promoCode) : undefined;

    // Prices, discount eligibility and the final total are all computed here,
    // from the database, and frozen into a PendingCheckout row. The browser's
    // only inputs are product ids, quantities and a promo code string.
    const { pending, totalCents, discountCents } = await createCheckoutSnapshot({
      items: req.body.items,
      promoCode,
      customer,
      provider: "stripe",
    });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: CURRENCY,
      receipt_email: customer.email,
      automatic_payment_methods: { enabled: true },
      // Surfaces the buyer on the payment itself rather than only in our own
      // database, so a Stripe dashboard search for a name or phone number
      // finds the charge during a support or chargeback enquiry.
      description: `Order for ${customer.name} (${customer.email})`,
      // Only the snapshot id is authoritative here. The rest is for humans
      // reading the Stripe dashboard — fulfillment never reads it, which is
      // what keeps this safely under Stripe's 500-character-per-value limit
      // no matter how large the cart gets.
      metadata: {
        pendingCheckoutId: pending.id,
        email: customer.email,
        name: customer.name,
        phone: customer.phone,
        country: customer.country,
      },
    }, {
      // Scoped to this snapshot, so it covers the SDK's own network retries
      // (lib/stripe.js sets maxNetworkRetries) — a create whose response is
      // lost in flight resolves to the same PaymentIntent instead of leaving
      // a second one behind.
      //
      // It does not, and does not need to, deduplicate two separate checkout
      // attempts: each of those builds its own snapshot and its own key. An
      // uncharged PaymentIntent costs nothing and expires on its own; what
      // must never double is the ORDER, and that is guaranteed by the unique
      // constraint on Order.providerRef (see fulfillOrder.js), not here.
      // The browser also only ever creates one per page load —
      // checkout-payments.js won't re-run this once the Payment Element is
      // mounted.
      idempotencyKey: `pi_create_${pending.id}`,
    });

    await prisma.pendingCheckout.update({
      where: { id: pending.id },
      data: { providerRef: paymentIntent.id },
    });

    res.json({
      id: paymentIntent.id,
      clientSecret: paymentIntent.client_secret,
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY,
      totalCents,
      discountCents,
    });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Called whenever the cart changes after a PaymentIntent already exists
// (e.g. the shopper adds a checkout-page recommendation) — re-prices the
// snapshot server-side and pushes the new total at Stripe. The snapshot and
// the charge amount must always move together: updating one without the
// other would either charge for items that aren't delivered or deliver items
// that weren't charged for.
router.post("/stripe/update-intent", async (req, res) => {
  if (!requireStripe(res)) return;
  try {
    const paymentIntentId = String(req.body.paymentIntentId || "");
    if (!paymentIntentId) throw new Error("paymentIntentId is required");
    const existing = await stripe.paymentIntents.retrieve(paymentIntentId);
    const pendingId = existing.metadata && existing.metadata.pendingCheckoutId;
    if (!pendingId) throw new Error("Checkout session not found");

    // A PaymentIntent that has already been paid must not have its amount
    // rewritten — Stripe would reject it, but failing here is clearer and
    // keeps the snapshot from being re-priced under a completed purchase.
    if (existing.status === "succeeded" || existing.status === "processing") {
      throw new Error("This payment has already been submitted");
    }

    // Contact & Billing stays editable after the Payment Element mounts, so
    // the details are re-sent here too. Only applied when all four validate —
    // a half-edited form must never overwrite a good record with a partial one.
    let customer = null;
    try {
      customer = parseCustomerDetails(req.body);
    } catch (err) {
      customer = null;
    }

    const promoCode = req.body.promoCode ? String(req.body.promoCode) : undefined;
    const { totalCents, discountCents } = await updateCheckoutSnapshot(pendingId, {
      items: req.body.items,
      promoCode,
      customer,
    });

    const paymentIntent = await stripe.paymentIntents.update(paymentIntentId, {
      amount: totalCents,
      // Keep Stripe's own receipt going to the corrected address, not the one
      // typed before the shopper fixed a typo. Stripe merges the metadata keys
      // it's given rather than replacing the object, so pendingCheckoutId
      // survives untouched.
      ...(customer ? { receipt_email: customer.email } : {}),
      ...(customer
        ? { metadata: { email: customer.email, name: customer.name, phone: customer.phone, country: customer.country } }
        : {}),
    });

    res.json({ totalCents: paymentIntent.amount, discountCents });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Called by the browser right after Stripe's client-side confirmPayment()
// returns. The webhook is the durable source of truth for fulfillment; this
// endpoint exists because it is what actually authenticates the browser —
// a Set-Cookie on a webhook response is invisible to the shopper.
//
// Because it mints a logged-in session, the PaymentIntent id alone is NOT
// sufficient authorization. That id travels in the URL query string on every
// redirect-based payment method (`?payment_intent=pi_...`), so it reaches
// browser history, `Referer` headers on any third-party asset, analytics and
// access logs. Anyone holding a leaked id could otherwise POST it here and be
// handed a session as the buyer — full account takeover from a value that is
// not treated as a secret anywhere.
//
// The client_secret is that proof: Stripe issues it only to the browser that
// created the intent, and it is what Stripe itself treats as the credential
// for acting on a PaymentIntent client-side.
router.post("/stripe/finalize", async (req, res) => {
  if (!requireStripe(res)) return;
  try {
    const paymentIntentId = String(req.body.paymentIntentId || "");
    const clientSecret = String(req.body.clientSecret || "");
    if (!paymentIntentId || !clientSecret) throw new Error("Payment reference is missing");

    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const expected = paymentIntent.client_secret || "";
    const provided = Buffer.from(clientSecret);
    const expectedBuf = Buffer.from(expected);
    if (
      expectedBuf.length !== provided.length ||
      !crypto.timingSafeEqual(expectedBuf, provided)
    ) {
      return res.status(403).json({ error: "Payment reference is not valid" });
    }

    const { order, sessionToken } = await fulfillFromPaymentIntent(paymentIntent);
    setSessionCookie(res, sessionToken);
    res.json({ ok: true, orderId: order.id, redirect: `/order/success?order=${encodeURIComponent(order.id)}` });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

function requirePaypal(res) {
  if (paypal.isPaypalConfigured) return true;
  res.status(503).json({
    error: "PayPal isn't available right now. Please try another method or contact support.",
  });
  return false;
}

router.post("/paypal/create-order", async (req, res) => {
  if (!requirePaypal(res)) return;
  try {
    const customer = parseCustomerDetails(req.body);
    const promoCode = req.body.promoCode ? String(req.body.promoCode) : undefined;

    const { pending, totalCents, discountCents } = await createCheckoutSnapshot({
      items: req.body.items,
      promoCode,
      customer,
      provider: "paypal",
    });

    const order = await paypal.createOrder(totalCents, pending.id, CURRENCY.toUpperCase());
    await prisma.pendingCheckout.update({ where: { id: pending.id }, data: { providerRef: order.id } });
    res.json({ orderId: order.id, totalCents, discountCents });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/paypal/capture-order", async (req, res) => {
  if (!requirePaypal(res)) return;
  const orderId = String(req.body.orderId || "");
  try {
    // Authoritative: the capture is performed and read back through PayPal's
    // own API with our server credentials. Nothing the browser claims about
    // the outcome is trusted — `onApprove` in the SDK only tells us the buyer
    // finished PayPal's UI, not that money moved.
    const capture = await paypal.captureOrder(orderId);

    if (capture.status !== "COMPLETED") {
      await logPaymentEvent({
        provider: "paypal",
        eventType: "checkout.capture",
        status: "failed",
        providerRef: orderId,
        providerResponse: { status: capture.status },
      });
      return res.status(402).json({ error: "Payment was not completed" });
    }

    const { order, sessionToken } = await fulfillFromPaypalCapture(capture, orderId);

    setSessionCookie(res, sessionToken);
    res.json({ ok: true, orderId: order.id, redirect: `/order/success?order=${encodeURIComponent(order.id)}` });
  } catch (err) {
    await logPaymentEvent({
      provider: "paypal",
      eventType: "checkout.capture",
      status: "failed",
      providerRef: orderId,
      providerResponse: { error: err.message },
    });
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
