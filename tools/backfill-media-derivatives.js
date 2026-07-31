// Generates responsive derivatives + sidecar manifests for imagery that was
// uploaded before the derivative pipeline existed.
//
// Safe to re-run: an image that already has a manifest is skipped unless
// --force is passed. Generated derivatives are recognised by their
// `-<width>.<ext>` suffix and never treated as sources, so re-running cannot
// produce derivatives-of-derivatives.
//
//   node tools/backfill-media-derivatives.js [--force] [--dry]
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const { generateDerivatives, manifestPathFor, WIDTHS } = require(path.join(ROOT, "server/src/lib/mediaDerivatives"));

const FORCE = process.argv.includes("--force");
const DRY = process.argv.includes("--dry");

// Public image roots and the URL each maps to.
const ROOTS = [
  { dir: path.join(ROOT, "assets/images/product/uploads"), url: "/assets/images/product/uploads" },
  { dir: path.join(ROOT, "assets/images/product/demo"), url: "/assets/images/product/demo" },
  { dir: path.join(ROOT, "assets/images/logo/uploads"), url: "/assets/images/logo/uploads" },
];
// Gallery is one directory per product id.
const GALLERY = path.join(ROOT, "assets/images/product/gallery");
if (fs.existsSync(GALLERY)) {
  for (const d of fs.readdirSync(GALLERY, { withFileTypes: true })) {
    if (d.isDirectory()) ROOTS.push({ dir: path.join(GALLERY, d.name), url: `/assets/images/product/gallery/${d.name}` });
  }
}

const MIME_BY_EXT = {
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
};

const widthSuffix = new RegExp(`-(?:${WIDTHS.join("|")})\\.(?:avif|webp)$`);

(async () => {
  let done = 0, skipped = 0, failed = 0;
  for (const { dir, url } of ROOTS) {
    if (!fs.existsSync(dir)) continue;
    for (const name of fs.readdirSync(dir)) {
      const ext = path.extname(name).toLowerCase();
      const mime = MIME_BY_EXT[ext];
      if (!mime) continue;
      if (widthSuffix.test(name)) continue; // a derivative, not a source
      const file = path.join(dir, name);
      if (!fs.statSync(file).isFile()) continue;

      if (!FORCE && fs.existsSync(manifestPathFor(file))) { skipped++; continue; }
      if (DRY) { console.log(`would process ${url}/${name}`); done++; continue; }

      try {
        const m = await generateDerivatives(file, mime, url);
        const n = (m.derivatives || []).length;
        console.log(`${(url + "/" + name).padEnd(62).slice(0, 62)} fit=${String(m.fit).padEnd(8)} ${n} derivatives`);
        done++;
      } catch (err) {
        console.error(`FAILED ${url}/${name}: ${err.message}`);
        failed++;
      }
    }
  }
  console.log(`\nprocessed ${done}, skipped ${skipped} (already had a manifest), failed ${failed}`);
})();
