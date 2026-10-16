const express = require("express");
const { prisma } = require("../../db");
const { logEvent } = require("../../lib/adminLog");
const { requirePromotionView, requirePromotionManage } = require("../../middleware/auth");

const router = express.Router();

const TYPES = new Set(["influencer", "athlete", "creator", "affiliate"]);
const COMMISSION_TYPES = new Set(["percentage", "fixed"]);

function serialize(influencer) {
  return {
    id: influencer.id,
    name: influencer.name,
    email: influencer.email,
    type: influencer.type,
    commissionPct: influencer.commissionPct,
    commissionType: influencer.commissionType,
    commissionFixedCents: influencer.commissionFixedCents,
    paymentRef: influencer.paymentRef,
    notes: influencer.notes,
    promotionCount: influencer._count?.promotions ?? undefined,
    createdAt: influencer.createdAt,
    updatedAt: influencer.updatedAt,
  };
}

function validatePayload(body, { partial } = { partial: false }) {
  const data = {};
  if (!partial || body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) throw new Error("Name is required");
    data.name = name;
  }
  if (body.email !== undefined) data.email = body.email ? String(body.email).trim().toLowerCase() : null;
  if (!partial || body.type !== undefined) {
    if (!TYPES.has(body.type)) throw new Error("Invalid influencer type");
    data.type = body.type;
  }
  if (body.commissionType !== undefined) {
    if (body.commissionType && !COMMISSION_TYPES.has(body.commissionType)) throw new Error("Invalid commission type");
    data.commissionType = body.commissionType || null;
  }
  if (body.commissionPct !== undefined) data.commissionPct = body.commissionPct === null || body.commissionPct === "" ? null : Number(body.commissionPct);
  if (body.commissionFixedCents !== undefined)
    data.commissionFixedCents = body.commissionFixedCents === null || body.commissionFixedCents === "" ? null : Math.round(Number(body.commissionFixedCents));
  if (body.paymentRef !== undefined) data.paymentRef = body.paymentRef ? String(body.paymentRef) : null;
  if (body.notes !== undefined) data.notes = body.notes ? String(body.notes) : null;
  return data;
}

router.get("/", requirePromotionView, async (req, res) => {
  const search = String(req.query.search || "").trim();
  const influencers = await prisma.influencer.findMany({
    where: search
      ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { email: { contains: search, mode: "insensitive" } }] }
      : undefined,
    include: { _count: { select: { promotions: true } } },
    orderBy: { name: "asc" },
  });
  res.json({ influencers: influencers.map(serialize) });
});

router.get("/:id", requirePromotionView, async (req, res) => {
  const influencer = await prisma.influencer.findUnique({ where: { id: req.params.id }, include: { _count: { select: { promotions: true } } } });
  if (!influencer) return res.status(404).json({ error: "Influencer not found" });
  res.json({ influencer: serialize(influencer) });
});

router.post("/", requirePromotionManage, async (req, res) => {
  const data = validatePayload(req.body, { partial: false });
  const influencer = await prisma.influencer.create({ data });
  await logEvent({
    category: "promotion",
    message: `Created influencer "${influencer.name}" (${influencer.type})`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { influencerId: influencer.id, action: "created" },
  });
  res.status(201).json({ influencer: serialize(influencer) });
});

router.patch("/:id", requirePromotionManage, async (req, res) => {
  const existing = await prisma.influencer.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Influencer not found" });

  const data = validatePayload(req.body, { partial: true });
  const commissionChanged =
    (data.commissionPct !== undefined && data.commissionPct !== existing.commissionPct) ||
    (data.commissionType !== undefined && data.commissionType !== existing.commissionType) ||
    (data.commissionFixedCents !== undefined && data.commissionFixedCents !== existing.commissionFixedCents);

  const influencer = await prisma.influencer.update({ where: { id: existing.id }, data });
  await logEvent({
    category: "promotion",
    message: `Updated influencer "${influencer.name}"${commissionChanged ? " — commission changed" : ""}`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { influencerId: influencer.id, action: "updated", commissionChanged },
  });
  res.json({ influencer: serialize(influencer) });
});

router.delete("/:id", requirePromotionManage, async (req, res) => {
  const existing = await prisma.influencer.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Influencer not found" });
  try {
    await prisma.influencer.delete({ where: { id: existing.id } });
  } catch (err) {
    if (err.code === "P2003") {
      return res.status(409).json({ error: "This influencer has promotions attached — remove those first" });
    }
    throw err;
  }
  await logEvent({
    category: "promotion",
    message: `Deleted influencer "${existing.name}"`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { influencerId: existing.id, action: "deleted" },
  });
  res.json({ ok: true });
});

module.exports = router;
