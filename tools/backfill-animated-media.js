// Generates poster + animated-WebP derivatives for gated program media that
// was uploaded before lib/animatedMedia.js existed.
//
// Safe to re-run: a file that already has a manifest is skipped unless --force
// is passed. Generated derivatives carry `-poster.webp` / `-anim.webp`
// suffixes and are never treated as sources, so re-running cannot produce
// derivatives-of-derivatives.
//
// This is also the recovery path for the one thing lib/mediaJobs.js gives up
// by being an in-process queue: a job lost to a restart. Every derivative is
// regenerable from the original, so re-running this is always sufficient.
//
//   node tools/backfill-animated-media.js [--force] [--dry] [--hd]
//
// --hd adds ONLY the fullscreen renditions (-hd.mp4 / -hd.webm) to media that
// already has everything else, and rewrites nothing that is already on disk.
// That distinction is the point: derivatives are served `immutable` for a
// year, so a plain --force to pick up a new rendition would also regenerate
// the tile files under their existing names, and every browser holding a
// cached copy would keep the old bytes until they expire. Adding a rendition
// is a new file; changing one is a new name.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const {
  generateAnimatedDerivatives,
  generateHdRendition,
  manifestPathFor,
  readManifest,
  ANIMATABLE,
} = require(path.join(ROOT, "server/src/lib/animatedMedia"));

const FORCE = process.argv.includes("--force");
const DRY = process.argv.includes("--dry");
const HD_ONLY = process.argv.includes("--hd");

// Gated program media: one directory per product id.
const MEDIA_ROOT = path.join(ROOT, "server/storage/media");

const MIME_BY_EXT = { ".gif": "image/gif", ".webp": "image/webp" };
const kb = (v) => (v ? (v.bytes / 1024).toFixed(0) + "KB" : "-");
// Anything this pipeline emits. `-thumb.webp` matters as much as the others:
// it is a WebP, so without it here a re-run would treat a generated thumbnail
// as a fresh source and derive a thumbnail OF the thumbnail. The video
// renditions can't be sources (their extensions aren't in MIME_BY_EXT) but are
// listed anyway so this stays the one place that knows what we generate.
const GENERATED = /-(?:poster|thumb|anim)\.webp$|-(?:vid|hd)\.(?:mp4|webm)$/;

async function main() {
  if (!fs.existsSync(MEDIA_ROOT)) {
    console.log(`no gated media directory at ${MEDIA_ROOT} — nothing to do`);
    return;
  }

  let considered = 0, skipped = 0, done = 0, failed = 0;
  let bytesBefore = 0, bytesPoster = 0, bytesAnim = 0;
  let bytesMp4 = 0, bytesWebm = 0, withVideo = 0;
  let hdMp4Bytes = 0, hdWebmBytes = 0, tileWebmBytes = 0;

  for (const d of fs.readdirSync(MEDIA_ROOT, { withFileTypes: true })) {
    if (!d.isDirectory()) continue;
    const dir = path.join(MEDIA_ROOT, d.name);

    for (const f of fs.readdirSync(dir)) {
      const ext = path.extname(f).toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime || !ANIMATABLE.has(mime)) continue;
      if (GENERATED.test(f)) continue; // never re-derive a derivative

      const filePath = path.join(dir, f);
      considered++;

      if (HD_ONLY) {
        const before = readManifest(filePath);
        if (!before || !before.animated) { skipped++; continue; }
        if (before.hdVideo && !FORCE) { skipped++; continue; }
        if (DRY) {
          console.log(`  would add HD  ${d.name}/${f}  (${before.width}x${before.height})`);
          continue;
        }
        const started = Date.now();
        const m = await generateHdRendition(filePath, mime);
        if (m.skipped || !m.hdVideo) {
          failed++;
          console.log(`  FAILED  ${d.name}/${f}  ${m.skipped || "no hd renditions"}`);
          continue;
        }
        done++;
        hdMp4Bytes += m.hdmp4.bytes;
        hdWebmBytes += m.hdwebm.bytes;
        tileWebmBytes += m.webm ? m.webm.bytes : 0;
        console.log(
          `  ${d.name}/${f}` +
          `  source ${m.width}x${m.height}` +
          `  -> hd ${m.hdwebm.width}x${m.hdwebm.height}` +
          `  hd.webm ${kb(m.hdwebm)}  hd.mp4 ${kb(m.hdmp4)}` +
          `  (tile webm ${kb(m.webm)}, mp4 ${kb(m.mp4)})` +
          `  (${Date.now() - started}ms)`
        );
        continue;
      }

      if (!FORCE && fs.existsSync(manifestPathFor(filePath))) {
        skipped++;
        continue;
      }

      const size = fs.statSync(filePath).size;
      if (DRY) {
        console.log(`  would derive ${d.name}/${f}  (${(size / 1048576).toFixed(1)}MB)`);
        continue;
      }

      const started = Date.now();
      const manifest = await generateAnimatedDerivatives(filePath, mime);
      if (manifest.skipped || (!manifest.poster && !manifest.anim)) {
        failed++;
        console.log(`  FAILED  ${d.name}/${f}`);
        continue;
      }

      done++;
      bytesBefore += size;
      bytesPoster += manifest.poster ? manifest.poster.bytes : 0;
      bytesAnim += manifest.anim ? manifest.anim.bytes : 0;
      bytesMp4 += manifest.mp4 ? manifest.mp4.bytes : 0;
      bytesWebm += manifest.webm ? manifest.webm.bytes : 0;
      if (manifest.video) withVideo++;
      console.log(
        `  ${d.name}/${f}  ${(size / 1048576).toFixed(1)}MB` +
        `  -> poster ${kb(manifest.poster)}, thumb ${kb(manifest.thumb)}` +
        `, anim ${kb(manifest.anim)}, mp4 ${kb(manifest.mp4)}, webm ${kb(manifest.webm)}` +
        `  (${manifest.frames} frames, ${Date.now() - started}ms)`
      );
    }
  }

  console.log(`\nconsidered ${considered}, derived ${done}, skipped ${skipped}, failed ${failed}`);
  if (HD_ONLY) {
    if (done) {
      // Per ASSET, not per page: fullscreen is one clip on demand, so the
      // number that matters is what one tap costs, not what the set weighs.
      console.log(`hd.webm total ${(hdWebmBytes / 1024).toFixed(0)}KB over ${done} assets` +
        `  (avg ${(hdWebmBytes / done / 1024).toFixed(0)}KB per tap, Chrome/FF/Android)`);
      console.log(`hd.mp4  total ${(hdMp4Bytes / 1024).toFixed(0)}KB over ${done} assets` +
        `  (avg ${(hdMp4Bytes / done / 1024).toFixed(0)}KB per tap, Safari/iOS)`);
      if (tileWebmBytes) {
        console.log(`tile webm untouched  ${(tileWebmBytes / 1024).toFixed(0)}KB` +
          `  — the day page still costs exactly this`);
      }
    }
    return;
  }
  if (done) {
    console.log(`originals            ${(bytesBefore / 1048576).toFixed(1)}MB`);
    console.log(`posters (first load) ${(bytesPoster / 1024).toFixed(0)}KB   ${(bytesBefore / bytesPoster).toFixed(0)}x smaller`);
    if (bytesAnim) console.log(`animations (on view) ${(bytesAnim / 1024).toFixed(0)}KB   ${(bytesBefore / bytesAnim).toFixed(0)}x smaller`);
    // What a customer ACTUALLY downloads is one of these two, never both:
    // Safari takes the MP4, everything else takes the smaller WebM.
    if (bytesWebm) console.log(`webm  (Chrome/FF/Android) ${(bytesWebm / 1024).toFixed(0)}KB   ${(bytesBefore / bytesWebm).toFixed(0)}x smaller`);
    if (bytesMp4) console.log(`mp4   (Safari/iOS)        ${(bytesMp4 / 1024).toFixed(0)}KB   ${(bytesBefore / bytesMp4).toFixed(0)}x smaller`);
    console.log(`${withVideo}/${done} have BOTH renditions and will render as <video>`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
