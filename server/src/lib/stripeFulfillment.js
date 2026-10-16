const { resolveCheckoutItems } = require("./checkoutItems");
const { fulfillOrder } = require("./fulfillOrder");
const { loadSnapshotForFulfillment, markSnapshotConsumed } = require("./checkoutSnapshot");
const { logPaymentEvent } = require("./paymentLog");

// Shared by the Stripe webhook (source of truth, works even if the browser
// never comes back) and the client-side finalize call (which actually logs
// the browser in). fulfillOrder() is idempotent on providerRef, so calling
// this twice for the same PaymentIntent is safe.
async function fulfillFromPaymentIntent(paymentIntent) {
  if (paymentIntent.status !== "succeeded") {
    throw new Error(`PaymentIntent not succeeded (status: ${paymentIntent.status})`);
  }

  // What Stripe says actually moved. `amount_received` is the settled figure;
  // `amount` is the requested one, and they agree for a succeeded intent —
  // the fallback only matters for older API shapes.
  const chargedCents = typeof paymentIntent.amount_received === "number"
    ? paymentIntent.amount_received
    : paymentIntent.amount;

  const pendingId = paymentIntent.metadata && paymentIntent.metadata.pendingCheckoutId;
  const snapshot = pendingId
    ? await loadSnapshotForFulfillment(pendingId, { chargedTotalCents: chargedCents })
    : await legacySnapshotFromMetadata(paymentIntent, chargedCents);

  if (!snapshot) throw new Error("Checkout session not found for this payment");

  // The order still gets fulfilled — the money has moved and the buyer is
  // owed their product — but a disagreement between what we quoted and what
  // Stripe charged is either a bug on our side or tampering, and must leave a
  // permanent record rather than being silently absorbed.
  if (snapshot.snapshotTotalCents !== chargedCents) {
    await logPaymentEvent({
      provider: "stripe",
      eventType: "checkout.amount_mismatch",
      status: "failed",
      providerRef: paymentIntent.id,
      customerEmail: snapshot.email,
      providerResponse: {
        quotedCents: snapshot.snapshotTotalCents,
        chargedCents,
        currency: paymentIntent.currency,
      },
    });
  }

  const result = await fulfillOrder({
    email: snapshot.email,
    // Captured at create-intent time (checkout.js). Absent on payments made
    // before these fields existed, which fulfillOrder treats as "nothing to
    // update" rather than blanking what's already on the User.
    customer: snapshot.customer,
    provider: "stripe",
    providerRef: paymentIntent.id,
    items: snapshot.items,
    totalCents: snapshot.totalCents,
    discountCents: snapshot.discountCents,
    promotionId: snapshot.promotionId,
    appliedPromotions: snapshot.appliedPromotions,
  });

  if (pendingId) {
    await markSnapshotConsumed(pendingId, { provider: "stripe", providerRef: paymentIntent.id });
  }

  return result;
}

// PaymentIntents created before checkout moved to PendingCheckout snapshots
// carried the cart in metadata and were re-priced here at fulfillment time.
// Kept so any intent still in flight across the deploy still fulfills; new
// payments never reach this path.
async function legacySnapshotFromMetadata(paymentIntent, chargedCents) {
  const meta = paymentIntent.metadata || {};
  if (!meta.items) return null;

  const { resolvedItems } = await resolveCheckoutItems(JSON.parse(meta.items));
  const discountCents = Number(meta.discountCents) || 0;

  return {
    email: meta.email,
    customer: { name: meta.name, phone: meta.phone, country: meta.country },
    items: resolvedItems,
    totalCents: chargedCents,
    snapshotTotalCents: chargedCents, // nothing better to compare against
    discountCents,
    promotionId: meta.promotionId || null,
    appliedPromotions: meta.appliedPromotions ? JSON.parse(meta.appliedPromotions) : [],
  };
}

module.exports = { fulfillFromPaymentIntent };
