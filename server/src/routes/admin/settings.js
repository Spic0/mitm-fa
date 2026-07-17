const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { prisma } = require("../../db");
const { logEvent } = require("../../lib/adminLog");
const { getSettings } = require("../../lib/settings");
const { verifyUploadedFile } = require("../../lib/uploadVerify");

const router = express.Router();

const SITE_ROOT = path.join(__dirname, "..", "..", "..", "..");
const LOGO_DIR = path.join(SITE_ROOT, "assets", "images", "logo", "uploads");
fs.mkdirSync(LOGO_DIR, { recursive: true });

// The only settings ever writable through this API. This is a store-admin
// surface, not a developer/ops one: real secrets (Stripe/PayPal/Resend keys,
// DB/storage/cloud credentials, anything env-var-shaped) must never appear
// here in any form, not even masked/read-only. Those stay exclusively in the
// server's environment configuration.
const EDITABLE_KEYS = ["storeName", "currency", "taxRate", "emailFromName"];

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

// SVG is deliberately not allowed: it's a text/XML format that can carry
// <script>, event-handler attributes, or externally-referenced content, and
// this file is served directly from the public webroot. Regex-based SVG
// sanitization is a known-weak control (foreignObject, xlink:href
// javascript:, CSS-embedded scripts all slip past naive checks), so raster
// formats only, same allowlist as product images.
const LOGO_MIME = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

const upload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      cb(null, LOGO_DIR);
    },
    filename(req, file, cb) {
      cb(null, `${crypto.randomUUID()}.bin`);
    },
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(req, file, cb) {
    if (!LOGO_MIME.has(file.mimetype)) {
      const err = new Error("Logo must be PNG, JPG, WebP, or GIF");
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
  await fs.promises.rename(req.file.path, path.join(LOGO_DIR, finalName));
  req.file.filename = finalName;

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
