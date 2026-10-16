// The landing page's product showcase ("See the program before you buy"), in
// a real browser, at real widths.
//
// What it guards, in order of importance:
//
//   1. THE PREVIEW BOUNDARY, from the browser's side. The page must never
//      hold more program content than GET /api/demo sends, no gated media
//      beyond the sliced posters may be requested, and the handbook viewer
//      the section opens must end on the locked page with nothing after it.
//      (The server side of the same boundary is tools/test-demo-preview.js.)
//   2. THE MEDIA BUDGET. This section paints real product imagery on the
//      landing page — the surface this platform has repeatedly shipped
//      multi-megabyte originals onto. Every image inside the section must be
//      a derivative or an allowlisted poster still, never a stored original.
//   3. The device showcase actually works: phone by default, the toggle
//      really switches the composition, nothing overflows at any width, and
//      switching does not move the rest of the page.
//
//   node test-product-showcase.js --base http://127.0.0.1:3210
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg("--base", "http://127.0.0.1:3210");

const MOBILE = [320, 375, 390, 430];
const DESKTOP = [1280, 1440, 1920];

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail !== undefined && detail !== "" ? "  — " + detail : ""}`);
}
function section(name) { console.log(`\n---- ${name} ----`); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  const builds = fs.readdirSync(root).sort();
  return path.join(root, builds[builds.length - 1], "chrome-linux64", "chrome");
}

// An image URL that is acceptable inside this section: a sized derivative of
// an upload, an allowlisted poster/thumb still, an SVG (vector — no smaller
// form exists), or a demo image that never had derivatives cut. What is NOT
// acceptable is a raster original that has derivatives — the signature of the
// recurring bug.
function isBudgeted(url) {
  if (/\.svg(\?|$)/.test(url)) return true;
  if (/variant=(poster|thumb)/.test(url)) return true;
  if (/-(320|640|960|1280)\.(avif|webp)/.test(url)) return true;
  if (/\/product\/demo\//.test(url)) return true; // demo SVG/plain fixtures
  if (/\/logo\//.test(url)) return true;
  return false;
}

async function newPage(browser, width, height, mobile) {
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
  await page.setViewport({ width, height, isMobile: !!mobile, deviceScaleFactor: 2 });
  return page;
}

async function gotoSection(page) {
  await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => {
    const el = document.getElementById("valueArea");
    return el && !el.hidden;
  }, { timeout: 10000 });
  await page.evaluate(() => document.getElementById("valueArea").scrollIntoView({ block: "start" }));
  await wait(700);
}

async function boundary(browser) {
  section("Preview boundary, from the browser");
  const page = await newPage(browser, 1440, 950);
  const gated = [];
  page.on("request", (r) => {
    const u = r.url();
    if (/\/api\/library\/media\//.test(u)) gated.push(u);
  });
  await gotoSection(page);

  // The DOM must hold exactly what the server chose to send. The demo
  // product's day one has more exercises than the slice; none of them may be
  // present anywhere in the document, blurred, hidden or otherwise.
  const dom = await page.evaluate(() => {
    const demoText = document.body.innerHTML;
    const section = document.getElementById("valueArea");
    return {
      exerciseRows: section.querySelectorAll(".dvp__ex").length,
      html: demoText.length,
      hasThirdExercise: /Cable Lateral Raises|Machine Shoulder Press/.test(demoText),
    };
  });
  const api = await page.evaluate(async () => {
    const r = await fetch("/api/demo", { headers: { Accept: "application/json" } });
    const d = await r.json();
    return { sent: d.preview.exercises.length, total: d.contents.exercises };
  });
  check("phone screen shows exactly what the server sent", dom.exerciseRows === api.sent, `${dom.exerciseRows} rows vs ${api.sent} sent`);
  check("no unsent exercise name anywhere in the document", !dom.hasThirdExercise);

  check(
    "gated media requests are poster/thumb stills only",
    gated.length > 0 && gated.every((u) => /variant=(poster|thumb)/.test(u)),
    `${gated.length} requests`
  );

  // ---- The handbook ----
  await page.click("[data-dv-handbook]");
  await page.waitForSelector(".pv", { timeout: 10000 });
  await wait(800);

  const first = await page.evaluate(() => (document.querySelector(".pv__count") || {}).textContent || "");
  const total = parseInt(first.split(" of ")[1], 10);
  check("handbook preview paginates to a small fixed page count", total >= 3 && total <= 6, first);

  for (let i = 0; i < total + 2; i++) { await page.keyboard.press("ArrowRight"); await wait(350); }
  const end = await page.evaluate(() => ({
    count: (document.querySelector(".pv__count") || {}).textContent || "",
    locked: !!document.querySelector(".pv-locked"),
    cta: (document.querySelector(".pv-locked__cta") || { getAttribute: () => null }).getAttribute("href"),
    // The CTA label must be legible — the global span colour rule has made
    // filled-pill labels invisible before. Computed colour, not eyeballs.
    ctaColours: (() => {
      const span = document.querySelector(".pv-locked__cta span");
      const a = document.querySelector(".pv-locked__cta");
      if (!span || !a) return null;
      return { text: getComputedStyle(span).color, bg: getComputedStyle(a).backgroundColor };
    })(),
  }));
  check("paging past the end stays on the locked page", end.count === `${total} of ${total}`, end.count);
  check("the locked page is the last page", end.locked);
  check("locked CTA points at the real product page", /^\/program\//.test(end.cta || ""), end.cta);
  check("locked CTA label is legible on its pill", end.ctaColours && end.ctaColours.text !== end.ctaColours.bg, JSON.stringify(end.ctaColours));

  check(
    "opening and reading the whole handbook fetched stills only",
    gated.every((u) => /variant=(poster|thumb)/.test(u)),
    `${gated.length} gated requests total`
  );

  await page.keyboard.press("Escape");
  await wait(600);
  check("Escape closes the handbook", await page.evaluate(() => !document.querySelector(".pv")));
  await page.close();
}

async function media(browser) {
  section("Media budget");
  const page = await newPage(browser, 1440, 950);
  const images = [];
  page.on("request", (r) => { if (r.resourceType() === "image") images.push(r.url()); });
  await gotoSection(page);
  // Open the laptop too, so both screens' imagery is on the wire.
  await page.click('[data-dv-mode="laptop"]');
  await wait(900);

  const sectionImgs = await page.evaluate(() =>
    Array.prototype.slice.call(document.querySelectorAll("#valueArea img")).map((i) => i.currentSrc || i.src).filter(Boolean)
  );
  const offenders = sectionImgs.filter((u) => !isBudgeted(u));
  check("every image inside the section is a derivative or an allowlisted still", offenders.length === 0, offenders.join(" "));

  // And nothing anywhere on the landing page pulled a raster original that
  // has derivatives — the whole-page form of the same check.
  const pageOffenders = images.filter((u) => /\/product\/uploads\//.test(u) && !/-(320|640|960|1280)\.(avif|webp)/.test(u));
  check("no stored original fetched anywhere on the landing page", pageOffenders.length === 0, pageOffenders.join(" "));
  await page.close();
}

async function devices(browser) {
  for (const width of DESKTOP) {
    section(`Desktop ${width}px`);
    const page = await newPage(browser, width, 950);
    await gotoSection(page);

    const m = await page.evaluate(() => {
      const stage = document.querySelector("[data-dv-stage]");
      const phone = document.querySelector(".dv-phone");
      const laptop = document.querySelector(".dv-laptop");
      const facts = document.querySelectorAll(".dv__fact").length;
      const pr = phone.getBoundingClientRect();
      return {
        mode: stage.getAttribute("data-mode"),
        phoneVisible: getComputedStyle(phone).visibility !== "hidden",
        laptopVisible: getComputedStyle(laptop).visibility !== "hidden",
        phoneW: pr.width, phoneH: pr.height,
        facts,
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        genericCards: document.querySelectorAll("#valueArea .value__spec-row, #valueArea [class*='feature-card']").length,
      };
    });
    check(`${width}: phone mode by default, laptop parked`, m.mode === "phone" && m.phoneVisible && !m.laptopVisible);
    check(`${width}: the device is a real showcase, not a thumbnail`, m.phoneW >= 240 && m.phoneH >= 480, `${Math.round(m.phoneW)}x${Math.round(m.phoneH)}`);
    check(`${width}: concrete product facts are shown`, m.facts >= 4, `${m.facts} rows`);
    check(`${width}: no horizontal overflow`, m.overflow <= 0, `${m.overflow}px`);
    check(`${width}: no generic card grid anywhere in the section`, m.genericCards === 0);

    // The toggle really switches, and switching moves nothing below.
    const before = await page.evaluate(() => document.querySelector(".goal-nav-area").getBoundingClientRect().top);
    await page.click('[data-dv-mode="laptop"]');
    await wait(500);
    const after = await page.evaluate(() => ({
      mode: document.querySelector("[data-dv-stage]").getAttribute("data-mode"),
      laptopVisible: getComputedStyle(document.querySelector(".dv-laptop")).visibility !== "hidden",
      phoneVisible: getComputedStyle(document.querySelector(".dv-phone")).visibility !== "hidden",
      laptopHasUI: !!document.querySelector(".dv-laptop .dvl__day"),
      nextTop: document.querySelector(".goal-nav-area").getBoundingClientRect().top,
      pressed: document.querySelector('[data-dv-mode="laptop"]').getAttribute("aria-pressed"),
    }));
    check(`${width}: toggle switches to the laptop experience`, after.mode === "laptop" && after.laptopVisible && !after.phoneVisible && after.laptopHasUI);
    check(`${width}: aria-pressed follows`, after.pressed === "true");
    check(`${width}: switching devices moves nothing below the section`, Math.abs(after.nextTop - before) < 2, `${Math.round(Math.abs(after.nextTop - before))}px shift`);
    await page.close();
  }
}

async function mobile(browser) {
  for (const width of MOBILE) {
    section(`Mobile ${width}px`);
    const page = await newPage(browser, width, 800, true);
    await gotoSection(page);

    const m = await page.evaluate(() => {
      const sec = document.getElementById("valueArea");
      const phone = document.querySelector(".dv-phone");
      const btn = document.querySelector("[data-dv-handbook]");
      const pr = phone.getBoundingClientRect();
      const br = btn.getBoundingClientRect();
      const order = [];
      ["value__masthead", "dv__show", "dv__info"].forEach((cls) => {
        const el = sec.getElementsByClassName(cls)[0];
        if (el) order.push({ cls, top: el.getBoundingClientRect().top });
      });
      return {
        overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        phoneW: pr.width, phoneRight: pr.right,
        btnH: br.height,
        sectionH: sec.getBoundingClientRect().height,
        ordered: order.every((o, i) => i === 0 || o.top >= order[i - 1].top),
        screenScrolls: (() => {
          const s = document.querySelector(".dv-phone__screen");
          return s.scrollHeight > s.clientHeight;
        })(),
      };
    });
    check(`${width}: no horizontal overflow`, m.overflow <= 0 && m.phoneRight <= width + 1, `overflow ${m.overflow}, phone right ${Math.round(m.phoneRight)}`);
    check(`${width}: heading, device, facts in that order`, m.ordered);
    check(`${width}: the device is readable`, m.phoneW >= 230, `${Math.round(m.phoneW)}px wide`);
    check(`${width}: the in-device UI is genuinely scrollable content`, m.screenScrolls);
    check(`${width}: handbook CTA is comfortably tappable`, m.btnH >= 44, `${Math.round(m.btnH)}px`);
    check(`${width}: the section is not extremely tall`, m.sectionH < 2400, `${Math.round(m.sectionH)}px`);
    await page.close();
  }
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    await boundary(browser);
    await media(browser);
    await devices(browser);
    await mobile(browser);
  } finally {
    await browser.close();
  }
  console.log(`\n${failures ? failures + " FAILURE(S)" : "All checks passed"}`);
  process.exit(failures ? 1 : 0);
})();
