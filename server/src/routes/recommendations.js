const express = require("express");
const { getRecommendations } = require("../lib/recommendations");

const router = express.Router();

// Public, unauthenticated — powers the checkout "Add a little extra" module
// today, and is generic enough to back "related products" on a product page
// (pass that one product's id) or the cart drawer (pass all cart ids) too.
router.get("/", async (req, res) => {
  const idsParam = req.query.productIds || "";
  const ids = String(idsParam).split(",").map((s) => s.trim()).filter(Boolean);
  const limitParam = parseInt(req.query.limit, 10);
  const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 3) : 3;

  const products = await getRecommendations(ids, limit);
  res.json({ products });
});

module.exports = router;
