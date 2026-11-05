// Validation for the /partnership business offer form (server/src/routes/partnership.js).
// Pure function, no server or DB: node test-partnership.js
const assert = require("assert");
// Requiring the route loads lib/email, which needs a key to construct; nothing is sent.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_test_placeholder";
const { validateOffer } = require("../server/src/routes/partnership");

const base = { name: "Alex Morgan", email: "alex@example.test", country: "US", message: "A proposal worth reading." };
const ok = (b) => validateOffer(b).offer;
const err = (b) => validateOffer(b).error;

assert.strictEqual(ok({ ...base, offerType: "creator", audience: "5k-25k" }).audience, "5k-25k");
assert.match(err({ ...base, offerType: "creator" }), /audience/);
assert.strictEqual(ok({ ...base, offerType: "brand", audience: "5k-25k", budget: "$5k-$25k" }).audience, null, "audience is creator-only");
assert.strictEqual(ok({ ...base, offerType: "brand", budget: "a million" }).budget, null, "unknown budget dropped");
assert.strictEqual(ok({ ...base, offerType: "other", budget: "$5k-$25k" }).budget, null, "budget is brand-only");
assert.match(err({ ...base, offerType: "spam" }), /kind of offer/);
assert.match(err({ ...base, offerType: "other", email: "nope" }), /email/);
assert.match(err({ ...base, offerType: "other", country: "FR" }), /country/);
assert.match(err({ ...base, offerType: "other", message: "hi" }), /describe/);
assert.strictEqual(ok({ ...base, offerType: "other", name: "x".repeat(500) }).name.length, 120);
console.log("partnership offer validation: all checks passed");
