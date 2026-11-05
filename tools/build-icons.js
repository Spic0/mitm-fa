// Builds the site's whole icon set and the default link-preview image from
// the one logo source, assets/images/logo/fa-logo.svg. Everything it writes
// is committed; re-run it only when the mark or the brand colour changes.
//
//   node tools/build-icons.js
//
// Output (repo root is the public web root, so these are served at /<name>):
//   favicon.ico            16, 32, 48 (PNG-compressed entries)
//   icon.svg               vector, same padding as the rasters
//   icon-48/96/192/512.png
//   icon-maskable-512.png  smaller mark, inside the maskable safe zone
//   apple-touch-icon.png   180x180
//   site.webmanifest
//   og/default.jpg         1200x630, the og:image fallback for every page
//
// Why the padding: Google shows a site's favicon cropped to a circle. A mark
// drawn edge to edge loses its corners to that crop, and a transparent
// background turns into whatever colour the results page is (white in light
// mode, near-black in dark mode, where a dark mark disappears). So every
// icon is a SOLID brand square with the mark at MARK_SCALE of the canvas
// width. The mark is 1.79:1, so at 0.70 its bounding-box diagonal is 0.80 of
// the canvas and the whole mark sits inside the inscribed circle.
//
// A maskable icon is cropped harder (to an arbitrary shape inside a circle
// of 80% diameter), and 0.70 would put the mark's corners 0.2% outside that,
// so the maskable variant gets its own smaller scale.
//
// The geometry is copied verbatim from fa-logo.svg (itself byte identical to
// the supplied master), never redrawn. Only its fill changes, to white.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "assets/images/logo/fa-logo.svg");
const FONT_DIR = path.join(ROOT, "assets/fonts/montserrat");

const BG = "#1a1a1a"; // --color-primary in assets/css/style.css
const FG = "#ffffff";
const MARK_SCALE = 0.7;
const MASKABLE_SCALE = 0.6;

const CHROME = process.env.CHROME_PATH || (function () {
  const base = path.join(process.env.HOME || "/root", ".cache/puppeteer/chrome");
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).sort() : [];
  if (!dirs.length) throw new Error("No Chrome in " + base + " — set CHROME_PATH.");
  return path.join(base, dirs[dirs.length - 1], "chrome-linux64", "chrome");
})();

const sharp = require(path.join(ROOT, "server/node_modules/sharp"));

function readMark() {
  const svg = fs.readFileSync(SRC, "utf8");
  const vb = svg.match(/viewBox="([^"]+)"/)[1].trim().split(/\s+/).map(Number);
  const polygons = svg.match(/<polygon[^>]*\/>/g);
  const miter = (svg.match(/stroke-miterlimit="([^"]+)"/) || [])[1] || "10";
  if (vb.length !== 4 || !polygons || polygons.length !== 3) {
    throw new Error("fa-logo.svg no longer has the expected viewBox + 3 polygons; check the source before rebuilding");
  }
  return { x: vb[0], y: vb[1], w: vb[2], h: vb[3], polygons: polygons.join("\n    "), miter };
}

// A square SVG: solid background, mark centred at `scale` of the width.
function squareSvg(mark, size, scale) {
  const k = (size * scale) / mark.w;
  const tx = (size - mark.w * k) / 2 - mark.x * k;
  const ty = (size - mark.h * k) / 2 - mark.y * k;
  const r = (n) => Math.round(n * 1000) / 1000;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">\n` +
    `  <rect width="${size}" height="${size}" fill="${BG}"/>\n` +
    `  <g transform="translate(${r(tx)} ${r(ty)}) scale(${r(k)})" fill="${FG}" stroke="${FG}" stroke-miterlimit="${mark.miter}">\n` +
    `    ${mark.polygons}\n` +
    `  </g>\n` +
    `</svg>\n`
  );
}

async function png(svg, size, { rgba = false } = {}) {
  // Rasterise at 1024px whatever the target, then downscale: librsvg at the
  // target size directly gives visibly harder edges on the 16/32px entries.
  // Density is relative to the SVG's own width (512), not the output size.
  const svgWidth = Number(svg.match(/width="(\d+)"/)[1]);
  let pipe = sharp(Buffer.from(svg), { density: (72 * 1024) / svgWidth })
    .resize(size, size)
    .flatten({ background: BG });
  // ICO entries declare 32bpp in the directory, and some Windows readers
  // require the embedded PNG to really be RGBA. Alpha 1 = fully opaque.
  if (rgba) pipe = pipe.ensureAlpha(1);
  return pipe.png({ compressionLevel: 9 }).toBuffer();
}

// ICO with PNG-compressed entries (supported by every browser, and Windows
// since Vista). sharp cannot write ICO and ImageMagick is not installed, and
// the container is small enough to write by hand.
function ico(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);
  const dir = Buffer.alloc(16 * entries.length);
  let offset = 6 + dir.length;
  entries.forEach(({ size, data }, i) => {
    const o = i * 16;
    dir.writeUInt8(size >= 256 ? 0 : size, o);
    dir.writeUInt8(size >= 256 ? 0 : size, o + 1);
    dir.writeUInt8(0, o + 2); // palette colours
    dir.writeUInt8(0, o + 3); // reserved
    dir.writeUInt16LE(1, o + 4); // colour planes
    dir.writeUInt16LE(32, o + 6); // bits per pixel
    dir.writeUInt32LE(data.length, o + 8);
    dir.writeUInt32LE(offset, o + 12);
    offset += data.length;
  });
  return Buffer.concat([header, dir, ...entries.map((e) => e.data)]);
}

function write(rel, data) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, data);
  console.log(`${rel.padEnd(24)} ${(fs.statSync(abs).size / 1024).toFixed(1).padStart(6)}KB`);
}

const OG_WIDTH = 1200;
const OG_HEIGHT = 630;
const OG_TAGLINE = "Workout &amp; Meal Plans<br>from Pro Athletes";

// Everything sits inside the central 630px square (the tagline is split over
// two lines for this), because WhatsApp and some chat clients crop the image
// to that square for the small preview. The wide frame is a bonus.
function ogHtml(mark) {
  const font = (w) =>
    `@font-face{font-family:M;font-weight:${w};src:url("file://${FONT_DIR}/montserrat-latin-${w}-normal.woff2") format("woff2")}`;
  const markH = 132;
  const markW = Math.round((markH * mark.w) / mark.h);
  return `<!doctype html><html><head><meta charset="utf-8"><style>
${font(500)}${font(700)}
html,body{margin:0;width:${OG_WIDTH}px;height:${OG_HEIGHT}px;background:${BG};overflow:hidden}
body{display:flex;flex-direction:column;align-items:center;justify-content:center;font-family:M,sans-serif;color:${FG}}
svg{display:block;width:${markW}px;height:${markH}px}
h1{margin:48px 0 0;font-weight:700;font-size:48px;letter-spacing:-.01em;line-height:1.18;text-align:center}
p{margin:20px 0 0;font-weight:500;font-size:24px;letter-spacing:.14em;color:#9c9993;text-transform:uppercase}
</style></head><body>
<svg viewBox="${mark.x} ${mark.y} ${mark.w} ${mark.h}" fill="${FG}" stroke="${FG}" stroke-miterlimit="${mark.miter}">${mark.polygons}</svg>
<h1>${OG_TAGLINE}</h1>
<p>fitness.agency</p>
</body></html>`;
}

async function buildOg(mark) {
  const puppeteer = require("puppeteer-core");
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--allow-file-access-from-files"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: OG_WIDTH, height: OG_HEIGHT, deviceScaleFactor: 1 });
    const tmp = path.join(require("os").tmpdir(), `fa-og-${process.pid}.html`);
    fs.writeFileSync(tmp, ogHtml(mark));
    await page.goto("file://" + tmp, { waitUntil: "load" });
    await page.evaluate(() => document.fonts.ready);
    const fontsOk = await page.evaluate(() => document.fonts.check('700 48px M') && [...document.fonts].every((f) => f.status === "loaded"));
    if (!fontsOk) throw new Error("Montserrat did not load; the OG image would render in a fallback font");
    const shot = await page.screenshot({ type: "png" });
    fs.unlinkSync(tmp);
    return sharp(shot).jpeg({ quality: 88, mozjpeg: true, chromaSubsampling: "4:4:4" }).toBuffer();
  } finally {
    await browser.close();
  }
}

(async () => {
  const mark = readMark();

  const vector = squareSvg(mark, 512, MARK_SCALE);
  // An XML comment holding a double hyphen silently breaks an SVG; there are
  // none here, but fail loudly rather than ship a broken icon if one appears.
  if (vector.includes("<!--")) throw new Error("icon.svg must not contain comments");
  write("icon.svg", vector);

  for (const size of [48, 96, 192, 512]) write(`icon-${size}.png`, await png(vector, size));
  write("icon-maskable-512.png", await png(squareSvg(mark, 512, MASKABLE_SCALE), 512));
  write("apple-touch-icon.png", await png(vector, 180));
  write("favicon.ico", ico(await Promise.all([16, 32, 48].map(async (size) => ({ size, data: await png(vector, size, { rgba: true }) })))));

  write(
    "site.webmanifest",
    JSON.stringify(
      {
        name: "Fitness Agency",
        short_name: "Fitness Agency",
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          { src: "/icon-maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
        ],
        theme_color: "#fafaf9",
        background_color: "#fafaf9",
        display: "standalone",
        start_url: "/",
      },
      null,
      2
    ) + "\n"
  );

  const og = await buildOg(mark);
  if (og.length > 300 * 1024) throw new Error(`og/default.jpg is ${og.length} bytes; link previews want it under 300KB`);
  write("og/default.jpg", og);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
