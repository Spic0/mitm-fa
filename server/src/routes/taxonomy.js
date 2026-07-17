const express = require("express");
const { getAllTaxonomyTrees } = require("../lib/taxonomy");

const router = express.Router();

// Public, unauthenticated read of the full taxonomy tree — the single
// source of truth the storefront (header nav, shop filters) and the admin
// CMS both read from, so a category/subcategory created or renamed in
// Admin shows up here on the very next request, no rebuild or cache
// invalidation needed.
router.get("/", async (req, res) => {
  const taxonomies = await getAllTaxonomyTrees();
  res.json({ taxonomies });
});

module.exports = router;
