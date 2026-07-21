const express = require("express");
const { prisma } = require("../db");
const { normalizeImageUrl } = require("../lib/media");

const router = express.Router();

// Root cause of the "product tagged to Football doesn't show under
// ?sport=football" bug: this serializer used to omit taxonomy data entirely
// (a holdover from when products carried free-text category/tags fields,
// which were removed from the schema). The storefront's shop.js has nothing
// to filter on unless the product's taxonomy node ids ride along here.
function serialize(product) {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    priceCents: product.priceCents,
    featured: product.featured,
    imageUrl: normalizeImageUrl(product.imageUrl),
    description: product.description,
    creator: product.creator,
    difficulty: product.difficulty,
    durationWeeks: product.durationWeeks,
    overview: product.overview,
    createdAt: product.createdAt,
    taxonomyNodeIds: (product.taxonomies || []).map((t) => t.taxonomyNodeId),
  };
}

const withTaxonomy = { taxonomies: { select: { taxonomyNodeId: true } } };

router.get("/", async (req, res) => {
  const where = { status: "published" };
  if (req.query.featured === "true") where.featured = true;

  const products = await prisma.product.findMany({
    where,
    orderBy: { createdAt: "asc" },
    include: withTaxonomy,
  });
  res.json({ products: products.map(serialize) });
});

router.get("/:idOrSlug", async (req, res) => {
  const { idOrSlug } = req.params;
  const product = await prisma.product.findFirst({
    where: { status: "published", OR: [{ id: idOrSlug }, { slug: idOrSlug }] },
    include: withTaxonomy,
  });
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json({ product: serialize(product) });
});

module.exports = router;
