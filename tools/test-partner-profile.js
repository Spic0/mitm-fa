// Browser test for the public partner profile (/partners/:slug).
//
// Guards the things the brief is explicit about and that a screenshot alone
// would not catch: no horizontal overflow at any phone width, tap targets at
// or above 44px, no clipped buttons, readable type, the profile column never
// exceeding the viewport, no console errors, and — the recurring bug class in
// this codebase — that no ORIGINAL full-resolution image is ever fetched when
// a derivative exists.
//
// Usage: node test-partner-profile.js [--url http://127.0.0.1:3200/partners/elena-cho] [--shots]
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const URL = arg("--url", "http://127.0.0.1:3200/partners/elena-cho");
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = path.join(__dirname, ".shots");

// The brief's phone widths first, then its desktop widths.
const PHONE_WIDTHS = [320, 375, 390, 430];
const DESKTOP_WIDTHS = [1280, 1440, 1920];
const WIDTHS = [...PHONE_WIDTHS, 768, ...DESKTOP_WIDTHS];

// Minimum comfortable tap target. 44px is the figure both Apple's and
// Google's guidance land on and what the brief asks for.
const MIN_TAP = 44;

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  const builds = fs.readdirSync(root).sort();
  return path.join(root, builds[builds.length - 1], "chrome-linux64", "chrome");
}

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? "  PASS" : "  FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() === "error") consoleErrors.push(m.text());
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  // Every image the page actually requested, so an original-vs-derivative
  // regression is caught rather than assumed absent.
  const imageRequests = [];
  page.on("request", (r) => {
    if (r.resourceType() === "image") imageRequests.push(r.url());
  });

  for (const width of WIDTHS) {
    console.log(`\n${width}px`);
    imageRequests.length = 0;
    await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
    await page.goto(URL, { waitUntil: "networkidle0" });

    const r = await page.evaluate((MIN_TAP) => {
      const doc = document.documentElement;
      const vw = doc.clientWidth;

      // Anything whose border box sticks out past the viewport.
      //
      // Visibility MUST be tested up the ancestor chain, not on the element
      // itself. The shared header's mega-menu panels are parked off-screen
      // and hidden on their CONTAINER; checking only the element reports
      // every one of their descendants as an overflow bug on every page of
      // this site. (Chrome also paints those panels into screenshots even
      // though they are hidden and non-interactive, so the image is not
      // evidence either — hit-test instead, as this does below.)
      const hiddenUp = (el) => {
        for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.display === "none" || cs.visibility === "hidden") return true;
          if (parseFloat(cs.opacity) === 0) return true;
        }
        return false;
      };

      // True when some ancestor clips horizontally, which means this element
      // cannot contribute to document-level overflow no matter how far its
      // box extends.
      const clippedUp = (el) => {
        for (let n = el.parentElement; n && n !== document.documentElement; n = n.parentElement) {
          const ox = getComputedStyle(n).overflowX;
          if (ox === "hidden" || ox === "clip" || ox === "auto" || ox === "scroll") return true;
        }
        return false;
      };

      const overflowing = [];
      document.querySelectorAll("body *").forEach((el) => {
        const cs = getComputedStyle(el);
        if (cs.position === "fixed") return;
        if (hiddenUp(el)) return;
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) return;
        if (b.right > vw + 1 || b.left < -1) {
          // An element inside a clipping ancestor cannot widen the document,
          // and this page's shared header legitimately parks the desktop nav
          // off-screen inside one at phone widths. That is the precise reason
          // those elements are not overflow bugs — so test for it directly
          // rather than trying to hit-test a point that lies outside the
          // viewport in the first place.
          if (clippedUp(el)) return;
          overflowing.push({
            sel: el.tagName.toLowerCase() + "." + String(el.className || "").split(" ").filter(Boolean).slice(0, 2).join("."),
            left: Math.round(b.left),
            right: Math.round(b.right),
          });
        }
      });

      const profile = document.querySelector(".pprofile");
      const taps = [];
      document.querySelectorAll(".pprofile a, .pprofile button").forEach((el) => {
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return;
        if (b.height < MIN_TAP) {
          taps.push({
            sel: el.className || el.tagName,
            h: Math.round(b.height),
            text: (el.textContent || "").trim().slice(0, 24),
          });
        }
      });

      // Type sizes actually in use inside the profile.
      const smallText = [];
      document.querySelectorAll(".pprofile__row-title, .pprofile__bio, .pprofile__name, .pprofile__cta").forEach((el) => {
        const fs = parseFloat(getComputedStyle(el).fontSize);
        if (fs < 13) smallText.push({ sel: el.className, fs });
      });

      const cta = document.querySelector(".pprofile__cta");
      const name = document.querySelector(".pprofile__name");

      return {
        vw,
        scrollW: doc.scrollWidth,
        bodyScrollW: document.body.scrollWidth,
        overflowing: overflowing.slice(0, 6),
        profileW: profile ? Math.round(profile.getBoundingClientRect().width) : null,
        taps: taps.slice(0, 6),
        smallText,
        ctaTop: cta ? Math.round(cta.getBoundingClientRect().top) : null,
        ctaW: cta ? Math.round(cta.getBoundingClientRect().width) : null,
        nameVisible: name ? name.getBoundingClientRect().top < 900 : false,
        productRows: document.querySelectorAll(".pprofile__row--product").length,
        linkRows: document.querySelectorAll(".pprofile__row:not(.pprofile__row--product)").length,
        socials: document.querySelectorAll(".pprofile__social").length,
        featureCards: document.querySelectorAll(".pprofile__feature").length,
      };
    }, MIN_TAP);

    check("no horizontal document overflow", r.scrollW <= r.vw, `scrollWidth ${r.scrollW} vs viewport ${r.vw}`);
    check("no element past the viewport edge", r.overflowing.length === 0, JSON.stringify(r.overflowing));
    check("profile column within viewport", r.profileW !== null && r.profileW <= r.vw, `column ${r.profileW}px`);
    check(`tap targets >= ${MIN_TAP}px`, r.taps.length === 0, JSON.stringify(r.taps));
    check("no text below 13px", r.smallText.length === 0, JSON.stringify(r.smallText));
    check("partner name rendered", r.nameVisible);

    if (PHONE_WIDTHS.includes(width)) {
      // On a phone the CTA spans the column, which IS the viewport minus
      // padding. On desktop the column is deliberately capped at 34rem and
      // centred, so a full-viewport-width CTA there would be the bug, not the
      // fix — hence this assertion is phone-only.
      check("primary CTA spans the column", r.ctaW !== null && r.ctaW > r.vw * 0.5, `cta ${r.ctaW}px of ${r.vw}px`);
      // The identity block plus the primary action should be reachable
      // without hunting: CTA within the first screen and a half.
      check("primary CTA near the fold", r.ctaTop !== null && r.ctaTop < 900, `top ${r.ctaTop}px`);
    } else {
      check("profile column stays narrow", r.profileW !== null && r.profileW <= 560, `column ${r.profileW}px`);
    }

    // Content actually present (guards against an empty-looking profile
    // passing every geometric assertion).
    check("featured product card present", r.featureCards === 1, `${r.featureCards}`);
    check("product rows present", r.productRows >= 1, `${r.productRows}`);
    check("link rows present", r.linkRows >= 1, `${r.linkRows}`);

    // THE recurring bug in this codebase: a renderer that ships the stored
    // original instead of asking for a derivative. Any uploads/ image fetched
    // WITHOUT a -320/-640/-960/-1280 width suffix is that regression.
    const originals = imageRequests.filter(
      (u) => /\/assets\/images\/product\/uploads\//.test(u) && !/-(?:320|640|960|1280)\.(?:avif|webp)(?:$|\?)/.test(u)
    );
    check("no original full-res image fetched", originals.length === 0, originals.join(", "));

    if (SHOTS) {
      await page.screenshot({
        path: path.join(SHOT_DIR, `partner-${width}.png`),
        fullPage: PHONE_WIDTHS.includes(width),
      });
    }
  }

  console.log("");
  check("no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 4).join(" | "));

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll partner profile checks passed");
  process.exit(failures ? 1 : 0);
})();
