const express = require("express");
const { prisma } = require("../../db");
const { getPromotionsDashboardSummary } = require("../../lib/promotionStats");

const router = express.Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_WINDOW_DAYS = 30;

function dayKey(date) {
  return date.toISOString().slice(0, 10);
}

function buildDaySeries(days) {
  const series = [];
  const now = new Date();
  for (let i = days - 1; i >= 0; i--) {
    series.push(dayKey(new Date(now.getTime() - i * DAY_MS)));
  }
  return series;
}

router.get("/overview", async (req, res) => {
  const now = new Date();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const windowStart = new Date(now.getTime() - CHART_WINDOW_DAYS * DAY_MS);

  const [paidOrders, pendingCount, failedCount, registeredUsers, recentUsers, recentLogs] = await Promise.all([
    prisma.order.findMany({
      where: { status: "paid" },
      include: { items: { include: { product: true } }, user: true },
      orderBy: { createdAt: "desc" },
    }),
    prisma.order.count({ where: { status: "pending" } }),
    prisma.order.count({ where: { status: "failed" } }),
    prisma.user.count({ where: { role: "customer" } }),
    prisma.user.findMany({
      where: { role: "customer" },
      orderBy: { createdAt: "desc" },
      take: 5,
      select: { id: true, email: true, name: true, createdAt: true },
    }),
    prisma.systemLog.findMany({ orderBy: { createdAt: "desc" }, take: 10 }),
  ]);

  const totalOrders = paidOrders.length;
  const totalRevenueCents = paidOrders.reduce((sum, o) => sum + o.totalCents, 0);
  const revenueTodayCents = paidOrders
    .filter((o) => o.createdAt >= startOfToday)
    .reduce((sum, o) => sum + o.totalCents, 0);
  const revenueThisMonthCents = paidOrders
    .filter((o) => o.createdAt >= startOfMonth)
    .reduce((sum, o) => sum + o.totalCents, 0);
  const ordersToday = paidOrders.filter((o) => o.createdAt >= startOfToday).length;
  const activeCustomers = new Set(
    paidOrders.filter((o) => o.createdAt >= windowStart).map((o) => o.userId)
  ).size;
  const conversionRate = totalOrders + pendingCount + failedCount === 0
    ? 0
    : totalOrders / (totalOrders + pendingCount + failedCount);
  const averageOrderValueCents = totalOrders === 0 ? 0 : Math.round(totalRevenueCents / totalOrders);

  const daySeries = buildDaySeries(CHART_WINDOW_DAYS);
  const revenueByDay = Object.fromEntries(daySeries.map((d) => [d, 0]));
  const ordersByDay = Object.fromEntries(daySeries.map((d) => [d, 0]));
  const paymentMethodCounts = {};
  const productTotals = new Map();

  for (const order of paidOrders) {
    if (order.createdAt >= windowStart) {
      const key = dayKey(order.createdAt);
      if (key in revenueByDay) {
        revenueByDay[key] += order.totalCents;
        ordersByDay[key] += 1;
      }
    }
    paymentMethodCounts[order.provider] = (paymentMethodCounts[order.provider] || 0) + 1;
    for (const item of order.items) {
      const existing = productTotals.get(item.productId) || {
        name: item.product.name,
        unitsSold: 0,
        revenueCents: 0,
      };
      existing.unitsSold += 1;
      existing.revenueCents += item.priceCents;
      productTotals.set(item.productId, existing);
    }
  }

  const newUsersRaw = await prisma.user.findMany({
    where: { role: "customer", createdAt: { gte: windowStart } },
    select: { createdAt: true },
  });
  const newUsersByDay = Object.fromEntries(daySeries.map((d) => [d, 0]));
  for (const u of newUsersRaw) {
    const key = dayKey(u.createdAt);
    if (key in newUsersByDay) newUsersByDay[key] += 1;
  }

  const topProducts = [...productTotals.values()]
    .sort((a, b) => b.revenueCents - a.revenueCents)
    .slice(0, 5);

  // Cheap, count/aggregate-shaped query — doesn't fan out per-order like the
  // rest of this endpoint, so it doesn't change this route's cost profile.
  const promotions = await getPromotionsDashboardSummary();

  const recentActivity = [
    ...recentLogs.map((l) => ({
      type: "log",
      category: l.category,
      message: l.message,
      createdAt: l.createdAt,
    })),
    ...paidOrders.slice(0, 5).map((o) => ({
      type: "purchase",
      category: "order",
      message: `${o.user.email} purchased ${o.items.length} item(s) for $${(o.totalCents / 100).toFixed(2)}`,
      createdAt: o.createdAt,
    })),
    ...recentUsers.map((u) => ({
      type: "registration",
      category: "user",
      message: `${u.email} registered`,
      createdAt: u.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 15);

  res.json({
    metrics: {
      totalRevenueCents,
      revenueTodayCents,
      revenueThisMonthCents,
      totalOrders,
      ordersToday,
      activeCustomers,
      registeredUsers,
      conversionRate,
      averageOrderValueCents,
    },
    charts: {
      revenueOverTime: daySeries.map((d) => ({ date: d, cents: revenueByDay[d] })),
      ordersOverTime: daySeries.map((d) => ({ date: d, count: ordersByDay[d] })),
      newUsersOverTime: daySeries.map((d) => ({ date: d, count: newUsersByDay[d] })),
      topProducts,
      paymentMethods: Object.entries(paymentMethodCounts).map(([provider, count]) => ({ provider, count })),
    },
    recentActivity,
    promotions,
  });
});

module.exports = router;
