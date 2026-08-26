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
    // Navigation presentation, read by lib/navigation.js and by the admin
    // CMS's Navigation panel. Carried on the same tree object every consumer
    // already loads rather than as a second fetch.
    showInNav: taxonomy.showInNav,
    navLayout: taxonomy.navLayout,
    nodeRoute: taxonomy.nodeRoute,
    groupRoute: taxonomy.groupRoute,
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

// Slug/segment helpers for CREATING a taxonomy through the CMS. A new nav
// category has to arrive with a working key, /shop/<key> route and a URL
// segment for its items, because those are what make its pages reachable at
// all — an admin should not have to know that to add "Equipment" to the menu.
// Everything is derived from the one thing they do type: the label.
//
// The segment is the SINGULAR of the key where a naive plural is obvious
// ("collections" -> "collection"), because that is the convention the three
// existing taxonomies already set: /goal/, /athlete/, /creator/.
function singularize(value) {
  if (/ies$/.test(value)) return value.replace(/ies$/, "y");
  if (/(ches|shes|sses|xes|zes)$/.test(value)) return value.replace(/es$/, "");
  if (/[^s]s$/.test(value)) return value.replace(/s$/, "");
  return value;
}

// Finds a value not already taken by ANY taxonomy's nodeRoute or groupRoute.
// The two share one URL namespace — /sport/football and /athlete/mbappe are
// resolved from the same lookup — so a collision would make one of them
// unreachable rather than merely ugly.
async function uniqueTaxonomySegment(base, excludeTaxonomyId) {
  const taken = new Set();
  const rows = await prisma.taxonomy.findMany({
    where: excludeTaxonomyId ? { id: { not: excludeTaxonomyId } } : {},
    select: { nodeRoute: true, groupRoute: true },
  });
  for (const r of rows) {
    if (r.nodeRoute) taken.add(r.nodeRoute);
    if (r.groupRoute) taken.add(r.groupRoute);
  }
  const seed = slugify(base) || "item";
  let candidate = seed;
  let suffix = 2;
  while (taken.has(candidate)) candidate = `${seed}-${suffix++}`;
  return candidate;
}

async function uniqueTaxonomyKey(label) {
  const base = slugify(label) || "category";
  let key = base;
  let suffix = 2;
  while (await prisma.taxonomy.findUnique({ where: { key } })) key = `${base}-${suffix++}`;
  return key;
}

module.exports = {
  getTaxonomyTree,
  getAllTaxonomyTrees,
  slugify,
  singularize,
  uniqueSlugForNode,
  uniqueTaxonomySegment,
  uniqueTaxonomyKey,
};
