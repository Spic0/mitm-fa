// Rasterises the official Fitness Agency mark for use in transactional email.
//
// Email needs a raster, not the SVG. Gmail strips <svg> and refuses SVG in
// <img src>, Outlook's Word engine has never rendered it, and the site's own
// product derivatives are AVIF/WebP only — neither of which Outlook can show
// either. So the one format that renders everywhere is PNG, and this is where
// it comes from.
//
// Source is assets/images/logo/fa-logo.svg, which is the supplied master
// (/var/www/FA ideja copy.svg) with its geometry byte identical — cropped to
// the mark's ink box and given an explicit fill. The master's own canvas is
// 72% empty padding, so rasterising THAT would produce a mark at roughly half
// size floating in a transparent box.
//
// Output is 2x the size the email displays it at, because every mail client
// on a phone is a retina display, and a 148px-wide mark drawn from 148px of
// pixels is visibly soft next to the rest of the type.
//
//   node tools/build-email-assets.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "assets/images/logo/fa-logo.svg");
const OUT = path.join(ROOT, "assets/images/logo/fa-logo-email.png");

// Display width in the email template. Keep the two in step: emailLayout.js
// sets width="148" on the <img>, which is what Outlook uses for layout.
const DISPLAY_WIDTH = 148;
const SCALE = 2;

(async () => {
  const sharp = require(path.join(ROOT, "server/node_modules/sharp"));
  const svg = fs.readFileSync(SRC);

  // The mark is 662.46 x 370.89 in user units (1.786:1). Height follows from
  // the width so the ratio is never fought — the same size-by-one-dimension
  // rule the header logo follows.
  const width = DISPLAY_WIDTH * SCALE;
  const meta = await sharp(svg).metadata();
  const height = Math.round((width * meta.height) / meta.width);

  await sharp(svg, { density: 600 })
    .resize({ width, height, fit: "contain", background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .png({ compressionLevel: 9, palette: true })
    .toFile(OUT);

  const out = await sharp(OUT).metadata();
  const bytes = fs.statSync(OUT).size;
  console.log(`${path.relative(ROOT, OUT)}  ${out.width}x${out.height}  ${(bytes / 1024).toFixed(1)}KB  (displays at ${DISPLAY_WIDTH}px)`);
  if (bytes > 25 * 1024) throw new Error("email logo is unexpectedly large for a two-colour mark");
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
