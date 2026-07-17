const { prisma } = require("../db");

// Same classification rule the admin wizard's wizardProgress() check uses
// (server/src/routes/admin/products.js) — a product is "training" or
// "nutrition" based on which content block it actually has filled in, not a
// separate stored field.
function hasTrainingContent(product) {
  return !!(product.trainingContent && Array.isArray(product.trainingContent.weeks) && product.trainingContent.weeks.length > 0);
}
function hasNutritionContent(product) {
  const n = product.nutritionContent;
  return !!(n && (n.notes || (Array.isArray(n.meals) && n.meals.length > 0)));
}
function productType(product) {
  const training = hasTrainingContent(product);
  const nutrition = hasNutritionContent(product);
  if (training && !nutrition) return "training";
  if (nutrition && !training) return "nutrition";
  return "other";
}

function serializeCard(product) {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    priceCents: product.priceCents,
    imageUrl: product.imageUrl,
    creator: product.creator,
  };
}

// Ranks published products by units sold (paid OrderItem rows), the same
// "bestseller" definition used by the admin dashboard/analytics top-products
// widgets — just scoped to the whole catalog with no date range, and
// excluding whatever the caller passes (already-recommended or in-cart ids).
//
// Sales counts are looked up separately from the candidate pool (rather than
// ranking sold ids first and filtering by status after) so that a top
// seller which has since been archived never shrinks the result — it's
// simply outranked by the next published product instead of leaving an
// empty slot. Products with zero sales default to a count of 0 and fall
// back to newest-first, so a catalog with little or no sales history still
// returns a sensible full set of picks.
async function getBestsellers(limit, excludeIds) {
  const rows = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: { order: { status: "paid" } },
    _count: { productId: true },
  });
  const countByProduct = new Map(rows.map((r) => [r.productId, r._count.productId]));

  const candidates = await prisma.product.findMany({
    where: { status: "published", id: { notIn: [...excludeIds] } },
  });

  candidates.sort((a, b) => {
    const diff = (countByProduct.get(b.id) || 0) - (countByProduct.get(a.id) || 0);
    if (diff !== 0) return diff;
    return new Date(b.createdAt) - new Date(a.createdAt);
  });

  return candidates.slice(0, limit);
}

// The reusable recommendation engine — one rule-based priority cascade that
// powers the checkout "Add a little extra" module today, and is meant to
// back "related products" on product pages / the cart drawer too: callers
// everywhere just pass the relevant set of product ids already "in view"
// (cart contents, or a single product being viewed) and get back the same
// ranked picks.
//
// Priority order (fills remaining slots at each step until `limit` is met):
//   1. Cross-category complements — a Training plan in the set recommends a
//      Nutrition plan by the same creator, and vice versa.
//   2. Same-creator upsell — any other published plan by a creator already
//      represented in the set.
//   3. Same-goal complements — published products sharing a "Shop by Goal"
//      taxonomy node with something in the set.
//   4. Bestsellers fallback — platform-wide top sellers by units sold.
// A product already in `productIds` is never recommended, at any step.
async function getRecommendations(productIds, limit = 3) {
  const excludeIds = new Set((productIds || []).filter(Boolean));
  const picks = [];

  function addCandidates(candidates) {
    for (const p of candidates) {
      if (picks.length >= limit) break;
      if (excludeIds.has(p.id)) continue;
      picks.push(p);
      excludeIds.add(p.id);
    }
  }

  const baseProducts = excludeIds.size
    ? await prisma.product.findMany({
        where: { id: { in: [...excludeIds] } },
        include: { taxonomies: { include: { taxonomyNode: { include: { taxonomy: true } } } } },
      })
    : [];

  if (baseProducts.length) {
    const creators = [...new Set(baseProducts.map((p) => p.creator).filter(Boolean))];
    const types = new Set(baseProducts.map(productType));

    // Rule 1: cross-category complements, scoped to the same creator(s).
    if (creators.length && (types.has("training") || types.has("nutrition"))) {
      const wantTypes = [];
      if (types.has("training")) wantTypes.push("nutrition");
      if (types.has("nutrition")) wantTypes.push("training");
      const sameCreator = await prisma.product.findMany({
        where: { status: "published", creator: { in: creators }, id: { notIn: [...excludeIds] } },
      });
      addCandidates(sameCreator.filter((p) => wantTypes.includes(productType(p))));
    }

    // Rule 2: same-creator upsell — any other plan by a creator in the set.
    if (picks.length < limit && creators.length) {
      const sameCreator = await prisma.product.findMany({
        where: { status: "published", creator: { in: creators }, id: { notIn: [...excludeIds] } },
      });
      addCandidates(sameCreator);
    }

    // Rule 3: same-goal complements via the Goals taxonomy.
    if (picks.length < limit) {
      const goalNodeIds = [];
      for (const p of baseProducts) {
        for (const pt of p.taxonomies) {
          if (pt.taxonomyNode.taxonomy.key === "goals") goalNodeIds.push(pt.taxonomyNode.id);
        }
      }
      if (goalNodeIds.length) {
        const sameGoal = await prisma.product.findMany({
          where: {
            status: "published",
            id: { notIn: [...excludeIds] },
            taxonomies: { some: { taxonomyNodeId: { in: goalNodeIds } } },
          },
        });
        addCandidates(sameGoal);
      }
    }
  }

  // Rule 4: bestsellers fallback — fills any remaining slots (or all of
  // them, for an empty/unmatched set).
  if (picks.length < limit) {
    addCandidates(await getBestsellers(limit, excludeIds));
  }

  return picks.slice(0, limit).map(serializeCard);
}

module.exports = { getRecommendations, getBestsellers, productType };
