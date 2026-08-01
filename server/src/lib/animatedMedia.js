// Derivatives for GATED program media (exercise demo GIFs), which lives in
// server/storage/media/<productId>/ and is served only to entitled customers.
//
// This is a different problem from lib/mediaDerivatives.js, which handles
// public product imagery. That module deliberately passes GIFs through
// untouched — "rasterising a GIF would drop its animation" — which was the
// right call for a cover image and completely wrong for the handbook, where
// GIFs ARE the content. The result was that a purchased program's exercise
// demos were served as raw GIF at upload resolution:
//
//   one real handbook GIF: 1920x1080, 27 frames, 15.5MB, painted into a
//   ~400px demo box. Six of them on one page is ~75MB.
//
// Two derivatives fix that, and animation survives both:
//
//   -poster.webp   first frame only, ~19KB   (815x smaller)
//   -anim.webp     animated, width-capped, ~226KB   (70x smaller)
//
// The handbook shows the poster immediately and only fetches the animation
// when a demo is actually looked at, so the page costs ~114KB of media
// instead of 75MB.
//
// Everything here is best-effort: the verified original is always complete and
// serveable on its own, and the read side falls back to it whenever a
// derivative is missing. A program uploaded before this existed keeps working.
const fs = require("fs");
const path = require("path");
const { generateVideoDerivatives } = require("./videoDerivatives");

let sharp;
let sharpState = "unloaded";
function loadSharp() {
  if (sharpState === "unloaded") {
    try {
      sharp = require("sharp");
      sharpState = "ready";
    } catch (err) {
      sharpState = "unavailable";
      console.warn("[animatedMedia] sharp unavailable — serving originals without derivatives.");
    }
  }
  return sharpState === "ready" ? sharp : null;
}

// A demo box is ~400 CSS px at its widest; 640 covers it at 1.5x and still
// leaves the animation legible fullscreen in the lightbox. Going wider costs
// bytes for detail nobody sees — the source is a phone-shot exercise clip, not
// a photograph.
const ANIM_WIDTH = 640;
const POSTER_WIDTH = 640;

// quality 50 measured at 226KB for the 15.5MB source above; 60 cost 30KB more
// for no visible gain on this kind of footage. effort 4 is the knee of the
// size/time curve — this runs in a background job, but a queue that takes ten
// seconds per file is still a queue that backs up.
const ANIM_QUALITY = 50;
const ANIM_EFFORT = 4;
const POSTER_QUALITY = 72;

// List/grid tile width. A quarter of the poster's area, for indexes and
// anywhere a demo is shown small.
const THUMB_WIDTH = 320;

const ANIMATABLE = new Set(["image/gif", "image/webp"]);

function posterPathFor(filePath) {
  return filePath.replace(/\.[^.]+$/, "") + "-poster.webp";
}
function animPathFor(filePath) {
  return filePath.replace(/\.[^.]+$/, "") + "-anim.webp";
}
// A list/grid still, a quarter the area of the poster. The poster is sized for
// the demo box; this is for anywhere a demo appears as a small tile.
function thumbPathFor(filePath) {
  return filePath.replace(/\.[^.]+$/, "") + "-thumb.webp";
}
function manifestPathFor(filePath) {
  return filePath.replace(/\.[^.]+$/, "") + ".gmedia.json";
}

// Derivative filenames are derived from the original's by suffix, so a caller
// holding only the stored URL can ask for a variant without a database lookup
// and without the stored URL ever being rewritten. Keep in sync with
// variantFileName() below, which is the read side of the same convention.
function variantFileName(fileName, variant) {
  const base = fileName.replace(/\.[^.]+$/, "");
  if (variant === "poster") return `${base}-poster.webp`;
  if (variant === "thumb") return `${base}-thumb.webp`;
  if (variant === "anim") return `${base}-anim.webp`;
  if (variant === "mp4") return `${base}-vid.mp4`;
  if (variant === "webm") return `${base}-vid.webm`;
  return fileName;
}

// Which variants must NEVER silently fall back to the original.
//
// The still variants can: a missing poster serving the original GIF is just
// the old, heavier behaviour, and it still renders. A missing VIDEO variant
// must not, because the fallback would be handed to a <video> element that
// cannot decode a GIF — the customer would get a dead player AND pay the full
// 15MB for the privilege. These 404 instead, which is the signal the handbook
// uses to render the <img> path.
const STRICT_VARIANTS = new Set(["mp4", "webm"]);

// Generates poster + animated derivatives for one already-verified upload.
// Never throws: a failure leaves the original in place and returns what it got.
async function generateAnimatedDerivatives(filePath, mime) {
  const base = { version: 1, mime, generatedAt: new Date().toISOString() };

  const lib = loadSharp();
  if (!lib || !ANIMATABLE.has(mime)) return { ...base, skipped: true };

  let meta;
  try {
    meta = await lib(filePath, { animated: true }).metadata();
  } catch (err) {
    console.error("[animatedMedia] metadata failed, original still serveable:", err.message);
    return { ...base, skipped: true };
  }

  // sharp reports the FULL strip height for an animated image; pageHeight is
  // the height of one frame, which is the only one that means anything here.
  const width = meta.width || null;
  const height = meta.pageHeight || meta.height || null;
  const frames = meta.pages || 1;
  const manifest = {
    ...base,
    width,
    height,
    frames,
    animated: frames > 1,
    aspectRatio: width && height ? Math.round((width / height) * 1000) / 1000 : null,
  };

  // Poster: always worth having. For a still GIF it is the whole story, and
  // the client can then skip the original entirely.
  try {
    const buf = await lib(filePath)
      .resize({ width: POSTER_WIDTH, withoutEnlargement: true })
      .webp({ quality: POSTER_QUALITY })
      .toBuffer();
    await fs.promises.writeFile(posterPathFor(filePath), buf);
    manifest.poster = { bytes: buf.length };
  } catch (err) {
    console.error("[animatedMedia] poster failed:", err.message);
  }

  // List/grid still. Cheap next to the poster (same decode, smaller resize)
  // and it keeps a 70-tile index off the poster tier.
  try {
    const buf = await lib(filePath)
      .resize({ width: THUMB_WIDTH, withoutEnlargement: true })
      .webp({ quality: POSTER_QUALITY })
      .toBuffer();
    await fs.promises.writeFile(thumbPathFor(filePath), buf);
    manifest.thumb = { bytes: buf.length };
  } catch (err) {
    console.error("[animatedMedia] thumbnail failed:", err.message);
  }

  // Animated derivative: only meaningful for something that actually moves.
  if (frames > 1) {
    try {
      const buf = await lib(filePath, { animated: true })
        .resize({ width: ANIM_WIDTH, withoutEnlargement: true })
        .webp({ quality: ANIM_QUALITY, effort: ANIM_EFFORT })
        .toBuffer();
      const originalBytes = (await fs.promises.stat(filePath)).size;
      // Never ship a "derivative" that is bigger than what it replaces — an
      // already-small, already-optimized GIF can come out larger as WebP.
      if (buf.length < originalBytes) {
        await fs.promises.writeFile(animPathFor(filePath), buf);
        manifest.anim = { bytes: buf.length, width: Math.min(ANIM_WIDTH, width || ANIM_WIDTH) };
      }
    } catch (err) {
      console.error("[animatedMedia] animated derivative failed:", err.message);
    }
  }

  // MP4 + WebM, for anything that actually moves. This is what the handbook
  // prefers to render — see lib/videoDerivatives.js for why an <img> playing
  // an animated WebP stops being viable somewhere around 70 demos. The
  // animated WebP above is still generated, and is still what a program falls
  // back to when ffmpeg is absent or a transcode fails.
  if (frames > 1) {
    try {
      const video = await generateVideoDerivatives(filePath, mime);
      if (video.mp4) manifest.mp4 = video.mp4;
      if (video.webm) manifest.webm = video.webm;
      // The single flag the client keys off. Requires BOTH formats: one alone
      // means some real browser silently gets nothing, and a demo that plays
      // everywhere except iPhones is worse than one that is a GIF everywhere.
      manifest.video = !!(video.mp4 && video.webm);
    } catch (err) {
      console.error("[animatedMedia] video derivatives failed:", err.message);
    }
  }

  try {
    await fs.promises.writeFile(manifestPathFor(filePath), JSON.stringify(manifest, null, 2));
  } catch (err) {
    /* the derivatives are on disk and discoverable by name regardless */
  }
  return manifest;
}

// ---------------------------------------------------------------------------
// Read side
// ---------------------------------------------------------------------------

// Manifests are immutable once written (uploads are UUID-named and never
// rewritten in place), so they are cached for the life of the process, misses
// included — otherwise a pre-existing program would stat the disk on every
// media request it serves.
const cache = new Map();

function readManifest(absPath) {
  if (cache.has(absPath)) return cache.get(absPath);
  let manifest = null;
  try {
    manifest = JSON.parse(fs.readFileSync(manifestPathFor(absPath), "utf8"));
  } catch (err) {
    manifest = null;
  }
  cache.set(absPath, manifest);
  return manifest;
}

function invalidate(absPath) {
  cache.delete(absPath);
}

module.exports = {
  generateAnimatedDerivatives,
  variantFileName,
  STRICT_VARIANTS,
  posterPathFor,
  animPathFor,
  thumbPathFor,
  manifestPathFor,
  readManifest,
  invalidate,
  ANIMATABLE,
  ANIM_WIDTH,
};
