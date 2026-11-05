// Homepage hero cover-on-scroll (.hero-stack, assets/js/hero-cover.js) at
// 1440x900, 1366x768, 390x844, 375x667, plus 390x844 with reduced motion.
// Screenshots at scrollY = 0, 40% and 100% of the hero's height. Checks: the
// hero is pinned, the H1 sinks/fades (and does not with reduced motion), at
// 100% the showcase's top is at or above the header bottom and the H1 is
// fully under it (and hit-testing lands on the showcase), the CTAs are
// clickable at rest, no console errors, no horizontal scroll, CLS < 0.1.
//   node test-hero-cover.js [--base http://127.0.0.1:3200] [--shots]
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://127.0.0.1:3200");
const SHOTS = process.argv.includes("--shots");
const DIR = path.join(__dirname, "..", ".screens");
const RUNS = [
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 390, height: 844, isMobile: true, hasTouch: true },
  { width: 375, height: 667, isMobile: true, hasTouch: true },
  { width: 390, height: 844, isMobile: true, hasTouch: true, reduced: true },
];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (ok, msg) => { console.log((ok ? "  ok   " : "  FAIL ") + msg); if (!ok) failures++; };
function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  return path.join(root, fs.readdirSync(root).sort().pop(), "chrome-linux64", "chrome");
}

async function state(page) {
  return page.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); const b = e.getBoundingClientRect(); return { top: b.top, bottom: b.bottom, left: b.left, right: b.right, h: b.height }; };
    const h1 = document.querySelector(".hero__title");
    const hr = r(".hero__title");
    const hit = document.elementFromPoint((hr.left + hr.right) / 2, Math.min(innerHeight - 1, Math.max(0, (hr.top + hr.bottom) / 2)));
    // What the eye gets: the H1's own opacity times every ancestor's up to the hero.
    let opacity = 1;
    for (let e = h1; e && !e.classList.contains("hero"); e = e.parentElement) opacity *= +getComputedStyle(e).opacity;
    const sub = r(".hero__sub");
    return {
      hero: r(".hero"), h1: hr, sub, sheet: r(".value-area"), header: r(".site-header"),
      opacity, overlap: hr.bottom > sub.top + 1 && hr.top < sub.bottom,
      hitSheet: !!(hit && hit.closest(".value-area")),
      hscroll: document.documentElement.scrollWidth > innerWidth,
    };
  });
}

(async () => {
  if (SHOTS) fs.mkdirSync(DIR, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const vp of RUNS) {
      const tag = `${vp.width}x${vp.height}${vp.reduced ? "-reduced" : ""}`;
      console.log(`\n${tag}`);
      const page = await browser.newPage();
      await page.setViewport(vp);
      await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
      if (vp.reduced) await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
      const errors = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(String(e)));
      await page.evaluateOnNewDocument(() => {
        window.__cls = 0;
        try { new PerformanceObserver((l) => l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; })).observe({ type: "layout-shift", buffered: true }); } catch (e) { /* unsupported */ }
      });
      await page.goto(BASE + "/", { waitUntil: "networkidle0" });
      await page.waitForSelector("#valueArea:not([hidden])", { timeout: 10000 }).catch(() => null);
      await sleep(600);
      const heroH = await page.$eval(".hero", (e) => e.offsetHeight);

      // At rest: the CTAs are on top and clickable.
      const ctas = await page.$$eval(".hero a[href], .hero button", (els) => els.filter((e) => e.offsetParent && !e.closest(".hero-card")).map((e) => {
        const b = e.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { text: e.textContent.trim().slice(0, 20), ok: !!hit && (hit === e || e.contains(hit)) };
      }));
      check(ctas.length > 0 && ctas.every((c) => c.ok), `hero CTAs clickable at rest (${ctas.map((c) => c.text).join(", ")})`);

      const steps = [0, 0.4, 1];
      const at = [];
      for (let n = 0; n < steps.length; n++) {
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), Math.round(heroH * steps[n]));
        await sleep(450);
        const s = await state(page);
        at.push(s);
        if (SHOTS) await page.screenshot({ path: path.join(DIR, `hero-h1-${tag}-${n + 1}.png`), captureBeyondViewport: false });
        check(!s.hscroll, `scroll ${Math.round(steps[n] * 100)}%: no horizontal scroll`);
      }
      check(Math.abs(at[1].hero.top) < 1 && Math.abs(at[2].hero.top) < 1, `hero pinned (top ${at[1].hero.top.toFixed(1)} / ${at[2].hero.top.toFixed(1)})`);
      const moved = [1, 2].map((n) => at[n].h1.top - at[0].h1.top);
      if (vp.reduced) {
        check(at.every((s) => s.opacity === 1) && moved.every((d) => Math.abs(d) < 0.5), "reduced motion: the H1 never moves or fades");
      } else {
        check(at[0].opacity === 1, "H1 untouched at rest");
        check(moved[0] > 5 && moved[1] > moved[0] && at[1].opacity < 1 && at[2].opacity <= 0.31, `H1 sinks ${moved.map((d) => Math.round(d)).join("/")}px and fades (opacity ${at[1].opacity.toFixed(2)} at 40%, ${at[2].opacity.toFixed(2)} at 100%)`);
      }
      check(at.every((s) => !s.overlap), "the H1 never overlaps its line underneath");
      const end = at[2];
      check(end.sheet.top <= end.header.bottom + 0.5, `100%: showcase top ${end.sheet.top.toFixed(1)} <= header bottom ${end.header.bottom.toFixed(1)}`);
      check(end.sheet.top <= end.h1.top && end.sheet.bottom >= end.h1.bottom && end.hitSheet, "100%: the H1 is fully under the showcase");

      // Past the stack the hero has scrolled away, still covered.
      await page.evaluate(() => { const v = document.querySelector(".value-area").getBoundingClientRect(); window.scrollBy({ top: v.bottom - innerHeight / 2, behavior: "instant" }); });
      await sleep(300);
      const after = await page.evaluate(() => { const hit = document.elementFromPoint(innerWidth / 2, innerHeight / 3); return !!(hit && hit.closest(".hero")); });
      check(!after, "past the showcase: the hero is not visible");
      const cls = await page.evaluate(() => window.__cls);
      check(cls < 0.1, `CLS ${cls.toFixed(4)} < 0.1`);
      check(errors.length === 0, `no console errors${errors.length ? ": " + errors.slice(0, 3).join(" | ") : ""}`);
      await page.close();
    }
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
