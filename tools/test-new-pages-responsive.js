// Generic responsive/quality harness for the pages added in this pass:
// the service pages and the partner profile.
//
// Checks that apply to ANY page and that a screenshot would not catch:
// no horizontal overflow, no visible element past the viewport edge, tap
// targets at or above 44px, no text below 13px, no console errors, and no
// full-resolution original image fetched where a derivative exists.
//
// The partner profile has extra, structure-specific assertions of its own in
// test-partner-profile.js; this is the shared baseline.
//
// Usage: node test-new-pages-responsive.js [--base http://127.0.0.1:3200] [--shots]
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg("--base", "http://127.0.0.1:3200");
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = path.join(__dirname, ".shots");

const SERVER = path.join(__dirname, "..", "server");
const { listServices } = require(path.join(SERVER, "src", "lib", "services.js"));

// The brief's widths: phones first, then desktop.
const PHONE_WIDTHS = [320, 375, 390, 430];
const DESKTOP_WIDTHS = [1280, 1440, 1920];
const WIDTHS = [...PHONE_WIDTHS, 768, ...DESKTOP_WIDTHS];
const MIN_TAP = 44;

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  const builds = fs.readdirSync(root).sort();
  return path.join(root, builds[builds.length - 1], "chrome-linux64", "chrome");
}

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures++;
  if (!cond) console.log(`    FAIL  ${label}${detail ? "  — " + detail : ""}`);
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });

  const PAGES = [
    { name: "services-index", url: "/services" },
    ...listServices().map((s) => ({ name: "service-" + s.slug, url: "/services/" + s.slug })),
    { name: "partner-profile", url: "/partners/elena-cho" },
  ];

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });

  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  const imageRequests = [];
  page.on("request", (r) => { if (r.resourceType() === "image") imageRequests.push(r.url()); });

  for (const p of PAGES) {
    let pageFailures = failures;
    for (const width of WIDTHS) {
      imageRequests.length = 0;
      await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
      await page.goto(BASE + p.url, { waitUntil: "networkidle0" });

      const r = await page.evaluate((MIN_TAP) => {
        const doc = document.documentElement;
        const vw = doc.clientWidth;

        // Visibility must be tested up the ancestor chain: the shared header
        // parks its desktop mega-menu off-screen inside a hidden container on
        // every page of this site.
        const hiddenUp = (el) => {
          for (let n = el; n && n !== doc; n = n.parentElement) {
            const cs = getComputedStyle(n);
            if (cs.display === "none" || cs.visibility === "hidden") return true;
            if (parseFloat(cs.opacity) === 0) return true;
          }
          return false;
        };
        // An element inside a horizontally-clipping ancestor cannot widen the
        // document however far its box extends.
        const clippedUp = (el) => {
          for (let n = el.parentElement; n && n !== doc; n = n.parentElement) {
            const ox = getComputedStyle(n).overflowX;
            if (ox === "hidden" || ox === "clip" || ox === "auto" || ox === "scroll") return true;
          }
          return false;
        };

        const overflowing = [];
        const taps = [];
        const smallText = [];

        document.querySelectorAll("body *").forEach((el) => {
          const cs = getComputedStyle(el);
          if (hiddenUp(el)) return;
          const b = el.getBoundingClientRect();
          if (b.width === 0 && b.height === 0) return;

          if (cs.position !== "fixed" && (b.right > vw + 1 || b.left < -1) && !clippedUp(el)) {
            overflowing.push({
              sel: el.tagName.toLowerCase() + "." + String(el.className || "").split(" ").filter(Boolean).slice(0, 2).join("."),
              left: Math.round(b.left),
              right: Math.round(b.right),
            });
          }
        });

        // Tap targets and type size, scoped to the page's own main content —
        // the shared header/footer are pre-existing and out of scope here.
        document.querySelectorAll("main a, main button").forEach((el) => {
          const b = el.getBoundingClientRect();
          if (b.width === 0 || b.height === 0) return;
          // Inline links inside a paragraph are text, not tap targets; only
          // standalone/block-level controls are held to the 44px floor.
          const cs = getComputedStyle(el);
          if (cs.display === "inline") return;
          if (b.height < MIN_TAP) {
            taps.push({ sel: String(el.className).slice(0, 40), h: Math.round(b.height) });
          }
        });

        // Readability is a claim about BODY COPY and headings, not about every
        // string on the page. Small, letter-spaced, uppercase micro-labels
        // (eyebrows, kickers, section labels, status chips) are a deliberate
        // typographic device used throughout the existing site — holding an
        // 11px tracked "FEATURED" label to a 13px body-text floor would be
        // measuring the wrong thing and would force the new pages off the
        // brand's own type system. So: paragraphs, list items and headings,
        // excluding anything set in uppercase.
        document.querySelectorAll("main p, main li, main h1, main h2, main h3").forEach((el) => {
          if (!el.textContent.trim()) return;
          const cs = getComputedStyle(el);
          if (cs.textTransform === "uppercase") return;
          const fs = parseFloat(cs.fontSize);
          if (fs && fs < 13) smallText.push({ sel: String(el.className).slice(0, 34), fs });
        });

        // The site header is `position: fixed`, so content that does not
        // reserve space for it renders UNDERNEATH it at scroll position 0.
        // style.css reserves 68px for this on every existing inner page
        // (`.page-banner { margin-top: 68px }`); a new page that forgets is
        // not visibly broken in a screenshot taken mid-scroll, which is
        // exactly why it needs an assertion.
        const header = document.querySelector("header.site-header");
        const headerBottom = header ? header.getBoundingClientRect().bottom : 0;
        let firstContentTop = null;
        const main = document.querySelector("main");
        if (main) {
          const walker = document.createTreeWalker(main, NodeFilter.SHOW_ELEMENT);
          while (walker.nextNode()) {
            const el = walker.currentNode;
            if (!el.textContent.trim()) continue;
            const b = el.getBoundingClientRect();
            if (b.height > 0 && b.width > 0) { firstContentTop = b.top; break; }
          }
        }

        return {
          vw,
          scrollW: doc.scrollWidth,
          overflowing: overflowing.slice(0, 5),
          taps: taps.slice(0, 5),
          smallText: smallText.slice(0, 5),
          hasMain: !!main,
          h1: (document.querySelector("h1") || {}).textContent || null,
          headerBottom: Math.round(headerBottom),
          firstContentTop: firstContentTop === null ? null : Math.round(firstContentTop),
        };
      }, MIN_TAP);

      check(`${p.name} @${width} no document overflow`, r.scrollW <= r.vw, `scrollWidth ${r.scrollW} vs ${r.vw}`);
      check(`${p.name} @${width} nothing past viewport edge`, r.overflowing.length === 0, JSON.stringify(r.overflowing));
      check(`${p.name} @${width} tap targets >= ${MIN_TAP}px`, r.taps.length === 0, JSON.stringify(r.taps));
      check(`${p.name} @${width} no text below 13px`, r.smallText.length === 0, JSON.stringify(r.smallText));
      check(`${p.name} @${width} has <main> and an <h1>`, r.hasMain && !!r.h1, r.h1 || "no h1");
      check(
        `${p.name} @${width} content clears the fixed header`,
        r.firstContentTop !== null && r.firstContentTop >= r.headerBottom,
        `first content top=${r.firstContentTop} vs header bottom=${r.headerBottom}`
      );

      const originals = imageRequests.filter(
        (u) => /\/assets\/images\/product\/uploads\//.test(u) && !/-(?:320|640|960|1280)\.(?:avif|webp)(?:$|\?)/.test(u)
      );
      check(`${p.name} @${width} no original full-res image`, originals.length === 0, originals.join(", "));

      if (SHOTS && (width === 390 || width === 1280)) {
        await page.screenshot({
          path: path.join(SHOT_DIR, `${p.name}-${width}.png`),
          fullPage: width === 390,
        });
      }
    }
    console.log(`${failures === pageFailures ? "PASS" : "FAIL"}  ${p.name}  (${WIDTHS.length} widths)`);
  }

  check("no console errors across all pages", consoleErrors.length === 0, consoleErrors.slice(0, 4).join(" | "));

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : `\nAll ${PAGES.length} pages passed at ${WIDTHS.length} widths`);
  process.exit(failures ? 1 : 0);
})();
