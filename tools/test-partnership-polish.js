// /partnership polish pass, at 1920x1080, 1440x900, 1366x768, 390x844 and
// 375x667: the demo viewer is centred (full screen on phones), the Calendly
// card is compact with no inner scroll, the offer frame never scrolls inside,
// odd cards are reversed, and the process diagram animates (and is still with
// reduced motion). Page-wide: no console errors, no horizontal scroll, CLS < 0.1.
//
// Needs a worktree server on :3200 (builder_test) with the demo fixtures:
//   node seed-partnership-demo-fixtures.js && node test-partnership-polish.js [--shots]
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://127.0.0.1:3200");
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = path.join(__dirname, "..", ".screens");
const VIEWPORTS = [
  { width: 1920, height: 1080 },
  { width: 1440, height: 900 },
  { width: 1366, height: 768 },
  { width: 390, height: 844, isMobile: true, hasTouch: true },
  { width: 375, height: 667, isMobile: true, hasTouch: true },
];

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  return path.join(root, fs.readdirSync(root).sort().pop(), "chrome-linux64", "chrome");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(ok, msg) {
  console.log((ok ? "  ok   " : "  FAIL ") + msg);
  if (!ok) failures++;
}
// Viewport-only screenshots: a beyond-viewport capture resizes the page and
// makes Calendly re-render (and swap its frame) mid-test.
async function shot(page, name) {
  const buf = await page.screenshot({ captureBeyondViewport: false });
  if (SHOTS) fs.writeFileSync(path.join(SHOT_DIR, name), buf);
  return buf;
}
async function scrollTo(page, sel, offset) {
  await page.evaluate((s, o) => { const e = document.querySelector(s); window.scrollBy({ top: e.getBoundingClientRect().top - o, behavior: "instant" }); }, sel, offset);
  await sleep(250);
}

async function run(browser, vp) {
  const tag = `${vp.width}x${vp.height}`;
  const desktop = !vp.isMobile;
  console.log(`\n${tag}`);
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.evaluateOnNewDocument(() => {
    window.__cls = 0;
    try {
      new PerformanceObserver((l) => { l.getEntries().forEach((e) => { if (!e.hadRecentInput) window.__cls += e.value; }); }).observe({ type: "layout-shift", buffered: true });
    } catch (e) { /* no layout-shift support */ }
  });
  await page.goto(BASE + "/partnership", { waitUntil: "networkidle0" });
  // Scroll the whole page once, like a reader: reveals, lazy frames, Calendly.
  await page.evaluate(async () => {
    for (let y = 0; y < document.documentElement.scrollHeight; y += Math.round(innerHeight * 0.8)) {
      window.scrollTo({ top: y, behavior: "instant" });
      await new Promise((r) => setTimeout(r, 140));
    }
  });
  await sleep(1500);
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "no horizontal scroll");
  const cls = await page.evaluate(() => window.__cls);
  check(cls < 0.1, `CLS ${cls.toFixed(4)} < 0.1`);

  // 4. Cards: 1, 3, 5... dark in every grid.
  await scrollTo(page, ".pt-grid", 90);
  const cards = await page.evaluate(() => [...document.querySelectorAll(".pt-grid")].map((g) => [...g.children].map((c) => getComputedStyle(c).backgroundColor)));
  const dark = "rgb(26, 26, 26)";
  check(cards.every((g) => g.every((bg, i) => (i % 2 === 0) === (bg === dark))), `odd cards reversed in ${cards.length} grids (${cards.map((g) => g.length).join("+")} cards)`);
  await shot(page, `v5-cards-${tag}.png`);

  // 5. Diagram: real list, labelled SVG, and it moves.
  await scrollTo(page, ".pt-proc-sec", desktop ? 40 : 60);
  await sleep(900);
  const proc = await page.evaluate(() => ({
    items: document.querySelectorAll("ol.pt-proc__steps > li").length,
    label: !!document.querySelector(".pt-proc__svg[aria-label]"),
    links: document.querySelectorAll(".pt-proc__base").length,
  }));
  check(proc.items === 8 && proc.label && proc.links === 8, `diagram: 8 list items, labelled SVG, ${proc.links} connectors`);
  const a = await shot(page, `v5-diagram-${tag}.png`);
  await sleep(2000);
  const b = await page.screenshot({ captureBeyondViewport: false });
  check(!a.equals(b), "diagram animates (frames 2s apart differ)");

  // 2. Calendly: compact card, Calendly's own height, no inner scroll.
  await scrollTo(page, ".pt-cal", 90);
  await page.waitForSelector(".pt-cal.is-ready", { timeout: 25000 }).catch(() => null);
  await sleep(1200);
  const cal = await page.$eval(".pt-cal", (c) => ({ w: c.offsetWidth, h: c.offsetHeight }));
  const wantW = desktop ? 520 : vp.width - 32;
  const calFrame = page.frames().find((f) => /calendly\.com/.test(f.url()));
  const inner = calFrame ? await calFrame.evaluate(() => ({ sh: document.scrollingElement.scrollHeight, ch: document.scrollingElement.clientHeight })).catch(() => null) : null;
  check(cal.w === wantW && cal.h >= 602 && cal.h <= 660, `calendly card ${cal.w}x${cal.h} (want ${wantW} wide, 602-660 tall)`);
  check(!!inner && inner.sh <= inner.ch, `calendly frame has no inner scroll (${inner ? inner.sh + "<=" + inner.ch : "frame not found"})`);
  await shot(page, `v5-calendly-${tag}.png`);

  // 3. Offer form: the frame is its content's height on every step.
  await scrollTo(page, ".pt-offer", 80);
  await sleep(1200);
  const form = () => page.evaluate(() => {
    const f = document.querySelector("[data-offer-frame]");
    const se = f.contentDocument.scrollingElement;
    return { frame: f.offsetHeight, body: Math.round(f.contentDocument.body.getBoundingClientRect().height), sh: se.scrollHeight, ch: se.clientHeight, top: Math.round(f.parentNode.getBoundingClientRect().top) };
  });
  const f1 = await form();
  check(f1.sh <= f1.ch && Math.abs(f1.frame - f1.body) <= 1, `form step 1: frame ${f1.frame}px = body ${f1.body}px, scrollHeight ${f1.sh} <= clientHeight ${f1.ch}`);
  await shot(page, `v5-form-${tag}.png`);
  const ff = await (await page.$("[data-offer-frame]")).contentFrame();
  await ff.evaluate(() => document.getElementById("presSetupNext").click());
  await sleep(1200);
  const f2 = await form();
  check(f2.sh <= f2.ch && Math.abs(f2.frame - f2.body) <= 1, `form contact step: frame ${f2.frame}px, no inner scroll`);
  await page.evaluate(() => { const f = document.querySelector("[data-offer-frame]"); window.scrollBy({ top: f.getBoundingClientRect().bottom - innerHeight + 20, behavior: "instant" }); });
  await sleep(300);
  await ff.evaluate(() => document.getElementById("presSetupBack").click());
  await sleep(1500);
  const f3 = await form();
  const headerBottom = await page.$eval(".site-header", (h) => h.getBoundingClientRect().bottom);
  check(f3.top >= headerBottom && f3.top < headerBottom + 40, `form back to step 1: box top ${f3.top}px kept under the header (${Math.round(headerBottom)}px)`);

  // 1. Demo viewer: centred panel (desktop) or full screen (phones).
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await sleep(300);
  await page.click(".ph__actions [data-demo-open]");
  await page.waitForSelector(".pt-demo__view.is-loaded", { timeout: 15000 });
  await sleep(1200);
  const demo = await page.evaluate(() => {
    const p = document.querySelector(".pt-demo__panel").getBoundingClientRect();
    return {
      dx: p.left + p.width / 2 - innerWidth / 2, dy: p.top + p.height / 2 - innerHeight / 2,
      w: p.width, h: p.height,
      locked: getComputedStyle(document.documentElement).overflow === "hidden",
      hscroll: document.documentElement.scrollWidth > innerWidth,
      float: getComputedStyle(document.querySelector(".ph__float")).visibility,
      devs: getComputedStyle(document.querySelector(".pt-demo__devs")).display,
    };
  });
  if (desktop) {
    check(Math.abs(demo.dx) <= 2 && Math.abs(demo.dy) <= 2 && demo.w === Math.min(1280, vp.width - 32) && demo.h === Math.min(860, vp.height - 32), `demo panel ${demo.w}x${demo.h} centred (dx ${demo.dx.toFixed(1)}, dy ${demo.dy.toFixed(1)})`);
  } else {
    check(demo.w === vp.width && demo.h === vp.height && demo.devs === "none", `demo panel full screen ${demo.w}x${demo.h}, device switch hidden`);
  }
  check(demo.locked && !demo.hscroll && demo.float === "hidden", "demo: body locked, no horizontal scroll, hero phone hidden");
  await shot(page, `v5-demo-${tag}.png`);
  await page.keyboard.press("Escape");

  check(errors.length === 0, `no console errors${errors.length ? ": " + errors.slice(0, 4).join(" | ") : ""}`);
  await page.close();
}

async function reducedMotion(browser) {
  console.log("\nprefers-reduced-motion (1440x900)");
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.goto(BASE + "/partnership", { waitUntil: "networkidle0" });
  await scrollTo(page, ".pt-proc-sec", 40);
  await sleep(1200);
  const a = await shot(page, "v5-diagram-reduced-1440x900.png");
  await sleep(2000);
  const b = await page.screenshot({ captureBeyondViewport: false });
  const st = await page.evaluate(() => ({
    pulse: [...document.querySelectorAll(".pt-proc__pulse")].every((p) => getComputedStyle(p).opacity === "0"),
    glow: [...document.querySelectorAll(".pt-proc__step")].every((s) => (s.style.getPropertyValue("--h") || "0") === "0.000" || !s.style.getPropertyValue("--h")),
    visible: [...document.querySelectorAll(".pt-proc__step")].every((s) => getComputedStyle(s).opacity === "1"),
  }));
  check(a.equals(b) && st.pulse && st.glow && st.visible, "static diagram: no pulse, no glow, all 8 steps visible, frames identical");
  await page.close();
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });
  const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const vp of VIEWPORTS) await run(browser, vp);
    await reducedMotion(browser);
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
