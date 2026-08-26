const express = require("express");
const { prisma } = require("../../db");
const { logEvent } = require("../../lib/adminLog");
const {
  getAllTaxonomyTrees,
  uniqueSlugForNode,
  uniqueTaxonomySegment,
  uniqueTaxonomyKey,
  singularize,
  slugify,
} = require("../../lib/taxonomy");
const { invalidateNavigation } = require("../../lib/navigation");

const router = express.Router();

// The header menu is rendered once and cached (it is identical on every page
// of the site), so every write in this file has to tell it to rebuild.
// Missing one does not corrupt anything — the cache also expires on a timer —
// but it does mean an admin sees their edit up to a minute late, which reads
// as "the CMS didn't save".
function navChanged() {
  invalidateNavigation();
}

// Presentation modes lib/navigation.js knows how to render. Validated here
// rather than trusted, so a typo cannot put a taxonomy into a layout that
// silently falls back to something else.
const NAV_LAYOUTS = ["auto", "list", "groups", "people"];

router.get("/", async (req, res) => {
  const taxonomies = await getAllTaxonomyTrees();
  res.json({ taxonomies });
});

// Creates a node under a taxonomy (parentId null = a new root-level item,
// e.g. a new sport under Browse Athletes; parentId set = a leaf/sub-branch
// under an existing item, e.g. a new athlete under Football).
router.post("/:taxonomyId/nodes", async (req, res) => {
  const { name, parentId } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: "name is required" });

  const taxonomy = await prisma.taxonomy.findUnique({ where: { id: req.params.taxonomyId } });
  if (!taxonomy) return res.status(404).json({ error: "Taxonomy not found" });

  if (parentId) {
    const parent = await prisma.taxonomyNode.findUnique({ where: { id: parentId } });
    if (!parent || parent.taxonomyId !== taxonomy.id) {
      return res.status(400).json({ error: "Invalid parent node" });
    }
  }

  const siblingCount = await prisma.taxonomyNode.count({
    where: { taxonomyId: taxonomy.id, parentId: parentId || null },
  });
  const slug = await uniqueSlugForNode(taxonomy.id, parentId || null, name);

  const node = await prisma.taxonomyNode.create({
    data: { taxonomyId: taxonomy.id, parentId: parentId || null, name: name.trim(), slug, order: siblingCount },
  });

  navChanged();
  await logEvent({
    category: "admin",
    message: `Created "${node.name}" under ${taxonomy.label}`,
    actorId: req.user.id,
  });
  res.status(201).json({ node });
});

// Rename / reorder / reparent — partial update, same "send only what changed"
// pattern as the product routes.
router.put("/nodes/:nodeId", async (req, res) => {
  const existing = await prisma.taxonomyNode.findUnique({ where: { id: req.params.nodeId } });
  if (!existing) return res.status(404).json({ error: "Node not found" });

  const { name, order, parentId } = req.body;
  const data = {};
  if (order !== undefined) data.order = order;
  if (parentId !== undefined) data.parentId = parentId || null;
  if (name !== undefined && name.trim()) {
    data.name = name.trim();
    data.slug = await uniqueSlugForNode(existing.taxonomyId, parentId !== undefined ? parentId || null : existing.parentId, name, existing.id);
  }

  const node = await prisma.taxonomyNode.update({ where: { id: existing.id }, data });
  navChanged();
  await logEvent({ category: "admin", message: `Updated taxonomy item "${node.name}"`, actorId: req.user.id });
  res.json({ node });
});

// Blocks deleting a node with children so reorganizing a whole subtree is
// always an explicit choice, never a silent cascade wipe of everything under
// it — the underlying FK cascade only ever fires on the leaf being deleted.
router.delete("/nodes/:nodeId", async (req, res) => {
  const node = await prisma.taxonomyNode.findUnique({
    where: { id: req.params.nodeId },
    include: { _count: { select: { children: true } } },
  });
  if (!node) return res.status(404).json({ error: "Node not found" });
  if (node._count.children > 0) {
    return res.status(409).json({ error: "Delete the sub-items under this one first" });
  }

  await prisma.taxonomyNode.delete({ where: { id: node.id } });
  navChanged();
  await logEvent({ category: "admin", message: `Deleted taxonomy item "${node.name}"`, actorId: req.user.id });
  res.json({ ok: true });
});

// -------------------------------------------------------------------------
// TAXONOMY-level CRUD — creating a whole new top-level nav category.
//
// This is what "a future category added through the CMS appears in the header
// automatically" actually requires, and it did not exist: the three seeded
// taxonomies could have their items edited, but there was no way to add a
// fourth category at all. Everything a new category needs to be REACHABLE —
// its key, its /shop/<key> landing route and the URL segment its items live
// under — is derived from the one thing an admin types, the label, because
// those are implementation details a content editor should never have to know.
// -------------------------------------------------------------------------
router.post("/", async (req, res) => {
  const { label, hasSubcategories, navLayout } = req.body;
  if (!label || !label.trim()) return res.status(400).json({ error: "Name is required" });
  if (navLayout !== undefined && !NAV_LAYOUTS.includes(navLayout)) {
    return res.status(400).json({ error: "Unknown layout" });
  }

  const key = await uniqueTaxonomyKey(label);
  const nested = !!hasSubcategories;
  // The item segment is the singular of the key, matching the convention the
  // seeded taxonomies set (/goal/, /athlete/, /creator/). Branch pages only
  // exist for a nested taxonomy — a flat one has no branches to address.
  const nodeRoute = await uniqueTaxonomySegment(singularize(key));
  const groupRoute = nested ? await uniqueTaxonomySegment(`${singularize(key)}-group`) : null;
  const count = await prisma.taxonomy.count();

  const taxonomy = await prisma.taxonomy.create({
    data: {
      key,
      label: label.trim(),
      route: `/shop/${key}`,
      order: count,
      hasSubcategories: nested,
      navLayout: navLayout || "auto",
      nodeRoute,
      groupRoute,
    },
  });

  navChanged();
  await logEvent({ category: "admin", message: `Created navigation category "${taxonomy.label}"`, actorId: req.user.id });
  res.status(201).json({ taxonomy });
});

// Rename / reorder / retire a category, and choose how its panel presents.
router.put("/:taxonomyId", async (req, res) => {
  const existing = await prisma.taxonomy.findUnique({ where: { id: req.params.taxonomyId } });
  if (!existing) return res.status(404).json({ error: "Category not found" });

  const { label, order, showInNav, navLayout, groupRoute } = req.body;
  const data = {};
  if (label !== undefined && label.trim()) data.label = label.trim();
  if (order !== undefined) data.order = order;
  if (showInNav !== undefined) data.showInNav = !!showInNav;
  if (navLayout !== undefined) {
    if (!NAV_LAYOUTS.includes(navLayout)) return res.status(400).json({ error: "Unknown layout" });
    data.navLayout = navLayout;
  }
  // Turning branch pages on or off. The segment is generated rather than
  // accepted verbatim: it shares a URL namespace with every other taxonomy's
  // segments, and a collision would make one of the two unreachable.
  if (groupRoute !== undefined) {
    data.groupRoute = groupRoute
      ? await uniqueTaxonomySegment(slugify(String(groupRoute)) || `${existing.key}-group`, existing.id)
      : null;
  }

  // key and route are deliberately NOT editable. They are live URLs: /shop/
  // <key> is canonical, indexed and linked from every panel's View-all, and
  // renaming a category should change what it is CALLED, not silently break
  // every link to it.
  const taxonomy = await prisma.taxonomy.update({ where: { id: existing.id }, data });
  navChanged();
  await logEvent({ category: "admin", message: `Updated navigation category "${taxonomy.label}"`, actorId: req.user.id });
  res.json({ taxonomy });
});

// Deleting a taxonomy cascades to its nodes, and through them to the
// ProductTaxonomy rows tagging products with it — so it is blocked while it
// still holds anything, exactly as deleting a node with children is. Hiding a
// category from the menu is what showInNav is for; this is for removing one
// that was created by mistake.
router.delete("/:taxonomyId", async (req, res) => {
  const taxonomy = await prisma.taxonomy.findUnique({
    where: { id: req.params.taxonomyId },
    include: { _count: { select: { nodes: true } } },
  });
  if (!taxonomy) return res.status(404).json({ error: "Category not found" });
  if (taxonomy._count.nodes > 0) {
    return res.status(409).json({ error: "Delete the items inside this category first" });
  }

  await prisma.taxonomy.delete({ where: { id: taxonomy.id } });
  navChanged();
  await logEvent({ category: "admin", message: `Deleted navigation category "${taxonomy.label}"`, actorId: req.user.id });
  res.json({ ok: true });
});

module.exports = router;
