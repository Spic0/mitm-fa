const express = require("express");
const { prisma } = require("../../db");
const { logEvent } = require("../../lib/adminLog");
const { getAllTaxonomyTrees, uniqueSlugForNode } = require("../../lib/taxonomy");

const router = express.Router();

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
  await logEvent({ category: "admin", message: `Deleted taxonomy item "${node.name}"`, actorId: req.user.id });
  res.json({ ok: true });
});

module.exports = router;
