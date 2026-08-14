const Stripe = require("stripe");

// Whether this deployment can actually take card payments. The client below
// is constructed either way (so nothing has to null-check it), but with a
// placeholder key every call fails at Stripe's API with an authentication
// error — which used to surface to the shopper as a raw 400 at the moment
// they tried to pay. Routes check this flag first and answer 503 with copy a
// customer can act on instead.
const isStripeConfigured = /^sk_(test|live)_/.test(process.env.STRIPE_SECRET_KEY || "");

// Pinned deliberately. Without an explicit version the SDK sends whatever
// version it was built against, so a routine `npm update` can silently change
// the shape of PaymentIntent/Charge/Event payloads that fulfillment reads —
// a payments regression introduced by a dependency bump, discovered in
// production. Change this only alongside a review of the Stripe changelog.
const STRIPE_API_VERSION = "2024-12-18.acacia";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY || "sk_test_placeholder", {
  apiVersion: STRIPE_API_VERSION,
  // Stripe's SDK retries idempotently on network failure; without a cap a
  // checkout request can hang far longer than the shopper will wait.
  maxNetworkRetries: 2,
  timeout: 20000,
});

module.exports = { stripe, isStripeConfigured, STRIPE_API_VERSION };
