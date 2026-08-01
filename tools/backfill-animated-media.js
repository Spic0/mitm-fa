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
//   node tools/backfill-animated-media.js [--force] [--dry]
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const {
  generateAnimatedDerivatives,
  manifestPathFor,
  ANIMATABLE,
} = require(path.join(ROOT, "server/src/lib/animatedMedia"));

const FORCE = process.argv.includes("--force");
const DRY = process.argv.includes("--dry");

// Gated program media: one directory per product id.
const MEDIA_ROOT = path.join(ROOT, "server/storage/media");

const MIME_BY_EXT = { ".gif": "image/gif", ".webp": "image/webp" };
// Anything this pipeline emits. `-thumb.webp` matters as much as the others:
// it is a WebP, so without it here a re-run would treat a generated thumbnail
// as a fresh source and derive a thumbnail OF the thumbnail. The video
// renditions can't be sources (their extensions aren't in MIME_BY_EXT) but are
// listed anyway so this stays the one place that knows what we generate.
const GENERATED = /-(?:poster|thumb|anim)\.webp$|-vid\.(?:mp4|webm)$/;

async function main() {
  if (!fs.existsSync(MEDIA_ROOT)) {
    console.log(`no gated media directory at ${MEDIA_ROOT} — nothing to do`);
    return;
  }

  let considered = 0, skipped = 0, done = 0, failed = 0;
  let bytesBefore = 0, bytesPoster = 0, bytesAnim = 0;
  let bytesMp4 = 0, bytesWebm = 0, withVideo = 0;

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
      const kb = (v) => (v ? (v.bytes / 1024).toFixed(0) + "KB" : "-");
      console.log(
        `  ${d.name}/${f}  ${(size / 1048576).toFixed(1)}MB` +
        `  -> poster ${kb(manifest.poster)}, thumb ${kb(manifest.thumb)}` +
        `, anim ${kb(manifest.anim)}, mp4 ${kb(manifest.mp4)}, webm ${kb(manifest.webm)}` +
        `  (${manifest.frames} frames, ${Date.now() - started}ms)`
      );
    }
  }

  console.log(`\nconsidered ${considered}, derived ${done}, skipped ${skipped}, failed ${failed}`);
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
