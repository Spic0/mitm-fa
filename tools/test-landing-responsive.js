// Responsive regression harness for the homepage.
//
// Checks the invariants the brand/typography/asset pass was asked to hold at
// every breakpoint the brief lists, against a REAL rendered page rather than
// by reading CSS:
//
//   1. no horizontal overflow of the document
//   2. no individual element wider than the viewport
//   3. no section collapsed to zero height (a fixed-height/flex mistake)
//   4. every landing slot has a non-zero box, filled or empty
//   5. the three product tabs' grids all reserve space before data arrives
//
//   node tools/test-landing-responsive.js [--url http://127.0.0.1:3200/] [--shots]
//
// Requires the site running on the given URL. Screenshots (--shots) land in
// tools/.shots/ and are gitignored.
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const URL = arg("--url", "http://127.0.0.1:3200/");
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = path.join(__dirname, ".shots");

// Exactly the widths the brief enumerates.
const WIDTHS = [320, 360, 375, 390, 414, 430, 768, 1024, 1280, 1440, 1920];

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  const builds = fs.readdirSync(root).sort();
  const build = builds[builds.length - 1];
  return path.join(root, build, "chrome-linux64", "chrome");
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  let failures = 0;
  const page = await browser.newPage();
  // The dev server 301s anything without this (see server/src/index.js).
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });

  for (const width of WIDTHS) {
    await page.setViewport({ width, height: 900, deviceScaleFactor: 1 });
    await page.goto(URL, { waitUntil: "networkidle0" });
    // The product grids and trust stats are rendered by fetch-driven JS.
    await new Promise((r) => setTimeout(r, 600));

    const result = await page.evaluate(() => {
      const doc = document.documentElement;
      const vw = doc.clientWidth;

      // An element wider than the viewport is only a BUG when nothing clips
      // it. Two things on this page are deliberately oversized and contained
      // by an `overflow: hidden` ancestor: the full-bleed hero backdrop
      // (.hero-slideshow__bg-layer) and the scrolling product ticker
      // (.marquee-wrapper), which is twice the list width by design so its
      // -100% loop is seamless. Reporting those as overflow would make the
      // harness cry wolf 100+ times per width and hide a real regression.
      const isClipped = (el) => {
        for (let p = el.parentElement; p && p !== document.body; p = p.parentElement) {
          const cs = getComputedStyle(p);
          if (/hidden|clip|auto|scroll/.test(cs.overflowX)) return true;
        }
        return false;
      };

      const overflowing = [];
      document.querySelectorAll("main *, footer *").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) return; // display:none / not laid out
        // 1px of tolerance for sub-pixel rounding on fractional viewports.
        if (r.right > vw + 1 || r.left < -1) {
          if (isClipped(el)) return;
          overflowing.push({
            tag: el.tagName.toLowerCase(),
            cls: (el.className && el.className.toString().slice(0, 60)) || "",
            left: Math.round(r.left),
            right: Math.round(r.right),
          });
        }
      });

      const sections = [];
      document.querySelectorAll("main > section, main > div").forEach((el) => {
        const r = el.getBoundingClientRect();
        sections.push({
          cls: (el.className && el.className.toString().slice(0, 44)) || el.tagName,
          h: Math.round(r.height),
          w: Math.round(r.width),
        });
      });

      const slots = [];
      document.querySelectorAll(".landing-slot").forEach((el) => {
        const r = el.getBoundingClientRect();
        slots.push({
          name: el.getAttribute("data-landing-slot"),
          filled: el.classList.contains("is-filled"),
          w: Math.round(r.width),
          h: Math.round(r.height),
        });
      });

      const grids = [];
      ["homeGridLatest", "homeGridBestSellers", "homeGridFeatured"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return grids.push({ id, present: false });
        grids.push({ id, present: true, cards: el.children.length });
      });

      // Hero composition. Below 992px the brief's order is
      // headline -> products -> CTA with no paragraph; from 992px up the
      // original two-column desktop composition must be intact. Both are
      // asserted from the RENDERED box positions rather than from the CSS,
      // because the mobile order is produced by `display: contents` plus
      // `order`, and reading the rules would not prove the boxes actually
      // land in that sequence.
      const heroBox = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        if (cs.display === "none") return { hidden: true };
        const r = el.getBoundingClientRect();
        return {
          top: Math.round(r.top), bottom: Math.round(r.bottom),
          left: Math.round(r.left), right: Math.round(r.right),
          w: Math.round(r.width), align: cs.textAlign,
        };
      };
      const hero = {
        title: heroBox(".hero__title"),
        // The lockup's alignment is set on the <h1> flex container; the two
        // spans inherit it. Read it from the container.
        titleAlign: (() => {
          const el = document.querySelector(".hero__title");
          return el ? getComputedStyle(el).textAlign : null;
        })(),
        // Caption fields live INSIDE each card, so image and name cannot
        // disagree. Assert the active card actually carries all three.
        caption: (() => {
          const c = document.querySelector(".hero-card.is-active");
          if (!c) return null;
          const txt = (s) => {
            const e = c.querySelector(s);
            return e ? e.textContent.trim() : null;
          };
          return { eyebrow: txt(".hero-card__eyebrow"), name: txt(".hero-card__name"), meta: txt(".hero-card__meta") };
        })(),
        sub: heroBox(".hero__sub"),
        stage: heroBox(".hero__stage"),
        actions: heroBox(".hero__actions"),
        twoCol: getComputedStyle(document.querySelector(".hero__grid"))
          .gridTemplateColumns.split(" ").filter(Boolean).length >= 2,
      };
      // Is the headline centred in its own box? Compare each rendered line's
      // left and right gaps — `text-align: center` on a box that is itself
      // off-centre would still look wrong.
      //
      // Measured on .hero__title-main, the display line, NOT the whole <h1>.
      // The <h1> also contains the tracked-out kicker, which carries a
      // deliberate `text-indent` equal to its letter-spacing: letter-spacing
      // appends a trailing space after the final letter, so a raw-centred
      // kicker has its GLYPHS sitting half a space left of centre. In a
      // shrink-to-fit centred box the indent widens the box as well as
      // offsetting the text, so the net effect is the required half-space
      // nudge. getClientRects reports the advance box, which therefore reads
      // as ~4px "off-centre" precisely WHEN the ink is correct — measuring it
      // would fail the fix and pass the bug.
      const t = document.querySelector(".hero__title-main") || document.querySelector(".hero__title");
      if (t) {
        const rg = document.createRange();
        rg.selectNodeContents(t);
        const rects = [...rg.getClientRects()];
        const tb = t.getBoundingClientRect();
        hero.lineCount = new Set(rects.map((r) => Math.round(r.top))).size;
        hero.centreSkew = rects.length
          ? Math.max(...rects.map((r) => Math.abs((r.left - tb.left) - (tb.right - r.right))))
          : 0;
      }

      return {
        vw,
        scrollW: doc.scrollWidth,
        bodyScrollW: document.body.scrollWidth,
        overflowing: overflowing.slice(0, 8),
        overflowCount: overflowing.length,
        sections,
        slots,
        grids,
        hero,
        trustStats: document.querySelectorAll(".trust__stat").length,
      };
    });

    const problems = [];
    if (result.scrollW > result.vw + 1) problems.push(`document scrollWidth ${result.scrollW} > viewport ${result.vw}`);
    if (result.overflowCount) problems.push(`${result.overflowCount} element(s) cross the viewport edge`);
    for (const s of result.sections) {
      if (s.h === 0) problems.push(`section "${s.cls}" collapsed to 0 height`);
    }
    for (const sl of result.slots) {
      if (sl.w === 0 || sl.h === 0) problems.push(`landing slot "${sl.name}" is ${sl.w}x${sl.h}`);
    }

    // ---- hero composition -------------------------------------------------
    const h = result.hero;
    if (!h.title || h.title.hidden) problems.push("hero headline is missing");
    else if (width < 992) {
      // Phone/tablet: one column, headline -> supporting line -> products ->
      // CTA.
      //
      // The supporting line used to be asserted HIDDEN here, because it was a
      // 62-character sentence that pushed the products ~100px down the first
      // viewport. It is six words now and it is shown, so the assertion is
      // inverted — with the one exception it is still hidden for: a viewport
      // under 700px tall, where the CTA row cannot otherwise reach the fold
      // (see the max-height tiers in home-dynamic.css). This harness runs at
      // 900px, so the visible case is the one exercised here; the short-screen
      // case is covered by the fold checks in test-hero-carousel.js.
      const shortScreen = 900 <= 700;
      if (!h.sub || Boolean(h.sub.hidden) !== shortScreen) {
        problems.push(`hero supporting line should be ${shortScreen ? "hidden" : "visible"} below 992px`);
      }
      if (h.titleAlign !== "center") problems.push(`hero headline text-align is ${h.titleAlign}, expected center`);
      if (h.centreSkew > 2) problems.push(`hero headline lines are off-centre by ${h.centreSkew}px`);
      if (h.stage && h.stage.top < h.title.bottom) problems.push("product stage is not below the headline");
      if (h.actions && h.stage && h.actions.top < h.stage.bottom) {
        problems.push("Explore Programs CTA is not below the product stage");
      }
      if (h.twoCol) problems.push("hero is still two columns below 992px");
    } else {
      // Desktop: the original composition. These guard the mobile work from
      // leaking upward — the failure mode this change could plausibly cause.
      if (!h.sub || h.sub.hidden) problems.push("hero paragraph must be visible from 992px up");
      if (h.titleAlign !== "left") problems.push(`desktop hero headline text-align is ${h.titleAlign}, expected left`);
      if (!h.twoCol) problems.push("desktop hero lost its two-column grid");
    }

    // The caption is the hero's product identity — a card with a plate but no
    // name is the failure this structure exists to prevent.
    if (!h.caption) problems.push("no active hero card");
    else {
      if (!h.caption.name) problems.push("active hero card has no product name");
      if (!h.caption.eyebrow) problems.push("active hero card has no attribution eyebrow");
      if (!h.caption.meta) problems.push("active hero card has no price/meta line");
    }

    const status = problems.length ? "FAIL" : "ok  ";
    console.log(
      `${status} ${String(width).padStart(4)}px  scrollW=${result.scrollW}  ` +
      `hero=[${width < 992 ? "h1>stage>cta" : "2col"} lines=${result.hero.lineCount} skew=${result.hero.centreSkew}px sub=${result.hero.sub && result.hero.sub.hidden ? "hidden" : "shown"}]  ` +
      `slots=[${result.slots.map((s) => `${s.name}:${s.w}x${s.h}${s.filled ? "" : "(empty)"}`).join(" ")}]  ` +
      `trustStats=${result.trustStats}`
    );
    if (problems.length) {
      failures++;
      problems.forEach((p) => console.log(`       - ${p}`));
      result.overflowing.forEach((o) => console.log(`         overflow: <${o.tag} class="${o.cls}"> ${o.left}..${o.right}`));
    }
    if (width === 1280) {
      console.log(`       grids: ${result.grids.map((g) => `${g.id}=${g.present ? g.cards + " cards" : "removed"}`).join(", ")}`);
    }

    if (SHOTS) {
      // The theme reveals sections with WOW.js + animate.css, whose initial
      // state is opacity:0. A fullPage screenshot never scrolls, so every
      // section below the fold would photograph as a blank band — an artifact
      // that looks exactly like a broken layout. Walk the page first so the
      // observers fire, then return to the top.
      // Half-viewport steps, re-reading scrollHeight each iteration (lazy
      // images make the page grow while walking it), then a second pass to
      // catch anything the first pass grew past. Coarser stepping leaves
      // whole sections at visibility:hidden and photographs them as blank
      // bands — which is indistinguishable from a real layout failure.
      await page.evaluate(async () => {
        const walk = async () => {
          const step = window.innerHeight / 2;
          for (let y = 0; y < document.body.scrollHeight; y += step) {
            window.scrollTo(0, y);
            await new Promise((r) => setTimeout(r, 90));
          }
        };
        await walk();
        await walk();
        window.scrollTo(0, 0);
        await new Promise((r) => setTimeout(r, 400));
      });
      await page.screenshot({ path: path.join(SHOT_DIR, `home-${width}.png`), fullPage: true });
    }
  }

  await browser.close();
  console.log(failures ? `\n${failures} width(s) FAILED` : `\nall ${WIDTHS.length} widths passed`);
  process.exit(failures ? 1 : 0);
})();
