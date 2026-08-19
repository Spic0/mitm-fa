const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { prisma } = require("../../db");
const { logEvent } = require("../../lib/adminLog");
const { getSettings } = require("../../lib/settings");
const { verifyUploadedFile } = require("../../lib/uploadVerify");
const { optimizeImageInPlace } = require("../../lib/imageOptimize");

const router = express.Router();

const SITE_ROOT = path.join(__dirname, "..", "..", "..", "..");
const LOGO_DIR = path.join(SITE_ROOT, "assets", "images", "logo", "uploads");
fs.mkdirSync(LOGO_DIR, { recursive: true });

// The only settings ever writable through this API. This is a store-admin
// surface, not a developer/ops one: real secrets (Stripe/PayPal/Resend keys,
// DB/storage/cloud credentials, anything env-var-shaped) must never appear
// here in any form, not even masked/read-only. Those stay exclusively in the
// server's environment configuration.
// demoProductSlug picks the product behind the public /demo preview. It is
// safe on this surface: lib/demo.js re-checks that the slug resolves to a
// PUBLISHED product before showing anything, so pointing it at a draft or a
// bad slug falls back rather than publishing something by accident.
const EDITABLE_KEYS = ["storeName", "currency", "taxRate", "emailFromName", "demoProductSlug"];

router.get("/", async (req, res) => {
  const settings = await getSettings();
  res.json({ settings });
});

router.put("/", async (req, res) => {
  const rejected = Object.keys(req.body).filter((k) => !EDITABLE_KEYS.includes(k));
  if (rejected.length) {
    return res.status(400).json({ error: `These settings can't be edited from the dashboard: ${rejected.join(", ")}` });
  }

  await Promise.all(
    EDITABLE_KEYS.filter((key) => req.body[key] !== undefined).map((key) => {
      const value = String(req.body[key]);
      return prisma.setting.upsert({ where: { key }, update: { value }, create: { key, value } });
    })
  );

  await logEvent({ category: "admin", message: "Updated platform settings", actorId: req.user.id });
  res.json({ ok: true });
});

// SVG was previously excluded here on the grounds that it is a text/XML
// format that can carry <script>, event-handler attributes or external
// references, and that this file is served straight from the public webroot.
// That reasoning was correct and still is — a *regex sanitizer alone* is a
// known-weak control, and this comment used to say so.
//
// SVG is allowed now because it is no longer a regex alone. Three independent
// layers have to fail before an uploaded SVG can run anything:
//   1. lib/svgSanitize.js strips the dangerous constructs and then re-scans,
//      rejecting the upload outright if any survive (fail closed, not "clean
//      it up and hope");
//   2. every .svg response carries `Content-Security-Policy: sandbox;
//      script-src 'none'` and `X-Content-Type-Options: nosniff` — see the
//      static handler in src/index.js. This is the layer that actually makes
//      a direct hit on the file URL safe, independent of layer 1;
//   3. a logo renders through <img>/CSS, where browsers already refuse to run
//      script in an SVG at all.
// Uploading here is also admin-only. Drop image/svg+xml from this set to go
// back to raster-only; nothing else needs to change.
const LOGO_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif", "image/svg+xml"]);

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, LOGO_DIR);
    },
    filename(req, file, cb) {
      cb(null, `${crypto.randomUUID()}.bin`);
    },
  }),
  limits: { fileSize: 100 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    // Same reasoning as products.js: a generic declared type falls through to
    // the magic-byte check rather than being refused sight-unseen.
    var declared = (file.mimetype || "").toLowerCase().trim();
    if (!LOGO_MIME.has(declared) && declared !== "application/octet-stream" && declared !== "") {
      const err = new Error("Logo must be PNG, JPG, WebP, GIF, or SVG");
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
});

router.post("/logo", upload.single("logo"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "A logo image is required" });

  const verified = await verifyUploadedFile(req.file.path, LOGO_MIME);
  if (!verified.ok) return res.status(400).json({ error: verified.reason });
  const finalName = `${path.basename(req.file.filename, path.extname(req.file.filename))}.${verified.ext}`;
  const finalPath = path.join(LOGO_DIR, finalName);
  await fs.promises.rename(req.file.path, finalPath);
  req.file.filename = finalName;
  await optimizeImageInPlace(finalPath, verified.mime);

  const logoUrl = `assets/images/logo/uploads/${req.file.filename}`;
  await prisma.setting.upsert({
    where: { key: "logoUrl" },
    update: { value: logoUrl },
    create: { key: "logoUrl", value: logoUrl },
  });
  await logEvent({ category: "admin", message: "Updated store logo", actorId: req.user.id });
  res.json({ logoUrl });
});

module.exports = router;
