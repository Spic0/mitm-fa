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
  const { resolvedItems, totalCents } = await resolveCheckoutItems(rawItems);

  return fulfillOrder({
    email,
    provider: "stripe",
    providerRef: paymentIntent.id,
    items: resolvedItems,
    totalCents,
  });
}

module.exports = { fulfillFromPaymentIntent };
