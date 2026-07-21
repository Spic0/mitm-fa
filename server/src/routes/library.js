const express = require("express");
const path = require("path");
const { prisma } = require("../db");
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

  res.json({
    preview: isPreview,
    productStatus: product.status,
    product: {
      id: product.id,
      slug: product.slug,
      name: product.name,
      imageUrl: normalizeImageUrl(product.imageUrl),
      creator: product.creator,
      difficulty: product.difficulty,
      durationWeeks: product.durationWeeks,
      overview: product.overview,
      trainingContent: product.trainingContent,
      nutritionContent: product.nutritionContent,
      bonusNotes: product.bonusNotes,
      faqs: product.faqs,
      resources: product.resources.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        type: r.type,
        url: r.type === "link" ? r.url : `/api/library/resource/${r.id}`,
      })),
    },
  });
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

  const token = mintDownloadToken("media", `${productId}/${fileName}`, req.user.id);
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
