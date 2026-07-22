#!/usr/bin/env node
//
// Email deliverability check. Run after changing RESEND_API_KEY or
// RESEND_FROM_EMAIL:
//
//   cd /var/www/mitm-fa/server && node scripts/check-email.js
//   cd /var/www/mitm-fa/server && node scripts/check-email.js you@example.com
//
// With no argument it only performs read-only checks and sends nothing.
// Pass a recipient to also send one real test message to that address.
//
// Never prints the API key.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const KEY = process.env.RESEND_API_KEY || "";
const FROM_OVERRIDE = process.env.RESEND_FROM_EMAIL || "";
const recipient = process.argv[2];

function line(ok, msg) {
  console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);
}

(async () => {
  console.log("\nResend configuration check\n");

  if (!KEY) {
    line(false, "RESEND_API_KEY is not set in server/.env");
    process.exit(1);
  }
  // Real Resend keys are re_ plus ~33 chars. The placeholder shipped in
  // .env.example is much shorter, and that exact placeholder was live in
  // production — worth calling out explicitly rather than just failing auth.
  line(true, `RESEND_API_KEY present (prefix ${KEY.slice(0, 3)}…, length ${KEY.length})`);
  if (KEY.length < 30) {
    line(false, "  ^ that length looks like the .env.example placeholder, not a real key");
  }

  // --- Key validity + verified domains (read-only) ---
  let domains = [];
  try {
    const res = await fetch("https://api.resend.com/domains", {
      headers: { Authorization: `Bearer ${KEY}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      line(false, `key rejected by Resend: ${body.message || res.status}`);
      console.log("\n  Fix: create a key at https://resend.com/api-keys and set RESEND_API_KEY in server/.env\n");
      process.exit(1);
    }
    line(true, "key accepted by Resend");
    domains = (body.data || []).filter((d) => d.status === "verified");
  } catch (err) {
    line(false, `could not reach Resend: ${err.message}`);
    process.exit(1);
  }

  // --- From address ---
  // onboarding@resend.dev is Resend's shared sandbox sender. It works, but it
  // will ONLY deliver to the address that owns the Resend account — every
  // send to a real customer is rejected. A verified domain is required before
  // any of this reaches an actual buyer.
  const from = FROM_OVERRIDE || "(store name) <onboarding@resend.dev>";
  console.log(`\n  From address: ${from}`);
  if (!FROM_OVERRIDE) {
    line(false, "RESEND_FROM_EMAIL not set — falling back to onboarding@resend.dev");
    console.log("        onboarding@resend.dev only delivers to your own Resend account address.");
    console.log("        Customer sign-in links and receipts will be REJECTED.");
  }

  if (domains.length) {
    line(true, `verified domain(s): ${domains.map((d) => d.name).join(", ")}`);
    if (!FROM_OVERRIDE) {
      console.log(`        Set: RESEND_FROM_EMAIL="Fitness Agency <noreply@${domains[0].name}>"`);
    }
  } else {
    line(false, "no verified sending domain on this Resend account");
    console.log("        Add and verify fitness.agency at https://resend.com/domains");
  }

  // --- Optional live send ---
  if (!recipient) {
    console.log("\n  (no recipient given — nothing was sent)");
    console.log("  To send one real test message: node scripts/check-email.js you@example.com\n");
    return;
  }

  const { sendAdminEmail } = require("../src/lib/email");
  console.log(`\n  Sending one test message to ${recipient}…`);
  const result = await sendAdminEmail(recipient, {
    subject: "Fitness Agency — email delivery test",
    body: "If you're reading this, outbound email is working.",
  });
  if (result && result.error) {
    line(false, `send rejected: ${result.error.message || JSON.stringify(result.error)}`);
    process.exit(1);
  }
  line(true, "send accepted by Resend — check the inbox (and spam)");
  console.log("");
})().catch((err) => {
  console.error("\n  Unexpected error:", err.message, "\n");
  process.exit(1);
});
