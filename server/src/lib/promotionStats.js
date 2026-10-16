const { prisma } = require("../db");

const DAY_MS = 24 * 60 * 60 * 1000;

function dayKey(date) {
  return new Date(date).toISOString().slice(0, 10);
}

// Cents of commission owed to the promotion's influencer/affiliate for a
// given batch of redeemed orders. "percentage" is commissionPct% of the
// revenue those orders brought in; "fixed" is a flat payout per redemption
// (the standard affiliate-marketing shape: $X per conversion, not per
// dollar). No influencer attached -> zero commission.
function computeCommissionCents(promotion, { revenueCents, redemptionCount }) {
  if (!promotion.influencer) return 0;
  if (promotion.influencer.commissionType === "percentage" && promotion.influencer.commissionPct != null) {
    return Math.round(revenueCents * (promotion.influencer.commissionPct / 100));
  }
  if (promotion.influencer.commissionType === "fixed" && promotion.influencer.commissionFixedCents != null) {
    return promotion.influencer.commissionFixedCents * redemptionCount;
  }
  return 0;
}

// Full analytics payload for the admin drawer. Deliberately not range-gated
// by default (promotions are short-lived campaigns, not perpetual storefront
// traffic — the whole lifetime is normally what an admin wants to see) but
// accepts an optional {since} to narrow the timeline series.
async function getPromotionStats(promotionId, { since } = {}) {
  const promotion = await prisma.promotion.findUnique({
    where: { id: promotionId },
    include: { influencer: true },
  });
  if (!promotion) return null;

  const redemptions = await prisma.promotionRedemption.findMany({
    where: { promotionId, ...(since ? { createdAt: { gte: since } } : {}) },
    include: {
      order: { include: { items: { include: { product: true } } } },
      user: true,
    },
    orderBy: { createdAt: "asc" },
  });

  const orders = redemptions.map((r) => r.order);
  const totalOrders = orders.length;
  const totalRevenueCents = orders.reduce((sum, o) => sum + o.totalCents, 0);
  const discountGivenCents = redemptions.reduce((sum, r) => sum + r.discountCents, 0);
  const netRevenueCents = totalRevenueCents; // totalCents is already post-discount (what was actually charged)
  const averageOrderValueCents = totalOrders ? Math.round(totalRevenueCents / totalOrders) : 0;

  // "Conversion rate" here means "share of all storefront orders placed in
  // this promotion's window that used this code" — there's no code-view/
  // attempt tracking in this app to compute a true funnel conversion rate
  // against, and adding that tracking pipeline is out of scope for this
  // feature; this is the honest metric available from existing data.
  const windowStart = since || promotion.activatesAt || promotion.createdAt;
  const windowEnd = promotion.expiresAt && promotion.expiresAt < new Date() ? promotion.expiresAt : new Date();
  const totalOrdersInWindow = await prisma.order.count({
    where: { status: "paid", createdAt: { gte: windowStart, lte: windowEnd } },
  });
  const conversionRate = totalOrdersInWindow ? totalOrders / totalOrdersInWindow : 0;

  const ordersOverTime = new Map();
  const revenueOverTime = new Map();
  for (const r of redemptions) {
    const key = dayKey(r.createdAt);
    ordersOverTime.set(key, (ordersOverTime.get(key) || 0) + 1);
    revenueOverTime.set(key, (revenueOverTime.get(key) || 0) + r.order.totalCents);
  }
  const toSeries = (map) => [...map.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1)).map(([date, value]) => ({ date, value }));

  const productMap = new Map();
  for (const o of orders) {
    for (const item of o.items) {
      const cur = productMap.get(item.productId) || { productId: item.productId, name: item.product.name, unitsSold: 0, revenueCents: 0 };
      cur.unitsSold += 1;
      cur.revenueCents += item.priceCents;
      productMap.set(item.productId, cur);
    }
  }
  const topProducts = [...productMap.values()].sort((a, b) => b.revenueCents - a.revenueCents).slice(0, 10);

  const customerMap = new Map();
  for (const r of redemptions) {
    const cur = customerMap.get(r.userId) || { userId: r.userId, email: r.user.email, name: r.user.name, orders: 0, spentCents: 0 };
    cur.orders += 1;
    cur.spentCents += r.order.totalCents;
    customerMap.set(r.userId, cur);
  }
  const topCustomers = [...customerMap.values()].sort((a, b) => b.spentCents - a.spentCents).slice(0, 10);

  // A customer counts as "new" if this promo order was their first-ever paid
  // order, "returning" otherwise.
  let newCustomers = 0;
  let returningCustomers = 0;
  const customerIds = [...customerMap.keys()];
  if (customerIds.length) {
    const firstOrders = await prisma.order.groupBy({
      by: ["userId"],
      where: { userId: { in: customerIds }, status: "paid" },
      _min: { createdAt: true },
    });
    const firstOrderAtByUser = new Map(firstOrders.map((f) => [f.userId, f._min.createdAt]));
    for (const r of redemptions) {
      const firstAt = firstOrderAtByUser.get(r.userId);
      if (firstAt && firstAt.getTime() === r.order.createdAt.getTime()) newCustomers++;
      else returningCustomers++;
    }
  }

  const commissionEarnedCents = computeCommissionCents(promotion, { revenueCents: totalRevenueCents, redemptionCount: totalOrders });
  // Digital catalog, ~zero marginal COGS — "profit" here is net revenue
  // after the influencer/affiliate payout, which is the only real cost this
  // system has visibility into.
  const estimatedProfitCents = netRevenueCents - commissionEarnedCents;

  return {
    promotionId,
    totalOrders,
    totalRevenueCents,
    discountGivenCents,
    netRevenueCents,
    averageOrderValueCents,
    conversionRate,
    ordersOverTime: toSeries(ordersOverTime),
    revenueOverTime: toSeries(revenueOverTime),
    topProducts,
    topCustomers,
    newCustomers,
    returningCustomers,
    commissionEarnedCents,
    estimatedProfitCents,
    recentOrders: orders
      .slice()
      .sort((a, b) => b.createdAt - a.createdAt)
      .slice(0, 10)
      .map((o) => ({ id: o.id, totalCents: o.totalCents, createdAt: o.createdAt, status: o.status })),
  };
}

// Compact summary block for the admin dashboard widget — cheap aggregate
// queries only, no per-order fan-out (unlike getPromotionStats, this runs on
// every dashboard load so it stays index/count-shaped).
async function getPromotionsDashboardSummary() {
  const [activePromotions, allEnabled, expiringSoon] = await Promise.all([
    prisma.promotion.count({ where: { status: "enabled" } }),
    prisma.promotion.findMany({
      where: { status: "enabled" },
      include: { influencer: true, _count: { select: { redemptions: true } } },
    }),
    prisma.promotion.count({
      where: { status: "enabled", expiresAt: { gte: new Date(), lte: new Date(Date.now() + 7 * DAY_MS) } },
    }),
  ]);

  const unusedPromotions = allEnabled.filter((p) => p._count.redemptions === 0).length;

  const revenueByPromotion = await prisma.promotionRedemption.groupBy({
    by: ["promotionId"],
    _sum: { discountCents: true },
    _count: { _all: true },
  });
  const orderIds = await prisma.promotionRedemption.findMany({ select: { promotionId: true, orderId: true } });
  const orderTotals = await prisma.order.findMany({
    where: { id: { in: orderIds.map((o) => o.orderId) } },
    select: { id: true, totalCents: true },
  });
  const totalByOrderId = new Map(orderTotals.map((o) => [o.id, o.totalCents]));
  const revenueByPromotionId = new Map();
  for (const row of orderIds) {
    const revenue = totalByOrderId.get(row.orderId) || 0;
    revenueByPromotionId.set(row.promotionId, (revenueByPromotionId.get(row.promotionId) || 0) + revenue);
  }

  let totalRevenueGeneratedCents = 0;
  let topPromotion = null;
  for (const promo of allEnabled) {
    const revenue = revenueByPromotionId.get(promo.id) || 0;
    totalRevenueGeneratedCents += revenue;
    if (!topPromotion || revenue > topPromotion.revenueCents) {
      topPromotion = { id: promo.id, name: promo.name, code: promo.code, revenueCents: revenue };
    }
  }

  const discountCounts = revenueByPromotion.reduce((sum, r) => sum + (r._sum.discountCents || 0), 0);
  const totalRedemptions = revenueByPromotion.reduce((sum, r) => sum + r._count._all, 0);
  const averageDiscountCents = totalRedemptions ? Math.round(discountCounts / totalRedemptions) : 0;

  const commissionByInfluencer = new Map();
  for (const promo of allEnabled) {
    if (!promo.influencer) continue;
    const revenue = revenueByPromotionId.get(promo.id) || 0;
    const redemptionCount = revenueByPromotion.find((r) => r.promotionId === promo.id)?._count._all || 0;
    const commission = computeCommissionCents(promo, { revenueCents: revenue, redemptionCount });
    const cur = commissionByInfluencer.get(promo.influencerId) || { id: promo.influencerId, name: promo.influencer.name, commissionCents: 0 };
    cur.commissionCents += commission;
    commissionByInfluencer.set(promo.influencerId, cur);
  }
  const topInfluencer = [...commissionByInfluencer.values()].sort((a, b) => b.commissionCents - a.commissionCents)[0] || null;

  return {
    activePromotions,
    revenueGeneratedCents: totalRevenueGeneratedCents,
    topPromotion: topPromotion && topPromotion.revenueCents > 0 ? topPromotion : null,
    expiringSoon,
    unusedPromotions,
    averageDiscountCents,
    topInfluencer,
  };
}

module.exports = { getPromotionStats, getPromotionsDashboardSummary, computeCommissionCents };
