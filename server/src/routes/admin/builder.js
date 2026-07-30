// Server support for the Product Builder: the reusable template library and
// the cross-product media library.
//
// Neither needs a schema migration. Templates are a single JSON blob in the
// existing Setting key/value store — they are admin-authored presets, low in
// volume (tens, not thousands), only ever read as a whole list, and never
// queried or joined, which is exactly what that store is for. Media library
// listings are derived from rows and files that already exist.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { prisma } = require("../../db");
const { logEvent } = require("../../lib/adminLog");

const router = express.Router();

const TEMPLATES_KEY = "builder.templates";
const MAX_TEMPLATES = 200;

const SITE_ROOT = path.join(__dirname, "..", "..", "..", "..");
const MEDIA_DIR = path.join(__dirname, "..", "..", "..", "storage", "media");
const RESOURCE_DIR = path.join(__dirname, "..", "..", "..", "storage", "resources");

// ---------------------------------------------------------------------------
// Template library
// ---------------------------------------------------------------------------
// A template is a detached copy of a day or a week — "Push Day", "Recovery
// Day", "Competition Week". It stores the node subtree verbatim; the client
// regenerates every id on insert, so inserting the same template twice yields
// two independent copies rather than two nodes sharing an id.

async function readTemplates() {
  const row = await prisma.setting.findUnique({ where: { key: TEMPLATES_KEY } });
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    // A corrupt blob must not take the whole builder down — an admin losing
    // their preset list is recoverable, a 500 on every builder open is not.
    return [];
  }
}

async function writeTemplates(list) {
  const value = JSON.stringify(list);
  await prisma.setting.upsert({
    where: { key: TEMPLATES_KEY },
    update: { value },
    create: { key: TEMPLATES_KEY, value },
  });
}

router.get("/templates", async (req, res) => {
  const templates = await readTemplates();
  res.json({ templates });
});

router.post("/templates", async (req, res) => {
  const { name, kind, node, category } = req.body;
  if (!name || !String(name).trim()) return res.status(400).json({ error: "A template name is required" });
  if (kind !== "day" && kind !== "week") return res.status(400).json({ error: "kind must be 'day' or 'week'" });
  if (!node || typeof node !== "object") return res.status(400).json({ error: "node is required" });

  const templates = await readTemplates();
  if (templates.length >= MAX_TEMPLATES) {
    return res.status(409).json({ error: `Template limit reached (${MAX_TEMPLATES}). Delete one first.` });
  }

  const template = {
    id: crypto.randomUUID(),
    name: String(name).trim().slice(0, 120),
    category: (category ? String(category).trim() : "").slice(0, 60) || null,
    kind,
    node,
    createdAt: new Date().toISOString(),
  };
  templates.unshift(template);
  await writeTemplates(templates);

  await logEvent({ category: "product", message: `Saved builder template "${template.name}"`, actorId: req.user.id });
  res.status(201).json({ template });
});

router.put("/templates/:id", async (req, res) => {
  const templates = await readTemplates();
  const index = templates.findIndex((t) => t.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: "Template not found" });

  const { name, category, node } = req.body;
  if (name !== undefined) templates[index].name = String(name).trim().slice(0, 120);
  if (category !== undefined) templates[index].category = (category ? String(category).trim() : "").slice(0, 60) || null;
  if (node !== undefined) templates[index].node = node;
  await writeTemplates(templates);
  res.json({ template: templates[index] });
});

router.delete("/templates/:id", async (req, res) => {
  const templates = await readTemplates();
  const next = templates.filter((t) => t.id !== req.params.id);
  if (next.length === templates.length) return res.status(404).json({ error: "Template not found" });
  await writeTemplates(next);
  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Media library
// ---------------------------------------------------------------------------
// One searchable list of everything already uploaded anywhere in the platform,
// so the same demo GIF never gets uploaded twelve times. Three sources:
//
//   gallery  — ProductMedia rows; public files under assets/images/product/gallery
//   program  — exercise demo media on disk under storage/media/<productId>
//   resource — ProductResource file rows under storage/resources
//
// Program media is listed from the filesystem rather than the database because
// it has never had rows: the old wizard wrote the URL straight into the
// trainingContent JSON. Walking the directory is how those existing assets
// become reusable at all.

function safeStat(file) {
  try { return fs.statSync(file); } catch { return null; }
}

function listProgramMedia() {
  const out = [];
  let productDirs;
  try {
    productDirs = fs.readdirSync(MEDIA_DIR, { withFileTypes: true });
  } catch {
    return out; // nothing uploaded yet
  }
  for (const dir of productDirs) {
    if (!dir.isDirectory()) continue;
    let files;
    try {
      files = fs.readdirSync(path.join(MEDIA_DIR, dir.name));
    } catch {
      continue;
    }
    for (const file of files) {
      const stat = safeStat(path.join(MEDIA_DIR, dir.name, file));
      if (!stat || !stat.isFile()) continue;
      const ext = path.extname(file).toLowerCase();
      out.push({
        key: `program:${dir.name}/${file}`,
        source: "program",
        productId: dir.name,
        fileName: file,
        url: `/api/library/media/${dir.name}/${file}`,
        type: ext === ".mp4" || ext === ".webm" ? "video" : "image",
        bytes: stat.size,
        createdAt: stat.mtime.toISOString(),
      });
    }
  }
  return out;
}

router.get("/media-library", async (req, res) => {
  const { search, type } = req.query;

  const [galleryRows, resourceRows, products] = await Promise.all([
    prisma.productMedia.findMany({ orderBy: { createdAt: "desc" } }),
    prisma.productResource.findMany({ where: { type: "file" }, orderBy: { createdAt: "desc" } }),
    prisma.product.findMany({ select: { id: true, name: true } }),
  ]);
  const productName = new Map(products.map((p) => [p.id, p.name]));

  let items = [
    ...galleryRows.map((m) => ({
      key: `gallery:${m.id}`,
      source: "gallery",
      productId: m.productId,
      fileName: path.basename(m.url),
      url: m.url,
      type: m.type,
      alt: m.alt,
      bytes: (safeStat(path.join(SITE_ROOT, m.url.replace(/^\//, ""))) || {}).size || null,
      createdAt: m.createdAt.toISOString(),
    })),
    ...listProgramMedia(),
    ...resourceRows.map((r) => ({
      key: `resource:${r.id}`,
      source: "resource",
      productId: r.productId,
      fileName: r.fileName,
      url: null, // resources are download-gated; reused by reference, not URL
      title: r.title,
      type: "file",
      bytes: (safeStat(path.join(RESOURCE_DIR, r.fileName || ""))|| {}).size || null,
      createdAt: r.createdAt.toISOString(),
    })),
  ];

  items.forEach((i) => { i.productName = productName.get(i.productId) || null; });

  if (type) items = items.filter((i) => i.type === String(type));
  if (search) {
    const term = String(search).toLowerCase();
    items = items.filter((i) =>
      (i.fileName || "").toLowerCase().includes(term) ||
      (i.title || "").toLowerCase().includes(term) ||
      (i.productName || "").toLowerCase().includes(term)
    );
  }
  items.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));

  res.json({ media: items.slice(0, 500), total: items.length });
});

// Reuse an existing program-media file inside a different product.
//
// This CANNOT be done by simply reusing the URL. /api/library/media/:productId
// authorizes on the product id in the path, so a customer who bought program B
// would get a 403 on a demo GIF whose URL still points at program A. The file
// is copied into the target product's own media directory and a fresh URL
// returned — a few KB of duplication in exchange for an entitlement check that
// stays correct.
router.post("/products/:id/media/reuse", async (req, res) => {
  const { sourceProductId, fileName } = req.body;
  if (!sourceProductId || !fileName) return res.status(400).json({ error: "sourceProductId and fileName are required" });
  if (path.basename(fileName) !== fileName) return res.status(400).json({ error: "Invalid file name" });
  if (path.basename(sourceProductId) !== sourceProductId) return res.status(400).json({ error: "Invalid product id" });

  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  const sourcePath = path.join(MEDIA_DIR, sourceProductId, fileName);
  // Both operands are already basename-checked above; this is the belt-and-
  // braces check that the resolved path really is inside the media root.
  if (!sourcePath.startsWith(MEDIA_DIR + path.sep)) return res.status(400).json({ error: "Invalid source" });
  if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: "That media file no longer exists" });

  // Same product — nothing to copy, the existing URL already authorizes.
  if (sourceProductId === product.id) {
    const ext = path.extname(fileName).toLowerCase();
    return res.json({
      url: `/api/library/media/${product.id}/${fileName}`,
      mediaType: ext === ".mp4" || ext === ".webm" ? "video" : "image",
      copied: false,
    });
  }

  const destDir = path.join(MEDIA_DIR, product.id);
  fs.mkdirSync(destDir, { recursive: true });
  const ext = path.extname(fileName).replace(/[^.a-z0-9]/gi, "") || ".bin";
  const destName = `${crypto.randomUUID()}${ext}`;
  await fs.promises.copyFile(sourcePath, path.join(destDir, destName));

  await logEvent({
    category: "product",
    message: `Reused media from product ${sourceProductId} in "${product.name}"`,
    actorId: req.user.id,
  });

  res.json({
    url: `/api/library/media/${product.id}/${destName}`,
    mediaType: ext === ".mp4" || ext === ".webm" ? "video" : "image",
    copied: true,
  });
});

// Reuse an existing public gallery file as a gallery slide on another product.
// Gallery files are public, so this one really can share a URL — but it still
// copies, so deleting the slide from product A (which unlinks the file) can't
// silently blank out product B's carousel.
//
// `asSlide: false` copies the file and returns the new URL WITHOUT adding a
// carousel row: that is the exercise/block case, where the admin picked a
// gallery image as a demo still and would be surprised to find it had also
// appeared in the storefront carousel.
router.post("/products/:id/gallery/reuse", async (req, res) => {
  const { url, asSlide } = req.body;
  if (!url || typeof url !== "string") return res.status(400).json({ error: "url is required" });

  const product = await prisma.product.findUnique({ where: { id: req.params.id } });
  if (!product) return res.status(404).json({ error: "Product not found" });

  const GALLERY_DIR = path.join(SITE_ROOT, "assets", "images", "product", "gallery");
  const relative = url.replace(/^\//, "");
  const sourcePath = path.join(SITE_ROOT, relative);
  if (!sourcePath.startsWith(GALLERY_DIR + path.sep)) return res.status(400).json({ error: "Not a gallery file" });
  if (!fs.existsSync(sourcePath)) return res.status(404).json({ error: "That file no longer exists" });

  const destDir = path.join(GALLERY_DIR, product.id);
  fs.mkdirSync(destDir, { recursive: true });
  const ext = path.extname(sourcePath).replace(/[^.a-z0-9]/gi, "") || ".bin";
  const destName = `${crypto.randomUUID()}${ext}`;
  await fs.promises.copyFile(sourcePath, path.join(destDir, destName));
  const newUrl = `/assets/images/product/gallery/${product.id}/${destName}`;

  if (asSlide === false) {
    return res.json({ url: newUrl, mediaType: ext === ".mp4" || ext === ".webm" ? "video" : "image", copied: true });
  }

  const last = await prisma.productMedia.findFirst({
    where: { productId: product.id },
    orderBy: { order: "desc" },
    select: { order: true },
  });

  const created = await prisma.productMedia.create({
    data: {
      productId: product.id,
      url: newUrl,
      type: ext === ".mp4" || ext === ".webm" ? "video" : "image",
      order: last ? last.order + 1 : 0,
    },
  });

  res.json({ media: created });
});

module.exports = router;
