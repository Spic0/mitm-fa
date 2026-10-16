// Shared "which Bootstrap classes does this site actually use" inventory, so
// the subsetter and its verifier agree on exactly one definition of "in use".
//
// Same shape, and the same reasoning, as fontawesome-inventory.js: the source
// stylesheet lives in tools/bootstrap-src/ (pristine, checked in, NEVER written
// to) and output goes only into assets/. A rebuild is therefore idempotent and
// always recoverable — a class added to the UI after a previous run is picked
// up normally instead of being permanently lost, because the "original" the
// tool reads was never the stripped copy.
//
// The scan is deliberately OVER-inclusive. A false positive keeps a rule that
// could have gone (a few bytes); a false negative deletes a rule the site
// needs, which is a visual break nobody would trace back to a build step. So
// anything that even looks like a class token counts: class="" attributes,
// classList calls, className assignments, jQuery/querySelector `.foo`
// selectors, and any bare word inside a string literal that could be part of a
// class list. That is why the reported token count is far larger than the
// number of classes really in play.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SRC_CSS = path.join(__dirname, "bootstrap-src", "bootstrap.min.css");
const OUT_CSS = path.join(ROOT, "assets", "css", "bootstrap.min.css");
const EXTRA_FILE = path.join(__dirname, "bootstrap-extra-classes.txt");

// Directories that are build inputs, build outputs, or user uploads — never a
// source of truth about which classes a page renders.
const SKIP_DIRS = new Set([
  "node_modules", ".git", "fontawesome-src", "bootstrap-src", "webfonts",
  "storage", "uploads", "gallery", "coverage", "dist",
]);

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

// Every place a class name can enter the DOM on this site: the static
// templates, the partials, the client bundles (which build markup as strings),
// the admin SPA, and server/src — routes/pages.js server-renders real markup
// with real Bootstrap grid classes in it, so it is a first-class source here.
function sourceFiles() {
  const html = walk(ROOT, [".html"]).filter((f) => !f.includes(`${path.sep}assets${path.sep}`));
  const clientJs = walk(path.join(ROOT, "assets", "js"), [".js"]);
  const serverJs = walk(path.join(ROOT, "server", "src"), [".js"]);
  return [...html, ...clientJs, ...serverJs];
}

function collectTokens(src, used) {
  const add = (t) => { if (t && /^-?[_a-zA-Z][\w-]*$/.test(t)) used.add(t); };
  const addList = (s) => String(s).split(/\s+/).forEach(add);

  for (const m of src.matchAll(/class\s*=\s*["']([^"']*)["']/g)) addList(m[1]);
  for (const m of src.matchAll(/classList\s*\.\s*(?:add|remove|toggle|contains|replace)\(([^)]*)\)/g))
    for (const s of m[1].matchAll(/["'`]([^"'`]*)["'`]/g)) addList(s[1]);
  for (const m of src.matchAll(/className\s*=\s*["'`]([^"'`]*)["'`]/g)) addList(m[1]);
  // jQuery/querySelector/closest/matches style selectors: `.foo`
  for (const m of src.matchAll(/\.(-?[_a-zA-Z][\w-]{1,60})\b/g)) add(m[1]);
  // Any string literal that could be a class list assembled into markup.
  for (const m of src.matchAll(/["'`]([^"'`<>{}()]{1,300})["'`]/g)) {
    if (!/^[\w \t:./-]+$/.test(m[1])) continue;
    addList(m[1]);
  }
}

function extraClasses() {
  if (!fs.existsSync(EXTRA_FILE)) return [];
  return fs.readFileSync(EXTRA_FILE, "utf8")
    .split("\n")
    .map((l) => l.replace(/#.*$/, "").trim())
    .filter(Boolean);
}

function resolveUsed() {
  const used = new Set();
  const files = sourceFiles();
  for (const f of files) collectTokens(fs.readFileSync(f, "utf8"), used);
  const extras = extraClasses();
  extras.forEach((c) => used.add(c));
  return { used, files, extras };
}

// Every class Bootstrap itself defines, for reporting and for the verifier.
function bootstrapClasses(css) {
  const out = new Set();
  for (const m of css.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)) out.add(m[1]);
  return out;
}

module.exports = { ROOT, SRC_CSS, OUT_CSS, EXTRA_FILE, resolveUsed, bootstrapClasses, walk };
