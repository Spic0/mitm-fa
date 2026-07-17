const { prisma } = require("../db");

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function buildTree(nodes, parentId) {
  return nodes
    .filter((n) => n.parentId === parentId)
    .sort((a, b) => a.order - b.order)
    .map((n) => ({
      id: n.id,
      name: n.name,
      slug: n.slug,
      order: n.order,
      productCount: n._count.products,
      children: buildTree(nodes, n.id),
    }));
}

// Single place the nested-tree shape is built from flat TaxonomyNode rows —
// used by the admin CMS today and reusable as-is by the public storefront
// endpoint once Phase 2 wires the three shop routes to it.
async function getTaxonomyTree(key) {
  const taxonomy = await prisma.taxonomy.findUnique({
    where: { key },
    include: { nodes: { include: { _count: { select: { products: true } } } } },
  });
  if (!taxonomy) return null;
  return {
    id: taxonomy.id,
    key: taxonomy.key,
    label: taxonomy.label,
    route: taxonomy.route,
    order: taxonomy.order,
    hasSubcategories: taxonomy.hasSubcategories,
    nodes: buildTree(taxonomy.nodes, null),
  };
}

async function getAllTaxonomyTrees() {
  const taxonomies = await prisma.taxonomy.findMany({ orderBy: { order: "asc" } });
  const trees = [];
  for (const t of taxonomies) trees.push(await getTaxonomyTree(t.key));
  return trees;
}

// Prisma's compound-unique shorthand rejects an explicit null for the
// nullable parentId, so duplicate-slug checks use findFirst rather than
// findUnique on (taxonomyId, parentId, slug) — same workaround as seed.js.
async function uniqueSlugForNode(taxonomyId, parentId, name, excludeNodeId) {
  const base = slugify(name) || "item";
  let slug = base;
  let suffix = 2;
  while (
    await prisma.taxonomyNode.findFirst({
      where: {
        taxonomyId,
        parentId: parentId ?? null,
        slug,
        ...(excludeNodeId ? { id: { not: excludeNodeId } } : {}),
      },
    })
  ) {
    slug = `${base}-${suffix++}`;
  }
  return slug;
}

module.exports = { getTaxonomyTree, getAllTaxonomyTrees, slugify, uniqueSlugForNode };
