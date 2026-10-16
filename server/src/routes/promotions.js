const express = require("express");
const { resolveDiscountForCode, findAutoApplyPromotion, computeDiscount } = require("../lib/promotions");
const { resolveItemsAndSubtotal } = require("../lib/checkoutItems");
const { promoValidateLimiter } = require("../middleware/rateLimit");

const router = express.Router();
router.use(promoValidateLimiter);

const MAX_LINE_ITEMS = 50;

function parseItems(rawItems) {
  if (!Array.isArray(rawItems) || rawItems.length === 0) throw new Error("Cart is empty");
  if (rawItems.length > MAX_LINE_ITEMS) throw new Error("Too many items");
  return rawItems;
}

// Called from the cart/checkout page when the shopper enters a code and
// clicks Apply. Deliberately re-derives pricing server-side (never trusts a
// client-computed subtotal) via the same product lookup checkout itself
// uses, just without the auto-apply/combination logic — that's only decided
// for real at create-intent time.
router.post("/validate", async (req, res) => {
  try {
    const code = String(req.body.code || "").trim();
    if (!code) return res.status(400).json({ ok: false, reason: "Enter a promo code" });
    const email = req.body.email ? String(req.body.email).trim().toLowerCase() : undefined;

    const rawItems = parseItems(req.body.items);
    const { subtotalCents, resolvedItems } = await resolveItemsAndSubtotal(rawItems);

    const result = await resolveDiscountForCode(code, { items: resolvedItems, subtotalCents, email });
    if (!result.ok) return res.json({ ok: false, reason: result.reason });

    res.json({
      ok: true,
      discountCents: result.discountCents,
      promotion: { name: result.promotion.name, code: result.promotion.code, discountType: result.promotion.discountType },
    });
  } catch (err) {
    res.status(400).json({ ok: false, reason: err.message });
  }
});

// Cheap, cacheable-by-the-client check for a site-wide/category auto-apply
// promotion — called once when the checkout page loads (and again on cart
// changes), never polled continuously.
router.get("/auto-apply", async (req, res) => {
  try {
    const rawItems = parseItems(JSON.parse(req.query.items || "[]"));
    const email = req.query.email ? String(req.query.email).trim().toLowerCase() : undefined;

    const { subtotalCents, resolvedItems } = await resolveItemsAndSubtotal(rawItems);

    const promotion = await findAutoApplyPromotion({ items: resolvedItems, subtotalCents, email });
    if (!promotion) return res.json({ applied: false });

    const discountCents = computeDiscount(promotion, { items: resolvedItems, subtotalCents });
    res.json({ applied: true, discountCents, promotion: { name: promotion.name, code: promotion.code } });
  } catch (err) {
    res.status(400).json({ applied: false, error: err.message });
  }
});

module.exports = router;
