const express = require("express");
const crypto = require("crypto");
const { prisma } = require("../db");
const { createSession, setSessionCookie } = require("../lib/session");
const { fulfillOrder } = require("../lib/fulfillOrder");
const { logEvent } = require("../lib/adminLog");

const router = express.Router();

const DEV_ADMIN_EMAIL = "dev-admin@profit.local";

const FIRST_NAMES = ["Alex", "Jordan", "Taylor", "Morgan", "Casey", "Riley", "Jamie", "Avery", "Quinn", "Drew"];
const LAST_NAMES = ["Smith", "Johnson", "Lee", "Brown", "Garcia", "Martinez", "Davis", "Clark", "Lewis", "Walker"];

function randomName() {
  const first = FIRST_NAMES[Math.floor(Math.random() * FIRST_NAMES.length)];
  const last = LAST_NAMES[Math.floor(Math.random() * LAST_NAMES.length)];
  return `${first} ${last}`;
}

function randomEmail(name) {
  const slug = name.toLowerCase().replace(/\s+/g, ".");
  return `${slug}.${crypto.randomBytes(3).toString("hex")}@example.com`;
}

// Dev-only: authenticate as an admin without going through magic-link email.
router.post("/login-as-admin", async (req, res) => {
  const user = await prisma.user.upsert({
    where: { email: DEV_ADMIN_EMAIL },
    update: { role: "admin" },
    create: { email: DEV_ADMIN_EMAIL, name: "Dev Admin", role: "admin" },
  });
  const sessionToken = await createSession(user.id);
  setSessionCookie(res, sessionToken);
  await logEvent({ category: "dev", message: "Dev instant admin login", actorId: user.id });
  res.json({ ok: true, user: { id: user.id, email: user.email } });
});

// Dev-only: create a fake customer account in one click.
router.post("/create-test-customer", async (req, res) => {
  const name = randomName();
  const email = randomEmail(name);
  const user = await prisma.user.create({ data: { name, email, role: "customer" } });
  await logEvent({ category: "dev", message: `Created test customer ${user.email}` });
  res.status(201).json({ user: { id: user.id, name: user.name, email: user.email } });
});

// Dev-only: simulate a completed purchase through the real fulfillment code
// path (no Stripe/PayPal involved), so every dashboard surface has real data.
router.post("/simulate-purchase", async (req, res) => {
  let { customerId, productId } = req.body;

  let customer = customerId ? await prisma.user.findUnique({ where: { id: customerId } }) : null;
  if (!customer) {
    const name = randomName();
    customer = await prisma.user.create({ data: { name, email: randomEmail(name), role: "customer" } });
  }

  let product = productId ? await prisma.product.findUnique({ where: { id: productId } }) : null;
  if (!product) {
    const products = await prisma.product.findMany({ take: 1, orderBy: { createdAt: "asc" } });
    product = products[0];
  }
  if (!product) return res.status(400).json({ error: "No products exist to simulate a purchase with" });

  const result = await fulfillOrder({
    email: customer.email,
    provider: "dev",
    providerRef: `dev_${crypto.randomUUID()}`,
    items: [{ productId: product.id, priceCents: product.priceCents }],
    totalCents: product.priceCents,
  });

  await logEvent({
    category: "dev",
    message: `Simulated purchase of "${product.name}" for ${customer.email}`,
  });
  res.status(201).json({ order: { id: result.order.id, totalCents: result.order.totalCents } });
});

// Dev-only: populate the database with realistic demo data for exercising the dashboard.
router.post("/seed", async (req, res) => {
  const { seedDemoData } = require("../../prisma/seedDemo");
  const summary = await seedDemoData();
  await logEvent({ category: "dev", message: "Ran demo data seed" });
  res.json({ ok: true, summary });
});

module.exports = router;
