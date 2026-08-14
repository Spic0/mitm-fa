const express = require("express");
const { prisma } = require("../../db");
const { createMagicLinkToken, buildMagicLinkUrl } = require("../../lib/magicLink");
const { sendPurchaseReceiptEmail } = require("../../lib/email");
const { logEvent } = require("../../lib/adminLog");
const { logPaymentEvent } = require("../../lib/paymentLog");
const { stripe, isStripeConfigured } = require("../../lib/stripe");
const paypal = require("../../lib/paypal");

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
      discountCents: order.discountCents,
      orderId: order.id,
      provider: order.provider,
      customerName: order.user.name,
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

// Refunds the money at the payment provider AND revokes access.
//
// This endpoint used to do only the second half: it set status "refunded",
// which cut off the gated program view, media and resource downloads
// (entitlement checks status "paid" specifically), and stopped there. The
// customer's money was never returned. An admin pressing "Refund", seeing the
// order go green and the access disappear, had every reason to believe the
// refund had happened — so the failure mode was a customer chasing a refund
// that the dashboard already showed as complete.
//
// Order of operations matters: the provider call comes FIRST, and a failure
// there aborts without touching the local record. Revoking access for a
// refund that didn't actually go through would leave the customer with
// neither their money nor their product.
//
// `accessOnly: true` is the deliberate escape hatch for orders with no
// provider charge to reverse (provider "manual"/"dev"), and for a refund
// already issued out-of-band in the Stripe or PayPal dashboard — where
// calling the API again would either error or double-refund.
router.post("/:id/refund", async (req, res) => {
  const order = await prisma.order.findUnique({ where: { id: req.params.id } });
  if (!order) return res.status(404).json({ error: "Order not found" });
  // Idempotent: an admin retrying after a flaky connection shouldn't be
  // punished with a 409, and must not be able to fire a second provider
  // refund at an order that is already refunded.
  if (order.status === "refunded") return res.json({ order, alreadyRefunded: true });

  const accessOnly = req.body && req.body.accessOnly === true;
  let providerRefund = null;

  if (!accessOnly) {
    try {
      providerRefund = await refundAtProvider(order);
    } catch (err) {
      await logPaymentEvent({
        provider: order.provider,
        eventType: "admin.refund",
        status: "failed",
        providerRef: order.providerRef,
        orderId: order.id,
        providerResponse: { error: err.message },
      });
      return res.status(502).json({
        error: `The refund was not issued: ${err.message}. Nothing has been changed — the customer still has access and has not been refunded.`,
      });
    }
  }

  const updated = await prisma.order.update({ where: { id: order.id }, data: { status: "refunded" } });

  await logPaymentEvent({
    provider: order.provider,
    eventType: "admin.refund",
    status: "succeeded",
    providerRef: order.providerRef,
    orderId: order.id,
    providerResponse: accessOnly
      ? { accessOnly: true, note: "Access revoked without a provider refund" }
      : providerRefund,
  });
  await logEvent({
    category: "order",
    message: accessOnly
      ? `Order ${order.id} access revoked (no provider refund issued)`
      : `Order ${order.id} refunded via ${order.provider} — $${(order.totalCents / 100).toFixed(2)} returned, access revoked`,
    actorId: req.user.id,
  });
  res.json({ order: updated, refunded: !accessOnly });
});

// Issues the actual refund. Throws with a message meant for the admin UI.
async function refundAtProvider(order) {
  if (!order.providerRef) {
    throw new Error("this order has no provider transaction to refund");
  }

  if (order.provider === "stripe") {
    if (!isStripeConfigured) throw new Error("Stripe is not configured on this server");
    const refund = await stripe.refunds.create(
      { payment_intent: order.providerRef },
      // Retrying the same order never issues a second refund.
      { idempotencyKey: `refund_order_${order.id}` }
    );
    return { id: refund.id, amount: refund.amount, currency: refund.currency, status: refund.status };
  }

  if (order.provider === "paypal") {
    if (!paypal.isPaypalConfigured) throw new Error("PayPal is not configured on this server");
    // Order.providerRef is the CHECKOUT order id; refunds act on the capture
    // inside it, so the capture id is read back from PayPal rather than
    // stored separately and risking drift.
    const paypalOrder = await paypal.getOrder(order.providerRef);
    const unit = paypalOrder.purchase_units && paypalOrder.purchase_units[0];
    const capture = unit && unit.payments && unit.payments.captures && unit.payments.captures[0];
    if (!capture || !capture.id) throw new Error("no completed PayPal capture found for this order");
    const refund = await paypal.refundCapture(capture.id);
    return { id: refund.id, status: refund.status, captureId: capture.id };
  }

  throw new Error(
    `orders paid via "${order.provider}" have no automatic refund — issue it manually, then use Revoke Access`
  );
}

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
