const express = require("express");
const { prisma } = require("../db");
const { stripe } = require("../lib/stripe");
const paypal = require("../lib/paypal");
const { resolveCheckoutItems } = require("../lib/checkoutItems");
const { parseCustomerDetails } = require("../lib/customerDetails");
const { fulfillOrder } = require("../lib/fulfillOrder");
const { fulfillFromPaymentIntent } = require("../lib/stripeFulfillment");
const { setSessionCookie } = require("../lib/session");
const { logPaymentEvent } = require("../lib/paymentLog");
const { apiLimiter } = require("../middleware/rateLimit");

const router = express.Router();
router.use(apiLimiter);

router.post("/stripe/create-intent", async (req, res) => {
  try {
    // Full Name / Phone / Email / Country are collected by the checkout form
    // and validated here before any PaymentIntent exists, so an invalid one
    // costs the shopper an inline error rather than a failed payment.
    const { name, email, phone, country } = parseCustomerDetails(req.body);
    const promoCode = req.body.promoCode ? String(req.body.promoCode) : undefined;
    const { totalCents, discountCents, promotionId, appliedPromotions } = await resolveCheckoutItems(req.body.items, {
      promoCode,
      email,
    });

    const paymentIntent = await stripe.paymentIntents.create({
      amount: totalCents,
      currency: "usd",
      receipt_email: email,
      automatic_payment_methods: { enabled: true },
      // Surfaces the buyer on the payment itself rather than only in our own
      // database, so a Stripe dashboard search for a name or phone number
      // finds the charge during a support or chargeback enquiry.
      description: `Order for ${name} (${email})`,
      metadata: {
        email,
        name,
        phone,
        country,
        items: JSON.stringify(req.body.items),
        discountCents: String(discountCents),
        promotionId: promotionId || "",
        appliedPromotions: JSON.stringify(appliedPromotions),
      },
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
// (e.g. the shopper adds a checkout-page recommendation) — keeps both the
// charge amount AND the metadata.items list in sync with the intent, since
// fulfillment (stripeFulfillment.js) rebuilds the order purely from
// metadata.items. Updating amount without also updating metadata.items
// would charge the shopper correctly but deliver only the original items —
// the two must always change together.
router.post("/stripe/update-intent", async (req, res) => {
  try {
    const paymentIntentId = String(req.body.paymentIntentId || "");
    if (!paymentIntentId) throw new Error("paymentIntentId is required");
    const existing = await stripe.paymentIntents.retrieve(paymentIntentId);
    const email = existing.metadata?.email;
    const promoCode = req.body.promoCode ? String(req.body.promoCode) : undefined;
    const { totalCents, discountCents, promotionId, appliedPromotions } = await resolveCheckoutItems(req.body.items, {
      promoCode,
      email,
    });

    // Contact & Billing stays editable after the Payment Element mounts, so
    // the details are re-sent here too. Only applied when all four validate —
    // a half-edited form must never overwrite good metadata with a partial
    // record, and Stripe merges the keys it's given rather than replacing the
    // whole object, so omitting them leaves the originals intact.
    let customerMeta = {};
    try {
      const { name, email: newEmail, phone, country } = parseCustomerDetails(req.body);
      customerMeta = { name, email: newEmail, phone, country };
    } catch (err) {
      customerMeta = {};
    }

    const paymentIntent = await stripe.paymentIntents.update(paymentIntentId, {
      amount: totalCents,
      // Keep Stripe's own receipt going to the corrected address, not the one
      // typed before the shopper fixed a typo.
      ...(customerMeta.email ? { receipt_email: customerMeta.email } : {}),
      metadata: {
        ...customerMeta,
        items: JSON.stringify(req.body.items),
        discountCents: String(discountCents),
        promotionId: promotionId || "",
        appliedPromotions: JSON.stringify(appliedPromotions),
      },
    });

    res.json({ totalCents: paymentIntent.amount, discountCents });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Called by the browser right after Stripe's client-side confirmPayment()
// redirect returns. The webhook is the durable source of truth for
// fulfillment; this endpoint is what actually authenticates the browser,
// since Set-Cookie on a webhook response is invisible to the shopper.
router.post("/stripe/finalize", async (req, res) => {
  try {
    const paymentIntentId = String(req.body.paymentIntentId || "");
    const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
    const { sessionToken } = await fulfillFromPaymentIntent(paymentIntent);
    setSessionCookie(res, sessionToken);
    res.json({ ok: true, redirect: "/my-library" });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/paypal/create-order", async (req, res) => {
  try {
    const { name, email, phone, country } = parseCustomerDetails(req.body);
    const promoCode = req.body.promoCode ? String(req.body.promoCode) : undefined;
    const { totalCents, discountCents, promotionId, appliedPromotions } = await resolveCheckoutItems(req.body.items, {
      promoCode,
      email,
    });

    const pending = await prisma.pendingCheckout.create({
      data: {
        email,
        customerName: name,
        customerPhone: phone,
        customerCountry: country,
        itemsJson: JSON.stringify(req.body.items),
        totalCents,
        discountCents,
        promotionId,
        appliedPromotionsJson: JSON.stringify(appliedPromotions),
      },
    });

    const order = await paypal.createOrder(totalCents, pending.id);
    res.json({ orderId: order.id, totalCents, discountCents });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.post("/paypal/capture-order", async (req, res) => {
  try {
    const { orderId } = req.body;
    const capture = await paypal.captureOrder(orderId);

    if (capture.status !== "COMPLETED") {
      await logPaymentEvent({
        provider: "paypal",
        eventType: "checkout.capture",
        status: "failed",
        providerRef: orderId,
        providerResponse: capture,
      });
      return res.status(402).json({ error: "Payment was not completed" });
    }

    const customId = capture.purchase_units?.[0]?.payments?.captures?.[0]?.custom_id;
    const pending = customId ? await prisma.pendingCheckout.findUnique({ where: { id: customId } }) : null;
    if (!pending) return res.status(400).json({ error: "Checkout session not found" });

    const rawItems = JSON.parse(pending.itemsJson);
    // Items re-resolved fresh (same pre-existing price-drift behavior as
    // Stripe); the discount is read back verbatim from the pending row
    // rather than recomputed — see the schema comment on PendingCheckout.
    const { resolvedItems, totalCents: baseTotalCents } = await resolveCheckoutItems(rawItems);
    const discountCents = pending.discountCents || 0;
    const appliedPromotions = pending.appliedPromotionsJson ? JSON.parse(pending.appliedPromotionsJson) : [];

    const { order, sessionToken } = await fulfillOrder({
      email: pending.email,
      customer: {
        name: pending.customerName,
        phone: pending.customerPhone,
        country: pending.customerCountry,
      },
      provider: "paypal",
      providerRef: orderId,
      items: resolvedItems,
      totalCents: Math.max(0, baseTotalCents - discountCents),
      discountCents,
      promotionId: pending.promotionId,
      appliedPromotions,
    });

    await logPaymentEvent({
      provider: "paypal",
      eventType: "checkout.capture",
      status: "succeeded",
      providerRef: orderId,
      customerEmail: pending.email,
      orderId: order.id,
      providerResponse: { status: capture.status },
    });

    setSessionCookie(res, sessionToken);
    res.json({ ok: true, redirect: "/my-library" });
  } catch (err) {
    await logPaymentEvent({
      provider: "paypal",
      eventType: "checkout.capture",
      status: "failed",
      providerRef: req.body.orderId,
      providerResponse: { error: err.message },
    });
    res.status(400).json({ error: err.message });
  }
});

module.exports = router;
