const { prisma } = require("../db");

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
// { productId, qty } pairs into one order-item entry per unit purchased.
async function resolveCheckoutItems(rawItems) {
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

  const totalCents = resolvedItems.reduce((sum, item) => sum + item.priceCents, 0);
  return { resolvedItems, totalCents };
}

module.exports = { resolveCheckoutItems };
