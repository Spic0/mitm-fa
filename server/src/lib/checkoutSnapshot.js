const { prisma } = require("../db");
const { resolveCheckoutItems } = require("./checkoutItems");

// The single server-side record of a checkout attempt, shared by Stripe and
// PayPal. Both providers create one of these BEFORE any payment object
// exists, then carry nothing but its id — Stripe in PaymentIntent metadata,
// PayPal in purchase_units[].custom_id.
//
// The point is that fulfillment reads a frozen snapshot rather than
// re-deriving the cart. Re-deriving is what the Stripe path used to do, and
// it has two failure modes that only appear in production, both after the
// customer's money has already moved:
//
//   - a price edited between payment and webhook records an Order total that
//     disagrees with the amount actually charged;
//   - a product unpublished between payment and webhook makes
//     resolveCheckoutItems throw "Unknown product", so the webhook 500s, and
//     Stripe's retries 500 identically forever — a paid customer who never
//     gets access.
//
// Everything priced here is computed server-side from the database
// (resolveCheckoutItems); the browser only ever sends { productId, qty } and
// an optional promo code.

async function createCheckoutSnapshot({ items, promoCode, customer, provider }) {
  const resolved = await resolveCheckoutItems(items, { promoCode, email: customer.email });

  const pending = await prisma.pendingCheckout.create({
    data: {
      email: customer.email,
      customerName: customer.name,
      customerPhone: customer.phone,
      customerCountry: customer.country,
      itemsJson: JSON.stringify(items),
      resolvedItemsJson: JSON.stringify(resolved.resolvedItems),
      subtotalCents: resolved.subtotalCents,
      totalCents: resolved.totalCents,
      discountCents: resolved.discountCents,
      promotionId: resolved.promotionId,
      appliedPromotionsJson: JSON.stringify(resolved.appliedPromotions),
      provider,
    },
  });

  return { pending, ...resolved };
}

// Re-prices an existing snapshot in place — the cart changed (a checkout-page
// recommendation was added) or the contact details were corrected while the
// payment object already exists. Returns the same shape as create so callers
// can push the new total at the provider.
async function updateCheckoutSnapshot(pendingId, { items, promoCode, customer }) {
  const existing = await prisma.pendingCheckout.findUnique({ where: { id: pendingId } });
  if (!existing) throw new Error("Checkout session not found");
  // A snapshot an order was already fulfilled from must never be re-priced:
  // that would rewrite the record of what a completed purchase was for.
  if (existing.consumedAt) throw new Error("This checkout has already been completed");

  const email = (customer && customer.email) || existing.email;
  const resolved = await resolveCheckoutItems(items, { promoCode, email });

  const pending = await prisma.pendingCheckout.update({
    where: { id: pendingId },
    data: {
      // Contact details are only overwritten when a complete, valid set was
      // supplied — a half-edited form must not blank out good values.
      ...(customer
        ? {
            email: customer.email,
            customerName: customer.name,
            customerPhone: customer.phone,
            customerCountry: customer.country,
          }
        : {}),
      itemsJson: JSON.stringify(items),
      resolvedItemsJson: JSON.stringify(resolved.resolvedItems),
      subtotalCents: resolved.subtotalCents,
      totalCents: resolved.totalCents,
      discountCents: resolved.discountCents,
      promotionId: resolved.promotionId,
      appliedPromotionsJson: JSON.stringify(resolved.appliedPromotions),
    },
  });

  return { pending, ...resolved };
}

// Reads a snapshot back into the argument shape fulfillOrder expects.
//
// `chargedTotalCents` is what the PROVIDER says actually moved, and it wins
// over the snapshot's own total whenever the two disagree: the order must
// record the amount the customer was really charged, never a recomputed
// figure. It's passed as null only where no provider figure is available.
async function loadSnapshotForFulfillment(pendingId, { chargedTotalCents = null } = {}) {
  const pending = await prisma.pendingCheckout.findUnique({ where: { id: pendingId } });
  if (!pending) return null;

  let resolvedItems;
  if (pending.resolvedItemsJson) {
    resolvedItems = JSON.parse(pending.resolvedItemsJson);
  } else {
    // Snapshot written before resolvedItemsJson existed. Re-resolving is the
    // old, worse behavior — but for these rows it's the only thing available,
    // and it's strictly better than refusing to fulfill a paid order.
    const reResolved = await resolveCheckoutItems(JSON.parse(pending.itemsJson));
    resolvedItems = reResolved.resolvedItems;
  }

  const discountCents = pending.discountCents || 0;
  const snapshotTotal = Math.max(0, pending.totalCents);

  return {
    email: pending.email,
    customer: {
      name: pending.customerName,
      phone: pending.customerPhone,
      country: pending.customerCountry,
    },
    items: resolvedItems,
    totalCents: chargedTotalCents == null ? snapshotTotal : chargedTotalCents,
    snapshotTotalCents: snapshotTotal,
    discountCents,
    promotionId: pending.promotionId,
    appliedPromotions: pending.appliedPromotionsJson ? JSON.parse(pending.appliedPromotionsJson) : [],
  };
}

// Best-effort bookkeeping — records which payment claimed this snapshot.
// Never allowed to throw: it runs after a successful charge, where the order
// already exists and nothing about a failed audit write should surface to the
// customer or make a webhook retry.
async function markSnapshotConsumed(pendingId, { provider, providerRef }) {
  try {
    await prisma.pendingCheckout.update({
      where: { id: pendingId },
      data: { consumedAt: new Date(), provider, providerRef },
    });
  } catch (err) {
    console.error("Failed to mark checkout snapshot consumed:", err);
  }
}

module.exports = {
  createCheckoutSnapshot,
  updateCheckoutSnapshot,
  loadSnapshotForFulfillment,
  markSnapshotConsumed,
};
