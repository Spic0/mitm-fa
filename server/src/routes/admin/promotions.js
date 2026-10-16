const express = require("express");
const { prisma } = require("../../db");
const { logEvent } = require("../../lib/adminLog");
const { normalizeCode } = require("../../lib/promotions");
const { getPromotionStats } = require("../../lib/promotionStats");
const { requirePromotionView, requirePromotionManage } = require("../../middleware/auth");

const router = express.Router();

const DISCOUNT_TYPES = new Set(["PERCENTAGE", "FIXED_AMOUNT", "FREE_PRODUCT"]);
const CODE_KINDS = new Set(["STANDARD", "AFFILIATE", "INFLUENCER", "CAMPAIGN"]);
const STATUSES = new Set(["enabled", "paused", "disabled"]);
const SORTABLE_FIELDS = new Set(["createdAt", "code", "name", "expiresAt"]);

function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Shared shape/type validation for create + update — throws a plain Error
// with a user-facing message on the first problem found.
function validatePayload(body, { partial } = { partial: false }) {
  const data = {};

  if (!partial || body.code !== undefined) {
    const code = normalizeCode(body.code);
    if (!code) throw new Error("Code is required");
    data.code = code;
  }
  if (!partial || body.name !== undefined) {
    const name = String(body.name || "").trim();
    if (!name) throw new Error("Name is required");
    data.name = name;
  }
  if (body.description !== undefined) data.description = body.description ? String(body.description) : null;

  if (!partial || body.discountType !== undefined) {
    if (!DISCOUNT_TYPES.has(body.discountType)) throw new Error("Invalid discount type");
    data.discountType = body.discountType;
  }
  const discountType = data.discountType || body.existingDiscountType;
  if (!partial || body.discountValue !== undefined) {
    const value = Number(body.discountValue);
    if (discountType !== "FREE_PRODUCT") {
      if (!Number.isFinite(value) || value < 0) throw new Error("Discount value must be a positive number");
      if (discountType === "PERCENTAGE" && value > 100) throw new Error("Percentage discount can't exceed 100");
    }
    data.discountValue = Number.isFinite(value) ? Math.round(value) : 0;
  }
  if (body.freeProductId !== undefined) data.freeProductId = body.freeProductId || null;

  if (body.codeKind !== undefined) {
    if (!CODE_KINDS.has(body.codeKind)) throw new Error("Invalid code kind");
    data.codeKind = body.codeKind;
  }

  // Direct status writes (as opposed to the dedicated pause/resume routes,
  // which only ever move between "enabled" and "paused") are what let the
  // Setup Wizard create a draft as "disabled" and flip it live on publish —
  // mirroring how the Product wizard's own status field works.
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) throw new Error("Invalid status");
    data.status = body.status;
  }

  if (body.maxUses !== undefined) data.maxUses = body.maxUses === null || body.maxUses === "" ? null : Math.max(0, parseInt(body.maxUses, 10));
  if (body.maxUsesPerCustomer !== undefined)
    data.maxUsesPerCustomer = body.maxUsesPerCustomer === null || body.maxUsesPerCustomer === "" ? null : Math.max(0, parseInt(body.maxUsesPerCustomer, 10));
  if (body.minSpendCents !== undefined) data.minSpendCents = body.minSpendCents === null || body.minSpendCents === "" ? null : Math.max(0, parseInt(body.minSpendCents, 10));
  if (body.maxDiscountCents !== undefined) data.maxDiscountCents = body.maxDiscountCents === null || body.maxDiscountCents === "" ? null : Math.max(0, parseInt(body.maxDiscountCents, 10));

  if (body.firstPurchaseOnly !== undefined) data.firstPurchaseOnly = Boolean(body.firstPurchaseOnly);
  if (body.singleUse !== undefined) data.singleUse = Boolean(body.singleUse);
  if (body.stackable !== undefined) data.stackable = Boolean(body.stackable);
  if (body.autoApply !== undefined) data.autoApply = Boolean(body.autoApply);

  if (body.activatesAt !== undefined) data.activatesAt = parseDate(body.activatesAt);
  if (body.expiresAt !== undefined) data.expiresAt = parseDate(body.expiresAt);
  if (body.timezone !== undefined) data.timezone = String(body.timezone || "UTC");

  if (body.influencerId !== undefined) data.influencerId = body.influencerId || null;

  return data;
}

function serializePromotion(promotion) {
  const uses = promotion._count?.redemptions ?? promotion.redemptions?.length ?? 0;
  const revenueCents = (promotion.redemptions || []).reduce((sum, r) => sum + (r.order?.totalCents || 0), 0);
  const lastUsedAt = (promotion.redemptions || []).reduce((max, r) => (!max || r.createdAt > max ? r.createdAt : max), null);
  return {
    id: promotion.id,
    code: promotion.code,
    name: promotion.name,
    description: promotion.description,
    discountType: promotion.discountType,
    discountValue: promotion.discountValue,
    freeProductId: promotion.freeProductId,
    codeKind: promotion.codeKind,
    maxUses: promotion.maxUses,
    maxUsesPerCustomer: promotion.maxUsesPerCustomer,
    minSpendCents: promotion.minSpendCents,
    maxDiscountCents: promotion.maxDiscountCents,
    firstPurchaseOnly: promotion.firstPurchaseOnly,
    singleUse: promotion.singleUse,
    stackable: promotion.stackable,
    autoApply: promotion.autoApply,
    activatesAt: promotion.activatesAt,
    expiresAt: promotion.expiresAt,
    timezone: promotion.timezone,
    status: promotion.status,
    createdBy: promotion.createdBy ? { id: promotion.createdBy.id, email: promotion.createdBy.email } : null,
    influencer: promotion.influencer ? { id: promotion.influencer.id, name: promotion.influencer.name, type: promotion.influencer.type } : null,
    createdAt: promotion.createdAt,
    updatedAt: promotion.updatedAt,
    uses,
    revenueCents,
    lastUsedAt,
    products: (promotion.products || []).map((p) => p.productId),
    categories: (promotion.categories || []).map((c) => c.taxonomyNodeId),
    users: (promotion.users || []).map((u) => u.userId),
    userEmails: (promotion.users || []).map((u) => u.user?.email).filter(Boolean),
  };
}

const LIST_INCLUDE = {
  createdBy: true,
  influencer: true,
  _count: { select: { redemptions: true } },
  redemptions: { select: { discountCents: true, createdAt: true, order: { select: { totalCents: true } } } },
  products: true,
  categories: true,
  users: { include: { user: true } },
};

router.get("/", requirePromotionView, async (req, res) => {
  const page = Math.max(1, parseInt(req.query.page, 10) || 1);
  const pageSize = Math.min(100, Math.max(1, parseInt(req.query.pageSize, 10) || 20));
  const sortBy = SORTABLE_FIELDS.has(req.query.sortBy) ? req.query.sortBy : "createdAt";
  const sortDir = req.query.sortDir === "asc" ? "asc" : "desc";
  const search = String(req.query.search || "").trim();

  const where = {
    AND: [
      req.query.status ? { status: req.query.status } : {},
      req.query.codeKind ? { codeKind: req.query.codeKind } : {},
      req.query.influencerId ? { influencerId: req.query.influencerId } : {},
      search
        ? {
            OR: [
              { code: { contains: search, mode: "insensitive" } },
              { name: { contains: search, mode: "insensitive" } },
            ],
          }
        : {},
    ],
  };

  const [total, promotions] = await Promise.all([
    prisma.promotion.count({ where }),
    prisma.promotion.findMany({
      where,
      include: LIST_INCLUDE,
      orderBy: { [sortBy]: sortDir },
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
  ]);

  res.json({ total, page, pageSize, promotions: promotions.map(serializePromotion) });
});

router.get("/:id", requirePromotionView, async (req, res) => {
  const promotion = await prisma.promotion.findUnique({ where: { id: req.params.id }, include: LIST_INCLUDE });
  if (!promotion) return res.status(404).json({ error: "Promotion not found" });
  res.json({ promotion: serializePromotion(promotion) });
});

// Lazy — only queried when the admin actually opens the stats drawer, never
// on list load (see server/src/lib/promotionStats.js).
router.get("/:id/analytics", requirePromotionView, async (req, res) => {
  const stats = await getPromotionStats(req.params.id);
  if (!stats) return res.status(404).json({ error: "Promotion not found" });
  res.json({ stats });
});

router.get("/:id/audit-log", requirePromotionView, async (req, res) => {
  const logs = await prisma.systemLog.findMany({
    where: { category: "promotion", metadata: { contains: req.params.id } },
    include: { actor: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({
    logs: logs.map((l) => ({
      id: l.id,
      message: l.message,
      actorEmail: l.actor?.email || null,
      ip: l.ip,
      createdAt: l.createdAt,
    })),
  });
});

// The "Specific Users" picker is email-based in the admin UI (no user-search
// widget exists to reuse) — resolved to ids here so the rest of the app only
// ever deals in ids.
async function resolveUserEmailsToIds(emails) {
  if (!emails || !emails.length) return [];
  const users = await prisma.user.findMany({
    where: { email: { in: emails.map((e) => String(e).trim().toLowerCase()) } },
    select: { id: true },
  });
  return users.map((u) => u.id);
}

async function setRelations(data, body) {
  if (body.productIds !== undefined) data.products = { create: (body.productIds || []).map((id) => ({ productId: id })) };
  if (body.categoryIds !== undefined) data.categories = { create: (body.categoryIds || []).map((id) => ({ taxonomyNodeId: id })) };
  if (body.userEmails !== undefined) {
    const ids = await resolveUserEmailsToIds(body.userEmails);
    data.users = { create: ids.map((id) => ({ userId: id })) };
  } else if (body.userIds !== undefined) {
    data.users = { create: (body.userIds || []).map((id) => ({ userId: id })) };
  }
}

router.post("/", requirePromotionManage, async (req, res) => {
  const data = validatePayload(req.body, { partial: false });
  data.createdById = req.user.id;
  await setRelations(data, req.body);

  try {
    const promotion = await prisma.promotion.create({ data, include: LIST_INCLUDE });
    await logEvent({
      category: "promotion",
      message: `Created promotion "${promotion.name}" (${promotion.code})`,
      actorId: req.user.id,
      ip: req.ip,
      metadata: { promotionId: promotion.id, action: "created" },
    });
    res.status(201).json({ promotion: serializePromotion(promotion) });
  } catch (err) {
    if (err.code === "P2002") return res.status(409).json({ error: "A promotion with this code already exists" });
    throw err;
  }
});

router.patch("/:id", requirePromotionManage, async (req, res) => {
  const existing = await prisma.promotion.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Promotion not found" });

  const data = validatePayload({ ...req.body, existingDiscountType: existing.discountType }, { partial: true });

  // Eligibility relations are wholesale-replaced rather than diffed — these
  // lists are short (a handful of products/categories/users per promotion),
  // so delete-then-recreate inside one transaction is simpler than computing
  // an add/remove diff and just as correct.
  const changes = [];
  if (data.discountValue !== undefined && data.discountValue !== existing.discountValue) changes.push("discount");
  if ((data.discountType || existing.discountType) !== existing.discountType) changes.push("discount type");
  if (req.body.influencerId !== undefined && req.body.influencerId !== existing.influencerId) changes.push("commission/influencer");

  await setRelations(data, req.body);
  const promotion = await prisma.$transaction(async (tx) => {
    if (req.body.productIds !== undefined) await tx.promotionProduct.deleteMany({ where: { promotionId: existing.id } });
    if (req.body.categoryIds !== undefined) await tx.promotionCategory.deleteMany({ where: { promotionId: existing.id } });
    if (req.body.userIds !== undefined || req.body.userEmails !== undefined) await tx.promotionUser.deleteMany({ where: { promotionId: existing.id } });
    return tx.promotion.update({ where: { id: existing.id }, data, include: LIST_INCLUDE });
  });

  await logEvent({
    category: "promotion",
    message: `Updated promotion "${promotion.name}" (${promotion.code})${changes.length ? ` — changed: ${changes.join(", ")}` : ""}`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { promotionId: promotion.id, action: "updated", changes },
  });
  res.json({ promotion: serializePromotion(promotion) });
});

router.post("/:id/clone", requirePromotionManage, async (req, res) => {
  const existing = await prisma.promotion.findUnique({
    where: { id: req.params.id },
    include: { products: true, categories: true, users: true },
  });
  if (!existing) return res.status(404).json({ error: "Promotion not found" });

  let cloneCode = `${existing.code}-COPY`;
  let suffix = 1;
  while (await prisma.promotion.findUnique({ where: { code: cloneCode } })) {
    suffix += 1;
    cloneCode = `${existing.code}-COPY${suffix}`;
  }

  const clone = await prisma.promotion.create({
    data: {
      code: cloneCode,
      name: `${existing.name} (Copy)`,
      description: existing.description,
      discountType: existing.discountType,
      discountValue: existing.discountValue,
      freeProductId: existing.freeProductId,
      codeKind: existing.codeKind,
      maxUses: existing.maxUses,
      maxUsesPerCustomer: existing.maxUsesPerCustomer,
      minSpendCents: existing.minSpendCents,
      maxDiscountCents: existing.maxDiscountCents,
      firstPurchaseOnly: existing.firstPurchaseOnly,
      singleUse: existing.singleUse,
      stackable: existing.stackable,
      autoApply: false, // never clone straight into a live auto-apply slot
      activatesAt: existing.activatesAt,
      expiresAt: existing.expiresAt,
      timezone: existing.timezone,
      status: "disabled", // clones start disabled — an admin must deliberately re-enable
      createdById: req.user.id,
      influencerId: existing.influencerId,
      products: { create: existing.products.map((p) => ({ productId: p.productId })) },
      categories: { create: existing.categories.map((c) => ({ taxonomyNodeId: c.taxonomyNodeId })) },
      users: { create: existing.users.map((u) => ({ userId: u.userId })) },
    },
    include: LIST_INCLUDE,
  });

  await logEvent({
    category: "promotion",
    message: `Cloned promotion "${existing.name}" (${existing.code}) as "${clone.code}"`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { promotionId: clone.id, action: "created", clonedFrom: existing.id },
  });
  res.status(201).json({ promotion: serializePromotion(clone) });
});

router.post("/:id/pause", requirePromotionView, async (req, res) => {
  const existing = await prisma.promotion.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Promotion not found" });
  const promotion = await prisma.promotion.update({ where: { id: existing.id }, data: { status: "paused" }, include: LIST_INCLUDE });
  await logEvent({
    category: "promotion",
    message: `Paused promotion "${promotion.name}" (${promotion.code})`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { promotionId: promotion.id, action: "paused" },
  });
  res.json({ promotion: serializePromotion(promotion) });
});

router.post("/:id/resume", requirePromotionView, async (req, res) => {
  const existing = await prisma.promotion.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Promotion not found" });
  const promotion = await prisma.promotion.update({ where: { id: existing.id }, data: { status: "enabled" }, include: LIST_INCLUDE });
  await logEvent({
    category: "promotion",
    message: `Activated promotion "${promotion.name}" (${promotion.code})`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { promotionId: promotion.id, action: "activated" },
  });
  res.json({ promotion: serializePromotion(promotion) });
});

router.post("/:id/expire", requirePromotionManage, async (req, res) => {
  const existing = await prisma.promotion.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Promotion not found" });
  const promotion = await prisma.promotion.update({ where: { id: existing.id }, data: { expiresAt: new Date() }, include: LIST_INCLUDE });
  await logEvent({
    category: "promotion",
    message: `Expired promotion "${promotion.name}" (${promotion.code}) immediately`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { promotionId: promotion.id, action: "expired" },
  });
  res.json({ promotion: serializePromotion(promotion) });
});

router.delete("/:id", requirePromotionManage, async (req, res) => {
  const existing = await prisma.promotion.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Promotion not found" });

  try {
    await prisma.promotion.delete({ where: { id: existing.id } });
  } catch (err) {
    // Redemption ledger rows reference this promotion with no cascade —
    // deleting a promotion that has real order history attached would
    // either silently orphan revenue attribution or (as here) simply fail;
    // disabling it is the correct action once it's actually been used.
    if (err.code === "P2003") {
      return res.status(409).json({ error: "This promotion has been used and can't be deleted — disable it instead." });
    }
    throw err;
  }

  await logEvent({
    category: "promotion",
    message: `Deleted promotion "${existing.name}" (${existing.code})`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { promotionId: existing.id, action: "deleted" },
  });
  res.json({ ok: true });
});

module.exports = router;
