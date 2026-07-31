const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { prisma } = require("../../db");
const { logEvent } = require("../../lib/adminLog");
const { verifyUploadedFile } = require("../../lib/uploadVerify");
const { optimizeImageInPlace, describeOptimization } = require("../../lib/imageOptimize");
const { generateDerivatives, invalidate: invalidateMedia, describeForAdmin } = require("../../lib/mediaDerivatives");
const {
  generateAnimatedDerivatives,
  invalidate: invalidateAnimated,
  posterPathFor,
  animPathFor,
  manifestPathFor: animManifestPathFor,
} = require("../../lib/animatedMedia");
const { enqueue: enqueueMediaJob } = require("../../lib/mediaJobs");

const router = express.Router();

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

// The four states a product can be in. This was previously an unvalidated
// passthrough — whatever string the form sent became the status — which was
// survivable while every value was cosmetic, and stopped being survivable
// the moment one of them became a visibility boundary.
//
//   draft        work in progress, not public, not sellable
//   private      finished, but deliberately unlisted — not public, not
//                sellable, reachable only by someone who already has a link
//   scheduled    finished and queued to go live at publishAt; a timer sweep in
//                src/index.js flips it to "published" when that moment passes
//   published    live in the store, sellable
//   archived     withdrawn, not public, not sellable
//   presentation a SHOWCASE product: exists only to be shown inside a
//                private presentation deck. Never in the store, never in
//                listings, never in search, never in the sitemap, never
//                recommended, never purchasable.
//
// "presentation", "private" and "scheduled" all get that isolation for free
// rather than by enforcement:
// every public read path in the app filters on status === "published"
// (see routes/products.js, routes/pages.js, lib/recommendations.js and
// lib/checkoutItems.js), so a status that is not "published" is invisible
// to all of them by construction. That is the whole reason this is a
// status value and not an `isPresentationOnly` boolean — a boolean would
// have needed a new filter added to a dozen queries, and would be one
// forgotten `where` clause away from putting a showcase product on the
// shop grid. The same reasoning is why "private" and "scheduled" are values
// here and not two more booleans.
const PRODUCT_STATUSES = new Set(["draft", "private", "scheduled", "published", "archived", "presentation"]);

function invalidStatus(status) {
  if (status === undefined) return null;
  if (PRODUCT_STATUSES.has(status)) return null;
  return `status must be one of: ${[...PRODUCT_STATUSES].join(", ")}`;
}

// One ceiling for every media upload route below. This MUST stay <= the
// `client_max_body_size` in /etc/nginx/conf.d/mitm-fa.conf — nginx sees the
// request first and answers 413 on its own, so a limit raised here alone
// changes nothing. (That mismatch, with nginx left on its 1m default, is
// exactly what made 12MB uploads fail with no server-side log line.)
const MAX_UPLOAD_BYTES = 100 * 1024 * 1024;

const SITE_ROOT = path.join(__dirname, "..", "..", "..", "..");
const IMAGE_DIR = path.join(SITE_ROOT, "assets", "images", "product", "uploads");
const IMAGE_URL_BASE = "/assets/images/product/uploads";
const RESOURCE_DIR = path.join(__dirname, "..", "..", "..", "storage", "resources");
fs.mkdirSync(IMAGE_DIR, { recursive: true });
fs.mkdirSync(RESOURCE_DIR, { recursive: true });

// Every stored filename is a fresh UUID — the client's original filename is
// never trusted or preserved on disk (no path traversal surface, no leaking
// internal naming, nothing for a "double extension" trick to ride on). The
// declared mimetype/extension only pick a *provisional* name; verifyAndRename
// below corrects it to match the file's real, sniffed content type before
// anything is allowed to be referenced by a product or served.
function provisionalName(declaredMime) {
  const ext = ((declaredMime || "").split("/")[1] || "bin").replace(/[^a-z0-9]/gi, "");
  return `${crypto.randomUUID()}.${ext || "bin"}`;
}

// Browsers do not reliably know what they are sending. A .mov picked on
// Windows, and plenty of files dragged from cloud-sync folders, arrive
// declared as application/octet-stream — and rejecting those in fileFilter
// means a perfectly valid MOV is refused before anything has looked at its
// actual bytes.
//
// So a generic/absent declared type is allowed THROUGH the filter, not
// accepted: verifyAndRename still sniffs the real magic bytes immediately
// afterwards and deletes anything that isn't on the allowlist. That is the
// actual security boundary either way — this filter only exists to fail fast
// on an obviously wrong pick, so it should never be the reason a legitimate
// upload is refused.
const GENERIC_DECLARED_TYPES = new Set(["", "application/octet-stream", "binary/octet-stream", "application/x-empty"]);

function declaredTypePlausible(declaredMime, allowedMimes) {
  const mime = (declaredMime || "").toLowerCase().trim();
  return allowedMimes.has(mime) || GENERIC_DECLARED_TYPES.has(mime);
}

// The upload routes below invoke multer manually (so they can do their own
// verification in the callback) rather than as route middleware, which means
// a multer error never reaches the central handler in src/index.js — it has
// to be translated here instead.
//
// Getting the status right matters beyond tidiness: an over-limit body is a
// 413 whether nginx stopped it or multer did, and the admin UI keys off that
// status to explain the size limit. Reporting multer's version as a bare 400
// "File too large" is what made an over-limit upload look like a different
// class of failure from the identical one a layer earlier.
function respondUploadError(res, err) {
  if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
    return res.status(413).json({
      error: `That file is too large. The limit is ${Math.round(MAX_UPLOAD_BYTES / (1024 * 1024))}MB per file.`,
    });
  }
  return res.status(err.status || 400).json({ error: err.message || "Upload failed" });
}

// Runs after multer has already written the file to disk. Sniffs the actual
// content (magic bytes, not the client-supplied Content-Type header, which
// is trivially spoofed) and renames the file to match its real type. Deletes
// and rejects anything that doesn't match the allowlist — this is the actual
// security boundary; multer's fileFilter is only a fast-fail UX nicety.
async function verifyAndRename(file, allowedMimes, publicUrlBase) {
  const result = await verifyUploadedFile(file.path, allowedMimes);
  if (!result.ok) return result;

  const finalName = `${path.basename(file.filename, path.extname(file.filename))}.${result.ext}`;
  const finalPath = path.join(path.dirname(file.path), finalName);
  await fs.promises.rename(file.path, finalPath);
  file.filename = finalName;
  file.path = finalPath;

  // Automatic optimization runs here, at the single choke point every image
  // upload route already funnels through, and only AFTER the content has been
  // verified — never re-encode bytes that haven't been proven to be an image.
  // It is best-effort by design: a failure leaves the verified original in
  // place rather than failing the upload.
  file.optimization = await optimizeImageInPlace(finalPath, result.mime);

  // Responsive derivatives + the sidecar manifest that tells the storefront
  // how to fit this image. Runs after optimization so the derivatives are cut
  // from the already-corrected (rotated, downscaled, metadata-stripped)
  // image rather than the raw upload. Best-effort, like the optimizer: the
  // original is complete and serveable on its own, and coverMedia() falls
  // back to plain imageUrl when no manifest exists.
  if (publicUrlBase) {
    file.media = await generateDerivatives(finalPath, result.mime, publicUrlBase);
    invalidateMedia(finalPath);
  }
  return result;
}

const IMAGE_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);
const imageStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, IMAGE_DIR);
  },
  filename(req, file, cb) {
    cb(null, provisionalName(file.mimetype));
  },
});
const upload = multer({
  storage: imageStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter(req, file, cb) {
    if (!declaredTypePlausible(file.mimetype, IMAGE_MIME)) {
      const err = new Error("Cover image and thumbnail must be PNG, JPG, WebP, GIF, or SVG");
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});
const uploadFields = upload.fields([
  { name: "coverImage", maxCount: 1 },
  { name: "thumbnail", maxCount: 1 },
]);

// Verifies every file multer attached to req.files (an { fieldName: [file] }
// map, as produced by .fields()) against allowedMimes, deleting and
// collecting an error for any that fail real-content sniffing.
async function verifyReqFiles(files, allowedMimes, publicUrlBase) {
  const errors = [];
  const notices = [];
  for (const fieldFiles of Object.values(files || {})) {
    for (const file of fieldFiles) {
      const result = await verifyAndRename(file, allowedMimes, publicUrlBase);
      if (!result.ok) errors.push(`${file.fieldname}: ${result.reason}`);
      const note = describeForAdmin(file.media);
      if (note) notices.push({ field: file.fieldname, ...note });
    }
  }
  // Errors block the upload; notices never do — they are guidance about how
  // an accepted image will be rendered. verifyReqFiles keeps returning an
  // array so existing `if (errors.length)` callers are unaffected, with the
  // notices hung off it.
  errors.notices = notices;
  return errors;
}

// Bonus attachments (PDF, Office docs, zip, images) — resources are never
// served inline/renderable (see library.js's res.download()), but still need
// a real content check so a malicious admin session can't smuggle malware
// out to paying customers under a trusted-looking title.
const RESOURCE_MIME = new Set([
  "application/pdf",
  "application/zip",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
]);
const resourceStorage = multer.diskStorage({
  destination(req, file, cb) {
    cb(null, RESOURCE_DIR);
  },
  filename(req, file, cb) {
    cb(null, `${crypto.randomUUID()}.bin`);
  },
});
const uploadResource = multer({ storage: resourceStorage, limits: { fileSize: MAX_UPLOAD_BYTES } });

// Exercise demo media (GIF / short video / image). Stored per-product under
// server/storage/media/<productId>/ — NOT in public assets — and served to
// entitled customers via the gated GET /api/library/media/:productId/:file.
const MEDIA_DIR = path.join(__dirname, "..", "..", "..", "storage", "media");
const MEDIA_MIME = new Set(["image/gif", "image/png", "image/jpeg", "image/webp", "image/svg+xml", "video/mp4", "video/webm", "video/quicktime"]);
const mediaStorage = multer.diskStorage({
  destination(req, file, cb) {
    const dir = path.join(MEDIA_DIR, req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    cb(null, provisionalName(file.mimetype));
  },
});
const uploadMedia = multer({
  storage: mediaStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter(req, file, cb) {
    if (!declaredTypePlausible(file.mimetype, MEDIA_MIME)) return cb(new Error("Use a GIF, image (PNG/JPG/WebP/SVG), or short MP4/MOV/WebM video"));
    cb(null, true);
  },
});

// Public product-page gallery (the sales-page carousel) — deliberately NOT
// the MEDIA_DIR pipeline above. That one is paid program content: it lives
// outside the public root and /api/library/media gates every read behind
// requireAuth + an ownership check. The carousel is shown to shoppers who by
// definition have not bought the product yet, so its files must be publicly
// served, exactly like the existing cover image in IMAGE_DIR.
const GALLERY_DIR = path.join(SITE_ROOT, "assets", "images", "product", "gallery");
const GALLERY_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml", "video/mp4", "video/webm", "video/quicktime"]);

function galleryDirFor(productId) {
  return path.join(GALLERY_DIR, productId);
}
function galleryUrlFor(productId, filename) {
  return `/assets/images/product/gallery/${productId}/${filename}`;
}

const galleryStorage = multer.diskStorage({
  destination(req, file, cb) {
    // req.params.id is a cuid matched by the route, never raw user input in a
    // path segment sense — but it is still only ever used via path.join with
    // a fixed base, so a crafted id cannot escape GALLERY_DIR.
    const dir = galleryDirFor(req.params.id);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename(req, file, cb) {
    cb(null, provisionalName(file.mimetype));
  },
});
const uploadGallery = multer({
  storage: galleryStorage,
  limits: { fileSize: MAX_UPLOAD_BYTES },
  fileFilter(req, file, cb) {
    if (!declaredTypePlausible(file.mimetype, GALLERY_MIME)) {
      const err = new Error("Gallery media must be PNG, JPG, WebP, GIF, SVG, MP4, MOV, or WebM");
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

function hasTrainingContent(product) {
  return !!(product.trainingContent && Array.isArray(product.trainingContent.weeks) && product.trainingContent.weeks.length > 0);
}

function hasNutritionContent(product) {
  const n = product.nutritionContent;
  return !!(n && (n.notes || (Array.isArray(n.meals) && n.meals.length > 0)));
}

// Which wizard steps have the data they need — computed on read rather than
// stored, so there's no separate "completion" column that can drift out of
// sync with the actual product fields.
function wizardProgress(product) {
  return {
    basics: !!(product.name && product.slug && product.description && product.imageUrl && (product.taxonomies || []).length > 0),
    pricing: product.priceCents != null && !!product.status,
    structure: !!(product.overview && product.difficulty && product.durationWeeks),
    training: hasTrainingContent(product) || hasNutritionContent(product),
    nutrition: hasNutritionContent(product) || hasTrainingContent(product),
    faqBonus: (product.faqs || []).length > 0 || (product.resources || []).length > 0 || !!product.bonusNotes,
    // SEO tags are optional metadata, never a publish blocker — always
    // reported complete so the wizard step never shows a false "missing" warning.
    seoTags: true,
    // Likewise optional: a product with no gallery media falls back to its
    // cover image on the product page, which is exactly the old behaviour.
    gallery: true,
    preview: !!(product.name && product.slug && product.priceCents != null && product.overview),
  };
}

// "Browse Athletes / Football / Marcus Reyes" — walks a ProductTaxonomy row's
// node up through its parents so the admin table/wizard can show where a
// product sits without a second round trip.
function taxonomyPath(productTaxonomy) {
  const names = [];
  let node = productTaxonomy.taxonomyNode;
  const taxonomyLabel = node.taxonomy.label;
  while (node) {
    names.unshift(node.name);
    node = node.parent || null;
  }
  return `${taxonomyLabel} / ${names.join(" / ")}`;
}

function serialize(product) {
  return {
    id: product.id,
    slug: product.slug,
    name: product.name,
    priceCents: product.priceCents,
    imageUrl: product.imageUrl,
    thumbnailUrl: product.thumbnailUrl,
    description: product.description,
    status: product.status,
    publishAt: product.publishAt,
    featured: product.featured,
    createdAt: product.createdAt,
    creator: product.creator,
    difficulty: product.difficulty,
    durationWeeks: product.durationWeeks,
    overview: product.overview,
    trainingContent: product.trainingContent,
    nutritionContent: product.nutritionContent,
    bonusNotes: product.bonusNotes,
    seoTags: product.seoTags || [],
    faqs: product.faqs || [],
    resources: product.resources || [],
    taxonomyNodeIds: (product.taxonomies || []).map((t) => t.taxonomyNodeId),
    taxonomyPaths: (product.taxonomies || []).map(taxonomyPath),
    wizardProgress: wizardProgress(product),
  };
}

const withRelations = {
  faqs: { orderBy: { order: "asc" } },
  resources: { orderBy: { order: "asc" } },
  taxonomies: { include: { taxonomyNode: { include: { taxonomy: true, parent: { include: { parent: true } } } } } },
};

// Search matches NAME, CREATOR or ID. Name alone was not enough for the
// presentation picker, where an admin reasonably looks for "Sam Sulek" (the
// creator) or pastes an id straight out of a URL and expects a hit.
//
// The id match is exact rather than a `contains`: a cuid is not something
// anyone types a fragment of, and a substring match over an indexed unique
// column is wasted work at every scale.
function productSearchFilter(search) {
  const term = String(search).trim();
  if (!term) return {};
  return {
    OR: [
      { name: { contains: term, mode: "insensitive" } },
      { creator: { contains: term, mode: "insensitive" } },
      { id: term },
      { slug: { contains: term, mode: "insensitive" } },
    ],
  };
}

// `limit` is OPT-IN and never defaulted. The Products table asks for the whole
// catalogue and must keep getting it — a default page size here would silently
// truncate that, which is the exact class of bug this endpoint is being fixed
// for. Callers that do pass one (the presentation picker) also get `total`, so
// a capped result can always say how many it is capping, and a product can
// never go missing without the UI knowing it did.
// The four fields a chooser needs, and nothing else.
//
// The full serialization carries every product's trainingContent and
// nutritionContent — one real program here is 83KB of exercise JSON on its
// own, so filling a dropdown with 50 of them meant moving megabytes to render
// a list of names. `compact` exists so a picker pays for what it displays;
// it also skips `withRelations` entirely, which drops four joins per row.
const COMPACT_SELECT = {
  id: true,
  slug: true,
  name: true,
  status: true,
  creator: true,
  priceCents: true,
  createdAt: true,
};

router.get("/", async (req, res) => {
  const { search, status, taxonomyNodeId, limit, compact } = req.query;
  const where = {
    AND: [
      status ? { status } : {},
      taxonomyNodeId ? { taxonomies: { some: { taxonomyNodeId: String(taxonomyNodeId) } } } : {},
      search ? productSearchFilter(search) : {},
    ],
  };

  const isCompact = compact === "1" || compact === "true";
  const take = Math.min(Math.max(parseInt(limit, 10) || 0, 0), 200) || undefined;

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take,
      ...(isCompact ? { select: COMPACT_SELECT } : { include: withRelations }),
    }),
    take ? prisma.product.count({ where }) : Promise.resolve(null),
  ]);

  res.json({
    products: isCompact ? products : products.map(serialize),
    ...(take ? { total, truncated: total > products.length } : {}),
  });
});

router.get("/:id", async (req, res) => {
  const product = await prisma.product.findUnique({ where: { id: req.params.id }, include: withRelations });
  if (!product) return res.status(404).json({ error: "Product not found" });
  res.json({ product: serialize(product) });
});

// Creates the draft the wizard operates on from just the fields collected in
// Step 1 — every later step is a partial PUT against this same id, which is
// what makes "save draft between steps" work without a separate draft model.
router.post("/", uploadFields, async (req, res) => {
  const uploadErrors = await verifyReqFiles(req.files, IMAGE_MIME, IMAGE_URL_BASE);
  if (uploadErrors.length) return res.status(400).json({ error: uploadErrors.join("; ") });
  const mediaNotices = uploadErrors.notices || [];

  const { name, slug, description, priceCents, status, featured, creator } = req.body;
  if (!name || !slug) {
    return res.status(400).json({ error: "name and slug are required" });
  }
  if (!SLUG_RE.test(slug)) {
    return res.status(400).json({ error: "slug must be lowercase letters, numbers, and hyphens only" });
  }
  const statusError = invalidStatus(status);
  if (statusError) return res.status(400).json({ error: statusError });

  const coverImage = req.files?.coverImage?.[0];
  const thumbnail = req.files?.thumbnail?.[0];

  const product = await prisma.product.create({
    data: {
      name,
      slug,
      description: description || null,
      priceCents: priceCents ? parseInt(priceCents, 10) : 0,
      creator: creator || null,
      status: status || "draft",
      featured: featured === "true" || featured === true,
      imageUrl: coverImage ? `assets/images/product/uploads/${coverImage.filename}` : null,
      thumbnailUrl: thumbnail ? `assets/images/product/uploads/${thumbnail.filename}` : null,
    },
    include: withRelations,
  });

  await logEvent({ category: "product", message: `Created product "${product.name}"`, actorId: req.user.id });
  res.status(201).json({ product: serialize(product) });
});

// Step 1/2/3 scalar fields — partial update, same pattern the old PUT used.
router.put("/:id", uploadFields, async (req, res) => {
  const uploadErrors = await verifyReqFiles(req.files, IMAGE_MIME, IMAGE_URL_BASE);
  if (uploadErrors.length) return res.status(400).json({ error: uploadErrors.join("; ") });
  const mediaNotices = uploadErrors.notices || [];

  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Product not found" });

  const {
    name, slug, description, priceCents, status, featured,
    creator, difficulty, durationWeeks, publishAt,
  } = req.body;
  if (slug !== undefined && !SLUG_RE.test(slug)) {
    return res.status(400).json({ error: "slug must be lowercase letters, numbers, and hyphens only" });
  }
  const statusError = invalidStatus(status);
  if (statusError) return res.status(400).json({ error: statusError });

  // "Scheduled" without a future timestamp is a product that would sit
  // invisible forever, which reads to the admin as "I published it and nothing
  // happened" — so it's rejected rather than silently accepted.
  let publishAtValue;
  if (publishAt !== undefined) {
    if (publishAt === "" || publishAt === null) {
      publishAtValue = null;
    } else {
      const parsed = new Date(publishAt);
      if (Number.isNaN(parsed.getTime())) return res.status(400).json({ error: "publishAt must be a valid date" });
      publishAtValue = parsed;
    }
  }
  const effectiveStatus = status !== undefined ? status : existing.status;
  const effectivePublishAt = publishAt !== undefined ? publishAtValue : existing.publishAt;
  if (effectiveStatus === "scheduled") {
    if (!effectivePublishAt) return res.status(400).json({ error: "Pick a date and time to schedule this program for" });
    if (effectivePublishAt.getTime() <= Date.now()) {
      return res.status(400).json({ error: "The scheduled time has to be in the future" });
    }
  }

  const coverImage = req.files?.coverImage?.[0];
  const thumbnail = req.files?.thumbnail?.[0];

  const product = await prisma.product.update({
    where: { id: existing.id },
    data: {
      ...(name !== undefined ? { name } : {}),
      ...(slug !== undefined ? { slug } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(priceCents !== undefined ? { priceCents: parseInt(priceCents, 10) } : {}),
      ...(status !== undefined ? { status } : {}),
      ...(publishAt !== undefined ? { publishAt: publishAtValue } : {}),
      ...(featured !== undefined ? { featured: featured === "true" || featured === true } : {}),
      ...(creator !== undefined ? { creator } : {}),
      ...(difficulty !== undefined ? { difficulty } : {}),
      ...(durationWeeks !== undefined ? { durationWeeks: durationWeeks ? parseInt(durationWeeks, 10) : null } : {}),
      ...(coverImage ? { imageUrl: `assets/images/product/uploads/${coverImage.filename}` } : {}),
      ...(thumbnail ? { thumbnailUrl: `assets/images/product/uploads/${thumbnail.filename}` } : {}),
    },
    include: withRelations,
  });

  await logEvent({ category: "product", message: `Updated product "${product.name}"`, actorId: req.user.id });
  res.json({ product: serialize(product), mediaNotices });
});

// Replaces the product's full taxonomy assignment set in one go — the wizard
// sends the complete selected set of leaf node ids every time, same "treat
// this slice as one replaceable unit" pattern as PUT /:id/content above.
router.put("/:id/taxonomy", async (req, res) => {
  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Product not found" });

  const nodeIds = Array.isArray(req.body.nodeIds) ? req.body.nodeIds.filter(Boolean) : [];

  await prisma.$transaction([
    prisma.productTaxonomy.deleteMany({ where: { productId: existing.id } }),
    ...(nodeIds.length
      ? [prisma.productTaxonomy.createMany({
          data: nodeIds.map((taxonomyNodeId) => ({ productId: existing.id, taxonomyNodeId })),
          skipDuplicates: true,
        })]
      : []),
  ]);

  const product = await prisma.product.findUnique({ where: { id: existing.id }, include: withRelations });
  await logEvent({ category: "product", message: `Updated navigation placement for "${product.name}"`, actorId: req.user.id });
  res.json({ product: serialize(product), mediaNotices });
});

// Steps 3-5: the actual program content (overview, training, nutrition,
// bonus notes, SEO tags) — plain JSON, no file upload involved.
router.put("/:id/content", async (req, res) => {
  const existing = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!existing) return res.status(404).json({ error: "Product not found" });

  const { overview, trainingContent, nutritionContent, bonusNotes, seoTags } = req.body;
  const product = await prisma.product.update({
    where: { id: existing.id },
    data: {
      ...(overview !== undefined ? { overview } : {}),
      ...(trainingContent !== undefined ? { trainingContent } : {}),
      ...(nutritionContent !== undefined ? { nutritionContent } : {}),
      ...(bonusNotes !== undefined ? { bonusNotes } : {}),
      ...(seoTags !== undefined ? { seoTags: Array.isArray(seoTags) ? seoTags.filter(Boolean) : [] } : {}),
    },
    include: withRelations,
  });

  await logEvent({ category: "product", message: `Updated program content for "${product.name}"`, actorId: req.user.id });
  res.json({ product: serialize(product) });
});

// Upload one exercise demo media file. Returns the gated URL the wizard
// stores on the exercise (trainingContent JSON — no schema change needed);
// the file itself is only reachable through /api/library/media, so program
// media is never publicly downloadable.
router.post("/:id/media", (req, res) => {
  uploadMedia.single("media")(req, res, async (err) => {
    if (err) return respondUploadError(res, err);
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const verified = await verifyAndRename(req.file, MEDIA_MIME);
    if (!verified.ok) return res.status(400).json({ error: verified.reason });

    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Product not found" });
    }

    await logEvent({
      category: "product",
      message: `Uploaded exercise media "${req.file.filename}" for "${product.name}"${describeOptimization(req.file.optimization)}`,
      actorId: req.user.id,
    });

    // Poster + animated-WebP derivatives, QUEUED rather than awaited. Deriving
    // one 15MB demo GIF costs ~1.5s of CPU, and the upload response needs
    // none of it — the handbook falls back to the original until the job
    // lands. Doing this inline is what made a batch of demo uploads stall the
    // whole single-process server. See lib/mediaJobs.js.
    const mediaPath = req.file.path;
    enqueueMediaJob(`derive ${req.file.filename}`, async () => {
      await generateAnimatedDerivatives(mediaPath, verified.mime);
      invalidateAnimated(mediaPath);
    });

    res.json({
      fileName: req.file.filename,
      mediaType: verified.mime.startsWith("video/") ? "video" : "image",
      url: `/api/library/media/${product.id}/${req.file.filename}`,
    });
  });
});

// ---------------------------------------------------------------------------
// Public product-page gallery (carousel) — ordered ProductMedia rows.
// ---------------------------------------------------------------------------

// List, so the wizard can render the current gallery without pulling the
// whole product payload just to read its media.
router.get("/:id/gallery", async (req, res) => {
  const media = await prisma.productMedia.findMany({
    where: { productId: req.params.id },
    orderBy: [{ order: "asc" }, { id: "asc" }],
  });
  res.json({ media });
});

// Upload one gallery item. New items append to the end of the existing
// order rather than assuming a count — rows can be deleted, so `count` would
// collide with a surviving row's position.
router.post("/:id/gallery", (req, res) => {
  uploadGallery.single("media")(req, res, async (err) => {
    if (err) return respondUploadError(res, err);
    if (!req.file) return res.status(400).json({ error: "No file uploaded" });

    const verified = await verifyAndRename(req.file, GALLERY_MIME, `/assets/images/product/gallery/${req.params.id}`);
    if (!verified.ok) return res.status(400).json({ error: verified.reason });

    const product = await prisma.product.findUnique({ where: { id: req.params.id } });
    if (!product) {
      fs.unlink(req.file.path, () => {});
      return res.status(404).json({ error: "Product not found" });
    }

    const last = await prisma.productMedia.findFirst({
      where: { productId: product.id },
      orderBy: { order: "desc" },
      select: { order: true },
    });

    const created = await prisma.productMedia.create({
      data: {
        productId: product.id,
        url: galleryUrlFor(product.id, req.file.filename),
        // Trust the sniffed type, not the declared one — verifyAndRename has
        // already renamed the file to match its real content.
        type: verified.mime.startsWith("video/") ? "video" : "image",
        alt: (req.body.alt || "").trim() || null,
        order: last ? last.order + 1 : 0,
      },
    });

    await logEvent({
      category: "product",
      message: `Added gallery media to "${product.name}"${describeOptimization(req.file.optimization)}`,
      actorId: req.user.id,
    });
    res.json({ media: created });
  });
});

router.delete("/:id/gallery/:mediaId", async (req, res) => {
  const media = await prisma.productMedia.findUnique({ where: { id: req.params.mediaId } });
  if (!media || media.productId !== req.params.id) {
    return res.status(404).json({ error: "Media not found" });
  }

  await prisma.productMedia.delete({ where: { id: media.id } });

  // Remove the file too, but only after the row is gone: an orphaned file is
  // harmless, whereas a row pointing at a deleted file renders a broken slide.
  // Resolved and bounds-checked rather than trusting the stored URL.
  const fileName = path.basename(media.url);
  const target = path.join(galleryDirFor(req.params.id), fileName);
  if (target.startsWith(GALLERY_DIR + path.sep)) {
    fs.unlink(target, () => {});
  }

  await logEvent({
    category: "product",
    message: `Removed gallery media from product ${req.params.id}`,
    actorId: req.user.id,
  });
  res.json({ ok: true });
});

// Reorder — takes the full ordered list of media ids. Applied in one
// transaction so a partial failure can't leave the carousel half-reordered.
router.put("/:id/gallery/order", async (req, res) => {
  const ids = Array.isArray(req.body.ids) ? req.body.ids : null;
  if (!ids) return res.status(400).json({ error: "Expected an array of media ids" });

  const owned = await prisma.productMedia.findMany({
    where: { productId: req.params.id },
    select: { id: true },
  });
  const ownedIds = new Set(owned.map((m) => m.id));
  // Reject the whole request if any id belongs to another product (or does
  // not exist) rather than silently reordering the subset that matched.
  if (ids.length !== owned.length || !ids.every((id) => ownedIds.has(id))) {
    return res.status(400).json({ error: "Media list doesn't match this product's gallery" });
  }

  await prisma.$transaction(
    ids.map((id, index) =>
      prisma.productMedia.update({ where: { id }, data: { order: index } })
    )
  );
  res.json({ ok: true });
});

router.delete("/:id", async (req, res) => {
  const product = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: { _count: { select: { orderItems: true } } },
  });
  if (!product) return res.status(404).json({ error: "Product not found" });
  if (product._count.orderItems > 0) {
    return res.status(409).json({ error: "This product has existing orders — archive it instead of deleting" });
  }

  await prisma.productFaq.deleteMany({ where: { productId: product.id } });
  await prisma.productResource.deleteMany({ where: { productId: product.id } });
  await prisma.productTaxonomy.deleteMany({ where: { productId: product.id } });
  // ProductMedia rows go with the product via onDelete: Cascade, but the
  // files they point at are on disk and would be left behind.
  fs.rm(galleryDirFor(product.id), { recursive: true, force: true }, () => {});
  await prisma.product.delete({ where: { id: product.id } });
  await logEvent({ category: "product", message: `Deleted product "${product.name}"`, actorId: req.user.id });
  res.json({ ok: true });
});

router.post("/:id/archive", async (req, res) => {
  const product = await prisma.product.update({
    where: { id: req.params.id },
    data: { status: "archived" },
    include: withRelations,
  });
  await logEvent({ category: "product", message: `Archived product "${product.name}"`, actorId: req.user.id });
  res.json({ product: serialize(product) });
});

// Clone Product — the whole thing, not just the scalar columns.
//
// This is how a "Women's version" / "Advanced version" / "Coach Edition" gets
// made, so a clone that quietly dropped the FAQs, the bonus PDFs, the carousel
// and every exercise demo GIF would leave the admin re-doing exactly the work
// the feature exists to save. What is deliberately NOT copied is anything
// earned rather than authored: orders, order items, and customer progress. The
// clone is always a draft and never featured — it is a starting point, not a
// second live product.
//
// `name` in the body lets the caller name the clone up front ("Iron Path —
// Women's Edition") instead of renaming "… (Copy)" afterwards.
router.post("/:id/duplicate", async (req, res) => {
  const original = await prisma.product.findUnique({
    where: { id: req.params.id },
    include: { taxonomies: true, faqs: true, resources: true, media: true },
  });
  if (!original) return res.status(404).json({ error: "Product not found" });

  const requestedName = (req.body && typeof req.body.name === "string" && req.body.name.trim()) || null;
  const name = requestedName || `${original.name} (Copy)`;

  // Slug is derived from whatever the clone is actually called, so a named
  // clone gets a readable URL rather than "original-slug-copy-3".
  const slugBase = requestedName
    ? requestedName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `${original.slug}-copy`
    : `${original.slug}-copy`;
  let slug = slugBase;
  let suffix = 2;
  while (await prisma.product.findUnique({ where: { slug } })) {
    slug = `${slugBase}-${suffix++}`;
  }

  const duplicate = await prisma.product.create({
    data: {
      name,
      slug,
      description: original.description,
      priceCents: original.priceCents,
      imageUrl: original.imageUrl,
      thumbnailUrl: original.thumbnailUrl,
      creator: original.creator,
      difficulty: original.difficulty,
      durationWeeks: original.durationWeeks,
      overview: original.overview,
      nutritionContent: original.nutritionContent,
      bonusNotes: original.bonusNotes,
      seoTags: original.seoTags,
      status: "draft",
      featured: false,
      taxonomies: {
        create: original.taxonomies.map((t) => ({ taxonomyNodeId: t.taxonomyNodeId })),
      },
      faqs: {
        create: original.faqs.map((f) => ({ question: f.question, answer: f.answer, order: f.order })),
      },
      // Link resources carry over by reference; file resources share the
      // already-uploaded blob, since RESOURCE_DIR is flat and not keyed by
      // product — two rows pointing at one file is the existing model, and
      // DELETE /resources/:id only unlinks the file for the row being deleted.
      resources: {
        create: original.resources.map((r) => ({
          title: r.title,
          description: r.description,
          type: r.type,
          fileName: r.fileName,
          url: r.url,
          order: r.order,
        })),
      },
    },
    include: withRelations,
  });

  // Gallery and exercise-demo media are per-product *directories*, so unlike
  // resources these have to be physically copied — the gallery URL embeds the
  // product id, and /api/library/media authorizes on the product id in the
  // path, so a shared file would 403 for anyone who bought only the clone.
  const trainingContent = await cloneProductMedia(original, duplicate.id);
  const withMedia = await prisma.product.update({
    where: { id: duplicate.id },
    data: { trainingContent },
    include: withRelations,
  });

  await logEvent({
    category: "product",
    message: `Cloned product "${original.name}" as "${withMedia.name}"`,
    actorId: req.user.id,
  });
  res.status(201).json({ product: serialize(withMedia) });
});

// Copies both media pipelines into the new product and returns a
// trainingContent blob whose exercise mediaUrls point at the copies. A file
// that has gone missing on disk is skipped rather than failing the clone: an
// exercise losing its demo GIF is a visible, fixable gap, whereas a 500 loses
// the entire clone.
async function cloneProductMedia(original, newProductId) {
  // --- gallery (public) ---
  if (original.media.length) {
    const destDir = galleryDirFor(newProductId);
    fs.mkdirSync(destDir, { recursive: true });
    for (const m of original.media) {
      const sourcePath = path.join(SITE_ROOT, m.url.replace(/^\//, ""));
      if (!sourcePath.startsWith(GALLERY_DIR + path.sep) || !fs.existsSync(sourcePath)) continue;
      const ext = path.extname(sourcePath).replace(/[^.a-z0-9]/gi, "") || ".bin";
      const destName = `${crypto.randomUUID()}${ext}`;
      await fs.promises.copyFile(sourcePath, path.join(destDir, destName));
      await prisma.productMedia.create({
        data: {
          productId: newProductId,
          url: galleryUrlFor(newProductId, destName),
          type: m.type,
          alt: m.alt,
          order: m.order,
        },
      });
    }
  }

  // Copies whatever derivatives exist alongside one media file to sit
  // alongside its copy. Best-effort: a missing derivative just means the
  // clone falls back to the original, exactly as an un-derived upload does.
  async function copyDerivatives(sourcePath, destPath) {
    const variants = [
      [posterPathFor(sourcePath), posterPathFor(destPath)],
      [animPathFor(sourcePath), animPathFor(destPath)],
      [animManifestPathFor(sourcePath), animManifestPathFor(destPath)],
    ];
    for (const [from, to] of variants) {
      try {
        if (fs.existsSync(from)) await fs.promises.copyFile(from, to);
      } catch (err) {
        /* the original is copied and serveable; a derivative is an optimisation */
      }
    }
  }

  // --- exercise demo media (gated) ---
  const training = original.trainingContent;
  if (!training || !Array.isArray(training.weeks)) return training ?? null;

  const copied = new Map(); // old url -> new url, so one GIF used on ten days is copied once
  const sourceDir = path.join(MEDIA_DIR, original.id);
  const destDir = path.join(MEDIA_DIR, newProductId);

  for (const week of training.weeks) {
    for (const day of week.days || []) {
      for (const ex of day.exercises || []) {
        if (!ex.mediaUrl || copied.has(ex.mediaUrl)) continue;
        const fileName = path.basename(ex.mediaUrl);
        const sourcePath = path.join(sourceDir, fileName);
        if (!sourcePath.startsWith(MEDIA_DIR + path.sep) || !fs.existsSync(sourcePath)) continue;
        fs.mkdirSync(destDir, { recursive: true });
        const ext = path.extname(fileName).replace(/[^.a-z0-9]/gi, "") || ".bin";
        const destName = `${crypto.randomUUID()}${ext}`;
        const destPath = path.join(destDir, destName);
        await fs.promises.copyFile(sourcePath, destPath);

        // Carry the poster/animated derivatives across too. They are named by
        // suffix off the original's basename, so a copy under a fresh UUID
        // would otherwise leave the clone with no derivatives at all and every
        // demo falling back to the multi-megabyte original. Copying is exact
        // and instant; re-deriving would cost ~1.5s of CPU per file to
        // reproduce bytes we already have.
        await copyDerivatives(sourcePath, destPath);

        copied.set(ex.mediaUrl, `/api/library/media/${newProductId}/${destName}`);
      }
    }
  }

  if (!copied.size) return training;

  const rewritten = JSON.parse(JSON.stringify(training));
  for (const week of rewritten.weeks) {
    for (const day of week.days || []) {
      for (const ex of day.exercises || []) {
        if (ex.mediaUrl && copied.has(ex.mediaUrl)) ex.mediaUrl = copied.get(ex.mediaUrl);
      }
    }
  }
  return rewritten;
}

// ---- FAQ (wizard step 6) ----

router.post("/:id/faqs", async (req, res) => {
  const { question, answer } = req.body;
  if (!question || !answer) return res.status(400).json({ error: "question and answer are required" });

  const count = await prisma.productFaq.count({ where: { productId: req.params.id } });
  const faq = await prisma.productFaq.create({
    data: { productId: req.params.id, question, answer, order: count },
  });
  res.status(201).json({ faq });
});

router.put("/:id/faqs/:faqId", async (req, res) => {
  const { question, answer, order } = req.body;
  const faq = await prisma.productFaq.update({
    where: { id: req.params.faqId },
    data: {
      ...(question !== undefined ? { question } : {}),
      ...(answer !== undefined ? { answer } : {}),
      ...(order !== undefined ? { order } : {}),
    },
  });
  res.json({ faq });
});

router.delete("/:id/faqs/:faqId", async (req, res) => {
  await prisma.productFaq.delete({ where: { id: req.params.faqId } });
  res.json({ ok: true });
});

// ---- Resources (wizard step 6) — optional bonus attachments/links, never
// the core product itself. ----

router.post("/:id/resources", uploadResource.single("resourceFile"), async (req, res) => {
  const { title, description, type, url } = req.body;
  if (!title || !type) return res.status(400).json({ error: "title and type are required" });
  if (type === "file" && !req.file) return res.status(400).json({ error: "A file is required for type 'file'" });
  if (type === "link") {
    if (!url) return res.status(400).json({ error: "A URL is required for type 'link'" });
    // Rejects javascript:/data: schemes here so a malicious admin-entered
    // "link" resource can't execute script when a customer clicks it —
    // HTML-escaping the URL on render only stops attribute breakout, not a
    // scheme that's dangerous as a bare href value.
    let parsed;
    try {
      parsed = new URL(url);
    } catch {
      return res.status(400).json({ error: "Enter a valid http(s) URL" });
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return res.status(400).json({ error: "Enter a valid http(s) URL" });
    }
  }

  if (req.file) {
    const verified = await verifyAndRename(req.file, RESOURCE_MIME);
    if (!verified.ok) return res.status(400).json({ error: verified.reason });
  }

  const count = await prisma.productResource.count({ where: { productId: req.params.id } });
  const resource = await prisma.productResource.create({
    data: {
      productId: req.params.id,
      title,
      description: description || null,
      type,
      fileName: req.file ? req.file.filename : null,
      url: type === "link" ? url : null,
      order: count,
    },
  });
  res.status(201).json({ resource });
});

router.delete("/:id/resources/:resourceId", async (req, res) => {
  const resource = await prisma.productResource.findUnique({ where: { id: req.params.resourceId } });
  if (!resource) return res.status(404).json({ error: "Resource not found" });

  if (resource.fileName) {
    fs.unlink(path.join(RESOURCE_DIR, resource.fileName), () => {});
  }
  await prisma.productResource.delete({ where: { id: resource.id } });
  res.json({ ok: true });
});

module.exports = router;
