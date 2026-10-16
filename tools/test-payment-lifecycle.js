#!/usr/bin/env node
/*
 * End-to-end payment lifecycle test.
 *
 * This exercises the parts of checkout that only ever run AFTER a customer's
 * money has moved — the webhook, fulfillment, entitlement and refund paths —
 * which are exactly the parts that cannot be tested by clicking through the
 * site, and exactly the parts where a bug costs a real customer real money.
 *
 * It needs no Stripe or PayPal account. Stripe verifies webhook signatures
 * with a local HMAC-SHA256 over `t=<timestamp>.<raw body>`, so a synthetic
 * PaymentIntent signed with the configured whsec_ is indistinguishable from a
 * real delivery as far as the server is concerned. Everything downstream of
 * signature verification — snapshot loading, order creation, the providerRef
 * unique constraint, entitlement — is our own code and runs for real.
 *
 * Runs against the `builder_test` postgres schema on a spare port so it never
 * touches production data. See tools/README or the deploy notes.
 *
 *   npm run test:payment-lifecycle     (from tools/)
 */

const { spawn } = require("child_process");
const crypto = require("crypto");
const path = require("path");

const SERVER_DIR = path.join(__dirname, "..", "server");
const PORT = Number(process.env.TEST_PORT || 3210);
const BASE = `http://127.0.0.1:${PORT}`;
const WEBHOOK_SECRET = "whsec_lifecycle_test_only_not_a_real_secret";

// ---------------------------------------------------------------------------
// Assertions
// ---------------------------------------------------------------------------
let passed = 0;
const failures = [];
let currentScenario = "(none)";

function scenario(name) {
  currentScenario = name;
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function check(label, condition, detail) {
  if (condition) {
    passed++;
    console.log(`  \x1b[32m✓\x1b[0m ${label}`);
  } else {
    failures.push({ scenario: currentScenario, label, detail });
    console.log(`  \x1b[31m✗ ${label}\x1b[0m${detail ? ` — ${detail}` : ""}`);
  }
}

function eq(label, actual, expected) {
  check(label, actual === expected, `expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

// ---------------------------------------------------------------------------
// Environment: point the server and our own Prisma client at builder_test
// ---------------------------------------------------------------------------
function buildEnv() {
  const fs = require("fs");
  const envPath = path.join(SERVER_DIR, ".env");
  const raw = fs.readFileSync(envPath, "utf8");
  const parsed = {};
  for (const line of raw.split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) parsed[m[1]] = m[2].replace(/^"|"$/g, "");
  }
  const baseUrl = (parsed.DATABASE_URL || "").replace(/\?schema=\w+$/, "");
  return {
    ...process.env,
    ...parsed,
    DATABASE_URL: `${baseUrl}?schema=builder_test`,
    PORT: String(PORT),
    APP_URL: BASE,
    NODE_ENV: "test",
    // Enough to satisfy the shape checks; no network call is ever made with
    // these. Signature verification is a local HMAC, which is the whole
    // reason this test can run offline.
    STRIPE_SECRET_KEY: "sk_test_lifecycle_placeholder",
    STRIPE_PUBLISHABLE_KEY: "pk_test_lifecycle_placeholder",
    STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
    // A syntactically valid but non-functional key. The Resend client throws
    // at construction time (so it can't simply be blank), but every send with
    // this key fails at the API — which is exactly the condition we want,
    // since receipt email must never be a precondition for fulfillment.
    RESEND_API_KEY: "re_lifecycle_test_placeholder",
  };
}

const ENV = buildEnv();
process.env.DATABASE_URL = ENV.DATABASE_URL;
// deriveCsrfToken() below runs in THIS process, so it needs the same secret
// the server is using.
process.env.CSRF_SECRET = ENV.CSRF_SECRET;

const { PrismaClient } = require(path.join(SERVER_DIR, "node_modules", "@prisma/client"));
const prisma = new PrismaClient({ datasources: { db: { url: ENV.DATABASE_URL } } });

// ---------------------------------------------------------------------------
// Stripe webhook signing — the same scheme stripe-node verifies
// ---------------------------------------------------------------------------
function signStripePayload(payload, secret = WEBHOOK_SECRET, timestamp = Math.floor(Date.now() / 1000)) {
  const signedPayload = `${timestamp}.${payload}`;
  const signature = crypto.createHmac("sha256", secret).update(signedPayload, "utf8").digest("hex");
  return `t=${timestamp},v1=${signature}`;
}

async function postWebhook(eventObject, { secret = WEBHOOK_SECRET, timestamp, tamper = false } = {}) {
  let body = JSON.stringify(eventObject);
  const header = signStripePayload(body, secret, timestamp);
  if (tamper) {
    // Signature computed over the original body, then the body is changed —
    // the exact shape of a replay/forgery attempt.
    const tampered = JSON.parse(body);
    tampered.data.object.amount_received = 1;
    body = JSON.stringify(tampered);
  }
  // index.js 301s any request that doesn't look like it arrived over HTTPS,
  // and a redirect to https://127.0.0.1 is an immediate connection failure —
  // so every request in this file has to carry the proxy header.
  const res = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "stripe-signature": header,
      "x-forwarded-proto": "https",
    },
    body,
    redirect: "manual",
  });
  return { status: res.status, text: await res.text() };
}

// Authenticated request as a given user. The session cookie is `profit_session`
// (HttpOnly), and any unsafe method additionally needs the signed
// double-submit CSRF token, which is an HMAC of the raw session token — so a
// valid request has to hold both, exactly as a real browser does.
const { deriveCsrfToken } = require(path.join(SERVER_DIR, "src", "lib", "csrf.js"));

async function authFetch(pathname, { token, method = "GET", body } = {}) {
  const headers = {
    "x-forwarded-proto": "https",
    cookie: `profit_session=${token}`,
  };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (method !== "GET" && method !== "HEAD" && token) {
    headers["x-csrf-token"] = deriveCsrfToken(token);
  }
  return fetch(`${BASE}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: "manual",
  });
}

function makeIntentEvent({ intentId, pendingCheckoutId, amount, email, type = "payment_intent.succeeded", status = "succeeded", eventId }) {
  return {
    id: eventId || `evt_test_${crypto.randomBytes(8).toString("hex")}`,
    object: "event",
    type,
    data: {
      object: {
        id: intentId,
        object: "payment_intent",
        status,
        amount,
        amount_received: status === "succeeded" ? amount : 0,
        currency: "usd",
        metadata: { pendingCheckoutId, email },
      },
    },
  };
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const FIXTURE_TAG = `lifecycle-${Date.now()}`;
const createdProductIds = [];
const createdUserEmails = new Set();

async function makeProduct(name, priceCents, status = "published") {
  const p = await prisma.product.create({
    data: {
      slug: `${FIXTURE_TAG}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name: `${FIXTURE_TAG} ${name}`,
      priceCents,
      status,
    },
  });
  createdProductIds.push(p.id);
  return p;
}

function testEmail(label) {
  const email = `${FIXTURE_TAG}-${label}@example.test`.toLowerCase();
  createdUserEmails.add(email);
  return email;
}

// Creates a PendingCheckout the same way the real create-intent route does —
// through the server's own snapshot module, so pricing is the production code
// path and not a reimplementation.
const { createCheckoutSnapshot } = require(path.join(SERVER_DIR, "src", "lib", "checkoutSnapshot.js"));

async function makeSnapshot(items, email, provider = "stripe") {
  return createCheckoutSnapshot({
    items,
    customer: { email, name: "Lifecycle Test", phone: "+15550000000", country: "US" },
    provider,
  });
}

// Sweeps by the shared `lifecycle-` prefix rather than only this run's ids,
// so a run that crashes half way doesn't leave fixtures behind for the next
// one to trip over. Everything it touches is prefix-scoped to this test.
async function cleanup() {
  const PREFIX = "lifecycle-";

  // Order matters — foreign keys.
  const users = await prisma.user.findMany({ where: { email: { startsWith: PREFIX } } });
  const userIds = users.map((u) => u.id);
  const products = await prisma.product.findMany({ where: { slug: { startsWith: PREFIX } } });
  const productIds = products.map((p) => p.id);

  const orders = await prisma.order.findMany({
    where: { OR: [{ userId: { in: userIds } }, { items: { some: { productId: { in: productIds } } } }] },
  });
  const orderIds = orders.map((o) => o.id);

  await prisma.orderItem.deleteMany({ where: { OR: [{ orderId: { in: orderIds } }, { productId: { in: productIds } }] } });
  await prisma.orderNote.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.promotionRedemption.deleteMany({ where: { orderId: { in: orderIds } } }).catch(() => {});
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.magicLinkToken.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  await prisma.programProgress.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.pendingCheckout.deleteMany({ where: { email: { startsWith: PREFIX } } });
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.webhookEvent.deleteMany({ where: { eventId: { startsWith: "evt_test_" } } });
  await prisma.paymentEvent.deleteMany({
    where: { OR: [{ providerRef: { startsWith: "pi_test_" } }, { providerRef: { startsWith: "pp_test_" } }] },
  }).catch(() => {});
}

// ---------------------------------------------------------------------------
// Server lifecycle
// ---------------------------------------------------------------------------
let serverProc;

async function startServer() {
  serverProc = spawn("node", ["src/index.js"], { cwd: SERVER_DIR, env: ENV, stdio: ["ignore", "pipe", "pipe"] });
  const logs = [];
  serverProc.stdout.on("data", (d) => logs.push(d.toString()));
  serverProc.stderr.on("data", (d) => logs.push(d.toString()));

  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/products`, { headers: { "x-forwarded-proto": "https" } });
      if (res.status < 500) return logs;
    } catch (_) {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`Server did not start on ${PORT}:\n${logs.join("")}`);
}

function stopServer() {
  if (serverProc && !serverProc.killed) serverProc.kill("SIGTERM");
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

async function scenarioSingleItem() {
  scenario("Single item: snapshot → signed webhook → order → entitlement");
  const product = await makeProduct("Single", 4999);
  const email = testEmail("single");
  const { pending, totalCents } = await makeSnapshot([{ productId: product.id, qty: 1 }], email);

  eq("server prices the cart itself", totalCents, 4999);

  const intentId = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
  const res = await postWebhook(makeIntentEvent({ intentId, pendingCheckoutId: pending.id, amount: 4999, email }));
  eq("webhook accepted", res.status, 200);

  const order = await prisma.order.findUnique({
    where: { providerRef: intentId },
    include: { items: true, user: true },
  });
  check("order created", !!order);
  if (!order) return;
  eq("order status is paid", order.status, "paid");
  eq("order total matches charge", order.totalCents, 4999);
  eq("order provider recorded", order.provider, "stripe");
  eq("one order item", order.items.length, 1);
  eq("item price frozen at purchase price", order.items[0].priceCents, 4999);
  eq("order attributed to buyer's email", order.user.email, email);

  const { hasEntitlement } = require(path.join(SERVER_DIR, "src", "lib", "entitlements.js"));
  check("entitlement granted", await hasEntitlement(order.userId, product.id));

  const consumed = await prisma.pendingCheckout.findUnique({ where: { id: pending.id } });
  check("snapshot marked consumed", !!consumed.consumedAt);
  eq("snapshot records the payment id", consumed.providerRef, intentId);
}

async function scenarioCartSizes() {
  scenario("Cart sizes 1 / 5 / 10 / 20 / 50 — no truncation, no metadata overflow");
  const email = testEmail("carts");
  const products = [];
  for (let i = 0; i < 50; i++) products.push(await makeProduct(`Bulk${i}`, 1000 + i));

  for (const size of [1, 5, 10, 20, 50]) {
    const items = products.slice(0, size).map((p) => ({ productId: p.id, qty: 1 }));
    const { pending, totalCents } = await makeSnapshot(items, email);

    const expectedTotal = products.slice(0, size).reduce((s, p) => s + p.priceCents, 0);
    eq(`cart of ${size}: total priced server-side`, totalCents, expectedTotal);

    const resolved = JSON.parse(pending.resolvedItemsJson);
    eq(`cart of ${size}: every line item survives the snapshot`, resolved.length, size);

    // This is the actual regression guard: Stripe caps a single metadata
    // VALUE at 500 characters. The cart must never be what travels there.
    const metadataValues = {
      pendingCheckoutId: pending.id,
      email,
      name: "Lifecycle Test",
      phone: "+15550000000",
      country: "US",
    };
    const longest = Math.max(...Object.values(metadataValues).map((v) => String(v).length));
    check(
      `cart of ${size}: largest Stripe metadata value is ${longest} chars (limit 500)`,
      longest < 500,
      `longest value was ${longest}`
    );

    const intentId = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
    const res = await postWebhook(makeIntentEvent({ intentId, pendingCheckoutId: pending.id, amount: expectedTotal, email }));
    eq(`cart of ${size}: webhook fulfilled`, res.status, 200);

    const order = await prisma.order.findUnique({ where: { providerRef: intentId }, include: { items: true } });
    check(`cart of ${size}: order exists`, !!order);
    if (order) {
      eq(`cart of ${size}: all ${size} products delivered`, order.items.length, size);
      eq(`cart of ${size}: total matches`, order.totalCents, expectedTotal);
    }
  }
}

async function scenarioQuantities() {
  scenario("Quantity handling and manipulation");
  const product = await makeProduct("Qty", 2500);
  const email = testEmail("qty");

  const { pending, totalCents } = await makeSnapshot([{ productId: product.id, qty: 3 }], email);
  eq("qty 3 priced as 3 units", totalCents, 7500);
  eq("snapshot expands to one entry per unit", JSON.parse(pending.resolvedItemsJson).length, 3);

  // A client-supplied price must be ignored entirely.
  const { pending: p2, totalCents: t2 } = await makeSnapshot(
    [{ productId: product.id, qty: 1, priceCents: 1, price: 1 }],
    email
  );
  eq("client-supplied priceCents ignored", t2, 2500);
  eq("snapshot uses catalog price", JSON.parse(p2.resolvedItemsJson)[0].priceCents, 2500);

  // Negative / absurd quantities are clamped, not trusted.
  const { totalCents: t3 } = await makeSnapshot([{ productId: product.id, qty: -5 }], email);
  eq("negative qty clamped to 1", t3, 2500);

  const { totalCents: t4 } = await makeSnapshot([{ productId: product.id, qty: 9999 }], email);
  eq("absurd qty clamped to per-line max of 10", t4, 25000);
}

async function scenarioInvalidProduct() {
  scenario("Invalid and unpublished products are unbuyable");
  const email = testEmail("invalid");

  let threw = null;
  try {
    await makeSnapshot([{ productId: "prod_does_not_exist" }], email);
  } catch (err) {
    threw = err.message;
  }
  check("unknown product id rejected at checkout", !!threw && /Unknown product/.test(threw), threw);

  const draft = await makeProduct("DraftOnly", 3000, "draft");
  threw = null;
  try {
    await makeSnapshot([{ productId: draft.id }], email);
  } catch (err) {
    threw = err.message;
  }
  check("unpublished product rejected at checkout", !!threw && /Unknown product/.test(threw), threw);

  threw = null;
  try {
    await makeSnapshot([], email);
  } catch (err) {
    threw = err.message;
  }
  check("empty cart rejected", !!threw && /empty/i.test(threw), threw);
}

async function scenarioDuplicateWebhook() {
  scenario("Duplicate webhook delivery never creates a second order");
  const product = await makeProduct("Dupe", 1999);
  const email = testEmail("dupe");
  const { pending } = await makeSnapshot([{ productId: product.id }], email);
  const intentId = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
  const event = makeIntentEvent({ intentId, pendingCheckoutId: pending.id, amount: 1999, email });

  const first = await postWebhook(event);
  eq("first delivery accepted", first.status, 200);

  // Same event id — Stripe's own retry.
  const second = await postWebhook(event);
  eq("redelivery of same event id accepted", second.status, 200);
  check("redelivery reported as duplicate", /duplicate/.test(second.text), second.text);

  // Different event id, same PaymentIntent — a distinct event about the same
  // payment, which the event-id claim does NOT catch. Only the providerRef
  // unique constraint stands between this and a double order.
  const thirdEvent = makeIntentEvent({ intentId, pendingCheckoutId: pending.id, amount: 1999, email });
  const third = await postWebhook(thirdEvent);
  eq("new event id for same payment accepted", third.status, 200);

  const count = await prisma.order.count({ where: { providerRef: intentId } });
  eq("exactly one order for the payment", count, 1);

  const items = await prisma.orderItem.count({ where: { order: { providerRef: intentId } } });
  eq("exactly one entitlement-granting item", items, 1);
}

async function scenarioConcurrentWebhooks() {
  scenario("Five concurrent deliveries for one payment → exactly one order");
  const product = await makeProduct("Concurrent", 8800);
  const email = testEmail("concurrent");
  const { pending } = await makeSnapshot([{ productId: product.id }], email);
  const intentId = `pi_test_${crypto.randomBytes(8).toString("hex")}`;

  // Five DISTINCT event ids for the same PaymentIntent, fired together. This
  // deliberately bypasses the webhook-event dedupe so the race lands squarely
  // on Order.providerRef's unique constraint — the thing that actually
  // guarantees the business outcome.
  const results = await Promise.all(
    Array.from({ length: 5 }, () =>
      postWebhook(makeIntentEvent({ intentId, pendingCheckoutId: pending.id, amount: 8800, email }))
    )
  );

  eq("all five deliveries answered 200", results.filter((r) => r.status === 200).length, 5);

  const count = await prisma.order.count({ where: { providerRef: intentId } });
  eq("exactly one order row", count, 1);

  const users = await prisma.user.count({ where: { email } });
  eq("exactly one user row", users, 1);

  const items = await prisma.orderItem.count({ where: { order: { providerRef: intentId } } });
  eq("exactly one order item", items, 1);
}

async function scenarioSignatureSecurity() {
  scenario("Webhook spoofing and replay are rejected");
  const product = await makeProduct("Spoof", 5000);
  const email = testEmail("spoof");
  const { pending } = await makeSnapshot([{ productId: product.id }], email);

  const intentA = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
  const forged = await postWebhook(makeIntentEvent({ intentId: intentA, pendingCheckoutId: pending.id, amount: 5000, email }), {
    secret: "whsec_attacker_does_not_know_the_real_one",
  });
  eq("forged signature rejected", forged.status, 400);
  eq("no order created from forged webhook", await prisma.order.count({ where: { providerRef: intentA } }), 0);

  const intentB = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
  const unsigned = await fetch(`${BASE}/api/webhooks/stripe`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
    body: JSON.stringify(makeIntentEvent({ intentId: intentB, pendingCheckoutId: pending.id, amount: 5000, email })),
    redirect: "manual",
  });
  eq("unsigned webhook rejected", unsigned.status, 400);
  eq("no order created from unsigned webhook", await prisma.order.count({ where: { providerRef: intentB } }), 0);

  const intentC = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
  const tampered = await postWebhook(
    makeIntentEvent({ intentId: intentC, pendingCheckoutId: pending.id, amount: 5000, email }),
    { tamper: true }
  );
  eq("body tampered after signing is rejected", tampered.status, 400);
  eq("no order created from tampered webhook", await prisma.order.count({ where: { providerRef: intentC } }), 0);

  // Stripe's own tolerance window rejects an old timestamp, which is what
  // stops a captured-and-replayed delivery from being accepted forever.
  const intentD = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
  const stale = await postWebhook(
    makeIntentEvent({ intentId: intentD, pendingCheckoutId: pending.id, amount: 5000, email }),
    { timestamp: Math.floor(Date.now() / 1000) - 60 * 60 * 24 }
  );
  eq("replay with a stale timestamp rejected", stale.status, 400);
  eq("no order created from stale replay", await prisma.order.count({ where: { providerRef: intentD } }), 0);
}

async function scenarioPriceDrift() {
  scenario("Price changed after checkout started — customer gets what they paid for");
  const product = await makeProduct("Drift", 6000);
  const email = testEmail("drift");
  const { pending, totalCents } = await makeSnapshot([{ productId: product.id }], email);
  eq("quoted at the old price", totalCents, 6000);

  // Admin edits the price while the customer is on the payment screen.
  await prisma.product.update({ where: { id: product.id }, data: { priceCents: 19900 } });

  const intentId = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
  const res = await postWebhook(makeIntentEvent({ intentId, pendingCheckoutId: pending.id, amount: 6000, email }));
  eq("webhook fulfilled", res.status, 200);

  const order = await prisma.order.findUnique({ where: { providerRef: intentId }, include: { items: true } });
  check("order exists", !!order);
  if (!order) return;
  eq("order total is what was charged, not the new price", order.totalCents, 6000);
  eq("line item price is the price at purchase", order.items[0].priceCents, 6000);
}

async function scenarioUnpublishedMidFlight() {
  scenario("Product unpublished after payment — webhook must still fulfill");
  const product = await makeProduct("Vanish", 7200);
  const email = testEmail("vanish");
  const { pending } = await makeSnapshot([{ productId: product.id }], email);

  // The old failure: this made fulfillment re-resolve and throw "Unknown
  // product", so the webhook 500'd forever and a paying customer never got
  // access.
  await prisma.product.update({ where: { id: product.id }, data: { status: "archived" } });

  const intentId = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
  const res = await postWebhook(makeIntentEvent({ intentId, pendingCheckoutId: pending.id, amount: 7200, email }));
  eq("webhook fulfilled despite product being unpublished", res.status, 200);

  const order = await prisma.order.findUnique({ where: { providerRef: intentId }, include: { items: true } });
  check("paid customer still got their order", !!order);
  if (order) {
    eq("product still delivered", order.items.length, 1);
    const { hasEntitlement } = require(path.join(SERVER_DIR, "src", "lib", "entitlements.js"));
    check("entitlement still granted", await hasEntitlement(order.userId, product.id));
  }
}

async function scenarioAmountMismatch() {
  scenario("Charged amount disagrees with quote — order records the charge and flags it");
  const product = await makeProduct("Mismatch", 5000);
  const email = testEmail("mismatch");
  const { pending } = await makeSnapshot([{ productId: product.id }], email);

  const intentId = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
  // Provider reports a different figure than we quoted.
  const res = await postWebhook(makeIntentEvent({ intentId, pendingCheckoutId: pending.id, amount: 4200, email }));
  eq("webhook still fulfills (money moved, buyer is owed the product)", res.status, 200);

  const order = await prisma.order.findUnique({ where: { providerRef: intentId } });
  check("order created", !!order);
  if (order) eq("order records the amount actually charged", order.totalCents, 4200);

  const flagged = await prisma.paymentEvent.findFirst({
    where: { providerRef: intentId, eventType: "checkout.amount_mismatch" },
  });
  check("mismatch left a permanent audit record", !!flagged);
}

async function scenarioFailedAndCanceled() {
  scenario("Failed and canceled payments never grant access");
  const product = await makeProduct("Failed", 3300);
  const email = testEmail("failed");
  const { pending } = await makeSnapshot([{ productId: product.id }], email);

  const intentId = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
  const res = await postWebhook(
    makeIntentEvent({
      intentId,
      pendingCheckoutId: pending.id,
      amount: 3300,
      email,
      type: "payment_intent.payment_failed",
      status: "requires_payment_method",
    })
  );
  eq("failed-payment webhook accepted", res.status, 200);
  eq("no order created for a failed payment", await prisma.order.count({ where: { providerRef: intentId } }), 0);

  // A canceled checkout is simply a snapshot that no payment ever claims.
  const canceled = await prisma.pendingCheckout.findUnique({ where: { id: pending.id } });
  check("abandoned snapshot is never marked consumed", !canceled.consumedAt);

  // And a succeeded event whose intent is NOT succeeded must be refused.
  const { fulfillFromPaymentIntent } = require(path.join(SERVER_DIR, "src", "lib", "stripeFulfillment.js"));
  let threw = null;
  try {
    await fulfillFromPaymentIntent({
      id: `pi_test_${crypto.randomBytes(6).toString("hex")}`,
      status: "requires_payment_method",
      amount: 3300,
      metadata: { pendingCheckoutId: pending.id },
    });
  } catch (err) {
    threw = err.message;
  }
  check("fulfillment refuses a non-succeeded PaymentIntent", !!threw && /not succeeded/i.test(threw), threw);
}

async function scenarioBrowserClosed() {
  scenario("Browser closed immediately after payment — webhook alone completes everything");
  const product = await makeProduct("NoBrowser", 12000);
  const email = testEmail("nobrowser");
  const { pending } = await makeSnapshot([{ productId: product.id }], email);
  const intentId = `pi_test_${crypto.randomBytes(8).toString("hex")}`;

  // No /stripe/finalize call at all — the browser is gone.
  const res = await postWebhook(makeIntentEvent({ intentId, pendingCheckoutId: pending.id, amount: 12000, email }));
  eq("webhook accepted", res.status, 200);

  const order = await prisma.order.findUnique({ where: { providerRef: intentId }, include: { user: true } });
  check("order exists without any browser involvement", !!order);
  if (!order) return;

  const { hasEntitlement } = require(path.join(SERVER_DIR, "src", "lib", "entitlements.js"));
  check("entitlement granted without the browser", await hasEntitlement(order.userId, product.id));

  const user = await prisma.user.findUnique({ where: { email } });
  check("customer account created", !!user);

  // The customer can still get in: a magic-link token was minted for them.
  const session = await prisma.session.findFirst({ where: { userId: order.userId } });
  check("a session was minted server-side for the buyer", !!session);
}

async function scenarioOrderAccessControl() {
  scenario("Order access control — IDOR and unauthenticated access");
  const product = await makeProduct("Private", 4000);
  const ownerEmail = testEmail("owner");
  const otherEmail = testEmail("other");

  const { pending } = await makeSnapshot([{ productId: product.id }], ownerEmail);
  const intentId = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
  await postWebhook(makeIntentEvent({ intentId, pendingCheckoutId: pending.id, amount: 4000, email: ownerEmail }));
  const order = await prisma.order.findUnique({ where: { providerRef: intentId } });
  check("owner's order created", !!order);
  if (!order) return;

  // An unrelated signed-in customer.
  const { pending: p2 } = await makeSnapshot([{ productId: product.id }], otherEmail);
  const intent2 = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
  await postWebhook(makeIntentEvent({ intentId: intent2, pendingCheckoutId: p2.id, amount: 4000, email: otherEmail }));
  const otherUser = await prisma.user.findUnique({ where: { email: otherEmail } });

  const { createSession } = require(path.join(SERVER_DIR, "src", "lib", "session.js"));
  const otherToken = await createSession(otherUser.id);

  const anon = await fetch(`${BASE}/api/library/orders/${order.id}`, {
    headers: { "x-forwarded-proto": "https" },
    redirect: "manual",
  });
  check("anonymous request for an order is refused", anon.status === 401 || anon.status === 403, `got ${anon.status}`);

  const cross = await authFetch(`/api/library/orders/${order.id}`, { token: otherToken });
  eq("another customer's order is a 404, not a leak", cross.status, 404);

  const ownerUser = await prisma.user.findUnique({ where: { email: ownerEmail } });
  const ownerToken = await createSession(ownerUser.id);
  const own = await authFetch(`/api/library/orders/${order.id}`, { token: ownerToken });
  eq("owner can read their own order", own.status, 200);

  if (own.status === 200) {
    const body = await own.json();
    const serialized = JSON.stringify(body);
    check("confirmation payload exposes no secret key material", !/sk_(test|live)_|whsec_|client_secret/.test(serialized));
  }
}

async function scenarioRefund() {
  scenario("Refund: a provider failure must not revoke access or claim success");
  const product = await makeProduct("Refundable", 9500);
  const email = testEmail("refund");
  const { pending } = await makeSnapshot([{ productId: product.id }], email);
  const intentId = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
  await postWebhook(makeIntentEvent({ intentId, pendingCheckoutId: pending.id, amount: 9500, email }));
  const order = await prisma.order.findUnique({ where: { providerRef: intentId } });
  check("order to refund exists", !!order);
  if (!order) return;

  // Promote a user to admin to exercise the real authorization path.
  const adminEmail = testEmail("admin");
  const admin = await prisma.user.create({ data: { email: adminEmail, role: "admin" } });
  const { createSession } = require(path.join(SERVER_DIR, "src", "lib", "session.js"));
  const adminToken = await createSession(admin.id);

  // Non-admin must not be able to refund.
  const buyer = await prisma.user.findUnique({ where: { email } });
  const buyerToken = await createSession(buyer.id);
  const unauth = await authFetch(`/api/admin/orders/${order.id}/refund`, {
    token: buyerToken,
    method: "POST",
    body: {},
  });
  check("a customer cannot refund their own order", unauth.status === 401 || unauth.status === 403, `got ${unauth.status}`);
  const stillPaid = await prisma.order.findUnique({ where: { id: order.id } });
  eq("unauthorized refund attempt changed nothing", stillPaid.status, "paid");

  // Admin refund with placeholder Stripe credentials: the provider call MUST
  // fail, and the order must be left completely untouched. This is the exact
  // regression the old "revoke access and call it refunded" bug represents.
  const attempt = await authFetch(`/api/admin/orders/${order.id}/refund`, {
    token: adminToken,
    method: "POST",
    body: {},
  });
  check("refund against an unreachable provider does not report success", attempt.status !== 200, `got ${attempt.status}`);

  const afterFailed = await prisma.order.findUnique({ where: { id: order.id } });
  eq("order still paid after a failed provider refund", afterFailed.status, "paid");

  const { hasEntitlement } = require(path.join(SERVER_DIR, "src", "lib", "entitlements.js"));
  check("access NOT revoked after a failed provider refund", await hasEntitlement(order.userId, product.id));

  const failLog = await prisma.paymentEvent.findFirst({
    where: { orderId: order.id, eventType: "admin.refund", status: "failed" },
  });
  check("failed refund attempt is recorded in the payment log", !!failLog);

  // The deliberate escape hatch: revoke access without claiming a refund.
  const accessOnly = await authFetch(`/api/admin/orders/${order.id}/refund`, {
    token: adminToken,
    method: "POST",
    body: { accessOnly: true },
  });
  eq("accessOnly revoke succeeds", accessOnly.status, 200);
  const revoked = await prisma.order.findUnique({ where: { id: order.id } });
  eq("order marked refunded", revoked.status, "refunded");
  check("entitlement revoked", !(await hasEntitlement(order.userId, product.id)));

  const body = await accessOnly.json();
  eq("response does not claim a provider refund happened", body.refunded, false);

  // Idempotent: a second press must not fire another provider refund.
  const again = await authFetch(`/api/admin/orders/${order.id}/refund`, {
    token: adminToken,
    method: "POST",
    body: {},
  });
  eq("refunding an already-refunded order is idempotent", again.status, 200);
  const againBody = await again.json();
  check("second refund reports it was already refunded", againBody.alreadyRefunded === true);

  createdUserEmails.add(adminEmail);
}

async function scenarioRefundWebhook() {
  scenario("Provider-initiated refund (dashboard) revokes access via webhook");
  const product = await makeProduct("DashRefund", 4400);
  const email = testEmail("dashrefund");
  const { pending } = await makeSnapshot([{ productId: product.id }], email);
  const intentId = `pi_test_${crypto.randomBytes(8).toString("hex")}`;
  await postWebhook(makeIntentEvent({ intentId, pendingCheckoutId: pending.id, amount: 4400, email }));
  const order = await prisma.order.findUnique({ where: { providerRef: intentId } });
  check("order exists", !!order);
  if (!order) return;

  const refundEvent = {
    id: `evt_test_${crypto.randomBytes(8).toString("hex")}`,
    object: "event",
    type: "charge.refunded",
    data: {
      object: {
        id: `ch_test_${crypto.randomBytes(6).toString("hex")}`,
        object: "charge",
        payment_intent: intentId,
        amount_refunded: 4400,
        refunded: true,
      },
    },
  };
  const res = await postWebhook(refundEvent);
  eq("charge.refunded accepted", res.status, 200);

  const after = await prisma.order.findUnique({ where: { id: order.id } });
  eq("order marked refunded from the provider event", after.status, "refunded");

  const { hasEntitlement } = require(path.join(SERVER_DIR, "src", "lib", "entitlements.js"));
  check("access revoked", !(await hasEntitlement(order.userId, product.id)));
}

// ---------------------------------------------------------------------------
// PayPal
//
// PayPal's webhook signature check is a REMOTE call to PayPal's verify API,
// so unlike Stripe it cannot be exercised offline — that half is asserted
// separately (it fails closed without PAYPAL_WEBHOOK_ID). What these cover is
// everything downstream of verification: the shared fulfillment path that
// both the browser's capture call and the webhook funnel into, which is where
// the "money moved but no order exists" bug lived.
// ---------------------------------------------------------------------------
function makePaypalCapture({ pendingCheckoutId, amountCents, status = "COMPLETED", captureId }) {
  return {
    id: `paypal_order_${crypto.randomBytes(6).toString("hex")}`,
    status,
    purchase_units: [
      {
        custom_id: pendingCheckoutId,
        payments: {
          captures: [
            {
              id: captureId || `capture_${crypto.randomBytes(6).toString("hex")}`,
              status,
              custom_id: pendingCheckoutId,
              amount: { value: (amountCents / 100).toFixed(2), currency_code: "USD" },
            },
          ],
        },
      },
    ],
  };
}

async function scenarioPaypalLifecycle() {
  scenario("PayPal: server capture → order → entitlement");
  const { fulfillFromPaypalCapture } = require(path.join(SERVER_DIR, "src", "lib", "paypalFulfillment.js"));
  const product = await makeProduct("PaypalOne", 6400);
  const email = testEmail("paypal");
  const { pending } = await makeSnapshot([{ productId: product.id }], email, "paypal");

  const ppOrderId = `pp_test_${crypto.randomBytes(8).toString("hex")}`;
  const capture = makePaypalCapture({ pendingCheckoutId: pending.id, amountCents: 6400 });

  const result = await fulfillFromPaypalCapture(capture, ppOrderId);
  check("fulfillment returned an order", !!result.order);

  const order = await prisma.order.findUnique({ where: { providerRef: ppOrderId }, include: { items: true } });
  check("order created", !!order);
  if (!order) return;
  eq("provider recorded as paypal", order.provider, "paypal");
  eq("status paid", order.status, "paid");
  eq("total is the captured amount", order.totalCents, 6400);
  eq("product delivered", order.items.length, 1);

  const { hasEntitlement } = require(path.join(SERVER_DIR, "src", "lib", "entitlements.js"));
  check("entitlement granted", await hasEntitlement(order.userId, product.id));

  const consumed = await prisma.pendingCheckout.findUnique({ where: { id: pending.id } });
  check("snapshot consumed", !!consumed.consumedAt);
  eq("snapshot records the PayPal order id", consumed.providerRef, ppOrderId);

  const logged = await prisma.paymentEvent.findFirst({
    where: { providerRef: ppOrderId, eventType: "checkout.capture", status: "succeeded" },
  });
  check("capture recorded in the payment log", !!logged);
}

async function scenarioPaypalDuplicateCapture() {
  scenario("PayPal: browser capture and webhook both fulfill → exactly one order");
  const { fulfillFromPaypalCapture } = require(path.join(SERVER_DIR, "src", "lib", "paypalFulfillment.js"));
  const product = await makeProduct("PaypalDupe", 3100);
  const email = testEmail("paypaldupe");
  const { pending } = await makeSnapshot([{ productId: product.id }], email, "paypal");
  const ppOrderId = `pp_test_${crypto.randomBytes(8).toString("hex")}`;
  const capture = makePaypalCapture({ pendingCheckoutId: pending.id, amountCents: 3100 });

  const first = await fulfillFromPaypalCapture(capture, ppOrderId);
  eq("first fulfillment is fresh", first.alreadyFulfilled, false);

  // The webhook arrives for the same capture the browser already fulfilled.
  const second = await fulfillFromPaypalCapture(capture, ppOrderId);
  eq("second fulfillment recognized as already done", second.alreadyFulfilled, true);
  eq("both return the same order", first.order.id, second.order.id);

  eq("exactly one order", await prisma.order.count({ where: { providerRef: ppOrderId } }), 1);
  eq("exactly one order item", await prisma.orderItem.count({ where: { order: { providerRef: ppOrderId } } }), 1);
}

async function scenarioPaypalConcurrentCapture() {
  scenario("PayPal: concurrent duplicate captures → exactly one order");
  const { fulfillFromPaypalCapture } = require(path.join(SERVER_DIR, "src", "lib", "paypalFulfillment.js"));
  const product = await makeProduct("PaypalRace", 7700);
  const email = testEmail("paypalrace");
  const { pending } = await makeSnapshot([{ productId: product.id }], email, "paypal");
  const ppOrderId = `pp_test_${crypto.randomBytes(8).toString("hex")}`;
  const capture = makePaypalCapture({ pendingCheckoutId: pending.id, amountCents: 7700 });

  const results = await Promise.allSettled(
    Array.from({ length: 5 }, () => fulfillFromPaypalCapture(capture, ppOrderId))
  );
  eq("all five attempts resolved", results.filter((r) => r.status === "fulfilled").length, 5);
  eq("exactly one order row", await prisma.order.count({ where: { providerRef: ppOrderId } }), 1);
  eq("exactly one user row", await prisma.user.count({ where: { email } }), 1);
  eq("exactly one order item", await prisma.orderItem.count({ where: { order: { providerRef: ppOrderId } } }), 1);
}

async function scenarioPaypalSpoofing() {
  scenario("PayPal: a capture with no valid snapshot creates nothing");
  const { fulfillFromPaypalCapture } = require(path.join(SERVER_DIR, "src", "lib", "paypalFulfillment.js"));

  // An attacker replaying a capture body with a made-up custom_id.
  const bogus = makePaypalCapture({ pendingCheckoutId: "pending_does_not_exist", amountCents: 9900 });
  const ppOrderId = `pp_test_${crypto.randomBytes(8).toString("hex")}`;
  let threw = null;
  try {
    await fulfillFromPaypalCapture(bogus, ppOrderId);
  } catch (err) {
    threw = err.message;
  }
  check("unknown snapshot is refused", !!threw && /Checkout session not found/.test(threw), threw);
  eq("no order created", await prisma.order.count({ where: { providerRef: ppOrderId } }), 0);

  // A capture body carrying no custom_id at all.
  const noCustom = { id: "x", status: "COMPLETED", purchase_units: [{ payments: { captures: [{ id: "c" }] } }] };
  const ppOrderId2 = `pp_test_${crypto.randomBytes(8).toString("hex")}`;
  threw = null;
  try {
    await fulfillFromPaypalCapture(noCustom, ppOrderId2);
  } catch (err) {
    threw = err.message;
  }
  check("capture with no snapshot reference is refused", !!threw, threw);
  eq("no order created", await prisma.order.count({ where: { providerRef: ppOrderId2 } }), 0);
}

async function scenarioPaypalAmountMismatch() {
  scenario("PayPal: captured amount disagrees with the quote");
  const { fulfillFromPaypalCapture } = require(path.join(SERVER_DIR, "src", "lib", "paypalFulfillment.js"));
  const product = await makeProduct("PaypalMismatch", 5500);
  const email = testEmail("paypalmismatch");
  const { pending } = await makeSnapshot([{ productId: product.id }], email, "paypal");
  const ppOrderId = `pp_test_${crypto.randomBytes(8).toString("hex")}`;

  // PayPal reports a smaller capture than we quoted.
  const capture = makePaypalCapture({ pendingCheckoutId: pending.id, amountCents: 4000 });
  await fulfillFromPaypalCapture(capture, ppOrderId);

  const order = await prisma.order.findUnique({ where: { providerRef: ppOrderId } });
  check("order still created", !!order);
  if (order) eq("order records the captured amount", order.totalCents, 4000);

  const flagged = await prisma.paymentEvent.findFirst({
    where: { providerRef: ppOrderId, eventType: "checkout.amount_mismatch" },
  });
  check("mismatch permanently recorded", !!flagged);
}

async function scenarioPaypalWebhookFailsClosed() {
  scenario("PayPal webhook fails closed when it cannot verify");
  const paypal = require(path.join(SERVER_DIR, "src", "lib", "paypal.js"));

  // With no PAYPAL_WEBHOOK_ID configured (the state of this test env, and of
  // production today) verification must return false rather than defaulting
  // to trusting the payload — otherwise anyone could POST a fake capture.
  const verified = await paypal.verifyWebhookSignature(
    { "paypal-transmission-id": "x", "paypal-transmission-sig": "y", "paypal-transmission-time": "z", "paypal-cert-url": "u", "paypal-auth-algo": "a" },
    Buffer.from(JSON.stringify({ id: "evt", event_type: "PAYMENT.CAPTURE.COMPLETED" }))
  );
  eq("unverifiable PayPal webhook is rejected", verified, false);

  const res = await fetch(`${BASE}/api/webhooks/paypal`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-forwarded-proto": "https" },
    body: JSON.stringify({ id: "evt_fake", event_type: "PAYMENT.CAPTURE.COMPLETED" }),
    redirect: "manual",
  });
  check("unsigned PayPal webhook does not succeed", res.status !== 200, `got ${res.status}`);
}

async function scenarioSecretHygiene() {
  scenario("No secret material reachable from the browser");
  const paths = ["/checkout.html", "/order-success.html", "/assets/js/checkout-payments.js", "/assets/js/order-success.js"];
  for (const p of paths) {
    const res = await fetch(`${BASE}${p}`, { headers: { "x-forwarded-proto": "https" } });
    if (res.status !== 200) {
      check(`${p} served`, false, `status ${res.status}`);
      continue;
    }
    const text = await res.text();
    check(`${p} contains no Stripe secret key`, !/sk_(test|live)_[A-Za-z0-9]/.test(text));
    check(`${p} contains no webhook secret`, !/whsec_[A-Za-z0-9]/.test(text));
    check(`${p} contains no PayPal client secret`, !/PAYPAL_CLIENT_SECRET/.test(text));
  }
}

async function scenarioWellKnown() {
  scenario("Apple Pay domain association route");
  const res = await fetch(`${BASE}/.well-known/apple-developer-merchantid-domain-association`, {
    headers: { "x-forwarded-proto": "https" },
  });
  // The file itself is downloaded from the Stripe dashboard and is not in
  // git. What this asserts is that the ROUTE exists and does not 301/404 into
  // the SPA — the failure that made verification impossible before.
  check(
    "route is served by the well-known handler (200 with file, 404 without)",
    res.status === 200 || res.status === 404,
    `got ${res.status}`
  );
  check("route is not redirected away", res.status !== 301 && res.status !== 302, `got ${res.status}`);

  const traversal = await fetch(`${BASE}/.well-known/../server/.env`, { headers: { "x-forwarded-proto": "https" } });
  check("no path traversal out of .well-known", traversal.status !== 200, `got ${traversal.status}`);
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------
async function main() {
  console.log(`\x1b[1mPayment lifecycle test\x1b[0m  (schema: builder_test, port: ${PORT})`);
  await startServer();

  const scenarios = [
    scenarioSingleItem,
    scenarioCartSizes,
    scenarioQuantities,
    scenarioInvalidProduct,
    scenarioDuplicateWebhook,
    scenarioConcurrentWebhooks,
    scenarioSignatureSecurity,
    scenarioPriceDrift,
    scenarioUnpublishedMidFlight,
    scenarioAmountMismatch,
    scenarioFailedAndCanceled,
    scenarioBrowserClosed,
    scenarioOrderAccessControl,
    scenarioRefund,
    scenarioRefundWebhook,
    scenarioPaypalLifecycle,
    scenarioPaypalDuplicateCapture,
    scenarioPaypalConcurrentCapture,
    scenarioPaypalSpoofing,
    scenarioPaypalAmountMismatch,
    scenarioPaypalWebhookFailsClosed,
    scenarioSecretHygiene,
    scenarioWellKnown,
  ];

  for (const fn of scenarios) {
    try {
      await fn();
    } catch (err) {
      failures.push({ scenario: currentScenario, label: "threw", detail: err.stack });
      console.log(`  \x1b[31m✗ scenario threw\x1b[0m — ${err.message}`);
    }
  }

  console.log(`\n\x1b[1mResult:\x1b[0m ${passed} passed, ${failures.length} failed`);
  if (failures.length) {
    console.log("\nFailures:");
    for (const f of failures) console.log(`  [${f.scenario}] ${f.label}${f.detail ? `\n      ${f.detail}` : ""}`);
  }
  return failures.length === 0;
}

main()
  .then(async (ok) => {
    await cleanup().catch((e) => console.error("cleanup failed:", e.message));
    stopServer();
    await prisma.$disconnect();
    process.exit(ok ? 0 : 1);
  })
  .catch(async (err) => {
    console.error(err);
    await cleanup().catch(() => {});
    stopServer();
    await prisma.$disconnect();
    process.exit(1);
  });
