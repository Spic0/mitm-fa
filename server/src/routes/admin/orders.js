const express = require("express");
const { prisma } = require("../../db");
const { createMagicLinkToken, buildMagicLinkUrl } = require("../../lib/magicLink");
const { sendPurchaseReceiptEmail } = require("../../lib/email");
const { logEvent } = require("../../lib/adminLog");

const router = express.Router();

const SORTABLE_FIELDS = new Set(["createdAt", "totalCents"]);

router.get("/", async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const sortBy = SORTABLE_FIELDS.has(req.query.sortBy) ? req.query.sortBy : "createdAt";
  const sortDir = req.query.sortDir === "asc" ? "asc" : "desc";
  const search = String(req.query.search || "").trim();

  const where = {
    AND: [
      req.query.status ? { status: req.query.status } : {},
      req.query.provider ? { provider: req.query.provider } : {},
      search
        ? {
            OR: [
              { id: { equals: search } },
              { user: { email: { contains: search, mode: "insensitive" } } },
              { user: { name: { contains: search, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };

  const [total, orders] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.findMany({
      where,
      include: { user: true, items: { include: { product: true } } },
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({
    total,
    page,
    pageSize,
    orders: orders.map((o) => ({
      id: o.id,
      customerName: o.user.name,
      customerEmail: o.user.email,
      products: o.items.map((i) => i.product.name),
      amountCents: o.totalCents,
      provider: o.provider,
      status: o.status,
      deliveryStatus: o.deliveryStatus,
      createdAt: o.createdAt,
    })),
  });
});

router.get("/:id", async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      user: true,
      items: { include: { product: true } },
      notes: { include: { author: true }, orderBy: { createdAt: "desc" } },
    },
  });
  if (!order) return res.status(404).json({ error: "Order not found" });

  res.json({
    order: {
      id: order.id,
      customerName: order.user.name,
      customerEmail: order.user.email,
      provider: order.provider,
      status: order.status,
      deliveryStatus: order.deliveryStatus,
      totalCents: order.totalCents,
      createdAt: order.createdAt,
      items: order.items.map((i) => ({ name: i.product.name, priceCents: i.priceCents })),
      notes: order.notes.map((n) => ({
        id: n.id,
        body: n.body,
        authorEmail: n.author.email,
        createdAt: n.createdAt,
      })),
    },
  });
});

router.post("/:id/resend-email", async (req, res) => {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: { user: true, items: { include: { product: true } } },
  });
  if (!order) return res.status(404).json({ error: "Order not found" });

  try {
    const magicToken = await createMagicLinkToken(order.userId);
    await sendPurchaseReceiptEmail(order.user.email, {
      orderItems: order.items,
      totalCents: order.totalCents,
      magicLink: buildMagicLinkUrl(magicToken),
    });
    await prisma.order.update({ where: { id: order.id }, data: { deliveryStatus: "resent" } });
    await logEvent({
      category: "order",
      message: `Resent download email for order ${order.id} to ${order.user.email}`,
      actorId: req.user.id,
    });
    res.json({ ok: true });
  } catch (err) {
    console.error("Failed to resend order email:", err);
    await prisma.order.update({ where: { id: order.id }, data: { deliveryStatus: "failed" } });
    res.status(502).json({ error: "Failed to send email" });
  }
});

// Revokes the customer's access to everything in this order — entitlement
// (server/src/lib/entitlements.js) checks status: "paid" specifically, so
// this alone is sufficient to cut off the gated program view, media, and
// resource downloads immediately, with no separate "access" flag to keep in
// sync. Idempotent: refunding an already-refunded order just re-confirms
// the state rather than erroring, since an admin retrying after a flaky
// connection shouldn't be punished with a 409.
router.post("/:id/refund", async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return res.status(404).json({ error: "Order not found" });
  if (order.status === "refunded") return res.json({ order });

  const updated = await prisma.order.update({ where: { id: order.id }, data: { status: "refunded" } });
  await logEvent({
    category: "order",
    message: `Order ${order.id} marked refunded — access revoked`,
    actorId: req.user.id,
  });
  res.json({ order: updated });
});

router.post("/:id/notes", async (req, res) => {
  const body = String(req.body.body || "").trim();
  if (!body) return res.status(400).json({ error: "Note body is required" });

  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return res.status(404).json({ error: "Order not found" });

  const note = await prisma.orderNote.create({
    data: { orderId: order.id, authorId: req.user.id, body },
    include: { author: true },
  });
  await logEvent({
    category: "order",
    message: `Added internal note to order ${order.id}`,
    actorId: req.user.id,
  });

  res.json({
    note: { id: note.id, body: note.body, authorEmail: note.author.email, createdAt: note.createdAt },
  });
});

module.exports = router;
