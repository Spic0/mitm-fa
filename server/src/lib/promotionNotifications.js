const { prisma } = require("../db");

const DAY_MS = 24 * 60 * 60 * 1000;

const EXPIRY_THRESHOLDS = [
  { type: "EXPIRES_30D", ms: 30 * DAY_MS },
  { type: "EXPIRES_14D", ms: 14 * DAY_MS },
  { type: "EXPIRES_7D", ms: 7 * DAY_MS },
  { type: "EXPIRES_3D", ms: 3 * DAY_MS },
  { type: "EXPIRES_24H", ms: 1 * DAY_MS },
];

// A promotion sits unused long enough that it's worth flagging, but not so
// short that a promo launched an hour ago trips it.
const NEVER_USED_AFTER_MS = 14 * DAY_MS;

// Minimum total redemptions before "unusually high sales" is even
// evaluated — without this, a brand-new promotion's first 2 orders on day
// one (infinite % above a zero baseline) would false-positive every time.
const HIGH_SALES_MIN_SAMPLE = 5;
const HIGH_SALES_MULTIPLIER = 3;

async function upsertNotification(promotionId, type) {
  await prisma.promotionNotification.upsert({
    where: { promotionId_type: { promotionId, type } },
    update: {}, // leave status/snoozedUntil alone if the admin already dismissed/snoozed it
    create: { promotionId, type },
  });
}

async function evaluateExpiry(promotion, now) {
  if (!promotion.expiresAt) return;
  const msRemaining = promotion.expiresAt.getTime() - now.getTime();
  if (msRemaining <= 0) {
    await upsertNotification(promotion.id, "EXPIRED");
    return;
  }
  for (const threshold of EXPIRY_THRESHOLDS) {
    if (msRemaining <= threshold.ms) {
      await upsertNotification(promotion.id, threshold.type);
    }
  }
}

async function evaluateUsage(promotion, totalUses) {
  if (promotion.maxUses == null) return;
  if (totalUses >= promotion.maxUses) {
    await upsertNotification(promotion.id, "USAGE_MAX");
  } else if (totalUses >= promotion.maxUses * 0.8) {
    await upsertNotification(promotion.id, "USAGE_80PCT");
  }
}

async function evaluateNeverUsed(promotion, totalUses, now) {
  if (totalUses > 0) return;
  if (now.getTime() - promotion.createdAt.getTime() < NEVER_USED_AFTER_MS) return;
  await upsertNotification(promotion.id, "NEVER_USED");
}

async function evaluateHighSales(promotion, now) {
  const [last24h, last7d, totalUses] = await Promise.all([
    prisma.promotionRedemption.count({ where: { promotionId: promotion.id, createdAt: { gte: new Date(now.getTime() - DAY_MS) } } }),
    prisma.promotionRedemption.count({ where: { promotionId: promotion.id, createdAt: { gte: new Date(now.getTime() - 7 * DAY_MS) } } }),
    prisma.promotionRedemption.count({ where: { promotionId: promotion.id } }),
  ]);
  if (totalUses < HIGH_SALES_MIN_SAMPLE) return;
  const dailyAverage = last7d / 7;
  if (dailyAverage > 0 && last24h > dailyAverage * HIGH_SALES_MULTIPLIER) {
    await upsertNotification(promotion.id, "HIGH_SALES");
  }
}

// Run periodically (see server/src/index.js) — idempotent, dedupes via the
// PromotionNotification (promotionId, type) unique constraint, and never
// overwrites a notification an admin already dismissed/snoozed/marked done.
async function evaluateAndCreateNotifications() {
  const now = new Date();
  const promotions = await prisma.promotion.findMany({ where: { status: "enabled" } });

  for (const promotion of promotions) {
    const totalUses = await prisma.promotionRedemption.count({ where: { promotionId: promotion.id } });
    await evaluateExpiry(promotion, now);
    await evaluateUsage(promotion, totalUses);
    await evaluateNeverUsed(promotion, totalUses, now);
    await evaluateHighSales(promotion, now);
  }
}

module.exports = { evaluateAndCreateNotifications };
