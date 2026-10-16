const fs = require("fs");

// Automatic post-upload image optimization.
//
// sharp is loaded lazily and OPTIONALLY. server/node_modules is a symlink to
// the production tree and the documented deploy is "merge + pm2 restart" with
// no install step, so a hard `require("sharp")` at module load would take the
// whole site down on the first deploy that lands this file before anyone has
// run `npm install`. Instead, a missing sharp degrades to "upload works, file
// just isn't optimized" and says so once in the log.
let sharp;
let sharpState = "unloaded"; // unloaded | ready | unavailable

function loadSharp() {
  if (sharpState === "unloaded") {
    try {
      sharp = require("sharp");
      sharpState = "ready";
    } catch (err) {
      sharpState = "unavailable";
      console.warn(
        "[imageOptimize] sharp is not installed — uploads will be stored as-is, " +
          "without optimization. Run `npm install` in server/ to enable it."
      );
    }
  }
  return sharpState === "ready" ? sharp : null;
}

// Only raster stills are re-encoded.
//
// GIF is excluded on purpose: it is the format the exercise-demo library is
// built on, those files are animated, and a re-encode risks collapsing an
// animation to its first frame — a silent, destructive change to paid program
// content. SVG is vector (already tiny, and re-encoding would undo
// svgSanitize's rewrite). Video is out of scope: transcoding MP4/MOV needs
// ffmpeg, not sharp, and is a much heavier operation than an upload request
// should be doing inline.
const OPTIMIZABLE = new Set(["image/jpeg", "image/png", "image/webp"]);

const MAX_WIDTH = 2560;
const QUALITY = 82;

// Re-encodes an image in place: strips metadata (EXIF, GPS, colour profiles
// beyond the essentials), downscales only if it is wider than MAX_WIDTH, and
// keeps the original format so the stored filename and URL stay valid.
//
// Never throws — an optimization failure must not fail the upload, because
// the file on disk at that point is already verified and perfectly usable.
// Returns a small report for the caller to log.
async function optimizeImageInPlace(filePath, mime) {
  if (!OPTIMIZABLE.has(mime)) return { optimized: false, reason: "format not optimizable" };

  const lib = loadSharp();
  if (!lib) return { optimized: false, reason: "sharp unavailable" };

  try {
    const before = (await fs.promises.stat(filePath)).size;

    // failOn:"none" — a slightly-corrupt-but-renderable image should be
    // passed through, not rejected at this late stage.
    const image = lib(filePath, { failOn: "none" });
    const meta = await image.metadata();

    // .rotate() with no argument bakes in the EXIF orientation BEFORE the
    // metadata is stripped. Without it, stripping EXIF silently turns every
    // phone photo shot in portrait on its side.
    let pipeline = image.rotate();

    const resized = !!(meta.width && meta.width > MAX_WIDTH);
    if (resized) {
      pipeline = pipeline.resize({ width: MAX_WIDTH, withoutEnlargement: true });
    }

    if (mime === "image/jpeg") {
      pipeline = pipeline.jpeg({ quality: QUALITY, mozjpeg: true });
    } else if (mime === "image/png") {
      // Lossless on purpose. sharp's `palette: true` quantizes to a 256-colour
      // indexed image — a big saving on flat UI graphics, but visible banding
      // on a photograph someone happened to export as PNG, and there is no
      // cheap way to tell those apart here. The dimension cap below is where
      // the real saving on an oversized PNG comes from anyway, so this side
      // stays lossless and predictable.
      pipeline = pipeline.png({ compressionLevel: 9, adaptiveFiltering: true });
    } else {
      pipeline = pipeline.webp({ quality: QUALITY });
    }

    const output = await pipeline.toBuffer();

    // Re-encoding is not guaranteed to win on bytes — an already-optimized PNG
    // or a small WebP can come back bigger.
    //
    // The byte comparison only decides things when we did NOT resize. Once the
    // image has been downscaled to MAX_WIDTH it is a genuinely different,
    // smaller image and keeping it is the point of the cap; discarding it
    // because a pathological source happened to re-encode larger would leave
    // an 8000px original in place while reporting success.
    if (!resized && output.length >= before) {
      return { optimized: false, reason: "re-encode was not smaller", before, after: before };
    }

    // sharp has already buffered the whole image, so the read is finished and
    // writing back over the source is safe.
    await fs.promises.writeFile(filePath, output);
    return {
      optimized: true,
      before,
      after: output.length,
      resized,
      width: resized ? MAX_WIDTH : meta.width,
    };
  } catch (err) {
    console.error("[imageOptimize] failed, keeping original:", err.message);
    return { optimized: false, reason: err.message };
  }
}

function describeOptimization(report) {
  if (!report || !report.optimized) return "";
  const kb = (n) => `${Math.round(n / 1024)}KB`;
  // A resized image is kept even when it re-encodes larger, so the delta can
  // legitimately be negative — don't render that as "−-12%".
  const pct = Math.round((1 - report.after / report.before) * 100);
  const delta = pct >= 0 ? `−${pct}%` : `+${Math.abs(pct)}%`;
  return ` (optimized ${kb(report.before)}→${kb(report.after)}, ${delta}${report.resized ? `, resized to ${report.width}px` : ""})`;
}

module.exports = { optimizeImageInPlace, describeOptimization, MAX_WIDTH, OPTIMIZABLE };
