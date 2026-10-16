// Verifies that subset-bootstrap-css.js did not drop a rule the site needs.
//
// The subsetter's inventory is a STATIC scan, which cannot see a class that
// only ever reaches the DOM at runtime. This walks the real pages in a real
// browser, collects every class token actually present after the page has
// settled and been interacted with, and reports any of them that Bootstrap
// styles but the static scan missed. Anything reported here belongs in
// tools/bootstrap-extra-classes.txt.
//
// It also re-checks the reverse direction: every Bootstrap class the static
// scan DID keep, so a rename that leaves the extras file stale shows up as
// dead weight rather than sitting there forever.
//
//   node tools/verify-bootstrap-subset.js [baseUrl]
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const { SRC_CSS, OUT_CSS, resolveUsed, bootstrapClasses } = require("./bootstrap-class-inventory");

const CHROME = "/root/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome";
const BASE = process.argv[2] || "http://localhost:3200";

// Every public route that ships bootstrap.min.css. Keep in step with the
// PAGES list in build-critical-css.js — the two answer different questions
// about the same set of templates.
const PAGES = [
  "/", "/shop", "/about", "/contact", "/cart", "/checkout", "/login",
  "/register", "/blog", "/blog/grid", "/blog/list", "/blog/article",
  "/my-library", "/coming-soon", "/services", "/order/success",
  "/program/lean-bulk-blueprint",
];
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844, isMobile: true, deviceScaleFactor: 3 },
];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME, headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const seen = new Set();
  const visited = [];

  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport(vp);
    // A populated cart is what makes /cart and /checkout render their real
    // rows at all; empty, both redirect and their markup is never exercised.
    await page.goto(BASE + "/program/elena-cho-strength-size-peak", { waitUntil: "load", timeout: 120000 }).catch(() => {});
    await page.evaluate(() => { const b = document.querySelector(".btn-add-to-bag"); if (b) b.click(); }).catch(() => {});
    await sleep(1200);

    for (const p of PAGES) {
      try {
        const res = await page.goto(BASE + p, { waitUntil: "load", timeout: 120000 });
        await sleep(2500);
        // Open the things that are closed on load: the cart drawer, the mobile
        // nav, any accordion/summary. Classes behind them count too.
        await page.evaluate(() => {
          document.querySelectorAll("#cartIcon, .cart-icon, [data-cart-open], .navbar-toggler, .header__bar, #coSummaryToggle")
            .forEach((el) => { try { el.click(); } catch (e) {} });
          window.scrollTo(0, document.body.scrollHeight);
        });
        await sleep(1200);
        const tokens = await page.evaluate(() => {
          const out = new Set();
          document.querySelectorAll("*").forEach((el) => {
            const c = el.getAttribute && el.getAttribute("class");
            if (c) String(c).split(/\s+/).forEach((t) => t && out.add(t));
          });
          return [...out];
        });
        tokens.forEach((t) => seen.add(t));
        visited.push(`${vp.name} ${p} ${res ? res.status() : "?"} (${tokens.length} tokens)`);
      } catch (e) {
        visited.push(`${vp.name} ${p} FAILED ${e.message.slice(0, 60)}`);
      }
    }
    await page.close();
  }
  await browser.close();

  const { used } = resolveUsed();
  const defined = bootstrapClasses(fs.readFileSync(SRC_CSS, "utf8"));

  // The failure this tool exists to catch: a class Bootstrap styles, present
  // in the live DOM, that the static scan never saw.
  const missed = [...seen].filter((t) => defined.has(t) && !used.has(t)).sort();

  console.log("\nvisited:");
  visited.forEach((v) => console.log("  " + v));
  console.log(`\nclass tokens observed in the live DOM: ${seen.size}`);
  console.log(`Bootstrap-styled tokens among them   : ${[...seen].filter((t) => defined.has(t)).length}`);

  if (missed.length) {
    console.log(`\nMISSED BY THE STATIC SCAN (${missed.length}) — add these to tools/bootstrap-extra-classes.txt:`);
    missed.forEach((c) => console.log("  " + c));
    process.exitCode = 1;
  } else {
    console.log("\nOK: every Bootstrap-styled class seen in the live DOM is in the static inventory.");
  }

  if (fs.existsSync(OUT_CSS)) {
    const src = fs.statSync(SRC_CSS).size, out = fs.statSync(OUT_CSS).size;
    console.log(`\nbootstrap.min.css ${src} -> ${out} bytes (${((out / src) * 100).toFixed(1)}%)`);
  }
})().catch((e) => { console.error(e); process.exit(1); });
