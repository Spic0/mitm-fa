#!/usr/bin/env node
//
// Stripe configuration check. Run after setting the Stripe env vars:
//
//   cd /var/www/mitm-fa/server && node scripts/check-stripe.js
//
// Read-only: lists keys, account state, enabled payment methods and
// webhook endpoints. Creates nothing and charges nothing.
// Never prints a secret.
require("dotenv").config({ path: require("path").join(__dirname, "..", ".env") });

const SECRET = process.env.STRIPE_SECRET_KEY || "";
const PUBLISHABLE = process.env.STRIPE_PUBLISHABLE_KEY || "";
const WEBHOOK = process.env.STRIPE_WEBHOOK_SECRET || "";
const APP_URL = process.env.APP_URL || "";

const line = (ok, msg) => console.log(`  ${ok ? "OK  " : "FAIL"}  ${msg}`);

async function api(path) {
  const res = await fetch(`https://api.stripe.com/v1/${path}`, {
    headers: { Authorization: `Bearer ${SECRET}` },
  });
  return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) };
}

(async () => {
  console.log("\nStripe configuration check\n");

  let fatal = false;
  for (const [name, val] of [
    ["STRIPE_SECRET_KEY", SECRET],
    ["STRIPE_PUBLISHABLE_KEY", PUBLISHABLE],
    ["STRIPE_WEBHOOK_SECRET", WEBHOOK],
  ]) {
    if (!val) { line(false, `${name} is not set in server/.env`); fatal = true; }
    else line(true, `${name} present (${val.slice(0, 7)}…, length ${val.length})`);
  }
  if (fatal) {
    console.log("\n  Keys come from https://dashboard.stripe.com/apikeys");
    console.log("  The webhook secret comes from the endpoint you create at");
    console.log("  https://dashboard.stripe.com/webhooks\n");
    process.exit(1);
  }

  // Test vs live must not be mixed — a live publishable key with a test
  // secret fails only at confirm time, which is the worst place to find out.
  const secretMode = SECRET.startsWith("sk_live") ? "live" : "test";
  const pubMode = PUBLISHABLE.startsWith("pk_live") ? "live" : "test";
  line(secretMode === pubMode, `key modes match (secret=${secretMode}, publishable=${pubMode})`);
  if (secretMode === "live") {
    console.log("        NOTE: these are LIVE keys — real cards will be charged.");
  }

  const acct = await api("account");
  if (!acct.ok) {
    line(false, `secret key rejected: ${(acct.body.error || {}).message || acct.status}`);
    process.exit(1);
  }
  line(true, `account ${acct.body.id}${acct.body.country ? " (" + acct.body.country + ")" : ""}`);
  line(!!acct.body.charges_enabled, `charges_enabled: ${acct.body.charges_enabled}`);
  if (!acct.body.charges_enabled) {
    console.log("        Stripe has not enabled charges on this account yet — complete onboarding.");
  }

  // Payment Element renders whatever is enabled here; Apple Pay and Google
  // Pay additionally require domain verification, which is why they can be
  // "on" and still not appear.
  const pm = await api("payment_method_configurations");
  if (pm.ok && (pm.body.data || []).length) {
    const cfg = pm.body.data[0];
    const enabled = Object.keys(cfg)
      .filter((k) => cfg[k] && typeof cfg[k] === "object" && cfg[k].display_preference)
      .filter((k) => (cfg[k].display_preference.value || "") !== "off");
    console.log(`\n  Payment methods enabled: ${enabled.join(", ") || "(none)"}`);
    for (const want of ["card", "apple_pay", "google_pay", "link"]) {
      line(enabled.includes(want), `  ${want}`);
    }
  } else {
    console.log("\n  Could not read payment method configuration (older API mode?)");
  }

  const domains = await api("apple_pay/domains");
  if (domains.ok) {
    const names = (domains.body.data || []).map((d) => d.domain_name);
    const host = APP_URL.replace(/^https?:\/\//, "").replace(/\/$/, "");
    line(names.includes(host), `Apple Pay domain registered for ${host || "(APP_URL unset)"}${names.length ? " — have: " + names.join(", ") : " — none registered"}`);
    if (!names.includes(host)) {
      console.log("        Apple Pay will NOT appear until this domain is verified at");
      console.log("        https://dashboard.stripe.com/settings/payments/apple_pay");
    }
  }

  const hooks = await api("webhook_endpoints");
  if (hooks.ok) {
    const eps = hooks.body.data || [];
    const expected = APP_URL ? `${APP_URL.replace(/\/$/, "")}/api/webhooks/stripe` : null;
    const match = eps.find((e) => e.url === expected);
    line(!!match, `webhook endpoint for ${expected || "(APP_URL unset)"}${match ? ` (${match.status})` : " — not found"}`);
    if (eps.length && !match) {
      console.log(`        Endpoints on this account: ${eps.map((e) => e.url).join(", ")}`);
    }
    if (match) {
      const needed = ["payment_intent.succeeded"];
      const has = match.enabled_events || [];
      const covered = has.includes("*") || needed.every((e) => has.includes(e));
      line(covered, `  subscribes to ${needed.join(", ")}`);
    }
  }

  console.log("\n  Nothing was created or charged by this check.\n");
})().catch((err) => {
  console.error("\n  Unexpected error:", err.message, "\n");
  process.exit(1);
});
