const express = require("express");
const { prisma } = require("../db");
const { normalizeImageUrl, coverMedia } = require("../lib/media");

const router = express.Router();

// Root cause of the "product tagged to Football doesn't show under
// ?sport=football" bug: this serializer used to omit taxonomy data entirely
// (a holdover from when products carried free-text category/tags fields,
// which were removed from the schema). The storefront's shop.js has nothing
// to filter on unless the product's taxonomy node ids ride along here.
function serialize(product) {
  const out = {
    id: product.id,
    slug: product.slug,
    name: product.name,
    priceCents: product.priceCents,
    featured: product.featured,
    imageUrl: normalizeImageUrl(product.imageUrl),
    // Responsive/fit metadata for the card's media container. Null for
    // images that predate the derivative pipeline — the card falls back to
    // imageUrl exactly as before, so nothing needs backfilling to ship.
    cover: coverMedia(product.imageUrl),
    description: product.description,
    creator: product.creator,
    difficulty: product.difficulty,
    durationWeeks: product.durationWeeks,
    overview: product.overview,
    createdAt: product.createdAt,
    taxonomyNodeIds: (product.taxonomies || []).map((t) => t.taxonomyNodeId),
  };

  // Only present when the caller asked for it (the detail endpoint). The
  // grid endpoint returns every published product and needs nothing but the
  // cover — attaching each product's full gallery there would grow that
  // payload with rows no shop-grid card can display.
  if (product.media) {
    out.media = product.media.map((m) => ({
      url: normalizeImageUrl(m.url),
      type: m.type,
      alt: m.alt || product.name,
    }));
  }
  return out;
}

const withTaxonomy = { taxonomies: { select: { taxonomyNodeId: true } } };

// Gallery ordering is admin-defined; `id` only breaks ties so that two items
// sharing an order value don't shuffle between requests.
const withMedia = {
  ...withTaxonomy,
  media: {
    select: { url: true, type: true, alt: true },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  },
};

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
    include: withMedia,
  });
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json({ product: serialize(product) });
});

module.exports = router;
