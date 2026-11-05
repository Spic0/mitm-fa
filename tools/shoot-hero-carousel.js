// Screenshots the homepage hero carousel on every product it rotates through,
// at 1440x900 and 390x844, and checks each active card shows a real raster
// cover (decoded, not an SVG placeholder). Also: no 4xx/5xx responses, CLS.
//   node shoot-hero-carousel.js --base http://127.0.0.1:3300 --label after [--expect-raster]
// Screens: .screens/carousel-<label>-<w>x<h>-<n>.png
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://127.0.0.1:3300");
const LABEL = arg("--label", "after");
const EXPECT_RASTER = process.argv.includes("--expect-raster");
const DIR = path.join(__dirname, "..", ".screens");
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failures++; };

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  return path.join(root, fs.readdirSync(root).sort().pop(), "chrome-linux64", "chrome");
}

(async () => {
  fs.mkdirSync(DIR, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const vp of VIEWPORTS) {
      const tag = `${vp.width}x${vp.height}`;
      console.log(`\n${LABEL} ${tag}`);
      const page = await browser.newPage();
      await page.setViewport(vp);
      await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
      const bad = [];
      page.on("response", (r) => { if (r.status() >= 400) bad.push(r.status() + " " + r.url()); });
      await page.evaluateOnNewDocument(() => {
        window.__cls = 0;
        try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: "layout-shift", buffered: true }); } catch (e) { /* unsupported */ }
      });
      await page.goto(BASE + "/", { waitUntil: "networkidle0" });
      const total = await page.$$eval("#heroDeck .hero-card[data-product-id]", (c) => new Set(c.map((e) => e.getAttribute("data-product-id"))).size).catch(() => 0);
      const seen = new Map();
      const deadline = Date.now() + 40000;
      while (seen.size < Math.max(total, 1) && Date.now() < deadline) {
        const id = await page.$eval("#heroDeck .hero-card.is-active", (e) => e.getAttribute("data-product-id")).catch(() => null);
        if (id && !seen.has(id)) {
          await sleep(900); // the slot transition (--hero-dur 620ms) settles
          const card = await page.evaluate(() => {
            const el = document.querySelector("#heroDeck .hero-card.is-active");
            const img = el && (el.querySelector("img.pmedia__img") || el.querySelector("img:not(.pmedia__placeholder)"));
            return {
              name: el && (el.querySelector(".hero-card__name") || {}).textContent,
              src: img ? img.currentSrc || img.src : "",
              decoded: !!(img && img.complete && img.naturalWidth > 0),
            };
          });
          seen.set(id, card);
          const n = seen.size;
          await page.screenshot({ path: path.join(DIR, `carousel-${LABEL}-${tag}-${n}.png`), captureBeyondViewport: false });
          const raster = /\.(avif|webp|jpe?g|png)(\?|$)/i.test(card.src);
          const short = card.src.replace(/^.*\/uploads\//, "");
          if (EXPECT_RASTER) check(card.decoded && raster, `card ${n} "${(card.name || "").trim()}": ${short} decoded raster`);
          else console.log(`  card ${n} "${(card.name || "").trim()}": ${short} decoded=${card.decoded}`);
        }
        await sleep(150);
      }
      check(seen.size >= Math.max(total, 1), `rotated through ${seen.size}/${total} cards`);
      check(bad.length === 0, `no 4xx/5xx responses${bad.length ? ": " + bad.slice(0, 4).join(" | ") : ""}`);
      const cls = await page.evaluate(() => window.__cls);
      console.log(`  CLS ${cls.toFixed(4)}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\ndone");
  process.exit(failures ? 1 : 0);
})();
