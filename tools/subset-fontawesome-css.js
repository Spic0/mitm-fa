// Strips unused icon rules out of FontAwesome's stylesheet.
//
// Reads the PRISTINE stylesheet from tools/fontawesome-src/all.min.css and
// writes assets/css/all.min.css. It never reads its own output, so running it
// twice gives the same result as running it once, and an icon added to the UI
// after a previous run is picked up normally instead of being permanently lost.
//
// Only rules of the exact shape `SELECTORS:before|:after{content:"\xxxx"}` are
// touched — that is the per-icon glyph mapping and nothing else. Every
// structural rule FontAwesome needs (@font-face, .fa base class, sizing,
// spin/pulse animations, stacking, fixed-width, list icons) is left exactly as
// it is, so removing an unused icon's content rule cannot affect a used one.
//
// Grouped selectors are filtered member by member rather than dropped whole,
// so an alias that shares a codepoint with a used icon survives. The
// pseudo-element appears on every member except the last, which the outer
// regex consumes — normalising for that is what makes the filter accurate.
const fs = require("fs");
const { SRC_CSS, OUT_CSS, resolveUsed } = require("./fontawesome-inventory");

const { used } = resolveUsed();

let kept = 0;
let removed = 0;

function stripRules(source, pseudo) {
  // Duotone rules carry TWO escape sequences (`content:"\30\30"`), so the
  // content pattern has to allow one-or-more, not exactly one — matching only
  // a single codepoint silently skipped all ~2900 duotone rules.
  const re = new RegExp('([^{}]+):' + pseudo + '\\{content:"(?:\\\\[0-9a-f]+)+"\\}', "g");
  return source.replace(re, (whole, selectors) => {
    const parts = selectors.split(",").map((s) => s.trim()).filter(Boolean);
    const survivors = parts.filter((sel) => {
      const bare = sel.replace(/::?(before|after)$/, "").trim();
      // Plain `.fa-name`, plus the duotone forms `.fad.fa-name` /
      // `.fa-duotone.fa-name`. Anything else is structural and kept.
      const m = bare.match(/^(?:\.fad|\.fa-duotone)?\.fa-([a-z0-9-]+)$/);
      if (!m) return true;
      return used.has(m[1]);
    });
    if (!survivors.length) { removed++; return ""; }
    kept++;
    const content = whole.match(/\{content:"(?:\\[0-9a-f]+)+"\}/)[0];
    const rebuilt = survivors.map((s) => (/::?(before|after)$/.test(s) ? s : s + ":" + pseudo));
    return rebuilt.join(",") + content;
  });
}

const css = fs.readFileSync(SRC_CSS, "utf8");
const before = css.length;

let out = stripRules(css, "before");
out = stripRules(out, "after");

fs.writeFileSync(OUT_CSS, out);
console.log(`icons in use:       ${used.size}`);
console.log(`icon rules kept:    ${kept}`);
console.log(`icon rules removed: ${removed}`);
console.log(`all.min.css ${(before / 1024).toFixed(0)}KB -> ${(out.length / 1024).toFixed(0)}KB  (-${((1 - out.length / before) * 100).toFixed(1)}%)`);

const musts = ["@font-face", "Font Awesome 6 Pro", "Font Awesome 6 Brands", ".fa-spin", ".fa-fw", "fa-solid-900.woff2"];
const missing = musts.filter((m) => !out.includes(m));
if (missing.length) {
  console.error(`STRUCTURAL LOSS: ${missing.join(", ")}`);
  process.exit(1);
}
console.log("structural CSS intact (font-faces, base classes, animations)");
