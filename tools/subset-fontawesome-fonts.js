// Subsets the FontAwesome webfonts down to only the glyphs this site actually
// references. Same class names, same markup, same CSS — just fonts that carry
// the ~100 icons in use instead of all ~4000.
//
// The inventory is deliberately over-inclusive: it scans every HTML file, every
// JS file (icons are injected from JS all over the admin panel), and every CSS
// file, and it keeps an icon if ANY source mentions it. A missed icon renders
// as a blank box, so the bias must be toward keeping too much.
const fs = require("fs");
const path = require("path");
const subsetFont = require("subset-font"); // devDependency, see tools/README.md

const ROOT = path.join(__dirname, "..");
const CSS = path.join(ROOT, "assets/css/all.min.css");
const FONTDIR = path.join(ROOT, "assets/webfonts");

function walk(dir, exts, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === ".git" || e.name === "webfonts") continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

// 1. Every fa-* token mentioned anywhere.
const sources = walk(ROOT, [".html", ".js", ".css", ".md"]).filter((f) => !f.includes("/assets/css/all.min.css"));
const mentioned = new Set();
for (const f of sources) {
  const txt = fs.readFileSync(f, "utf8");
  for (const m of txt.matchAll(/\bfa-([a-z0-9-]+)\b/g)) mentioned.add(m[1]);
}

// 2. Icon name -> codepoint, from the FA stylesheet itself.
const css = fs.readFileSync(CSS, "utf8");
const nameToCode = new Map();
for (const m of css.matchAll(/\.fa-([a-z0-9-]+):before\{content:"\\([0-9a-f]+)"/g)) {
  nameToCode.set(m[1], parseInt(m[2], 16));
}
// Aliases: .fa-a,.fa-b:before{content:"\f000"} — grab grouped selectors too.
for (const m of css.matchAll(/([^{}]+):before\{content:"\\([0-9a-f]+)"\}/g)) {
  const code = parseInt(m[2], 16);
  for (const sel of m[1].split(",")) {
    const n = sel.trim().match(/^\.fa-([a-z0-9-]+)$/);
    if (n) nameToCode.set(n[1], code);
  }
}

const used = [];
for (const name of mentioned) if (nameToCode.has(name)) used.push(nameToCode.get(name));

// Always keep the few control glyphs FA itself relies on.
const KEEP_ALWAYS = [0x20, 0xa0];
const codepoints = [...new Set([...used, ...KEEP_ALWAYS])].sort((a, b) => a - b);
const text = codepoints.map((c) => String.fromCodePoint(c)).join("");

console.log(`fa-* tokens mentioned in source: ${mentioned.size}`);
console.log(`of those, real FA icons:         ${used.length}`);
console.log(`glyphs kept per font:            ${codepoints.length}`);

(async () => {
  const targets = fs.readdirSync(FONTDIR).filter((f) => f.endsWith(".woff2"));
  let before = 0, after = 0;
  for (const file of targets) {
    const p = path.join(FONTDIR, file);
    const buf = fs.readFileSync(p);
    before += buf.length;
    try {
      const out = await subsetFont(buf, text, { targetFormat: "woff2" });
      // Never write a subset that is somehow bigger, and never write an empty one.
      if (out.length && out.length < buf.length) {
        fs.writeFileSync(path.join(FONTDIR, file), out);
        after += out.length;
        console.log(`  ${file.padEnd(28)} ${(buf.length / 1024).toFixed(0).padStart(4)}KB -> ${(out.length / 1024).toFixed(0).padStart(4)}KB`);
      } else {
        after += buf.length;
        console.log(`  ${file.padEnd(28)} kept original (subset not smaller)`);
      }
    } catch (e) {
      after += buf.length;
      console.log(`  ${file.padEnd(28)} SKIPPED: ${e.message}`);
    }
  }
  console.log(`\ntotal ${(before / 1024).toFixed(0)}KB -> ${(after / 1024).toFixed(0)}KB  (saved ${((1 - after / before) * 100).toFixed(1)}%)`);
})();
