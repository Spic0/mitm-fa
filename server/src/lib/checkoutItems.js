const { prisma } = require("../db");
const { resolveDiscountForCode, findAutoApplyPromotion, computeDiscount } = require("./promotions");

// A real cart is a handful of line items; nothing about this catalog (a few
// dozen training/nutrition plans) ever needs more than this. Capping early —
// before the DB query, before any per-item work — is what actually matters:
// without it, a single request can force an arbitrarily large DB query, a
// huge in-memory array build, and (via the PayPal path, which stores the
// raw item list in an unbounded text column) an arbitrarily large row
// written to the database. Confirmed live: an unbounded 10,000-entry cart
// produced a 500KB+ PendingCheckout row and ~2s of server time per request
// before either payment provider's own API had a chance to reject anything.
const MAX_LINE_ITEMS = 50;
const MAX_TOTAL_UNITS = 100;

// Never trust client-provided prices: look products up server-side and expand
// { productId, qty } pairs into one order-item entry per unit purchased. Pure
// pricing, no promo logic — split out so callers that only need a subtotal
// (e.g. the /validate and /auto-apply routes, which are themselves deciding
// what to do with a promo) don't pay for an auto-apply lookup they discard.
async function resolveItemsAndSubtotal(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new Error("Cart is empty");
  }
  if (rawItems.length > MAX_LINE_ITEMS) {
    throw new Error(`Cart can't have more than ${MAX_LINE_ITEMS} line items`);
  }

  // Only published products are purchasable — a draft/archived id (visible
  // in the admin dashboard, or a stale link to something later unpublished)
  // must never be checkoutable just because the id is guessable.
  const productIds = [...new Set(rawItems.map((i) => i.productId))];
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, status: "published" } });
  const byId = new Map(products.map((p) => [p.id, p]));

  const resolvedItems = [];
  for (const raw of rawItems) {
    const product = byId.get(raw.productId);
    if (!product) throw new Error(`Unknown product: ${raw.productId}`);
    const qty = Math.max(1, Math.min(10, Number(raw.qty) || 1));
    for (let i = 0; i < qty; i++) {
      if (resolvedItems.length >= MAX_TOTAL_UNITS) throw new Error(`Cart can't have more than ${MAX_TOTAL_UNITS} total items`);
      resolvedItems.push({ productId: product.id, priceCents: product.priceCents });
    }
  }

  const subtotalCents = resolvedItems.reduce((sum, item) => sum + item.priceCents, 0);
  return { resolvedItems, subtotalCents };
}

// Full checkout resolution: pricing + promo application. `promoCode`/`email`
// are optional — when a promoCode is given, the discount is validated and
// computed server-side too (same "never trust the client" rule that already
// applies to prices), and the returned totalCents is what should actually be
// charged.
async function resolveCheckoutItems(rawItems, { promoCode, email } = {}) {
  const { resolvedItems, subtotalCents } = await resolveItemsAndSubtotal(rawItems);

  // At most one manually-entered code + at most one auto-apply promotion can
  // apply to an order — two manually-entered codes never combine, and an
  // auto-apply promotion only joins a manual code when that code's
  // `stackable` flag allows it. `appliedPromotions` (0-2 entries) is what
  // actually gets redeemed at fulfillment time; `promotionId` is just the
  // manual code, kept for Order's display-convenience FK.
  const appliedPromotions = [];
  let manualResult = null;
  if (promoCode) {
    manualResult = await resolveDiscountForCode(promoCode, { items: resolvedItems, subtotalCents, email });
    if (!manualResult.ok) throw new Error(manualResult.reason);
    appliedPromotions.push({ promotionId: manualResult.promotion.id, discountCents: manualResult.discountCents });
  }

  const canConsiderAutoApply = !manualResult || manualResult.promotion.stackable;
  if (canConsiderAutoApply) {
    const remainingSubtotal = subtotalCents - (manualResult ? manualResult.discountCents : 0);
    const auto = await findAutoApplyPromotion({ items: resolvedItems, subtotalCents: remainingSubtotal, email });
    if (auto && (!manualResult || auto.id !== manualResult.promotion.id)) {
      const autoDiscountCents = computeDiscount(auto, { items: resolvedItems, subtotalCents: remainingSubtotal });
      if (autoDiscountCents > 0) appliedPromotions.push({ promotionId: auto.id, discountCents: autoDiscountCents });
    }
  }

  const discountCents = Math.min(appliedPromotions.reduce((sum, a) => sum + a.discountCents, 0), subtotalCents);
  const totalCents = subtotalCents - discountCents;
  const promotionId = manualResult ? manualResult.promotion.id : null;
  return { resolvedItems, subtotalCents, discountCents, promotionId, appliedPromotions, totalCents };
}

module.exports = { resolveCheckoutItems, resolveItemsAndSubtotal };
