const express = require("express");
const { prisma } = require("../../db");

const router = express.Router();

const RANGE_DAYS = { "7d": 7, "30d": 30, "90d": 90, "1y": 365 };
const DAY_MS = 24 * 60 * 60 * 1000;

function bucketUnitFor(range) {
  if (range === "7d" || range === "30d") return "day";
  if (range === "90d") return "week";
  return "month"; // 1y, lifetime
}

function bucketKey(date, unit) {
  const d = new Date(date);
  if (unit === "day") return d.toISOString().slice(0, 10);
  if (unit === "week") {
    const jan1 = new Date(d.getFullYear(), 0, 1);
    const week = Math.ceil(((d - jan1) / DAY_MS + jan1.getDay() + 1) / 7);
    return d.getFullYear() + "-W" + String(week).padStart(2, "0");
  }
  return d.toISOString().slice(0, 7); // YYYY-MM
}

router.get("/overview", async (req, res) => {
  const range = ["7d", "30d", "90d", "1y", "lifetime"].includes(req.query.range) ? req.query.range : "30d";

  let startDate;
  if (range === "lifetime") {
    const earliest = await prisma.order.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } });
    startDate = earliest ? earliest.createdAt : new Date();
  } else {
    startDate = new Date(Date.now() - RANGE_DAYS[range] * DAY_MS);
  }

  const [ordersInRange, customersWithOrderCounts] = await Promise.all([
    prisma.order.findMany({
      where: { createdAt: { gte: startDate } },
      include: { items: { include: { product: true } }, user: true },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({
      where: { role: "customer" },
      select: { id: true, orders: { where: { status: "paid" }, select: { id: true } } },
    }),
  ]);

  const paid = ordersInRange.filter((o) => o.status === "paid");
  const pending = ordersInRange.filter((o) => o.status === "pending");
  const failed = ordersInRange.filter((o) => o.status === "failed");
  const refunded = ordersInRange.filter((o) => o.status === "refunded");

  const revenueCents = paid.reduce((sum, o) => sum + o.totalCents, 0);
  const customerIdsInRange = new Set(paid.map((o) => o.userId));
  const lifetimeCountByUser = new Map(customersWithOrderCounts.map((u) => [u.id, u.orders.length]));
  let returningCount = 0;
  customerIdsInRange.forEach((id) => {
    if ((lifetimeCountByUser.get(id) || 0) > 1) returningCount++;
  });

  const checkoutAttempts = paid.length + pending.length + failed.length;
  const checkoutConversionRate = checkoutAttempts ? paid.length / checkoutAttempts : 0;
  const paymentAttempts = paid.length + failed.length;
  const paymentSuccessRate = paymentAttempts ? paid.length / paymentAttempts : 0;
  const refundRate = paid.length + refunded.length ? refunded.length / (paid.length + refunded.length) : 0;

  const unit = bucketUnitFor(range);
  const salesMap = new Map();
  for (const o of paid) {
    const key = bucketKey(o.createdAt, unit);
    salesMap.set(key, (salesMap.get(key) || 0) + o.totalCents);
  }
  const salesSeries = [...salesMap.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, cents]) => ({ date, cents }));

  const productMap = new Map();
  for (const o of paid) {
    for (const item of o.items) {
      const cur = productMap.get(item.productId) || { name: item.product.name, unitsSold: 0, revenueCents: 0 };
      cur.unitsSold += 1;
      cur.revenueCents += item.priceCents;
      productMap.set(item.productId, cur);
    }
  }
  const products = [...productMap.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 10);

  res.json({
    range,
    bucketUnit: unit,
    metrics: {
      revenueCents,
      orders: paid.length,
      customers: customerIdsInRange.size,
      returningCustomers: returningCount,
      checkoutConversionRate,
      paymentSuccessRate,
      refundRate,
    },
    salesSeries,
    products,
  });
});

module.exports = router;
