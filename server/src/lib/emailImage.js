// Email-safe rasters for product covers.
//
// The storefront's derivative pipeline (lib/mediaDerivatives.js) emits AVIF
// and WebP only. Outlook renders neither, and older Apple Mail does not do
// WebP either, so a receipt that reuses those URLs shows a broken image to a
// large share of customers. The original upload is not an option either: the
// catalog holds covers up to 1290x2796 PNG, and posting one of those into a
// receipt is megabytes of mail for a 76px thumbnail.
//
// So email gets its own rendition: a small, square, white-flattened JPEG,
// generated once per cover and cached next to it. Generation happens on first
// use rather than in a build step, because covers are uploaded through the
// admin panel at any time and a receipt must never wait on someone
// remembering to run a script.
const fs = require("fs");
const path = require("path");

const SITE_ROOT = path.join(__dirname, "..", "..", "..");

// 76px in the template, doubled for retina. Small enough that the whole
// thing lands around 8-15KB.
const EMAIL_PX = 152;
const SUFFIX = "-email.jpg";

// Only ever read from the public asset tree, and only image extensions — this
// takes a URL that ultimately came from an admin upload record.
//
// SVG is included because the catalog genuinely uses it: every demo cover is
// an SVG, and those are exactly the products a receipt has to illustrate.
// Rasterising one here is also the only way it reaches a mail client at all,
// since none of them render SVG.
const RASTER_EXT = new Set([".png", ".jpg", ".jpeg", ".webp", ".avif", ".svg"]);

function loadSharp() {
  try {
    return require("sharp");
  } catch (err) {
    return null;
  }
}

// "/assets/images/product/uploads/x.png" -> absolute path, or null if the
// path escapes the asset tree or is not an image we can read.
// Catalog rows store both forms — "/assets/…" from the admin uploader and
// "assets/…" from the seeded demo covers — and a receipt has to illustrate
// either. Normalising here rather than at each call site keeps that detail in
// one place.
function normalise(publicPath) {
  const clean = String(publicPath || "").split("?")[0].split("#")[0].trim();
  if (!clean) return "";
  return clean.startsWith("/") ? clean : `/${clean}`;
}

function resolveLocal(publicPath) {
  if (!publicPath || /^https?:\/\//i.test(publicPath)) return null;
  const clean = normalise(publicPath);
  if (!clean.startsWith("/assets/")) return null;
  const abs = path.join(SITE_ROOT, clean);
  if (!abs.startsWith(path.join(SITE_ROOT, "assets"))) return null;
  if (!RASTER_EXT.has(path.extname(abs).toLowerCase())) return null;
  return abs;
}

// The email rendition's public path for a given cover, generating it if it
// does not exist yet. Returns null when there is nothing usable — callers
// render the card without a cover rather than falling back to a huge
// original.
async function emailCoverPath(publicPath) {
  const abs = resolveLocal(publicPath);
  if (!abs || !fs.existsSync(abs)) return null;

  const outAbs = abs.replace(/\.[^.]+$/, "") + SUFFIX;
  const outPublic = normalise(publicPath).replace(/\.[^.]+$/, "") + SUFFIX;

  try {
    // Regenerate if the source has changed since the rendition was made.
    if (fs.existsSync(outAbs) && fs.statSync(outAbs).mtimeMs >= fs.statSync(abs).mtimeMs) {
      return outPublic;
    }
    const sharp = loadSharp();
    if (!sharp) return null;

    // density only affects vector input; it is what stops an SVG cover
    // rasterising at its nominal size and arriving soft.
    await sharp(abs, { density: 300 })
      // Square crop, matching the 76x76 slot in the receipt. `cover` keeps
      // the middle of a tall phone-screenshot cover rather than letterboxing
      // it into grey bars at thumbnail size.
      .resize(EMAIL_PX, EMAIL_PX, { fit: "cover", position: "attention" })
      // JPEG has no alpha, and an un-flattened transparent PNG turns black
      // when converted. White matches the card the thumbnail sits on.
      .flatten({ background: "#ffffff" })
      .jpeg({ quality: 78, progressive: true, mozjpeg: true })
      .toFile(outAbs);

    return outPublic;
  } catch (err) {
    // A cover that will not render is a missing thumbnail, never a failed
    // receipt.
    console.error("emailImage: could not build email rendition for", publicPath, err.message);
    return null;
  }
}

module.exports = { emailCoverPath, EMAIL_PX, SUFFIX };
