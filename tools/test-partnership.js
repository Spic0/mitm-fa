// Validation for /api/partnership, the endpoint behind the setup wizard on
// /partnership (server/src/routes/partnership.js). Pure function, no server
// or DB: node test-partnership.js
const assert = require("assert");
// Requiring the route loads lib/email, which needs a key to construct; nothing is sent.
process.env.RESEND_API_KEY = process.env.RESEND_API_KEY || "re_test_placeholder";
const { validateEnquiry } = require("../server/src/routes/partnership");

const base = { name: "Alex Morgan", email: "alex@example.test" };
const ok = (b) => validateEnquiry(b).enquiry;
const err = (b) => validateEnquiry(b).error;

// The wizard's own body (as presentation.js sends it) is accepted as is.
const wizard = ok({ ...base, visitId: "", intent: "Partnership estimate", company: "", message: "Estimated partnership range: 15% - 18%" });
assert.strictEqual(wizard.intent, "Partnership estimate");
assert.match(wizard.message, /15%/);
assert.strictEqual(ok(base).intent, "Partnership estimate", "intent defaults like the deck endpoint");
assert.match(err({ email: "alex@example.test" }), /name/);
assert.match(err({ ...base, email: "nope" }), /email/);
assert.strictEqual(ok({ ...base, name: "x".repeat(500) }).name.length, 120);
assert.strictEqual(ok({ ...base, message: "m".repeat(5000) }).message.length, 4000);
console.log("partnership enquiry validation: all checks passed");
