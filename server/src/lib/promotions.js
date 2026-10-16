const { prisma } = require("../db");

function normalizeCode(code) {
  return String(code || "").trim().toUpperCase();
}

const PROMOTION_INCLUDE = { products: true, categories: true, users: true };

async function findPromotionByCode(code) {
  const normalized = normalizeCode(code);
  if (!normalized) return null;
  return prisma.promotion.findUnique({ where: { code: normalized }, include: PROMOTION_INCLUDE });
}

// activatesAt/expiresAt are stored as absolute instants (the admin form
// converts the entered local time + Promotion.timezone into UTC before
// saving) — validation here is a plain instant comparison, no runtime
// timezone math needed.
function isWithinWindow(promotion, now = new Date()) {
  if (promotion.activatesAt && now < promotion.activatesAt) return false;
  if (promotion.expiresAt && now > promotion.expiresAt) return false;
  return true;
}

function isExpired(promotion, now = new Date()) {
  return Boolean(promotion.expiresAt && now > promotion.expiresAt);
}

// Everything that can reject a code before we bother computing a discount
// amount. Shared by the public /validate endpoint, checkout's server-side
// re-application, and auto-apply promotion discovery.
async function checkEligibility(promotion, { items, subtotalCents, userId }) {
  if (promotion.status !== "enabled") return { ok: false, reason: "This promotion is not active" };
  if (!isWithinWindow(promotion)) return { ok: false, reason: "This promotion is not currently active" };

  if (promotion.minSpendCents != null && subtotalCents < promotion.minSpendCents) {
    return { ok: false, reason: `A minimum order of $${(promotion.minSpendCents / 100).toFixed(2)} is required` };
  }

  if (promotion.products.length > 0) {
    const eligibleIds = new Set(promotion.products.map((p) => p.productId));
    if (!items.some((item) => eligibleIds.has(item.productId))) {
      return { ok: false, reason: "This code doesn't apply to the items in your cart" };
    }
  }

  if (promotion.categories.length > 0) {
    const productIds = [...new Set(items.map((item) => item.productId))];
    const nodeIds = promotion.categories.map((c) => c.taxonomyNodeId);
    const match = await prisma.productTaxonomy.findFirst({
      where: { productId: { in: productIds }, taxonomyNodeId: { in: nodeIds } },
    });
    if (!match) return { ok: false, reason: "This code doesn't apply to the items in your cart" };
  }

  if (promotion.users.length > 0) {
    if (!userId || !promotion.users.some((u) => u.userId === userId)) {
      return { ok: false, reason: "This code isn't available on your account" };
    }
  }

  // Usage limits read the append-only redemption ledger directly (never a
  // cached counter), so they're always correct as of this check — see the
  // module comment in fulfillOrder.js about the narrow race window between
  // this check and actual redemption.
  if (promotion.maxUses != null || promotion.singleUse) {
    const totalUses = await prisma.promotionRedemption.count({ where: { promotionId: promotion.id } });
    if (promotion.singleUse && totalUses > 0) {
      return { ok: false, reason: "This promotion has already been used" };
    }
    if (promotion.maxUses != null && totalUses >= promotion.maxUses) {
      return { ok: false, reason: "This promotion has reached its usage limit" };
    }
  }

  if (userId) {
    if (promotion.maxUsesPerCustomer != null) {
      const usedByCustomer = await prisma.promotionRedemption.count({ where: { promotionId: promotion.id, userId } });
      if (usedByCustomer >= promotion.maxUsesPerCustomer) {
        return { ok: false, reason: "You've already used this promotion" };
      }
    }
    if (promotion.firstPurchaseOnly) {
      const priorOrders = await prisma.order.count({ where: { userId, status: "paid" } });
      if (priorOrders > 0) {
        return { ok: false, reason: "This promotion is only valid on your first purchase" };
      }
    }
  }

  return { ok: true };
}

function computeDiscount(promotion, { items, subtotalCents }) {
  if (subtotalCents <= 0) return 0;
  if (promotion.discountType === "PERCENTAGE") {
    let discount = Math.round(subtotalCents * (promotion.discountValue / 100));
    if (promotion.maxDiscountCents != null) discount = Math.min(discount, promotion.maxDiscountCents);
    return Math.min(discount, subtotalCents);
  }
  if (promotion.discountType === "FIXED_AMOUNT") {
    return Math.min(promotion.discountValue, subtotalCents);
  }
  if (promotion.discountType === "FREE_PRODUCT") {
    if (!promotion.freeProductId) return 0;
    const match = items.find((item) => item.productId === promotion.freeProductId);
    return match ? Math.min(match.priceCents, subtotalCents) : 0;
  }
  return 0;
}

// email (not userId) is what checkout actually has for a guest — resolved to
// an existing User here (a brand-new email has no prior orders/redemptions,
// so it's automatically eligible for first-purchase/per-customer-limit rules).
async function resolveUserIdForEmail(email) {
  if (!email) return null;
  const user = await prisma.user.findUnique({ where: { email: String(email).trim().toLowerCase() } });
  return user ? user.id : null;
}

async function resolveDiscountForCode(code, { items, subtotalCents, email }) {
  const promotion = await findPromotionByCode(code);
  if (!promotion) return { ok: false, reason: "Invalid promo code" };

  const userId = await resolveUserIdForEmail(email);
  const eligibility = await checkEligibility(promotion, { items, subtotalCents, userId });
  if (!eligibility.ok) return { ok: false, reason: eligibility.reason };

  const discountCents = computeDiscount(promotion, { items, subtotalCents });
  return { ok: true, promotion, discountCents };
}

// Auto-apply promotions never take a manually-entered code — first
// eligible match wins (admin ordering isn't modeled; ties are rare and this
// keeps the lookup a single pass). Only ever combined with at most one
// manual code (gated by `stackable`), never with another auto-apply promo.
async function findAutoApplyPromotion({ items, subtotalCents, email }) {
  const candidates = await prisma.promotion.findMany({
    where: { autoApply: true, status: "enabled" },
    include: PROMOTION_INCLUDE,
  });
  if (candidates.length === 0) return null;
  const userId = await resolveUserIdForEmail(email);
  for (const promotion of candidates) {
    const eligibility = await checkEligibility(promotion, { items, subtotalCents, userId });
    if (eligibility.ok) return promotion;
  }
  return null;
}

// Writes the usage ledger row. Must be called from inside the same
// transaction/idempotency boundary as the Order it's attached to — see
// fulfillOrder.js.
async function recordRedemption(client, { promotionId, orderId, userId, discountCents }) {
  return client.promotionRedemption.create({ data: { promotionId, orderId, userId, discountCents } });
}

module.exports = {
  normalizeCode,
  findPromotionByCode,
  isWithinWindow,
  isExpired,
  checkEligibility,
  computeDiscount,
  resolveDiscountForCode,
  findAutoApplyPromotion,
  recordRedemption,
  resolveUserIdForEmail,
};
