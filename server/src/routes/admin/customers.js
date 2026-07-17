const express = require("express");
const { prisma } = require("../../db");
const { sendAdminEmail } = require("../../lib/email");
const { logEvent } = require("../../lib/adminLog");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Manually create a customer account from the admin — for phone/offline
// orders or comping access — instead of only ever getting created implicitly
// by a real checkout. Optionally grants immediate access to one product,
// recorded as a real (zero-charge) order so it shows up in their library and
// purchase history exactly like a normal sale would.
router.post("/", async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const name = String(req.body.name || "").trim();
  const notes = String(req.body.notes || "").trim();
  const status = req.body.status === "suspended" ? "suspended" : "active";
  const grantProductId = req.body.grantProductId ? String(req.body.grantProductId) : null;

  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    return res.status(409).json({ error: "A customer with this email already exists" });
  }

  let product = null;
  if (grantProductId) {
    product = await prisma.product.findUnique({ where: { id: grantProductId } });
    if (!product) return res.status(400).json({ error: "Selected product not found" });
  }

  const user = await prisma.user.create({
    data: { email, name: name || null, notes: notes || null, status, role: "customer" },
  });

  if (product) {
    await prisma.order.create({
      data: {
        userId: user.id,
        provider: "manual",
        providerRef: `manual_${user.id}_${Date.now()}`,
        status: "paid",
        deliveryStatus: "delivered",
        totalCents: 0,
        items: { create: [{ productId: product.id, priceCents: 0 }] },
      },
    });
  }

  await logEvent({
    category: "user",
    message: `Manually created customer ${user.email}` + (product ? ` with access to "${product.name}"` : ""),
    actorId: req.user.id,
  });
  res.status(201).json({ customer: { id: user.id, name: user.name, email: user.email } });
});

router.get("/", async (req, res) => {
  const search = String(req.query.search || "").trim();
  const where = {
    role: "customer",
    ...(search
      ? {
          OR: [
            { email: { contains: search, mode: "insensitive" } },
            { name: { contains: search, mode: "insensitive" } },
          ],
        }
      : {}),
  };

  const users = await prisma.user.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { orders: { where: { status: "paid" } } },
  });

  res.json({
    customers: users.map((u) => ({
      id: u.id,
      name: u.name,
      email: u.email,
      createdAt: u.createdAt,
      lifetimeSpendCents: u.orders.reduce((sum, o) => sum + o.totalCents, 0),
      orderCount: u.orders.length,
      lastLoginAt: u.lastLoginAt,
      country: u.country,
      status: u.status,
    })),
  });
});

router.get("/:id", async (req, res) => {
  const user = await prisma.user.findUnique({
    where: { id: req.params.id },
    include: {
      orders: {
        where: { status: "paid" },
        include: { items: { include: { product: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  if (!user || user.role !== "customer") return res.status(404).json({ error: "Customer not found" });

  res.json({
    customer: {
      id: user.id,
      name: user.name,
      email: user.email,
      createdAt: user.createdAt,
      lastLoginAt: user.lastLoginAt,
      country: user.country,
      status: user.status,
      notes: user.notes,
      lifetimeSpendCents: user.orders.reduce((sum, o) => sum + o.totalCents, 0),
      purchasedProducts: [...new Set(user.orders.flatMap((o) => o.items.map((i) => i.product.name)))],
      orders: user.orders.map((o) => ({
        id: o.id,
        totalCents: o.totalCents,
        provider: o.provider,
        createdAt: o.createdAt,
        items: o.items.map((i) => i.product.name),
      })),
    },
  });
});

router.post("/:id/suspend", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user || user.role !== "customer") return res.status(404).json({ error: "Customer not found" });

  const nextStatus = user.status === "suspended" ? "active" : "suspended";
  const updated = await prisma.user.update({ where: { id: user.id }, data: { status: nextStatus } });

  if (nextStatus === "suspended") {
    await prisma.session.deleteMany({ where: { userId: user.id } });
  }

  await logEvent({
    category: "user",
    message: `${nextStatus === "suspended" ? "Suspended" : "Reactivated"} customer ${user.email}`,
    actorId: req.user.id,
  });
  res.json({ status: updated.status });
});

router.post("/:id/reset-login", async (req, res) => {
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user || user.role !== "customer") return res.status(404).json({ error: "Customer not found" });

  await prisma.session.deleteMany({ where: { userId: user.id } });
  await logEvent({
    category: "user",
    message: `Reset login sessions for customer ${user.email}`,
    actorId: req.user.id,
  });
  res.json({ ok: true });
});

router.post("/:id/send-email", async (req, res) => {
  const subject = String(req.body.subject || "").trim();
  const body = String(req.body.body || "").trim();
  if (!subject || !body) return res.status(400).json({ error: "subject and body are required" });

  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user || user.role !== "customer") return res.status(404).json({ error: "Customer not found" });

  try {
    await sendAdminEmail(user.email, { subject, body });
    await logEvent({
      category: "user",
      message: `Sent email "${subject}" to ${user.email}`,
      actorId: req.user.id,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to send admin email:", err);
    res.status(502).json({ error: "Failed to send email" });
  }
});

module.exports = router;
