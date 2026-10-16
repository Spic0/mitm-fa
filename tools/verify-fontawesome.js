// Proves that every FontAwesome icon this site references will actually render.
//
// An icon needs THREE things to appear, and the subsetting build can break any
// of them independently:
//   1. the markup references it            (assets/js, *.html)
//   2. assets/css/all.min.css maps the class to a codepoint
//   3. assets/webfonts/<family>.woff2 contains a glyph for that codepoint
//
// Nothing was checking (3). The served fonts had been subset down to 79 icon
// glyphs while the stylesheet still mapped 106 icons, so 24 icons — including
// the dashboard, analytics and logout icons in the admin sidebar, the mobile
// menu bars, the cart, and every error/warning triangle — resolved to a
// codepoint with no glyph and rendered as nothing at all. There is no console
// error and no failed request when this happens; the icon is simply invisible,
// which is why it survived to production.
//
// Exits non-zero on any missing icon, so it can gate a deploy.
const fs = require("fs");
const path = require("path");
const { codepoints } = require("./woff2-cmap");
const { SRC_FONTS, OUT_FONTS, OUT_CSS, resolveUsed, NOT_ICONS } = require("./fontawesome-inventory");

const { used, seen, extras } = resolveUsed();

// Which family does each icon live in? Derived from the PRISTINE fonts rather
// than hardcoded, so brand icons (which exist only in fa-brands) are checked
// against the right file and a family added later is picked up for free.
const families = fs.readdirSync(SRC_FONTS).filter((f) => f.endsWith(".woff2"));
const pristine = new Map();
const built = new Map();
for (const f of families) {
  try { pristine.set(f, codepoints(path.join(SRC_FONTS, f))); } catch (e) {
    console.error(`cannot read pristine ${f}: ${e.message}`);
    process.exit(1);
  }
  const outPath = path.join(OUT_FONTS, f);
  if (!fs.existsSync(outPath)) { console.error(`missing built font: assets/webfonts/${f}`); process.exit(1); }
  try { built.set(f, codepoints(outPath)); } catch (e) {
    console.error(`cannot read built ${f}: ${e.message}`);
    process.exit(1);
  }
}

// Which icon classes does the built stylesheet still map?
const css = fs.readFileSync(OUT_CSS, "utf8");
const defined = new Set();
for (const m of css.matchAll(/([^{}]+):(?:before|after)\{content:"(?:\\[0-9a-f]+)+"\}/g)) {
  for (const sel of m[1].split(",")) {
    const n = sel.trim().replace(/::?(before|after)$/, "").match(/^(?:\.fad|\.fa-duotone)?\.fa-([a-z0-9-]+)$/);
    if (n) defined.add(n[1]);
  }
}

const noCss = [];
const noGlyph = [];

for (const [name, code] of used) {
  if (!defined.has(name)) noCss.push([name, code]);
  // Check every family that legitimately carries this glyph. If the pristine
  // set says fa-brands has it and fa-solid does not, only fa-brands is checked.
  // Reported one line per icon — an icon missing from six families is one
  // problem with one fix, not six.
  const absent = families.filter((f) => pristine.get(f).has(code) && !built.get(f).has(code));
  if (absent.length) noGlyph.push([name, code, absent]);
}

console.log(`icons referenced in markup:  ${seen.size} tokens -> ${used.size} real icons (incl. ${extras.length} runtime-built)`);
console.log(`icon rules in built CSS:     ${defined.size}`);
for (const f of families) {
  console.log(`  ${f.padEnd(28)} ${String(built.get(f).size).padStart(5)} glyphs  (pristine ${pristine.get(f).size})`);
}

let bad = false;

if (noCss.length) {
  bad = true;
  console.error(`\nMISSING CSS RULE (${noCss.length}) — class maps to nothing:`);
  for (const [n, c] of noCss.sort()) console.error(`  fa-${n.padEnd(30)} U+${c.toString(16).toUpperCase()}   used in ${seen.get(n) || "(extras list)"}`);
}

if (noGlyph.length) {
  bad = true;
  console.error(`\nMISSING GLYPH (${noGlyph.length}) — renders as an empty box:`);
  for (const [n, c, fs_] of noGlyph.sort()) {
    console.error(`  fa-${n.padEnd(30)} U+${c.toString(16).toUpperCase().padEnd(5)} used in ${seen.get(n) || "(extras list)"}`);
    console.error(`      absent from: ${fs_.map((f) => f.replace(/\.woff2$/, "")).join(", ")}`);
  }
}

// Icons the scan could not resolve to a real FontAwesome name. Usually a
// truncated token from runtime string-building ("fa-chevron" from
// "fa-chevron-" + dir) — the signal that something belongs in
// tools/fontawesome-extra-icons.txt.
const { codes } = resolveUsed();
const unresolved = [...seen.keys()].filter((n) => !codes.has(n) && !NOT_ICONS.has(n) && !/^(fa|fad|fas|far|fal|fat|fab)$/.test(n));
const STRUCTURAL = /^(solid|regular|brands|light|thin|duotone|fw|spin|spin-reverse|spin-pulse|pulse|border|stack|stack-1x|stack-2x|ul|li|inverse|flip|flip-horizontal|flip-vertical|flip-both|rotate|rotate-90|rotate-180|rotate-270|rotate-by|beat|beat-fade|fade|bounce|shake|sr-only|sr-only-focusable|pull-left|pull-right|swap-opacity|width-auto|1x|2x|3x|4x|5x|6x|7x|8x|9x|10x|xs|2xs|sm|lg|xl|2xl)$/;
const suspicious = unresolved.filter((n) => !STRUCTURAL.test(n));
if (suspicious.length) {
  console.warn(`\nUNRECOGNISED fa-* tokens (${suspicious.length}) — not FontAwesome icon names.`);
  console.warn(`If one of these is a runtime-built prefix, add the full name to tools/fontawesome-extra-icons.txt:`);
  for (const n of suspicious.sort()) console.warn(`  fa-${n.padEnd(30)} in ${seen.get(n)}`);
}

if (bad) {
  console.error(`\nFAILED — the build would ship invisible icons.`);
  process.exit(1);
}
console.log(`\nOK — every referenced icon has a CSS rule and a glyph.`);
