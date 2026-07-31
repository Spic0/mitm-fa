// Builds assets/css/critical.css — the subset of bootstrap.min.css and
// style.css needed to render the first paint correctly.
//
// Those two files are 86KB of the site's 115KB of render-blocking CSS, and on
// a slow connection they were the last thing gating first paint (measured:
// bootstrap finished at 2029ms, style.css at 2193ms, FCP fired at 2292ms).
// Splitting them means the browser can paint from a ~10KB file and pick the
// rest up asynchronously.
//
// NOT inlined into the HTML, deliberately. This site's CSP is `style-src
// 'self'` with no 'unsafe-inline' and it currently ships zero inline styles —
// a real XSS mitigation on a site that takes payments. Inlining would need
// either 'unsafe-inline' (weakens it for every page) or a per-build sha256 in
// the CSP header (couples the header to build output, and silently blanks the
// page if they ever drift). A separate small stylesheet costs one round trip
// and none of that risk.
//
// Which rules are "critical" is decided by Chrome, not by guessing selectors:
// CSS.startRuleUsageTracking reports exactly which rules the engine matched
// while rendering. Collected across several pages at desktop AND mobile, then
// unioned — so the result is a superset of any one page's first paint, which
// is the safe direction to err. A missing rule is a visible flash; an extra
// rule is a few hundred wasted bytes.
//
//   node tools/build-critical-css.js [baseUrl]
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");
const postcss = require("postcss");

const ROOT = path.join(__dirname, "..");
const CHROME = "/root/.cache/puppeteer/chrome/linux-148.0.7778.97/chrome-linux64/chrome";
const BASE = process.argv[2] || "http://localhost:3200";
const OUT = path.join(ROOT, "assets/css/critical.css");

// The stylesheets being split. Anything not listed here keeps loading normally.
const SPLIT = ["/assets/css/bootstrap.min.css", "/assets/css/style.css"];

// Every public route that defers these stylesheets must be scanned here, or
// its first paint will be missing rules and flash. The union across all of
// them is what makes one shared critical.css safe for the whole site — keep
// this list and the set of pages patched by tools/split-critical-css.js in
// step with each other.
const PAGES = [
  "/",
  "/shop",
  "/about",
  "/contact",
  "/cart",
  "/checkout",
  "/login",
  "/register",
  "/blog",
  "/my-library",
  // A product detail page — a distinct template (shop-single.html) with a
  // gallery, tabs and a purchase panel none of the pages above have.
  "/program/lean-bulk-blueprint",
];
const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

// Rebuilds a valid stylesheet containing only the used rules.
//
// This has to go through a real CSS AST. Slicing the raw byte ranges that
// coverage reports and concatenating them produces INVALID CSS: a rule nested
// inside `@media (...) { ... }` comes back without its enclosing at-rule, so
// the braces no longer balance and the parser gives up almost immediately. The
// first version of this tool did exactly that and produced a 79KB file that
// Chrome parsed into NINE rules — which is why the page still painted
// completely unstyled.
//
// Walking the AST instead keeps each kept rule inside its parent at-rule, and
// drops at-rules that end up empty.
function extractUsed(postcss, css, ranges) {
  const root = postcss.parse(css);

  const used = (node) => {
    const s = node.source && node.source.start && node.source.start.offset;
    if (s == null) return false;
    const e = node.source.end ? node.source.end.offset : s;
    return ranges.some(([rs, re]) => s < re && e >= rs);
  };

  root.walkRules((rule) => {
    // A rule inside @keyframes is a frame ("0%", "to"), not a selector that can
    // match an element — coverage never marks those used, and dropping them
    // would silently break every animation. They live or die with their parent.
    if (rule.parent && rule.parent.type === "atrule" && /keyframes/i.test(rule.parent.name)) return;
    if (!used(rule)) rule.remove();
  });

  root.walkAtRules((at) => {
    // Always keep these regardless of coverage: @font-face is never "matched",
    // custom properties on :root are inherited by everything, and @keyframes
    // are referenced by name from rules that may animate later.
    if (/font-face|keyframes|import|charset/i.test(at.name)) return;
    // @media / @supports survive only if something inside them survived.
    if (at.nodes && at.nodes.length === 0) at.remove();
  });

  // style.css ships unminified (it is a readable theme file), and the AST
  // re-serialises it with all of its original indentation and comments. That
  // is dead weight in a file whose whole job is to arrive fast — cleanRaws
  // drops the formatting, and comments go with it.
  root.walkComments((c) => c.remove());
  root.cleanRaws();

  return root.toResult().css.replace(/\n\s*/g, "");
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  // url -> Set of "start:end" byte ranges that were used.
  const usedRanges = new Map(SPLIT.map((u) => [u, []]));
  const sheetText = new Map();

  for (const vp of VIEWPORTS) {
    for (const p of PAGES) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height });
      await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });

      // Puppeteer's CSS coverage, NOT CSS.startRuleUsageTracking directly:
      // rule-usage tracking is scoped to the current document and is reset by
      // navigation, so starting it before goto() reports almost nothing (it
      // measured the about:blank document, and produced a critical.css missing
      // .container/.row/.col-* — the page painted completely unstyled).
      // resetOnNavigation:false is what makes it survive the navigation.
      await page.coverage.startCSSCoverage({ resetOnNavigation: false });

      await page.goto(BASE + p, { waitUntil: "networkidle2", timeout: 60000 });
      // Let client-rendered content (product grids, nav menus) mount, so rules
      // those elements need are counted too.
      await new Promise((r) => setTimeout(r, 3500));

      const coverage = await page.coverage.stopCSSCoverage();
      for (const entry of coverage) {
        const match = SPLIT.find((url) => entry.url.endsWith(url));
        if (!match) continue;
        if (!sheetText.has(match)) sheetText.set(match, entry.text);
        for (const r of entry.ranges) usedRanges.get(match).push([r.start, r.end]);
      }

      await page.close();
      const counts = SPLIT.map((u) => `${u.split("/").pop()}:${usedRanges.get(u).length}`).join(" ");
      console.log(`  scanned ${vp.name.padEnd(7)} ${p.padEnd(30)} ${counts}`);
    }
  }

  let out = "";
  let totalBefore = 0;
  for (const url of SPLIT) {
    const css = sheetText.get(url) || fs.readFileSync(path.join(ROOT, url.replace(/^\//, "")), "utf8");
    totalBefore += css.length;

    // Merge overlapping/adjacent ranges so rules aren't emitted twice.
    const ranges = usedRanges.get(url).sort((a, b) => a[0] - b[0]);
    const merged = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]);
      else merged.push([r[0], r[1]]);
    }

    const extracted = extractUsed(postcss, css, merged);
    out += `\n/* ---- critical subset of ${url} ---- */\n` + extracted + "\n";
    console.log(`  ${url}: ${merged.length} used ranges -> ${(extracted.length / 1024).toFixed(1)}KB`);
  }

  const header =
    "/* GENERATED by tools/build-critical-css.js — do not edit by hand.\n" +
    "   The above-the-fold subset of bootstrap.min.css + style.css, so first\n" +
    "   paint doesn't wait on 86KB of CSS. Both full files still load,\n" +
    "   deferred, and override anything here. Re-run the tool after changing\n" +
    "   either source file. */\n";

  fs.writeFileSync(OUT, header + out);
  console.log(`\nassets/css/critical.css  ${(fs.statSync(OUT).size / 1024).toFixed(1)}KB  (from ${(totalBefore / 1024).toFixed(0)}KB of source)`);
  await browser.close();
})();
