// Strips unused rules out of Bootstrap's stylesheet.
//
// Reads the PRISTINE stylesheet from tools/bootstrap-src/bootstrap.min.css and
// writes assets/css/bootstrap.min.css. It never reads its own output, so
// running it twice gives the same result as running it once — the same
// idempotence rule the FontAwesome subsetters follow, and for the same reason:
// a tool that overwrites its own input can only ever lose information.
//
// Why this is worth doing: Bootstrap 5.3.2 is 232,948 bytes and defines 2,031
// classes. Measured with CDP CSS coverage on the live /checkout, 2.6% of it was
// used. There is no Bootstrap JavaScript anywhere on this site and not a single
// [data-bs-*] attribute, so every component that only exists to be driven by it
// — modal, offcanvas, toast, carousel, accordion, tooltip, popover, the
// dropdown/collapse state machinery — is unreachable markup-wise as well.
//
// WHAT IS KEPT, deliberately erring toward keeping:
//   * every at-rule that is not a plain style rule (@charset, @font-face,
//     @keyframes, @property, @import) verbatim, and the /*! license banner —
//     this is MIT-licensed third-party code and the notice ships with it;
//   * every selector with NO class token at all: :root, [data-bs-theme=...],
//     the reboot's element rules, *, ::before/::after. That is what keeps the
//     ~1,900 --bs-* custom properties alive, which style.css reads from;
//   * conditional group rules (@media/@supports/@layer/@container) when
//     anything survives inside them, dropped whole when nothing does;
//   * any selector whose classes are ALL in use. A compound like `.a.b` needs
//     both, because it cannot match unless both are present.
// Classes inside [attr=...] and inside :not()/:is()/:where() arguments are NOT
// treated as the subject of the rule, so a rule is never dropped because of a
// class that only appears in a negation.
//
// The class inventory is deliberately over-inclusive — see
// bootstrap-class-inventory.js. If something ever does slip through, add it to
// tools/bootstrap-extra-classes.txt rather than loosening the scan; that file
// exists so a fix is one line and survives the next rebuild.
const fs = require("fs");
const { SRC_CSS, OUT_CSS, resolveUsed, bootstrapClasses } = require("./bootstrap-class-inventory");

const { used, files, extras } = resolveUsed();
const source = fs.readFileSync(SRC_CSS, "utf8");

let keptRules = 0;
let droppedRules = 0;
const droppedClassNames = new Set();

// Minified CSS still contains quoted strings (content:"\f101", url("..."),
// [class^="col-"]) and those can hold braces, so brace matching has to be
// quote-aware or the parser desynchronises silently.
function findBlockEnd(src, openIdx) {
  let depth = 0, quote = null;
  for (let i = openIdx; i < src.length; i++) {
    const c = src[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") { quote = c; continue; }
    if (c === "{") depth++;
    else if (c === "}") { depth--; if (depth === 0) return i; }
  }
  return -1;
}

function selectorIsUsed(selector) {
  // Drop the parts that are conditions ON the subject rather than the subject:
  // attribute values, and the arguments of functional pseudo-classes.
  let cleaned = selector.replace(/\[[^\]]*\]/g, " ");
  let prev;
  do { prev = cleaned; cleaned = cleaned.replace(/\((?:[^()])*\)/g, " "); } while (cleaned !== prev);

  const classes = [...cleaned.matchAll(/\.(-?[_a-zA-Z][\w-]*)/g)].map((m) => m[1]);
  if (!classes.length) return true;
  const unusedHere = classes.filter((c) => !used.has(c));
  unusedHere.forEach((c) => droppedClassNames.add(c));
  return unusedHere.length === 0;
}

function filterStyleRule(prelude, body) {
  const survivors = prelude
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .filter(selectorIsUsed);
  if (!survivors.length) { droppedRules++; return ""; }
  keptRules++;
  return survivors.join(",") + "{" + body + "}";
}

// At-rules whose body is a list of style rules and can therefore be filtered.
const GROUP_AT = /^@(media|supports|layer|container|scope|document)\b/i;
// At-rules whose body is declarations or frames — kept verbatim.
const VERBATIM_AT = /^@(font-face|keyframes|-webkit-keyframes|page|property|counter-style|font-feature-values|viewport)\b/i;

function processBlock(src) {
  let out = "";
  let i = 0;
  while (i < src.length) {
    // Preserve the license banner (and any other /*! */ note); drop ordinary
    // comments, of which minified Bootstrap has none anyway.
    if (src.startsWith("/*", i)) {
      const end = src.indexOf("*/", i + 2);
      const comment = src.slice(i, end === -1 ? src.length : end + 2);
      if (comment.startsWith("/*!")) out += comment;
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (/\s/.test(src[i])) { i++; continue; }

    // Statement at-rules with no block: @charset "UTF-8"; @import ...;
    if (src[i] === "@") {
      const semi = src.indexOf(";", i);
      const brace = src.indexOf("{", i);
      if (semi !== -1 && (brace === -1 || semi < brace)) {
        out += src.slice(i, semi + 1);
        i = semi + 1;
        continue;
      }
    }

    const open = src.indexOf("{", i);
    if (open === -1) break;
    const close = findBlockEnd(src, open);
    if (close === -1) break;

    const prelude = src.slice(i, open).trim();
    const body = src.slice(open + 1, close);

    if (VERBATIM_AT.test(prelude)) {
      out += prelude + "{" + body + "}";
    } else if (GROUP_AT.test(prelude)) {
      const inner = processBlock(body);
      if (inner.trim()) out += prelude + "{" + inner + "}";
    } else {
      out += filterStyleRule(prelude, body);
    }
    i = close + 1;
  }
  return out;
}

const result = processBlock(source);
fs.writeFileSync(OUT_CSS, result);

const defined = bootstrapClasses(source);
const referenced = [...defined].filter((c) => used.has(c));
const pct = (n, d) => ((n / d) * 100).toFixed(1) + "%";

console.log(`[bootstrap] scanned ${files.length} source files` + (extras.length ? `, plus ${extras.length} from bootstrap-extra-classes.txt` : ""));
console.log(`[bootstrap] Bootstrap defines ${defined.size} classes; this site references ${referenced.length} (${pct(referenced.length, defined.size)})`);
console.log(`[bootstrap] rules kept ${keptRules}, dropped ${droppedRules} (${pct(droppedRules, keptRules + droppedRules)} of rules)`);
console.log(`[bootstrap] ${SRC_CSS.replace(/.*\//, "")} ${source.length} bytes -> ${result.length} bytes (${pct(result.length, source.length)}, saved ${source.length - result.length})`);
