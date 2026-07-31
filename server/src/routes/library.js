const express = require("express");
const fs = require("fs");
const path = require("path");
const { prisma } = require("../db");
const { variantFileName } = require("../lib/animatedMedia");
const { requireAuth } = require("../middleware/auth");
const { hasEntitlement } = require("../lib/entitlements");
const { mintDownloadToken, verifyDownloadToken } = require("../lib/signedDownload");
const { apiLimiter } = require("../middleware/rateLimit");
const { logEvent } = require("../lib/adminLog");
const { normalizeImageUrl } = require("../lib/media");

const router = express.Router();
const RESOURCE_DIR = path.join(__dirname, "..", "..", "storage", "resources");
const MEDIA_DIR = path.join(__dirname, "..", "..", "storage", "media");

router.use(requireAuth);
router.use(apiLimiter);

// One row per distinct product ever purchased (so re-purchases still show a
// single library entry) — this is the "My Library" grid, linking into the
// gated in-platform program view rather than a file download.
router.get("/", async (req, res) => {
  const items = await prisma.orderItem.findMany({
    where: { order: { userId: req.user.id, status: "paid" } },
    include: { product: true, order: true },
    orderBy: { order: { createdAt: "desc" } },
  });

  const byProduct = new Map();
  for (const item of items) {
    if (!byProduct.has(item.productId)) {
      byProduct.set(item.productId, {
        product: {
          id: item.product.id,
          slug: item.product.slug,
          name: item.product.name,
          imageUrl: normalizeImageUrl(item.product.imageUrl),
          description: item.product.description,
          creator: item.product.creator,
          difficulty: item.product.difficulty,
          durationWeeks: item.product.durationWeeks,
        },
        purchasedAt: item.order.createdAt,
      });
    }
  }

  res.json({ library: [...byProduct.values()] });
});

router.get("/orders", async (req, res) => {
  const orders = await prisma.order.findMany({
    where: { userId: req.user.id, status: "paid" },
    include: { items: { include: { product: true } } },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    orders: orders.map((order) => ({
      id: order.id,
      provider: order.provider,
      totalCents: order.totalCents,
      createdAt: order.createdAt,
      items: order.items.map((item) => ({ name: item.product.name, priceCents: item.priceCents })),
    })),
  });
});

// The gated "open program" view: full structured content for a purchased
// product, rendered inside the platform instead of downloaded as a file.
//
// Customer Preview Mode: admins are allowed through without an entitlement
// (flagged with preview:true so the UI can show a "you're previewing" bar).
// This is the pre-ads QA path — the exact page a paying customer gets,
// including draft products that aren't purchasable yet.
router.get("/program/:productId", async (req, res) => {
  const { productId } = req.params;
  const product = await prisma.product.findFirst({
    where: { OR: [{ id: productId }, { slug: productId }] },
    include: {
      faqs: { orderBy: { order: "asc" } },
      resources: { orderBy: { order: "asc" } },
      // Gallery ordering is admin-defined; `id` only breaks ties so two rows
      // sharing an order value don't shuffle between requests. `id` is also
      // what the client derives its stable "video:<id>" progress key from,
      // so it must be selected, unlike on the public product endpoint.
      media: {
        select: { id: true, url: true, type: true, alt: true },
        orderBy: [{ order: "asc" }, { id: "asc" }],
      },
      taxonomies: { include: { taxonomyNode: { select: { name: true } } } },
    },
  });
  if (!product) return res.status(404).json({ error: "Program not found" });

  const isAdmin = req.user.role === "admin";
  const entitled = await hasEntitlement(req.user.id, product.id);
  if (!entitled && !isAdmin) return res.status(403).json({ error: "You don't have access to this program" });

  const isPreview = isAdmin && !entitled;
  if (isPreview) {
    // Fire-and-forget: an audit-trail write must never slow down or fail
    // the actual preview request it's recording.
    logEvent({
      category: "admin",
      message: `Preview mode: opened "${product.name}" (status: ${product.status}) without a purchase`,
      metadata: { productId: product.id, productStatus: product.status },
      actorId: req.user.id,
    });
  }

  // The hero's "purchased on" / "owned since" line. Earliest paid order
  // containing this product — a re-purchase (or a gifted second copy) must
  // not make the customer look newer than they are.
  const firstOrder = isPreview
    ? null
    : await prisma.orderItem.findFirst({
        where: { productId: product.id, order: { userId: req.user.id, status: "paid" } },
        orderBy: { order: { createdAt: "asc" } },
        select: { order: { select: { createdAt: true } } },
      });

  // Progress is read before it's touched, so the hero can say "last opened
  // 3 days ago" on this very request rather than "just now" — opening the
  // program is exactly what's being recorded here. Admins previewing
  // without an entitlement never write progress: preview is a QA view of
  // someone else's experience, not their own.
  let progress = null;
  if (!isPreview) {
    const existing = await prisma.programProgress.findUnique({
      where: { userId_productId: { userId: req.user.id, productId: product.id } },
      select: { completedKeys: true, lastKey: true, lastSection: true, lastOpenedAt: true },
    });
    progress = existing || { completedKeys: [], lastKey: null, lastSection: null, lastOpenedAt: null };

    // Fire-and-forget: recording that the program was opened must never
    // delay or fail the render of the program itself.
    prisma.programProgress
      .upsert({
        where: { userId_productId: { userId: req.user.id, productId: product.id } },
        create: { userId: req.user.id, productId: product.id, lastOpenedAt: new Date() },
        update: { lastOpenedAt: new Date() },
      })
      .catch(() => {});
  }

  res.json({
    preview: isPreview,
    productStatus: product.status,
    purchasedAt: firstOrder ? firstOrder.order.createdAt : null,
    progress,
    product: {
      id: product.id,
      slug: product.slug,
      name: product.name,
      imageUrl: normalizeImageUrl(product.imageUrl),
      // Publication date — the anchor of the Updates timeline, which is
      // built from real timestamps rather than a changelog model.
      createdAt: product.createdAt,
      creator: product.creator,
      // Taxonomy replaced the old free-text Product.category; the leaf node
      // names are what the hero shows as topic chips.
      categories: (product.taxonomies || [])
        .map((t) => t.taxonomyNode && t.taxonomyNode.name)
        .filter(Boolean),
      difficulty: product.difficulty,
      durationWeeks: product.durationWeeks,
      overview: product.overview,
      trainingContent: product.trainingContent,
      nutritionContent: product.nutritionContent,
      bonusNotes: product.bonusNotes,
      faqs: product.faqs,
      media: (product.media || []).map((m) => ({
        id: m.id,
        url: normalizeImageUrl(m.url),
        type: m.type,
        alt: m.alt || product.name,
      })),
      resources: product.resources.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        type: r.type,
        createdAt: r.createdAt,
        url: r.type === "link" ? r.url : `/api/library/resource/${r.id}`,
      })),
    },
  });
});

// Progress write-back for the program view. The client owns the completed
// set (it's a few dozen keys at most) and PUTs the whole thing debounced,
// rather than the server maintaining it item by item — one upsert per
// change instead of a read-modify-write round trip per checkbox.
//
// Keys are opaque here on purpose: see the ProgramProgress comment in
// schema.prisma for why they're clamped rather than validated.
const MAX_KEYS = 600;
const MAX_KEY_LEN = 200;

function clampKeys(value) {
  if (!Array.isArray(value)) return null;
  const seen = new Set();
  for (const key of value) {
    if (typeof key !== "string" || !key) continue;
    seen.add(key.slice(0, MAX_KEY_LEN));
    if (seen.size >= MAX_KEYS) break;
  }
  return [...seen];
}

function clampField(value) {
  if (value == null) return null;
  return typeof value === "string" ? value.slice(0, MAX_KEY_LEN) : null;
}

router.put("/program/:productId/progress", async (req, res) => {
  const product = await prisma.product.findFirst({
    where: { OR: [{ id: req.params.productId }, { slug: req.params.productId }] },
    select: { id: true },
  });
  if (!product) return res.status(404).json({ error: "Program not found" });

  // Entitlement only — an admin previewing a program they don't own is
  // looking at the customer experience, not accruing progress of their own,
  // so this deliberately does not have the isAdmin escape hatch the read
  // path above has. The client treats the 403 as "don't sync", not an error.
  const entitled = await hasEntitlement(req.user.id, product.id);
  if (!entitled) return res.status(403).json({ error: "You don't have access to this program" });

  const completedKeys = clampKeys(req.body && req.body.completedKeys);
  const data = {
    lastKey: clampField(req.body && req.body.lastKey),
    lastSection: clampField(req.body && req.body.lastSection),
  };
  // Omitted (rather than empty) completedKeys means "position only" — a
  // section change shouldn't be able to wipe completions if the two
  // requests ever race.
  if (completedKeys) data.completedKeys = completedKeys;

  const saved = await prisma.programProgress.upsert({
    where: { userId_productId: { userId: req.user.id, productId: product.id } },
    create: { userId: req.user.id, productId: product.id, ...data },
    update: data,
    select: { completedKeys: true, lastKey: true, lastSection: true, lastOpenedAt: true },
  });

  res.json({ progress: saved });
});

// Exercise demo media (GIFs / short videos / images) uploaded through the
// admin product wizard. Stored under server/storage/media/<productId>/ and
// served only to entitled customers or admins — program media is part of the
// paid product, so it never lives in the public assets folder.
//
// This is the stable, permanent reference — the URL baked into
// Product.trainingContent at upload time (see admin/products.js) and never
// rewritten — so nothing else in the codebase needs to change. It does the
// real ownership check, then hands off a short-lived signed token rather
// than the bytes themselves: the actual file is only ever served from
// /download/media/:token below, which re-verifies ownership again at the
// moment it's used and expires automatically a few minutes later. A leaked
// link to *this* URL still requires a live, valid session to do anything;
// a leaked link to the *signed* URL it redirects to stops working shortly
// after it's issued even with a valid session.
// ?variant=poster asks for the still first frame (~19KB for a 15.5MB demo
// GIF), ?variant=anim for the width-capped animated WebP (~226KB). Anything
// else, including no variant at all, serves the original.
//
// Resolving by naming convention rather than by a stored URL is deliberate:
// the URL baked into Product.trainingContent at upload time is the stable,
// permanent reference and is never rewritten, so there is nowhere to put a
// second URL without a migration and a backfill of every existing program.
// A variant that hasn't been generated yet — an upload whose background job
// is still queued, or a program that predates this — falls back to the
// original, so the handbook degrades to exactly its old behaviour instead of
// showing a broken image.
router.get("/media/:productId/:fileName", async (req, res) => {
  const { productId, fileName } = req.params;
  // The upload endpoint only ever writes sanitized basenames, so anything
  // with a path separator (or that changes under basename()) is an attempt
  // to escape the product's media folder.
  if (path.basename(fileName) !== fileName) return res.status(400).json({ error: "Invalid file name" });

  const entitled = await hasEntitlement(req.user.id, productId);
  if (!entitled && req.user.role !== "admin") {
    return res.status(403).json({ error: "You don't have access to this media" });
  }

  let served = fileName;
  const variant = String(req.query.variant || "");
  if (variant === "poster" || variant === "anim") {
    const candidate = variantFileName(fileName, variant);
    // basename() again: variantFileName only ever appends a suffix, but this
    // is the value that becomes a filesystem path, so it is re-checked rather
    // than trusted to have stayed clean.
    if (path.basename(candidate) === candidate && fs.existsSync(path.join(MEDIA_DIR, productId, candidate))) {
      served = candidate;
    }
  }

  const token = mintDownloadToken("media", `${productId}/${served}`, req.user.id);
  res.redirect(`/api/library/download/media/${token}`);
});

router.get("/download/media/:token", async (req, res) => {
  const payload = verifyDownloadToken(req.params.token, "media");
  if (!payload) return res.status(410).json({ error: "This link has expired. Reopen the program to get a fresh one." });
  // The token is only valid for the user it was minted for — a still-logged-in
  // session belonging to someone else can't reuse a link they happened to see.
  if (payload.userId !== req.user.id) return res.status(403).json({ error: "You don't have access to this media" });

  const [productId, fileName] = payload.id.split("/");
  if (path.basename(fileName) !== fileName) return res.status(400).json({ error: "Invalid file name" });

  // Re-check ownership at serve time, not just at mint time — closes the
  // window where access is revoked (e.g. a refund) after a token was
  // minted but before it's actually used.
  const entitled = await hasEntitlement(req.user.id, productId);
  if (!entitled && req.user.role !== "admin") {
    return res.status(403).json({ error: "You don't have access to this media" });
  }

  // Signed, short-lived, and re-verified — but still never cached by any
  // shared/intermediate cache, since the URL itself is single-use-ish and
  // scoped to one viewer; the browser may still cache it locally per fetch.
  res.set("Cache-Control", "private, max-age=60");
  // Program media may now include SVG, which unlike every other allowed type
  // is a scriptable document. Same defence as the public static handler in
  // src/index.js — see the comment there for why the sanitizer alone isn't
  // relied on. Applied here too because this route bypasses that handler
  // entirely.
  if (path.extname(fileName).toLowerCase() === ".svg") {
    res.set("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
    res.set("X-Content-Type-Options", "nosniff");
  }
  res.sendFile(path.join(MEDIA_DIR, productId, fileName), (err) => {
    if (err && !res.headersSent) res.status(404).json({ error: "Media not found" });
  });
});

// Optional bonus attachment download/redirect — gated the same way as the
// program view itself, since a resource is only ever reachable through it.
// Same stable-reference + signed-redirect pattern as media, above.
router.get("/resource/:resourceId", async (req, res) => {
  const resource = await prisma.productResource.findUnique({ where: { id: req.params.resourceId } });
  if (!resource) return res.status(404).json({ error: "Resource not found" });

  const entitled = await hasEntitlement(req.user.id, resource.productId);
  if (!entitled && req.user.role !== "admin") {
    return res.status(403).json({ error: "You don't have access to this resource" });
  }

  if (resource.type === "link") return res.redirect(resource.url);

  const token = mintDownloadToken("resource", resource.id, req.user.id);
  res.redirect(`/api/library/download/resource/${token}`);
});

router.get("/download/resource/:token", async (req, res) => {
  const payload = verifyDownloadToken(req.params.token, "resource");
  if (!payload) return res.status(410).json({ error: "This link has expired. Go back and click download again." });
  if (payload.userId !== req.user.id) return res.status(403).json({ error: "You don't have access to this resource" });

  const resource = await prisma.productResource.findUnique({ where: { id: payload.id } });
  if (!resource) return res.status(404).json({ error: "Resource not found" });

  const entitled = await hasEntitlement(req.user.id, resource.productId);
  const isAdmin = req.user.role === "admin";
  if (!entitled && !isAdmin) return res.status(403).json({ error: "You don't have access to this resource" });

  if (!entitled && isAdmin) {
    logEvent({
      category: "admin",
      message: `Preview mode: downloaded bonus resource "${resource.title}" without a purchase`,
      metadata: { resourceId: resource.id, productId: resource.productId },
      actorId: req.user.id,
    });
  }

  res.download(path.join(RESOURCE_DIR, resource.fileName), resource.title);
});

module.exports = router;
