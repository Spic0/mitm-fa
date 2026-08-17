const { prisma } = require("../db");
const { createSession } = require("./session");
const { createMagicLinkToken, buildMagicLinkUrl } = require("./magicLink");
const { sendPurchaseReceiptEmail, sendWelcomeEmail } = require("./email");
const { logEvent } = require("./adminLog");
const { recordRedemption } = require("./promotions");

// Idempotent: safe to call more than once for the same providerRef (e.g. webhook retries).
// items: [{ productId, priceCents }]
// appliedPromotions (optional): [{ promotionId, discountCents }], 0-2 entries
// (one manual code + one stackable auto-apply promotion, see
// checkoutItems.js) — discountCents here should already be baked into
// totalCents by the caller; this just records the usage ledger rows.
// customer (optional): { name, phone, country } from the checkout form.
// Only ever fills in blanks on an existing User — a returning buyer who
// mistypes their name at checkout shouldn't overwrite the name already on
// their account, and an older payment that carries no details shouldn't blank
// out details captured by a newer one.
function customerFieldsToFill(customer, user) {
  const data = {};
  if (!customer) return data;
  for (const field of ["name", "phone", "country"]) {
    const value = customer[field] ? String(customer[field]).trim() : "";
    if (value && !user[field]) data[field] = value;
  }
  return data;
}

async function fulfillOrder({ email, customer = null, provider, providerRef, items, totalCents, discountCents = 0, promotionId = null, appliedPromotions = [] }) {
  const existing = await prisma.order.findUnique({
    where: { providerRef },
    include: { user: true },
  });
  if (existing) {
    const sessionToken = await createSession(existing.userId);
    return { user: existing.user, order: existing, sessionToken, alreadyFulfilled: true };
  }

  const normalizedEmail = email.trim().toLowerCase();
  let user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  // Drives the one-off welcome email below. Set only on the branch that
  // actually creates the row — the P2002 recovery path means "someone else
  // created it first", so that request must not also claim the welcome.
  let isNewUser = false;
  if (!user) {
    try {
      user = await prisma.user.create({
        data: {
          email: normalizedEmail,
          ...(customer && customer.name ? { name: String(customer.name).trim() } : {}),
          ...(customer && customer.phone ? { phone: String(customer.phone).trim() } : {}),
          ...(customer && customer.country ? { country: String(customer.country).trim() } : {}),
        },
      });
      isNewUser = true;
      await logEvent({ category: "user", message: `New user registered: ${normalizedEmail}`, actorId: user.id });
    } catch (err) {
      // Same check-then-create race as the order below, one step earlier: two
      // concurrent first-time fulfillments for the same brand-new customer
      // email (webhook + /stripe/finalize, both racing to create the User
      // row) can both pass the findUnique above before either commits.
      if (err.code === "P2002" && err.meta?.target?.includes("email")) {
        user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
      }
      if (!user) throw err;
    }
  } else {
    // Returning buyer, or one whose account was created by an earlier magic
    // link with nothing but an email on it — backfill only the fields still
    // empty. Never blocks fulfillment: a payment has already succeeded by
    // this point, so a failure to enrich the profile must not throw.
    const fill = customerFieldsToFill(customer, user);
    if (Object.keys(fill).length) {
      try {
        user = await prisma.user.update({ where: { id: user.id }, data: fill });
      } catch (err) {
        console.error("Failed to backfill customer details:", err);
      }
    }
  }

  let order;
  try {
    // Order creation + redemption-ledger writes happen in one transaction so
    // a promotion's usage count can never advance without the order it's
    // attributed to actually existing (or vice versa) — same "never fails
    // after a successful charge" requirement as the rest of this function,
    // just extended to cover the ledger too.
    order = await prisma.$transaction(async (tx) => {
      const created = await tx.order.create({
        data: {
          userId: user.id,
          provider,
          providerRef,
          status: "paid",
          totalCents,
          discountCents,
          promotionId,
          items: {
            create: items.map((item) => ({
              productId: item.productId,
              priceCents: item.priceCents,
            })),
          },
        },
        include: { items: { include: { product: true } } },
      });
      for (const applied of appliedPromotions) {
        await recordRedemption(tx, {
          promotionId: applied.promotionId,
          orderId: created.id,
          userId: user.id,
          discountCents: applied.discountCents,
        });
      }
      return created;
    });
  } catch (err) {
    // The findUnique check above and this create aren't atomic — a second
    // concurrent fulfillment attempt for the exact same payment can slip
    // through the gap between them. This isn't rare: it's the ordinary path
    // for every purchase, since the Stripe webhook and the browser's
    // /stripe/finalize call both fulfill the same PaymentIntent independently
    // and can genuinely race in production. The providerRef unique
    // constraint is what actually prevents a duplicate order (confirmed
    // under 5 concurrent requests: exactly one Order row, never two) — this
    // catch just makes the losing request(s) recognize that and return the
    // real order instead of surfacing a raw 500 for a purchase that, from
    // the customer's perspective, succeeded.
    if (err.code === "P2002" && err.meta?.target?.includes("providerRef")) {
      const winner = await prisma.order.findUnique({ where: { providerRef }, include: { user: true } });
      if (winner) {
        const sessionToken = await createSession(winner.userId);
        return { user: winner.user, order: winner, sessionToken, alreadyFulfilled: true };
      }
    }
    throw err;
  }
  await logEvent({
    category: "order",
    message: `Order created for ${user.email} via ${provider} — $${(totalCents / 100).toFixed(2)}`,
    actorId: user.id,
  });

  const sessionToken = await createSession(user.id);

  try {
    const magicToken = await createMagicLinkToken(user.id);
    await sendPurchaseReceiptEmail(user.email, {
      orderItems: order.items,
      totalCents: order.totalCents,
      discountCents: order.discountCents,
      orderId: order.id,
      provider,
      customerName: user.name,
      magicLink: buildMagicLinkUrl(magicToken),
      orderDate: order.createdAt,
    });
    // First purchase from a brand-new account: the receipt covers the order,
    // the welcome covers how the account itself works (magic-link sign-in,
    // lifetime access). Sent only on account creation, never on repeat orders.
    if (isNewUser) await sendWelcomeEmail(user.email, { name: user.name });
  } catch (err) {
    // Email delivery failure must never block order fulfillment.
    console.error("Failed to send purchase receipt email:", err);
  }

  return { user, order, sessionToken, alreadyFulfilled: false };
}

module.exports = { fulfillOrder };
