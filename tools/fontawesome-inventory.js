// Shared icon inventory for the two FontAwesome subsetting tools and the
// verifier, so all three agree on exactly one definition of "in use".
//
// Both subsetters previously derived this themselves, from slightly different
// file-type lists, and each wrote its output back over its own input. That
// combination is what silently broke the icons: once a glyph had been dropped
// from the served font, no later run could restore it, because the "original"
// the tool read was already the stripped copy. Everything here reads from
// tools/fontawesome-src/ (pristine, checked in, never written to) and writes
// only into assets/, so a rebuild is idempotent and always recoverable.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC_DIR = path.join(__dirname, "fontawesome-src");
const SRC_CSS = path.join(SRC_DIR, "all.min.css");
const SRC_FONTS = path.join(SRC_DIR, "webfonts");
const OUT_CSS = path.join(ROOT, "assets/css/all.min.css");
const OUT_FONTS = path.join(ROOT, "assets/webfonts");
const EXTRA_FILE = path.join(__dirname, "fontawesome-extra-icons.txt");

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    // webfonts/ and fontawesome-src/ are build inputs/outputs, never sources of
    // truth about which icons a page renders.
    if (["node_modules", ".git", "webfonts", "fontawesome-src"].includes(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

// Tokens that match the fa-* shape but are not icon names, so the verifier
// doesn't report them forever. Each is a deliberate, checked entry — never add
// one to silence a real missing icon.
const NOT_ICONS = new Set([
  "builder",  // `root.className = "fa-builder"` — a layout class in builder/ui.js
  "chevron",  // truncated by `"fa-chevron-" + dir`; real names are in the extras file
  "solid-900", "regular-400", "brands-400", "light-300", "thin-100", "duotone-900",
              // webfont filenames, e.g. the <link rel=preload> in partials/header.html
]);

// Where each icon name was seen, so the verifier can point at a real file.
function scanSources() {
  const seen = new Map();
  for (const f of walk(ROOT, [".html", ".js"])) {
    // The tools themselves discuss `fa-name` in prose; counting that would keep
    // junk alive and bury real misses in noise.
    if (f.startsWith(__dirname)) continue;
    let txt = fs.readFileSync(f, "utf8");
    // Drop HTML and JS block comments. A commented-out icon is not rendered, and
    // a comment naming an icon (like the one on checkout.html explaining a
    // renamed class) would otherwise be indistinguishable from real usage.
    // Line comments are deliberately NOT stripped: `//` also appears inside URLs
    // and string literals, and cutting there could drop a real icon from the
    // inventory — the bias must always be toward keeping too much.
    txt = txt.replace(/<!--[\s\S]*?-->/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
    for (const m of txt.matchAll(/\bfa-([a-z0-9-]+)\b/g)) {
      if (!seen.has(m[1])) seen.set(m[1], path.relative(ROOT, f));
    }
  }
  return seen;
}

// Icons whose class name is BUILT AT RUNTIME and so cannot be seen by any
// static scan — e.g. builder/ui.js does `"fa-chevron-" + (open ? "down" :
// "right")`, which leaves only the useless token `fa-chevron` in the source.
// Anything listed here is kept unconditionally. This file is the one place to
// add an icon that a scan cannot prove is used.
function readExtras() {
  if (!fs.existsSync(EXTRA_FILE)) return [];
  return fs.readFileSync(EXTRA_FILE, "utf8")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean)
    .map((n) => n.replace(/^\.?fa-/, ""));
}

// name -> codepoint, parsed from the PRISTINE stylesheet. Reading this from the
// already-subsetted output is what made the font inventory shrink on every run.
function nameToCode() {
  const css = fs.readFileSync(SRC_CSS, "utf8");
  const map = new Map();
  // Grouped selectors share one content rule (".fa-search,.fa-magnifying-glass:before"),
  // and only the last member carries the pseudo-element.
  for (const m of css.matchAll(/([^{}]+):(?:before|after)\{content:"\\([0-9a-f]+)"(?:\})/g)) {
    const code = parseInt(m[2], 16);
    for (const sel of m[1].split(",")) {
      const n = sel.trim().replace(/::?(before|after)$/, "").match(/^(?:\.fad|\.fa-duotone)?\.fa-([a-z0-9-]+)$/);
      if (n) map.set(n[1], code);
    }
  }
  return map;
}

// The final answer: every icon name that must survive subsetting, restricted to
// names that are real FontAwesome icons.
function resolveUsed() {
  const seen = scanSources();
  const extras = readExtras();
  const codes = nameToCode();
  const used = new Map();
  for (const name of [...seen.keys(), ...extras]) {
    if (codes.has(name)) used.set(name, codes.get(name));
  }
  return { used, seen, extras, codes };
}

module.exports = { NOT_ICONS, ROOT, SRC_DIR, SRC_CSS, SRC_FONTS, OUT_CSS, OUT_FONTS, EXTRA_FILE, walk, scanSources, readExtras, nameToCode, resolveUsed };
