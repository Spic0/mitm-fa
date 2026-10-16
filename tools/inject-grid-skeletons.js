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

// There was a second pass here for horizontal STRIPS, holding one entry:
// `dealCardsTrack`, the featured-product rail on the landing page. That
// section was removed on 2026-08-26 (it listed the same products as the grid
// below it), so the pass, its card shape and its config are gone with it
// rather than left as dead code pointing at an element that no longer exists.
// The reasoning is worth keeping for the next rail someone adds: an element a
// fetch fills later needs its height reserved in the markup, or it becomes the
// page's largest layout shift — which is exactly what that one was
// (0.0505 at ~450ms) before it got a skeleton.
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

// Find a container by id and return the exact bounds of its inner HTML.
//
// This walks the div nesting instead of regex-matching up to the first
// `</div>`. A non-greedy `([\s\S]*?)(</div>)` stops at the first CLOSING tag
// it sees, which — for any container holding nested markup, i.e. every grid
// here once it has cards in it — is a tag INSIDE the container, not the
// container's own. Rewriting that partial region left the tail of the previous
// block stranded after the new one, so each re-run stranded another copy and
// leaked 4 unbalanced `</div>` per grid. That is what broke the four home
// variants (-12 divs each) and shop.html (-4): the stray closers ended the
// row early and every following column escaped into the section, which the
// browser then reparented into a tall wall of never-filled skeletons.
function findContainer(html, id) {
  const m = html.match(new RegExp(`<div[^>]*id="${id}"[^>]*>`));
  if (!m) return null;
  const innerStart = m.index + m[0].length;
  const tagRe = /<div\b[^>]*>|<\/div>/g;
  tagRe.lastIndex = innerStart;
  let depth = 1;
  let t;
  while ((t = tagRe.exec(html))) {
    depth += t[0][1] === "/" ? -1 : 1;
    if (depth === 0) return { openTag: m[0], innerStart, innerEnd: t.index, closeTag: t[0] };
  }
  return null; // unbalanced source: leave it alone rather than guess
}

const files = fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"));
let touched = 0;

for (const file of files) {
  const p = path.join(ROOT, file);
  let html = fs.readFileSync(p, "utf8");
  let changed = false;

  for (const [id, count] of Object.entries(GRIDS)) {
    const box = findContainer(html, id);
    if (!box) continue;

    const inner = html.slice(box.innerStart, box.innerEnd);
    // Only ever replace our own generated block, never real markup.
    if (inner.trim() && !inner.includes(MARK_OPEN)) continue;

    const colMatch = box.openTag.match(/data-col-class="([^"]+)"/);
    const colClass = colMatch ? colMatch[1] : "col-xl-3 col-lg-4 col-md-6";

    const block = MARK_OPEN + Array.from({ length: count }, () => skeletonCard(colClass)).join("") + MARK_CLOSE;
    if (inner === block) continue;

    html = html.slice(0, box.innerStart) + block + html.slice(box.innerEnd);
    changed = true;
  }

  if (changed) {
    fs.writeFileSync(p, html);
    console.log(`  ${file}: skeletons injected`);
    touched++;
  }
}
console.log(`${touched} file(s) updated`);
