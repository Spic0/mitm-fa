// The customer's own account — /api/account/*.
//
// Every route requires a session (router.use(requireAuth) below), and every
// handler acts on req.user and NEVER on an id from the request. That is the
// whole
// authorization model for this file and it is deliberately not
// parameterised: there is no /api/account/:id, so there is no object whose
// ownership could be got wrong. A customer editing "their" profile can only
// ever address themselves.
//
// Password changes are NOT here — they stay on /api/auth/set-password, which
// already implements the rule that matters (changing an existing password
// requires re-entering the current one, so a stolen session cannot plant a
// permanent credential). Duplicating it would mean two places to get that
// rule right.
const express = require("express");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const multer = require("multer");
const { prisma } = require("../db");
const { logEvent } = require("../lib/adminLog");
const { verifyUploadedFile } = require("../lib/uploadVerify");
const { optimizeImageInPlace } = require("../lib/imageOptimize");
const { generateDerivatives, invalidate: invalidateMedia } = require("../lib/mediaDerivatives");
const { requireAuth } = require("../middleware/auth");
const { ProfileError, buildProfileUpdate, toCustomerProfile } = require("../lib/customerProfile");

const router = express.Router();

// Every route below, without exception. Applied here rather than at the
// mount so it cannot be dropped by editing index.js.
router.use(requireAuth);

const SITE_ROOT = path.join(__dirname, "..", "..", "..");
// Same directory, pipeline and public base as every other uploaded image on
// the platform, so avatars get the identical derivative/LQIP treatment and
// nothing new has to be taught to serve them.
const AVATAR_DIR = path.join(SITE_ROOT, "assets", "images", "product", "uploads");
const AVATAR_PUBLIC_BASE = "assets/images/product/uploads";
const MAX_AVATAR_BYTES = 8 * 1024 * 1024;

const AVATAR_MIME = new Set(["image/png", "image/jpeg", "image/webp"]);
const GENERIC_DECLARED_TYPES = new Set([
  "", "application/octet-stream", "binary/octet-stream", "application/x-empty",
]);

// SVG is not accepted, for the same reason it is not accepted for a partner
// avatar: a headshot has no vector use case, and every SVG served here needs
// a sanitizer plus a sandboxed CSP to be safe. Not a surface worth opening
// for a profile picture — least of all one any signed-up customer can post.
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
      const err = new Error("Profile photo must be a PNG, JPG or WebP");
      err.status = 400;
      return cb(err);
    }
    cb(null, true);
  },
}).single("avatar");

function loadSelf(userId) {
  return prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true, email: true, name: true, displayName: true, phone: true,
      country: true, avatarUrl: true, passwordHash: true, createdAt: true,
    },
  });
}

// ---------------------------------------------------------------------
// GET /api/account/profile
// ---------------------------------------------------------------------
router.get("/profile", async (req, res) => {
  const user = await loadSelf(req.user.id);
  if (!user) return res.status(404).json({ error: "Account not found" });
  res.json({ profile: toCustomerProfile(user) });
});

// ---------------------------------------------------------------------
// PATCH /api/account/profile
//
// Partial by design: My Profile saves one card at a time, so a body carrying
// only { phone } must leave name and country exactly as they were. See
// buildProfileUpdate — absent keys are absent from the update, which is not
// the same as null.
// ---------------------------------------------------------------------
router.patch("/profile", async (req, res) => {
  let data;
  try {
    data = buildProfileUpdate(req.body);
  } catch (err) {
    if (err instanceof ProfileError) return res.status(400).json({ error: err.message });
    throw err;
  }
  if (!Object.keys(data).length) {
    return res.status(400).json({ error: "Nothing to update" });
  }

  await prisma.user.update({ where: { id: req.user.id }, data });
  // Logged as the customer's own action. No field VALUES in the message —
  // this log is readable by staff and a phone number is the customer's, not
  // ours to scatter through the system log.
  await logEvent({
    category: "user",
    message: `Customer updated their profile (${Object.keys(data).join(", ")})`,
    actorId: req.user.id,
    ip: req.ip,
  });

  const user = await loadSelf(req.user.id);
  res.json({ profile: toCustomerProfile(user) });
});

// ---------------------------------------------------------------------
// POST /api/account/avatar
// ---------------------------------------------------------------------
router.post("/avatar", (req, res) => {
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

    // Content sniffing, not the declared mimetype: the filter above only saw
    // what the browser claimed. verifyUploadedFile deletes the file itself
    // when it rejects, so there is nothing to clean up on this path.
    const result = await verifyUploadedFile(req.file.path, AVATAR_MIME);
    if (!result.ok) {
      return res.status(400).json({ error: result.reason || "That file is not a valid image" });
    }

    const finalName = `${path.basename(req.file.filename, path.extname(req.file.filename))}.${result.ext}`;
    const finalPath = path.join(AVATAR_DIR, finalName);
    await fs.promises.rename(req.file.path, finalPath);

    await optimizeImageInPlace(finalPath, result.mime);
    await generateDerivatives(finalPath, result.mime, AVATAR_PUBLIC_BASE);
    invalidateMedia(finalPath);

    await prisma.user.update({
      where: { id: req.user.id },
      data: { avatarUrl: `${AVATAR_PUBLIC_BASE}/${finalName}` },
    });
    await logEvent({
      category: "user",
      message: "Customer updated their profile photo",
      actorId: req.user.id,
      ip: req.ip,
    });

    const user = await loadSelf(req.user.id);
    res.json({ profile: toCustomerProfile(user) });
  });
});

// ---------------------------------------------------------------------
// DELETE /api/account/avatar
//
// Clears the reference only; the file is left on disk. Deleting it would
// break any derivative already cached against that path, and an orphaned
// 40KB image is a much smaller problem than a 404 in someone's profile.
// ---------------------------------------------------------------------
router.delete("/avatar", async (req, res) => {
  await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl: null } });
  await logEvent({
    category: "user",
    message: "Customer removed their profile photo",
    actorId: req.user.id,
    ip: req.ip,
  });
  const user = await loadSelf(req.user.id);
  res.json({ profile: toCustomerProfile(user) });
});

module.exports = router;
