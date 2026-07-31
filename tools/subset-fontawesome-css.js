// Strips unused icon rules out of all.min.css.
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
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CSSPATH = path.join(ROOT, "assets/css/all.min.css");

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git", "webfonts"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

const used = new Set();
for (const f of walk(ROOT, [".html", ".js"])) {
  for (const m of fs.readFileSync(f, "utf8").matchAll(/\bfa-([a-z0-9-]+)\b/g)) used.add(m[1]);
}

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

const css = fs.readFileSync(CSSPATH, "utf8");
const before = css.length;

let out = stripRules(css, "before");
out = stripRules(out, "after");

fs.writeFileSync(CSSPATH, out);
console.log(`icon rules kept:    ${kept}`);
console.log(`icon rules removed: ${removed}`);
console.log(`all.min.css ${(before / 1024).toFixed(0)}KB -> ${(out.length / 1024).toFixed(0)}KB  (-${((1 - out.length / before) * 100).toFixed(1)}%)`);

const musts = ["@font-face", "Font Awesome 6 Pro", "Font Awesome 6 Brands", ".fa-spin", ".fa-fw", "fa-solid-900.woff2"];
const missing = musts.filter((m) => !out.includes(m));
console.log(missing.length ? `STRUCTURAL LOSS: ${missing.join(", ")}` : "structural CSS intact (font-faces, base classes, animations)");
