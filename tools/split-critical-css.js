// Patches the HTML so first paint uses assets/css/critical.css, and the two
// heavy stylesheets it was extracted from load without blocking.
//
// Order matters and is preserved exactly: critical.css is inserted BEFORE
// bootstrap.min.css, and the deferred links keep their original position in
// the document. Browsers order stylesheets by document position, not by when
// they finish loading, so the cascade is identical to before — the full files
// still win every tie against critical.css, and home-dynamic.css /
// media-container.css still win against style.css.
//
// Two guards, both of which have teeth:
//   - a page is only patched if it loads css-preload-swap.js, which is what
//     flips rel="preload" back to rel="stylesheet". Without it the deferred
//     CSS would never apply at all and the page would render unstyled.
//     (index-2.html, index-2-light.html and index-light.html don't load it,
//     so they are deliberately left render-blocking.)
//   - both files are added to the page's <noscript> block, so a visitor with
//     JS disabled still gets the full stylesheets.
//
//   node tools/split-critical-css.js [--revert]
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const REVERT = process.argv.includes("--revert");

const DEFER = ["/assets/css/bootstrap.min.css", "/assets/css/style.css"];
const CRITICAL = "/assets/css/critical.css";
const CRITICAL_LINK = `<link rel="stylesheet" href="${CRITICAL}">`;

let patched = 0, skipped = 0;

for (const file of fs.readdirSync(ROOT).filter((f) => f.endsWith(".html"))) {
  const p = path.join(ROOT, file);
  let html = fs.readFileSync(p, "utf8");

  const usesBoth = DEFER.every((d) => html.includes(d));
  if (!usesBoth) continue;

  if (REVERT) {
    for (const href of DEFER) {
      html = html.replace(
        new RegExp(`<link rel="preload" as="style"(?: fetchpriority="low")? href="${href}" data-preload-style>`, "g"),
        `<link rel="stylesheet" href="${href}">`
      );
    }
    html = html.replace(new RegExp(`\\s*${CRITICAL_LINK.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "g"), "");
    // Remove the two <noscript> entries this tool added. Scoped to inside the
    // <noscript> block so it can't touch the real links restored above — an
    // earlier version anchored on `</noscript>` and therefore only ever
    // removed the last of the two, silently leaving a duplicate behind.
    html = html.replace(/<noscript>([\s\S]*?)<\/noscript>/, (block, inner) => {
      for (const href of DEFER) {
        inner = inner.replace(new RegExp(`\\s*<link rel="stylesheet" href="${href}">`, "g"), "");
      }
      return `<noscript>${inner}</noscript>`;
    });
    fs.writeFileSync(p, html);
    console.log(`  ${file}: reverted`);
    patched++;
    continue;
  }

  if (!html.includes("css-preload-swap.js")) {
    console.log(`  ${file}: SKIPPED — no css-preload-swap.js, deferring here would leave it unstyled`);
    skipped++;
    continue;
  }
  if (html.includes(CRITICAL)) {
    console.log(`  ${file}: already split`);
    continue;
  }

  // 1. critical.css goes first, so the deferred originals override it.
  html = html.replace(
    `<link rel="stylesheet" href="${DEFER[0]}">`,
    `${CRITICAL_LINK}\n    <link rel="stylesheet" href="${DEFER[0]}">`
  );

  // 2. Flip both to preload, in place.
  for (const href of DEFER) {
    html = html.replace(
      `<link rel="stylesheet" href="${href}">`,
      // fetchpriority="low": rel=preload fetches at HIGH priority by default,
      // so these two were competing with critical.css for a constrained link
      // and delaying the very paint they were moved out of the way for
      // (measured on production: critical.css needed 1400ms for 15KB while
      // 86KB of deferred CSS downloaded alongside it). They are explicitly
      // not needed for first paint, so they should yield to everything that
      // is.
      `<link rel="preload" as="style" fetchpriority="low" href="${href}" data-preload-style>`
    );
  }

  // 3. no-JS fallback.
  const noscriptAdds = DEFER.map((h) => `      <link rel="stylesheet" href="${h}">`).join("\n");
  if (html.includes("<noscript>")) {
    html = html.replace("<noscript>", `<noscript>\n${noscriptAdds}`);
  } else {
    html = html.replace(CRITICAL_LINK, `${CRITICAL_LINK}\n    <noscript>\n${noscriptAdds}\n    </noscript>`);
  }

  fs.writeFileSync(p, html);
  console.log(`  ${file}: split`);
  patched++;
}

console.log(`\n${REVERT ? "reverted" : "patched"} ${patched} file(s), skipped ${skipped}`);
