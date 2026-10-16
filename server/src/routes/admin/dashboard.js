const express = require("express");
const { prisma } = require("../../db");
const { getPromotionsDashboardSummary } = require("../../lib/promotionStats");

const router = express.Router();

const DAY_MS = 24 * 60 * 60 * 1000;
const CHART_WINDOW_DAYS = 30;
// How many of the most recent send attempts the email health check looks at.
const EMAIL_HEALTH_SAMPLE = 20;

// Turns the recent EmailLog rows into a single verdict for the dashboard.
//
// This exists because outbound email fails silently by design: Resend's SDK
// resolves with an { error } object instead of throwing, and fulfillOrder.js
// deliberately never lets an email failure block fulfillment. Both are
// reasonable on their own, and together they meant an invalid API key went
// unnoticed for nine days while every sign-in link and purchase receipt was
// rejected.
//
// Severity keys off the MOST RECENT attempt rather than a failure ratio: a
// run of old failures followed by a success means someone fixed it, and an
// old ratio would keep crying wolf. Conversely one failure at the top of the
// list is what a just-expired API key looks like.
function buildEmailHealth(rows) {
  if (!rows.length) return { status: "unknown", checked: 0 };

  const failures = rows.filter((r) => r.status === "failed");
  if (!failures.length) return { status: "ok", checked: rows.length, failed: 0 };

  const latest = rows[0];
  const latestFailed = latest.status === "failed";

  // Surface the provider's own words ("API key is invalid", "domain is not
  // verified", ...) — that string is what tells an operator which of the two
  // Resend failure modes they're looking at, and it's already stored.
  let reason = null;
  const firstFailure = failures[0];
  try {
    const parsed = JSON.parse(firstFailure.providerResponse || "{}");
    reason = parsed.message || parsed.name || null;
  } catch (err) {
    reason = null;
  }

  return {
    // "critical" = email is broken right now; "degraded" = it recovered but
    // recent attempts were lost, which still means missing receipts.
    status: latestFailed ? "critical" : "degraded",
    checked: rows.length,
    failed: failures.length,
    allFailed: failures.length === rows.length,
    reason,
    lastFailureAt: firstFailure.sentAt,
    lastFailureSubject: firstFailure.subject,
  };
}

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

  const [paidOrders, pendingCount, failedCount, registeredUsers, recentUsers, recentLogs, recentEmails] = await Promise.all([
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
    // Deliberately the most recent N attempts rather than a time window.
    // Outbound volume here is low (sign-in links, receipts, enquiries), so a
    // "last 7 days" window is empty on a quiet week and would report healthy
    // while the provider has been rejecting everything for a month. What
    // actually answers "is email working right now" is whether the most
    // recent attempts succeeded.
    prisma.emailLog.findMany({
      orderBy: { sentAt: "desc" },
      take: EMAIL_HEALTH_SAMPLE,
      select: { subject: true, status: true, providerResponse: true, sentAt: true },
    }),
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
    emailHealth: buildEmailHealth(recentEmails),
  });
});

module.exports = router;
