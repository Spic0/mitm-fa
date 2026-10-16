// Admin CRUD for Partner Profiles.
//
// Mounted admin-only in routes/admin/index.js (requireAdmin), which is the
// real security boundary — nothing in this file re-checks the role, and
// nothing in it should be reachable any other way. The public half of this
// feature is the /partners/:slug renderer in routes/pages.js; the two share
// lib/partners.js and nothing else.
//
// Shape note: socials/links/products are edited as WHOLE COLLECTIONS
// (PUT-style replace inside a transaction) rather than per-row endpoints.
// The wizard edits them as ordered lists — reordering four links through
// per-row PATCHes is four requests that can half-apply, whereas one replace
// either takes or doesn't. Position is assigned server-side from array order,
// so the client never has to compute index numbers and they can't go sparse.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { prisma } = require("../../db");
const { logEvent } = require("../../lib/adminLog");
const { verifyUploadedFile } = require("../../lib/uploadVerify");
const { optimizeImageInPlace } = require("../../lib/imageOptimize");
const { generateDerivatives, invalidate: invalidateMedia } = require("../../lib/mediaDerivatives");
const { normalizeImageUrl } = require("../../lib/media");
const {
  PARTNER_TYPES,
  STATUSES,
  ACCENTS,
  LAYOUTS,
  SOCIAL_PLATFORMS,
  LINK_ICONS,
  LIMITS,
  PROFILE_INCLUDE,
  fail,
  uniqueSlug,
  validateUrl,
  validateLinkTarget,
  validateSocialUrl,
  cleanText,
  cleanHandle,
  buildPublicProfile,
} = require("../../lib/partners");

const router = express.Router();

const SITE_ROOT = path.join(__dirname, "..", "..", "..", "..");
// Avatars live alongside product uploads rather than in a new directory: the
// same static mount, the same cache headers, and — the load-bearing part —
// the same derivative pipeline and lib/media.js resolution already work for
// anything under here with no new special-casing.
const AVATAR_DIR = path.join(SITE_ROOT, "assets", "images", "product", "uploads");
const AVATAR_PUBLIC_BASE = "assets/images/product/uploads";
const MAX_AVATAR_BYTES = 10 * 1024 * 1024;
fs.mkdirSync(AVATAR_DIR, { recursive: true });

const AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const GENERIC_DECLARED_TYPES = new Set([
  "", "application/octet-stream", "binary/octet-stream", "application/x-empty",
]);

// SVG is deliberately NOT accepted for an avatar, unlike a product cover.
// A profile picture has no legitimate vector use case here, and every SVG on
// this site has to carry a sanitizer plus a sandboxed CSP just to be safe to
// serve — not a surface worth opening for a headshot.
const avatarUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, AVATAR_DIR),
    filename: (req, file, cb) => {
      const ext = ((file.mimetype || "").split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "");
      cb(null, `${crypto.randomUUID()}.${ext || "bin"}`);
    },
  }),
  limits: { fileSize: MAX_AVATAR_BYTES },
  fileFilter(req, file, cb) {
    const mime = (file.mimetype || "").toLowerCase().trim();
    if (!AVATAR_MIME.has(mime) && !GENERIC_DECLARED_TYPES.has(mime)) {
      const err = new Error("Profile image must be a PNG, JPG or WebP");
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
}).single("avatar");

// ---------------------------------------------------------------------
// Serialization
// ---------------------------------------------------------------------

function toClient(row) {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.displayName,
    handle: row.handle,
    partnerType: row.partnerType,
    bio: row.bio,
    avatarUrl: row.avatarUrl ? normalizeImageUrl(row.avatarUrl) : null,
    websiteUrl: row.websiteUrl,
    status: row.status,
    accent: row.accent,
    layout: row.layout,
    ctaLabel: row.ctaLabel,
    metaDescription: row.metaDescription,
    influencerId: row.influencerId,
    publicUrl: `/partners/${row.slug}`,
    publishedAt: row.publishedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    productCount: row._count ? row._count.products : (row.products || []).length,
    linkCount: row._count ? row._count.links : (row.links || []).length,
    socials: (row.socials || [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((s) => ({ platform: s.platform, url: s.url })),
    links: (row.links || [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((l) => ({
        id: l.id,
        title: l.title,
        url: l.url,
        description: l.description,
        icon: l.icon,
        featured: l.featured,
      })),
    products: (row.products || [])
      .slice()
      .sort((a, b) => a.position - b.position)
      .map((pp) => ({
        productId: pp.productId,
        featured: pp.featured,
        // Product fields are included for the admin table/preview only. They
        // are read live through the relation on every request and never
        // written back to a Partner row — the profile owns no product data.
        name: pp.product ? pp.product.name : null,
        slug: pp.product ? pp.product.slug : null,
        priceCents: pp.product ? pp.product.priceCents : null,
        imageUrl: pp.product && pp.product.imageUrl ? normalizeImageUrl(pp.product.imageUrl) : null,
        creator: pp.product ? pp.product.creator : null,
        status: pp.product ? pp.product.status : null,
      })),
  };
}

// ---------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------

function validateCore(body, { partial } = { partial: false }) {
  const data = {};

  if (!partial || body.displayName !== undefined) {
    data.displayName = cleanText(body.displayName, LIMITS.displayName, {
      field: "Partner name",
      required: true,
    });
  }
  if (body.handle !== undefined) data.handle = cleanHandle(body.handle);
  if (body.bio !== undefined) data.bio = cleanText(body.bio, LIMITS.bio, { field: "Bio" });
  if (body.ctaLabel !== undefined) data.ctaLabel = cleanText(body.ctaLabel, LIMITS.ctaLabel, { field: "CTA label" });
  if (body.metaDescription !== undefined) {
    data.metaDescription = cleanText(body.metaDescription, LIMITS.metaDescription, { field: "Meta description" });
  }

  if (body.partnerType !== undefined) {
    if (!PARTNER_TYPES.has(body.partnerType)) fail("Invalid partner type");
    data.partnerType = body.partnerType;
  }
  if (body.accent !== undefined) {
    if (!ACCENTS.has(body.accent)) fail("Invalid accent");
    data.accent = body.accent;
  }
  if (body.layout !== undefined) {
    if (!LAYOUTS.has(body.layout)) fail("Invalid layout");
    data.layout = body.layout;
  }
  if (body.status !== undefined) {
    if (!STATUSES.has(body.status)) fail("Invalid status");
    data.status = body.status;
  }
  if (body.websiteUrl !== undefined) {
    data.websiteUrl = body.websiteUrl ? validateUrl(body.websiteUrl, { field: "Website" }) : null;
  }
  return data;
}

function validateSocials(input) {
  if (!Array.isArray(input)) fail("Social links must be a list");
  const seen = new Set();
  const rows = [];
  input.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const platform = String(raw.platform || "").toLowerCase().trim();
    // An empty URL is how the wizard says "this platform isn't configured".
    // Skipping rather than erroring is what keeps "do not show empty social
    // icons" true without the admin having to delete rows.
    if (!platform || !String(raw.url || "").trim()) return;
    if (!SOCIAL_PLATFORMS.has(platform)) fail(`"${platform}" is not a supported social platform`);
    if (seen.has(platform)) fail(`Two ${SOCIAL_PLATFORMS.get(platform).label} links were provided`);
    seen.add(platform);
    rows.push({ platform, url: validateSocialUrl(platform, raw.url), position: i });
  });
  return rows;
}

function validateLinks(input) {
  if (!Array.isArray(input)) fail("Custom links must be a list");
  if (input.length > 25) fail("A profile can have at most 25 custom links");
  const rows = [];
  input.forEach((raw, i) => {
    if (!raw || typeof raw !== "object") return;
    const title = cleanText(raw.title, LIMITS.linkTitle, { field: "Link title" });
    const url = String(raw.url || "").trim();
    // Both blank = an empty row the admin never filled in; drop it silently.
    if (!title && !url) return;
    if (!title) fail("Every custom link needs a title");
    if (!url) fail(`"${title}" needs a URL`);
    const icon = raw.icon && LINK_ICONS.has(raw.icon) ? raw.icon : null;
    rows.push({
      title,
      url: validateLinkTarget(url, { field: title }),
      description: cleanText(raw.description, LIMITS.linkDescription, { field: "Link description" }),
      icon,
      featured: !!raw.featured,
      position: i,
    });
  });
  // Exactly one link may be the featured/primary one — the design has a
  // single slot for it above the fold.
  let featuredSeen = false;
  rows.forEach((r) => {
    if (r.featured && featuredSeen) r.featured = false;
    if (r.featured) featuredSeen = true;
  });
  return rows;
}

async function validateProducts(input) {
  if (!Array.isArray(input)) fail("Products must be a list");
  if (input.length > 30) fail("A profile can feature at most 30 products");

  const rows = [];
  const seen = new Set();
  input.forEach((raw, i) => {
    const productId = typeof raw === "string" ? raw : raw && raw.productId;
    if (!productId) return;
    if (seen.has(productId)) return; // same product twice is always a mistake
    seen.add(productId);
    rows.push({ productId: String(productId), featured: !!(raw && raw.featured), position: i });
  });

  if (rows.length) {
    // Every referenced product must actually exist. Without this a typo'd or
    // stale id becomes a foreign-key error from Prisma at write time, which
    // surfaces to the admin as an opaque 500 instead of "that product is gone".
    const found = await prisma.product.findMany({
      where: { id: { in: rows.map((r) => r.productId) } },
      select: { id: true },
    });
    const alive = new Set(found.map((p) => p.id));
    const missing = rows.filter((r) => !alive.has(r.productId));
    if (missing.length) fail("One of the selected products no longer exists — remove it and try again");
  }

  let featuredSeen = false;
  rows.forEach((r) => {
    if (r.featured && featuredSeen) r.featured = false;
    if (r.featured) featuredSeen = true;
  });
  return rows;
}

// Replaces a partner's child collections inside one transaction. Delete-then-
// recreate rather than diffing: these are small, ordered, admin-authored
// lists where identity carries no meaning beyond position, so a diff would be
// more code defending a distinction nothing depends on.
async function replaceCollections(tx, partnerId, { socials, links, products }) {
  if (socials) {
    await tx.partnerSocial.deleteMany({ where: { partnerId } });
    if (socials.length) await tx.partnerSocial.createMany({ data: socials.map((s) => ({ ...s, partnerId })) });
  }
  if (links) {
    await tx.partnerLink.deleteMany({ where: { partnerId } });
    if (links.length) await tx.partnerLink.createMany({ data: links.map((l) => ({ ...l, partnerId })) });
  }
  if (products) {
    await tx.partnerProduct.deleteMany({ where: { partnerId } });
    if (products.length) await tx.partnerProduct.createMany({ data: products.map((p) => ({ ...p, partnerId })) });
  }
}

function loadPartner(id) {
  return prisma.partner.findUnique({ where: { id }, include: PROFILE_INCLUDE });
}

// ---------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------

router.get("/", async (req, res) => {
  const search = String(req.query.search || "").trim();
  const status = String(req.query.status || "").trim();

  const where = {};
  if (search) {
    where.OR = [
      { displayName: { contains: search, mode: "insensitive" } },
      { slug: { contains: search, mode: "insensitive" } },
      { handle: { contains: search, mode: "insensitive" } },
    ];
  }
  if (status && STATUSES.has(status)) where.status = status;

  const partners = await prisma.partner.findMany({
    where,
    include: { _count: { select: { products: true, links: true } } },
    orderBy: { updatedAt: "desc" },
  });
  res.json({ partners: partners.map(toClient) });
});

// The product picker for wizard step 3. Only published products are
// offerable: a profile that features a draft would render a card the
// visitor cannot buy, and every other public surface already filters the
// same way.
router.get("/product-options", async (req, res) => {
  const search = String(req.query.search || "").trim();
  const products = await prisma.product.findMany({
    where: {
      status: "published",
      ...(search ? { OR: [
        { name: { contains: search, mode: "insensitive" } },
        { creator: { contains: search, mode: "insensitive" } },
      ] } : {}),
    },
    select: { id: true, slug: true, name: true, creator: true, priceCents: true, imageUrl: true },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({
    products: products.map((p) => ({ ...p, imageUrl: p.imageUrl ? normalizeImageUrl(p.imageUrl) : null })),
  });
});

router.get("/:id", async (req, res) => {
  const partner = await loadPartner(req.params.id);
  if (!partner) return res.status(404).json({ error: "Partner not found" });
  res.json({ partner: toClient(partner) });
});

// The exact payload the public page will render, without publishing it.
// Backs the wizard's live preview, so preview and production go through the
// same buildPublicProfile() — a preview that used its own shaping code would
// be a second renderer to keep in step, which is the bug this codebase has
// hit repeatedly with product media.
router.get("/:id/preview", async (req, res) => {
  const partner = await loadPartner(req.params.id);
  if (!partner) return res.status(404).json({ error: "Partner not found" });
  res.json({ profile: buildPublicProfile(partner) });
});

router.post("/", async (req, res) => {
  const body = req.body || {};
  const core = validateCore(body, { partial: false });
  const slug = await uniqueSlug(prisma, body.slug || core.displayName);

  const socials = body.socials !== undefined ? validateSocials(body.socials) : [];
  const links = body.links !== undefined ? validateLinks(body.links) : [];
  const products = body.products !== undefined ? await validateProducts(body.products) : [];

  const created = await prisma.$transaction(async (tx) => {
    const partner = await tx.partner.create({
      data: {
        ...core,
        slug,
        // A brand-new profile is always a draft, whatever the client sent.
        // Publishing is a separate, explicit action.
        status: "draft",
        publishedAt: null,
      },
    });
    await replaceCollections(tx, partner.id, { socials, links, products });
    return partner;
  });

  await logEvent({
    category: "partner",
    message: `Created partner profile "${created.displayName}" (/partners/${created.slug})`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { partnerId: created.id, action: "created" },
  });

  res.status(201).json({ partner: toClient(await loadPartner(created.id)) });
});

router.patch("/:id", async (req, res) => {
  const existing = await prisma.partner.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Partner not found" });

  const body = req.body || {};
  const core = validateCore(body, { partial: true });

  // A slug change is a URL change for something that may already be indexed
  // and shared, so it only happens when explicitly sent — never as a
  // side-effect of renaming the partner.
  if (body.slug !== undefined && String(body.slug).trim()) {
    core.slug = await uniqueSlug(prisma, body.slug, existing.id);
  }

  // publishedAt records the FIRST publish and is not moved by later edits —
  // it is the profile's age, not its last-modified time (updatedAt is that).
  if (core.status === "published" && !existing.publishedAt) core.publishedAt = new Date();

  const socials = body.socials !== undefined ? validateSocials(body.socials) : null;
  const links = body.links !== undefined ? validateLinks(body.links) : null;
  const products = body.products !== undefined ? await validateProducts(body.products) : null;

  await prisma.$transaction(async (tx) => {
    await tx.partner.update({ where: { id: existing.id }, data: core });
    await replaceCollections(tx, existing.id, { socials, links, products });
  });

  const partner = await loadPartner(existing.id);
  await logEvent({
    category: "partner",
    message: `Updated partner profile "${partner.displayName}"`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { partnerId: partner.id, action: "updated" },
  });
  res.json({ partner: toClient(partner) });
});

// Publish / unpublish / archive as explicit verbs rather than a status field
// the client sets. Each one is a distinct decision with its own audit line,
// and "unpublish" must not be reachable by fat-fingering a dropdown.
function statusRoute(action, nextStatus, verb) {
  router.post(`/:id/${action}`, async (req, res) => {
    const existing = await prisma.partner.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Partner not found" });

    if (nextStatus === "published") {
      // Refuse to publish something that would render as an empty page. This
      // is the one place the "is this profile complete" question is asked
      // with authority — the wizard's step indicators are a UI convenience.
      if (!existing.displayName || !existing.slug) {
        return res.status(400).json({ error: "A profile needs a name and a URL before it can be published" });
      }
    }

    const data = { status: nextStatus };
    if (nextStatus === "published" && !existing.publishedAt) data.publishedAt = new Date();

    await prisma.partner.update({ where: { id: existing.id }, data });
    await logEvent({
      category: "partner",
      message: `${verb} partner profile "${existing.displayName}" (/partners/${existing.slug})`,
      actorId: req.user.id,
      ip: req.ip,
      metadata: { partnerId: existing.id, action },
    });
    res.json({ partner: toClient(await loadPartner(existing.id)) });
  });
}
statusRoute("publish", "published", "Published");
statusRoute("unpublish", "draft", "Unpublished");
statusRoute("archive", "archived", "Archived");

router.delete("/:id", async (req, res) => {
  const existing = await prisma.partner.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Partner not found" });

  // Child rows cascade at the database level (see schema.prisma), so this is
  // one statement and cannot leave orphans behind.
  await prisma.partner.delete({ where: { id: existing.id } });
  await logEvent({
    category: "partner",
    message: `Deleted partner profile "${existing.displayName}"`,
    actorId: req.user.id,
    ip: req.ip,
    metadata: { partnerId: existing.id, action: "deleted" },
  });
  res.json({ ok: true });
});

// Avatar upload. Same two-stage pattern as every other image on the site:
// multer writes it, then the bytes are sniffed for real content type before
// anything is allowed to reference the file, then derivatives are cut so the
// profile header can serve a 320w AVIF instead of the original.
router.post("/:id/avatar", (req, res) => {
  avatarUpload(req, res, async (err) => {
    if (err) {
      if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: `That image is too large. The limit is ${Math.round(MAX_AVATAR_BYTES / (1024 * 1024))}MB.`,
        });
      }
      return res.status(err.status || 400).json({ error: err.message || "Upload failed" });
    }
    if (!req.file) return res.status(400).json({ error: "No image was uploaded" });

    const partner = await prisma.partner.findUnique({ where: { id: req.params.id } });
    if (!partner) {
      await fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(404).json({ error: "Partner not found" });
    }

    const result = await verifyUploadedFile(req.file.path, AVATAR_MIME);
    if (!result.ok) {
      // verifyUploadedFile deletes the file itself on failure.
      return res.status(400).json({ error: result.reason || "That file is not a valid image" });
    }

    const finalName = `${path.basename(req.file.filename, path.extname(req.file.filename))}.${result.ext}`;
    const finalPath = path.join(AVATAR_DIR, finalName);
    await fs.promises.rename(req.file.path, finalPath);

    await optimizeImageInPlace(finalPath, result.mime);
    await generateDerivatives(finalPath, result.mime, AVATAR_PUBLIC_BASE);
    invalidateMedia(finalPath);

    const avatarUrl = `${AVATAR_PUBLIC_BASE}/${finalName}`;
    await prisma.partner.update({ where: { id: partner.id }, data: { avatarUrl } });

    await logEvent({
      category: "partner",
      message: `Updated profile image for "${partner.displayName}"`,
      actorId: req.user.id,
      ip: req.ip,
      metadata: { partnerId: partner.id, action: "avatar" },
    });

    res.json({ partner: toClient(await loadPartner(partner.id)) });
  });
});

module.exports = router;
