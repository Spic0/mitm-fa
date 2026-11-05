// Imports product cover images exactly the way an admin upload does
// (server/src/routes/admin/products.js verifyAndRename): a fresh UUID name in
// the uploads dir, content sniffing, optimizeImageInPlace, then the AVIF/WebP
// derivatives + .media.json sidecar the storefront reads through coverMedia().
// It writes FILES ONLY: no database access. It prints the new imageUrl per
// slug for update.sql.
//
// Sources are photos (Higgsfield returns PNG), so they are stored as JPEG
// (quality 88): the original is only a fallback behind the derivatives, and a
// 4.8MB PNG has no business being one.
//
//   node import-product-covers.js [--uploads DIR] slug=path/to/image.png ...
// DIR defaults to this checkout's assets/images/product/uploads (gitignored,
// per checkout: copy the printed files to production's at deploy time).
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const SERVER = path.join(__dirname, "..", "server");
const sharp = require(path.join(SERVER, "node_modules", "sharp"));
const { verifyUploadedFile } = require(path.join(SERVER, "src", "lib", "uploadVerify"));
const { optimizeImageInPlace } = require(path.join(SERVER, "src", "lib", "imageOptimize"));
const { generateDerivatives } = require(path.join(SERVER, "src", "lib", "mediaDerivatives"));

const IMAGE_URL_BASE = "/assets/images/product/uploads";
const args = process.argv.slice(2);
const ui = args.indexOf("--uploads");
const UPLOADS = ui > -1 ? path.resolve(args.splice(ui, 2)[1]) : path.join(__dirname, "..", "assets", "images", "product", "uploads");
const pairs = args.map((a) => a.split("=")).filter((p) => p.length === 2);
if (!pairs.length) {
  console.error("usage: node import-product-covers.js [--uploads DIR] slug=image ...");
  process.exit(1);
}

(async () => {
  fs.mkdirSync(UPLOADS, { recursive: true });
  const out = {};
  for (const [slug, src] of pairs) {
    const name = `${crypto.randomUUID()}.jpg`;
    const dest = path.join(UPLOADS, name);
    await sharp(src).rotate().jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" }).toFile(dest);
    const check = await verifyUploadedFile(dest, new Set(["image/jpeg"]));
    if (!check.ok) throw new Error(`${slug}: ${src} did not verify as JPEG`);
    await optimizeImageInPlace(dest, check.mime);
    const media = await generateDerivatives(dest, check.mime, IMAGE_URL_BASE);
    const files = fs.readdirSync(UPLOADS).filter((f) => f.startsWith(name.replace(/\.jpg$/, "")));
    out[slug] = { imageUrl: `${IMAGE_URL_BASE}/${name}`, files, fit: media && media.fit, width: media && media.width, height: media && media.height, bytes: fs.statSync(dest).size };
  }
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
