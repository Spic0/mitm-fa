// Guards the SEO contract for /services and /services/:slug.
//
// The brief's hard requirements: every page has its OWN title, meta
// description, canonical and OpenGraph data; none are duplicated between
// pages; there is exactly one H1; the heading hierarchy is sane; no .html or
// query-param URLs are exposed; internal links resolve; and the JSON-LD is
// real, parseable, and free of fabricated ratings/reviews/prices.
//
// Usage: node test-service-pages.js [--base http://127.0.0.1:3200]
const path = require("path");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg("--base", "http://127.0.0.1:3200");

const SERVER = path.join(__dirname, "..", "server");
const { listServices } = require(path.join(SERVER, "src", "lib", "services.js"));

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
}

async function get(pathname) {
  const res = await fetch(BASE + pathname, { headers: { "x-forwarded-proto": "https" } });
  return { status: res.status, body: await res.text() };
}

const pick = (html, re) => {
  const m = html.match(re);
  return m ? m[1] : null;
};

(async () => {
  const services = listServices();
  const pages = ["/services", ...services.map((s) => `/services/${s.slug}`)];

  const titles = new Map();
  const descriptions = new Map();
  const canonicals = new Map();

  for (const p of pages) {
    const { status, body } = await get(p);
    console.log(`\n${p}`);
    check("  200", status === 200, `status ${status}`);

    const title = pick(body, /<title[^>]*>([^<]*)<\/title>/);
    const desc = pick(body, /<meta name="description" content="([^"]*)"/);
    const canonical = pick(body, /<link rel="canonical" href="([^"]*)"/);
    const ogTitle = pick(body, /<meta property="og:title" content="([^"]*)"/);
    const ogDesc = pick(body, /<meta property="og:description" content="([^"]*)"/);
    const ogUrl = pick(body, /<meta property="og:url" content="([^"]*)"/);
    const ogImage = pick(body, /<meta property="og:image" content="([^"]*)"/);
    const twCard = pick(body, /<meta name="twitter:card" content="([^"]*)"/);

    check("  unique <title>", !!title && !titles.has(title), title);
    check("  meta description present", !!desc && desc.length > 40, desc ? `${desc.length} chars` : "missing");
    check("  unique meta description", !!desc && !descriptions.has(desc));
    check("  canonical present", !!canonical, canonical);
    check("  unique canonical", !!canonical && !canonicals.has(canonical));
    check("  canonical matches the path", !!canonical && new URL(canonical).pathname === p, canonical);
    check("  og:title / og:description / og:url / og:image", !!(ogTitle && ogDesc && ogUrl && ogImage));
    check("  twitter card", !!twCard, twCard);
    check("  not noindex", !/content="noindex/.test(body));

    if (title) titles.set(title, p);
    if (desc) descriptions.set(desc, p);
    if (canonical) canonicals.set(canonical, p);

    // Headings: exactly one H1, and no H3 appearing before any H2.
    const h1s = body.match(/<h1[^>]*>/g) || [];
    check("  exactly one <h1>", h1s.length === 1, `${h1s.length}`);
    const headingOrder = (body.match(/<h([123])[^>]*>/g) || []).map((h) => h.match(/h([123])/)[1]);
    const firstH2 = headingOrder.indexOf("2");
    const firstH3 = headingOrder.indexOf("3");
    check("  no <h3> before the first <h2>", firstH3 === -1 || (firstH2 !== -1 && firstH2 < firstH3));

    // Clean URLs: no .html, .php, ?id= or raw database ids in any internal href.
    const hrefs = Array.from(body.matchAll(/href="(\/[^"#]*)"/g)).map((m) => m[1]);
    const dirty = hrefs.filter((h) => /\.html|\.php|\?(?:id|productId|profile|slug)=|[a-z0-9]{25}/.test(h));
    check("  no .html/.php/?id= or raw ids in links", dirty.length === 0, dirty.slice(0, 4).join(", "));

    // JSON-LD must parse and must not contain fabricated trust signals.
    const ldBlocks = Array.from(body.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)).map((m) => m[1]);
    check("  has JSON-LD", ldBlocks.length >= 1, `${ldBlocks.length} block(s)`);
    let parsed = null;
    try {
      parsed = ldBlocks.map((b) => JSON.parse(b));
      check("  JSON-LD parses", true);
    } catch (e) {
      check("  JSON-LD parses", false, e.message);
    }
    if (parsed) {
      const flat = JSON.stringify(parsed);
      check("  no fabricated ratings/reviews/prices", !/aggregateRating|"review"|"ratingValue"|"priceCurrency"/.test(flat));
      check("  Organization present", /"Organization"/.test(flat));
      if (p !== "/services") {
        check("  Service + BreadcrumbList present", /"Service"/.test(flat) && /"BreadcrumbList"/.test(flat));
      }
    }
  }

  // Internal links across every service page must resolve.
  console.log("\ninternal link crawl");
  const seen = new Set();
  const broken = [];
  for (const p of pages) {
    const { body } = await get(p);
    for (const m of body.matchAll(/href="(\/[^"#?]*)"/g)) {
      const href = m[1];
      if (seen.has(href)) continue;
      seen.add(href);
      if (href.startsWith("/assets/")) continue;
      const r = await fetch(BASE + href, { headers: { "x-forwarded-proto": "https" }, redirect: "manual" });
      if (r.status >= 400) broken.push(`${href} -> ${r.status}`);
    }
  }
  check(`all ${seen.size} internal links resolve`, broken.length === 0, broken.slice(0, 6).join(", "));

  // Sitemap + robots
  const sitemap = await get("/sitemap.xml");
  const missing = pages.filter((p) => !sitemap.body.includes(p + "<"));
  check("sitemap lists every service page", missing.length === 0, missing.join(", "));

  const robots = await get("/robots.txt");
  check("robots.txt does not disallow /services", !/Disallow: \/services/.test(robots.body));

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll service page checks passed");
  process.exit(failures ? 1 : 0);
})();
