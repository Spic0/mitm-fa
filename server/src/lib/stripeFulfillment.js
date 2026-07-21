const { resolveCheckoutItems } = require("./checkoutItems");
const { fulfillOrder } = require("./fulfillOrder");

// Shared by the Stripe webhook (source of truth, works even if the browser
// never comes back) and the client-side finalize call (which actually logs
// the browser in). fulfillOrder() is idempotent on providerRef, so calling
// this twice for the same PaymentIntent is safe.
async function fulfillFromPaymentIntent(paymentIntent) {
  if (paymentIntent.status !== "succeeded") {
    throw new Error(`PaymentIntent not succeeded (status: ${paymentIntent.status})`);
  }
  const email = paymentIntent.metadata.email;
  const rawItems = JSON.parse(paymentIntent.metadata.items);
  // Item prices are re-resolved fresh here (pre-existing behavior — prices
  // can drift between intent creation and fulfillment). The discount is
  // deliberately NOT re-validated/recomputed the same way: it was already
  // locked in at create/update-intent time (whatever the shopper was
  // actually charged), read back verbatim from metadata below. Re-running
  // promotion eligibility here (max uses, expiry, etc.) could reject a
  // promotion that legitimately applied at charge time and block
  // fulfillment of a payment that already succeeded — which must never
  // happen.
  const { resolvedItems, totalCents: baseTotalCents } = await resolveCheckoutItems(rawItems);

  const discountCents = Number(paymentIntent.metadata.discountCents) || 0;
  const appliedPromotions = paymentIntent.metadata.appliedPromotions
    ? JSON.parse(paymentIntent.metadata.appliedPromotions)
    : [];
  const promotionId = paymentIntent.metadata.promotionId || null;

  return fulfillOrder({
    email,
    provider: "stripe",
    providerRef: paymentIntent.id,
    items: resolvedItems,
    totalCents: Math.max(0, baseTotalCents - discountCents),
    discountCents,
    promotionId,
    appliedPromotions,
  });
}

module.exports = { fulfillFromPaymentIntent };
