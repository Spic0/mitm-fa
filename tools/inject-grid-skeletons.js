// Injects static skeleton cards into the product grid containers.
//
// Why static markup and not JS: products are fetched client-side, so a grid is
// empty when the page first lays out and everything below it — most visibly
// the footer — moves down the moment cards arrive. Rendering skeletons from JS
// does NOT fix that; it only moves the same shift earlier (measured: the
// /shop footer still shifted 0.144 at 193ms). The reserved space has to exist
// in the HTML the browser parses, before any script runs.
//
// Safe to re-run: a container that already has skeleton markup is rewritten
// rather than appended to, so the count stays correct.
//
//   node tools/inject-grid-skeletons.js
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");

// container id -> how many cards that grid typically shows above the fold.
// These only need to be close: the goal is reserving roughly the right block
// of space, not predicting the exact product count.
const GRIDS = {
  shopProductGrid: 8,
  homeGridLatest: 8,
  homeGridTopRated: 8,
  homeGridFeatured: 4,
};

// The deal-cards strip is a horizontal scroller, not a grid, so it needs a
// different card shape — but the same reasoning: it was the single largest
// layout shift on the landing page (0.0505 at ~450ms), purely because the
// track had no height until home-dynamic.js filled it.
const STRIPS = {
  dealCardsTrack: 3,
};

function skeletonDealCard() {
  return (
    `<span class="deal-card deal-card--skeleton" aria-hidden="true">` +
    `<span class="deal-card__image pmedia--skeleton"></span>` +
    `<span class="deal-card__content">` +
    `<span class="skel-line skel-line--title"></span>` +
    `<span class="skel-line skel-line--price"></span>` +
    `<span class="skel-line skel-cta"></span>` +
    `</span></span>`
  );
}

const MARK_OPEN = "<!--skeleton-->";
const MARK_CLOSE = "<!--/skeleton-->";

function skeletonCard(colClass) {
  return (
    `<div class="${colClass}" aria-hidden="true">` +
    `<div class="product__item product__item--skeleton bor">` +
    `<div class="product__image product__image--pmedia pt-20 d-block"><div class="pmedia pmedia--skeleton"></div></div>` +
    `<div class="product__content"><div class="skel-line skel-line--title"></div><div class="skel-line skel-line--price"></div></div>` +
    `<div class="product__tap-cta bor-top skel-cta"></div>` +
    `</div></div>`
  );
}

const files = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
let touched = 0;

for (const file of files) {
  const p = path.join(ROOT, file);
  let html = fs.readFileSync(p, "utf8");
  let changed = false;

  for (const [id, count] of Object.entries(GRIDS)) {
    // Match the container and whatever it currently holds.
    const re = new RegExp(`(<div[^>]*id="${id}"[^>]*>)([\\s\\S]*?)(</div>)`, "");
    const m = html.match(re);
    if (!m) continue;

    const openTag = m[1];
    const inner = m[2];
    // Only ever replace our own generated block, never real markup.
    if (inner.trim() && !inner.includes(MARK_OPEN)) continue;

    const colMatch = openTag.match(/data-col-class="([^"]+)"/);
    const colClass = colMatch ? colMatch[1] : "col-xl-3 col-lg-4 col-md-6";

    const block = MARK_OPEN + Array.from({ length: count }, () => skeletonCard(colClass)).join("") + MARK_CLOSE;
    if (inner === block) continue;

    html = html.replace(re, openTag + block + m[3]);
    changed = true;
  }

  for (const [id, count] of Object.entries(STRIPS)) {
    const re = new RegExp(`(<div[^>]*id="${id}"[^>]*>)([\\s\\S]*?)(</div>)`, "");
    const m = html.match(re);
    if (!m) continue;
    const inner = m[2];
    // The track ships with an HTML comment inside it; treat that as empty.
    const isEmpty = !inner.replace(/<!--(?!\/?skeleton)[\s\S]*?-->/g, "").trim();
    if (!isEmpty && !inner.includes(MARK_OPEN)) continue;

    const block = MARK_OPEN + Array.from({ length: count }, skeletonDealCard).join("") + MARK_CLOSE;
    if (inner === block) continue;
    html = html.replace(re, m[1] + block + m[3]);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(p, html);
    console.log(`  ${file}: skeletons injected`);
    touched++;
  }
}
console.log(`${touched} file(s) updated`);
