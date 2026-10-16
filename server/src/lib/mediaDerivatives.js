const fs = require("fs");
const path = require("path");

// Responsive derivative generation for uploaded product imagery.
//
// The problem this solves is two problems at once:
//
//   1. PERFORMANCE — a product card is ~280px wide and was being handed the
//      full-resolution upload. One real cover on this site is a 1920x480,
//      636KB PNG being painted into a 280px box. Cards now request a width
//      that matches how they are actually displayed.
//
//   2. LAYOUT — the card must not change shape because of what was uploaded.
//      That is a rendering decision, but it needs facts about the image
//      (dimensions, aspect ratio, orientation) that are only cheaply available
//      here, at upload time. Those are measured once and written to a sidecar
//      manifest so the storefront never has to probe the file.
//
// Deliberately NO database migration: everything lives in a `<name>.media.json`
// sidecar next to the image. Product.imageUrl stays the single source of truth
// and keeps working untouched, nothing needs backfilling in the DB before this
// can ship, and rolling the whole feature back is `rm *.media.json` plus
// reverting the code. The manifests are cheap to read and cached in memory
// below, so the cost of not having a column is one stat() per image per boot.

let sharp;
let sharpState = "unloaded";
function loadSharp() {
  if (sharpState === "unloaded") {
    try {
      sharp = require("sharp");
      sharpState = "ready";
    } catch (err) {
      sharpState = "unavailable";
      console.warn("[mediaDerivatives] sharp unavailable — serving originals without derivatives.");
    }
  }
  return sharpState === "ready" ? sharp : null;
}

// Card media is displayed at ~280-420px CSS px depending on breakpoint, so
// these cover 1x through 3x without shipping anything larger than a card can
// ever use. 1280 is the retina tier for the widest card.
const WIDTHS = [320, 640, 960, 1280];

// AVIF first (smallest), WebP second (universal since ~2020), and the
// already-optimized original as the final fallback via <img src>.
const FORMATS = [
  { ext: "avif", mime: "image/avif" },
  { ext: "webp", mime: "image/webp" },
];

// Vector and animated formats are passed through untouched: an SVG is already
// resolution-independent, and rasterising a GIF would drop its animation.
const RASTER = new Set(["image/jpeg", "image/png", "image/webp", "image/avif"]);

function manifestPathFor(imagePath) {
  return imagePath.replace(/\.[^.]+$/, "") + ".media.json";
}

function derivativeName(basename, width, ext) {
  return `${basename}-${width}.${ext}`;
}

// How the storefront should fit this image inside a fixed-ratio container.
// Computed here rather than in CSS because CSS cannot see the image's
// dimensions before it loads, and guessing is what produces the layout jumps
// this whole change exists to remove.
//
// CARD_AR is the container's aspect ratio (4:3). The rule:
//   - close to the container's shape  -> cover  (fills edge to edge, tiny crop)
//   - meaningfully taller or wider    -> contain (whole image visible, on a
//                                        blurred backdrop so the box still
//                                        reads as full-bleed)
//   - smaller than the box it sits in -> contain, never upscale into mush
const CARD_AR = 4 / 3;
const COVER_TOLERANCE = 0.35; // how far from CARD_AR still crops acceptably

function chooseFit(width, height) {
  if (!width || !height) return { fit: "cover", reason: "unknown dimensions" };
  const ar = width / height;
  const orientation = ar > 1.05 ? "landscape" : ar < 0.95 ? "portrait" : "square";

  // Anything that would have to be blown up past its own resolution to fill a
  // card looks worse cropped than it does letterboxed. `tiny` additionally
  // tells the client to cap how far it may be scaled up at all: a 32x32
  // favicon stretched to fill a 330px box is an unreadable smear, and no
  // amount of fitting makes pixels that were never there. Better to show it
  // small and sharp, centred on its own blurred backdrop.
  if (width < 320) {
    return { fit: "contain", orientation, ar, tiny: true, reason: "image is smaller than a card" };
  }
  const distance = Math.abs(Math.log(ar / CARD_AR));
  if (distance <= COVER_TOLERANCE) {
    return { fit: "cover", orientation, ar, reason: "close to card ratio" };
  }
  return {
    fit: "contain",
    orientation,
    ar,
    reason: ar > CARD_AR ? "much wider than the card (banner/screenshot)" : "much taller than the card (portrait/phone screenshot)",
  };
}

// A tiny blurred inline preview. Rendered behind the real image so the card
// shows something immediately instead of an empty box, and — because it is a
// data URI in the markup — it costs no extra request.
async function buildPlaceholder(lib, filePath) {
  try {
    const buf = await lib(filePath, { failOn: "none" })
      .resize(20, 20, { fit: "inside" })
      .blur(1.2)
      .webp({ quality: 40 })
      .toBuffer();
    return `data:image/webp;base64,${buf.toString("base64")}`;
  } catch (err) {
    return null;
  }
}

async function dominantColour(lib, filePath) {
  try {
    const { dominant } = await lib(filePath, { failOn: "none" }).stats();
    if (!dominant) return null;
    return `#${[dominant.r, dominant.g, dominant.b].map((c) => c.toString(16).padStart(2, "0")).join("")}`;
  } catch (err) {
    return null;
  }
}

// Generates every derivative for one already-verified, already-optimized
// upload and writes the sidecar manifest. Best-effort throughout: a failure
// here must never fail the upload, because the original on disk is complete
// and perfectly serveable on its own.
async function generateDerivatives(filePath, mime, publicUrlBase) {
  const basename = path.basename(filePath).replace(/\.[^.]+$/, "");
  const dir = path.dirname(filePath);

  const base = {
    version: 1,
    original: `${publicUrlBase}/${path.basename(filePath)}`,
    mime,
    generatedAt: new Date().toISOString(),
  };

  const lib = loadSharp();
  if (!lib || !RASTER.has(mime)) {
    // SVG/GIF (or no sharp): still record what we can so the storefront gets a
    // consistent shape and a sane fit mode rather than a missing manifest.
    const manifest = {
      ...base,
      derivatives: [],
      // An SVG scales to any box; treat it as container-shaped so it fills the
      // card cleanly instead of being letterboxed on a blurred backdrop.
      ...(mime === "image/svg+xml"
        ? { width: null, height: null, fit: "contain", orientation: "vector", padded: true }
        : { fit: "cover", orientation: "unknown" }),
    };
    await fs.promises.writeFile(manifestPathFor(filePath), JSON.stringify(manifest, null, 2)).catch(() => {});
    return manifest;
  }

  try {
    const meta = await lib(filePath, { failOn: "none" }).metadata();
    const fitInfo = chooseFit(meta.width, meta.height);

    const derivatives = [];
    for (const width of WIDTHS) {
      // Never upscale: a 400px original gets a 320 derivative and nothing
      // above it, so we don't ship bytes that add no detail.
      if (meta.width && width > meta.width) continue;
      for (const fmt of FORMATS) {
        const outName = derivativeName(basename, width, fmt.ext);
        const outPath = path.join(dir, outName);
        try {
          let pipe = lib(filePath, { failOn: "none" }).resize({ width, withoutEnlargement: true });
          // effort is deliberately low: this runs inline in an upload request,
          // and AVIF's default effort can take several seconds per image.
          pipe = fmt.ext === "avif" ? pipe.avif({ quality: 55, effort: 2 }) : pipe.webp({ quality: 76 });
          const buf = await pipe.toBuffer();
          await fs.promises.writeFile(outPath, buf);
          derivatives.push({ url: `${publicUrlBase}/${outName}`, width, format: fmt.ext, mime: fmt.mime, bytes: buf.length });
        } catch (err) {
          // One failed size/format is not worth failing the rest over.
        }
      }
    }

    const manifest = {
      ...base,
      width: meta.width || null,
      height: meta.height || null,
      aspectRatio: meta.width && meta.height ? Math.round((meta.width / meta.height) * 1000) / 1000 : null,
      orientation: fitInfo.orientation,
      fit: fitInfo.fit,
      tiny: !!fitInfo.tiny,
      fitReason: fitInfo.reason,
      placeholder: await buildPlaceholder(lib, filePath),
      colour: await dominantColour(lib, filePath),
      derivatives,
    };

    await fs.promises.writeFile(manifestPathFor(filePath), JSON.stringify(manifest, null, 2));
    return manifest;
  } catch (err) {
    console.error("[mediaDerivatives] generation failed, original still serveable:", err.message);
    return base;
  }
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

// Manifests are immutable once written (uploads are UUID-named and never
// rewritten in place), so they can be cached for the life of the process.
// A miss is cached too, as `null`, so a product whose image predates this
// feature doesn't re-stat the disk on every single request.
const cache = new Map();

function readManifestSync(imageAbsPath) {
  if (cache.has(imageAbsPath)) return cache.get(imageAbsPath);
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPathFor(imageAbsPath), "utf8"));
  } catch (err) {
    manifest = null;
  }
  cache.set(imageAbsPath, manifest);
  return manifest;
}

function invalidate(imageAbsPath) {
  cache.delete(imageAbsPath);
}

// Builds the compact shape the storefront needs: a srcset per format, the fit
// mode, the placeholder, and the intrinsic size so the browser can reserve the
// exact box before a single byte of image arrives.
function mediaPayload(imageAbsPath) {
  const m = readManifestSync(imageAbsPath);
  if (!m) return null;

  const byFormat = {};
  for (const d of m.derivatives || []) {
    (byFormat[d.format] = byFormat[d.format] || []).push(d);
  }
  const sources = Object.entries(byFormat).map(([format, list]) => ({
    type: list[0].mime,
    srcset: list.sort((a, b) => a.width - b.width).map((d) => `${d.url} ${d.width}w`).join(", "),
  }));

  return {
    src: m.original,
    width: m.width || null,
    height: m.height || null,
    aspectRatio: m.aspectRatio || null,
    fit: m.fit || "cover",
    tiny: !!m.tiny,
    orientation: m.orientation || "unknown",
    placeholder: m.placeholder || null,
    colour: m.colour || null,
    sources,
  };
}

// Admin-facing guidance about an upload that was just accepted.
//
// The platform's contract is that ANY image renders correctly — the container
// guarantees that, and none of these warnings block or alter anything. They
// exist so an admin who uploads a phone screenshot as a cover understands why
// it appears letterboxed on a blurred backdrop rather than filling the card,
// and knows what to upload instead if they want edge-to-edge.
//
// Returns null when the image is a good fit and there is nothing useful to say.
function describeForAdmin(manifest) {
  if (!manifest || !manifest.width || !manifest.height) return null;

  const { width, height, fit, orientation } = manifest;
  const ideal = `For an edge-to-edge cover, upload roughly 4:3 (e.g. 1600x1200) at 960px wide or more.`;

  if (manifest.tiny) {
    return {
      level: "warning",
      message: `That image is only ${width}x${height}px — smaller than the card it has to fill. It will be shown small and sharp rather than blown up and blurry. ${ideal}`,
    };
  }
  if (fit === "contain" && orientation === "portrait") {
    return {
      level: "notice",
      message: `That's a tall ${width}x${height} image, so it will be shown in full on a blurred backdrop instead of being cropped. ${ideal}`,
    };
  }
  if (fit === "contain" && orientation === "landscape") {
    return {
      level: "notice",
      message: `That's a wide ${width}x${height} banner, so it will be shown in full on a blurred backdrop instead of being cropped to a strip. ${ideal}`,
    };
  }
  if (width < 960) {
    return {
      level: "notice",
      message: `That image is ${width}px wide, so it may look soft on high-resolution screens. 960px or wider is ideal.`,
    };
  }
  return null;
}

module.exports = {
  describeForAdmin,
  generateDerivatives,
  mediaPayload,
  readManifestSync,
  invalidate,
  chooseFit,
  manifestPathFor,
  WIDTHS,
  CARD_AR,
};
