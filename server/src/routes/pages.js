// Clean-URL page serving: every customer-facing route lives here instead of
// as one large regex handler in index.js. Static routes (about/contact/...)
// just inline the shared header; the shop family (/shop, /goal/:slug,
// /sport/:slug, /athlete/:slug, /creator/:slug) resolves a taxonomy context
// server-side for SEO + hands it to shop.js via data-context-* attributes;
// /program/:slug resolves a real Product and injects full per-product SEO.
//
// Old .html / query-param URLs (?goal=, ?creator=, shop-single.html?slug=,
// ...) 301-redirect here into the clean equivalent — see the bottom of this
// file — so existing bookmarks/search-indexed links and SEO signal survive
// the move instead of breaking.
const path = require("path");
const fs = require("fs");
const express = require("express");
const { prisma } = require("../db");
const { getAllTaxonomyTrees } = require("../lib/taxonomy");
const { normalizeImageUrl, coverMedia } = require("../lib/media");
const { resolveSlot, SLOTS } = require("../lib/landingAssets");

const router = express.Router();
const SITE_ROOT = path.join(__dirname, "..", "..", "..");
const HEADER_PARTIAL_PATH = path.join(SITE_ROOT, "partials", "header.html");
const HEADER_MARKER = "<!--SHARED_HEADER-->";
const HIDDEN_HEADER_PAGES = new Set(["checkout.html"]);

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Price of a PRODUCT for display. A plan at 0 is free, and rendering that as
// "$0.00" on a storefront reads as a pricing bug rather than an offer — the
// catalog has one such product published and featured today, so this is a
// live case. Kept in step with ProFitAPI.formatProductPrice in
// assets/js/api.js, which renders the same two values client-side; the SSR'd
// hero/showcase and the JS that later re-renders them must never disagree.
function formatProductPrice(cents) {
  return cents === 0 ? "Free" : `$${(cents / 100).toFixed(2)}`;
}

function appUrl(pathname) {
  const base = process.env.APP_URL ? process.env.APP_URL.replace(/\/$/, "") : "";
  return base + pathname;
}

async function readTemplate(templateFile) {
  try {
    return await fs.promises.readFile(path.join(SITE_ROOT, templateFile), "utf8");
  } catch {
    return null;
  }
}

// The storefront shell (header nav, shop page title/crumb) must render even
// when taxonomy data can't be loaded — a DB outage or misconfiguration
// (e.g. missing DATABASE_URL) should degrade to empty nav sections, not take
// down every page on the site.
async function safeGetAllTaxonomyTrees() {
  try {
    return await getAllTaxonomyTrees();
  } catch (err) {
    console.error("Failed to load taxonomy trees; rendering storefront with empty navigation.", err);
    return [];
  }
}

// Header mega-menu goal links and sport columns, generated live from the
// Taxonomy tables — the exact same source of truth the admin CMS reads and
// writes. A category/subcategory created, renamed, or deleted in Admin ->
// Navigation is reflected here on the very next request.
function navGoalLinksHtml(goalsTaxonomy) {
  if (!goalsTaxonomy) return "";
  return goalsTaxonomy.nodes
    .map((n) => `<li><a href="/goal/${encodeURIComponent(n.slug)}">${escapeHtml(n.name)}</a></li>`)
    .join("");
}

function navSportColumnsHtml(athletesTaxonomy) {
  if (!athletesTaxonomy) return "";
  return athletesTaxonomy.nodes
    .map((n) => {
      const athleteLinks = n.children
        .map((a) => `<li><a href="/athlete/${encodeURIComponent(a.slug)}">${escapeHtml(a.name)}</a></li>`)
        .join("");
      return (
        `<div class="mega-menu__col mega-menu__col--sport" data-sport="${escapeHtml(n.slug)}">` +
        `<span class="mega-menu__heading">${escapeHtml(n.name)}</span>` +
        `<ul data-role="sport-athletes">${athleteLinks}</ul>` +
        `<a href="/sport/${encodeURIComponent(n.slug)}" class="mega-menu__view-all">View All <i class="fa-regular fa-arrow-right" aria-hidden="true"></i></a>` +
        "</div>"
      );
    })
    .join("");
}

async function applyNavContexts(headerHtml) {
  const trees = await safeGetAllTaxonomyTrees();
  const goals = trees.find((t) => t.key === "goals");
  const athletes = trees.find((t) => t.key === "athletes");
  return headerHtml
    .replace("<!--NAV_GOALS_TRAINING-->", navGoalLinksHtml(goals))
    .replace("<!--NAV_SPORTS_COLUMNS-->", navSportColumnsHtml(athletes));
}

async function inlineHeader(html, templateFile) {
  if (!html.includes(HEADER_MARKER)) return html;
  const headerRaw = await fs.promises.readFile(HEADER_PARTIAL_PATH, "utf8");
  let headerHtml = headerRaw;
  if (HIDDEN_HEADER_PAGES.has(templateFile)) {
    // A class, not an inline style="" — CSP's style-src has no 'unsafe-inline'.
    headerHtml = headerHtml.replace(
      '<header class="site-header">',
      '<header class="site-header u-hidden">'
    );
  }
  headerHtml = await applyNavContexts(headerHtml);
  return html.replace(HEADER_MARKER, headerHtml);
}

// Shared per-page SEO injection for every static page (and error.html/
// program.html, rendered outside the STATIC_ROUTES loop below): unique
// title/description/canonical/OpenGraph/Twitter, plus robots noindex for
// account/transactional pages that have no business being indexed or
// shared. `canonicalPath` is null for pages with no single canonical URL
// (a shared error/gated-viewer template).
function applyStaticSeo(html, meta, canonicalPath) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const image = appUrl("/assets/images/banner/inner-banner.jpg");
  const block =
    `<meta name="description" content="${description}">\n` +
    (canonicalPath ? `    <link rel="canonical" href="${appUrl(canonicalPath)}">\n` : "") +
    (meta.noindex ? `    <meta name="robots" content="noindex, nofollow">\n` : "") +
    `    <meta property="og:type" content="website">\n` +
    `    <meta property="og:title" content="${title} | Fitness Agency">\n` +
    `    <meta property="og:description" content="${description}">\n` +
    (canonicalPath ? `    <meta property="og:url" content="${appUrl(canonicalPath)}">\n` : "") +
    `    <meta property="og:image" content="${image}">\n` +
    `    <meta name="twitter:card" content="summary">\n` +
    `    <meta name="twitter:title" content="${title} | Fitness Agency">\n` +
    `    <meta name="twitter:description" content="${description}">`;

  return html
    .replace(/<title[^>]*>[^<]*<\/title>/, `<title data-brand-title="${title} | {brand}">${title} | Fitness Agency</title>`)
    .replace("<!--PAGE_SEO-->", block);
}

async function render404(req, res) {
  let html = await readTemplate("error.html");
  if (html == null) return res.status(404).type("html").send("Not found");
  html = await inlineHeader(html, "error.html");
  html = applyStaticSeo(html, {
    title: "Page Not Found",
    description: "The page you're looking for doesn't exist or may have moved.",
    noindex: true,
  }, null);
  res.status(404).type("html").send(html);
}

// ---------------------------------------------------------------------
// Shop family: /shop, /goal/:slug, /sport/:slug, /athlete/:slug, /creator/:slug
// all render shop.html with a server-resolved context (or none, for plain
// /shop). Mirrors the pre-existing resolveShopContext/applyShopContext
// pattern (originally query-param driven) against path params instead.
// ---------------------------------------------------------------------
async function resolveShopContext(pathContext) {
  if (!pathContext) return null;
  const trees = await safeGetAllTaxonomyTrees();
  const goals = trees.find((t) => t.key === "goals");
  const athletes = trees.find((t) => t.key === "athletes");
  const creators = trees.find((t) => t.key === "creators");

  if (pathContext.type === "goal") {
    const node = goals && goals.nodes.find((n) => n.slug === pathContext.slug);
    if (!node) return { notFound: true };
    return {
      type: "goal", nodeId: node.id, slug: node.slug,
      title: `${node.name} Training & Nutrition Plans`,
      description: `Training and nutrition plans built around ${node.name.toLowerCase()}, from real coaches and athletes.`,
      heading: node.name,
      crumb: `Shop by Goal · ${node.name}`,
      canonicalPath: `/goal/${encodeURIComponent(node.slug)}`,
    };
  }

  if (pathContext.type === "sport") {
    const node = athletes && athletes.nodes.find((n) => n.slug === pathContext.slug);
    if (!node) return { notFound: true };
    return {
      type: "sport", nodeId: node.id, slug: node.slug,
      title: `${node.name} Training Programs`,
      description: `Training plans built and used by ${node.name.toLowerCase()} athletes.`,
      heading: `${node.name} Training`,
      crumb: `Sports · ${node.name}`,
      canonicalPath: `/sport/${encodeURIComponent(node.slug)}`,
    };
  }

  if (pathContext.type === "athlete") {
    // TaxonomyNode.slug is unique only per parent, not globally, so a flat
    // /athlete/:slug (matching the task's own example, no sport segment)
    // does a best-effort match across every sport. Logs if more than one
    // sport happens to have an athlete with this slug, so a same-name
    // collision is visible in the logs instead of silently costing the
    // second athlete its clean URL.
    const matches = [];
    if (athletes) {
      for (const sport of athletes.nodes) {
        const found = (sport.children || []).find((a) => a.slug === pathContext.slug);
        if (found) matches.push({ node: found, sport });
      }
    }
    if (!matches.length) return { notFound: true };
    if (matches.length > 1) {
      console.warn(
        `Athlete slug "${pathContext.slug}" matches more than one athlete across different sports; serving the first. Sports: ${matches.map((m) => m.sport.slug).join(", ")}`
      );
    }
    const { node, sport } = matches[0];
    return {
      type: "athlete", nodeId: node.id, slug: node.slug, sportSlug: sport.slug,
      title: `${node.name} Training Plans`,
      description: `Programs built and used by ${node.name}.`,
      heading: node.name,
      crumb: `Browse Athletes · ${node.name}`,
      canonicalPath: `/athlete/${encodeURIComponent(node.slug)}`,
    };
  }

  if (pathContext.type === "creator") {
    let node = null;
    if (creators) {
      for (const cat of creators.nodes) {
        const found = (cat.children || []).find((c) => c.slug === pathContext.slug);
        if (found) { node = found; break; }
      }
    }
    if (!node) return { notFound: true };
    return {
      type: "creator", nodeId: node.id, slug: node.slug,
      title: `${node.name} Training Plans`,
      description: `Programs built and used by ${node.name}.`,
      heading: node.name,
      crumb: `Creators · ${node.name}`,
      canonicalPath: `/creator/${encodeURIComponent(node.slug)}`,
    };
  }

  return { notFound: true };
}

async function applyShopContext(html, ctx) {
  const canonicalPath = ctx && ctx.canonicalPath ? ctx.canonicalPath : "/shop";
  if (process.env.APP_URL) {
    html = html.replace(
      "<!--SHOP_CANONICAL-->",
      `<link rel="canonical" href="${appUrl(canonicalPath)}">`
    );
  }

  const ogTitle = escapeHtml(ctx && !ctx.notFound ? `${ctx.title} | Fitness Agency` : "Fitness Agency - Training & Diet Plans");
  const ogDesc = escapeHtml(ctx && !ctx.notFound ? ctx.description : "Training and nutrition plans from elite athletes and coaches. Browse by goal, sport, or creator and download instantly.");
  html = html.replace(
    "<!--SHOP_OG-->",
    `<meta property="og:type" content="website">\n` +
      `    <meta property="og:title" content="${ogTitle}">\n` +
      `    <meta property="og:description" content="${ogDesc}">\n` +
      `    <meta property="og:url" content="${appUrl(canonicalPath)}">\n` +
      `    <meta name="twitter:card" content="summary">\n` +
      `    <meta name="twitter:title" content="${ogTitle}">\n` +
      `    <meta name="twitter:description" content="${ogDesc}">`
  );

  // Hand the server-resolved context to shop.js via data-* attributes on the
  // grid it's about to render into, instead of making it re-fetch
  // /api/taxonomy and re-walk the tree to reproduce what was just resolved
  // above for SEO. Plain data attributes, not an inline JSON script block —
  // this site's CSP has no 'unsafe-inline' for scripts.
  const dataAttrs = ctx && !ctx.notFound
    ? ` data-context-type="${escapeHtml(ctx.type)}" data-context-slug="${escapeHtml(ctx.slug)}" data-context-node-id="${escapeHtml(ctx.nodeId)}"${ctx.sportSlug ? ` data-context-sport-slug="${escapeHtml(ctx.sportSlug)}"` : ""}`
    : "";
  html = html.replace(
    '<div class="row g-4" id="shopProductGrid">',
    `<div class="row g-4" id="shopProductGrid"${dataAttrs}>`
  );

  if (!ctx || ctx.notFound) return html;

  const title = escapeHtml(ctx.title);
  return html
    .replace(/<title[^>]*>[^<]*<\/title>/, `<title data-brand-title="${title} | {brand}">${title} | Fitness Agency</title>`)
    .replace(/(<meta name="description" data-shop-meta content=")[^"]*(")/, `$1${escapeHtml(ctx.description)}$2`)
    .replace(/(<h2[^>]*data-shop-heading[^>]*>)[^<]*(<\/h2>)/, `$1${escapeHtml(ctx.heading)}$2`)
    .replace(/(<p[^>]*data-shop-sub[^>]*>)[^<]*(<\/p>)/, `$1${escapeHtml(ctx.description)}$2`)
    .replace(/(<span[^>]*data-shop-crumb[^>]*>)[^<]*(<\/span>)/, `$1${escapeHtml(ctx.crumb)}$2`);
}

async function renderShopPage(req, res, pathContext) {
  const ctx = await resolveShopContext(pathContext);
  if (ctx && ctx.notFound) return render404(req, res);
  let html = await readTemplate("shop.html");
  if (html == null) return render404(req, res);
  html = await inlineHeader(html, "shop.html");
  html = await applyShopContext(html, ctx);
  res.type("html").send(html);
}

router.get("/shop", (req, res) => renderShopPage(req, res, null));
router.get("/goal/:slug", (req, res) => renderShopPage(req, res, { type: "goal", slug: req.params.slug }));
router.get("/sport/:slug", (req, res) => renderShopPage(req, res, { type: "sport", slug: req.params.slug }));
router.get("/athlete/:slug", (req, res) => renderShopPage(req, res, { type: "athlete", slug: req.params.slug }));
router.get("/creator/:slug", (req, res) => renderShopPage(req, res, { type: "creator", slug: req.params.slug }));

// ---------------------------------------------------------------------
// /program/:slug — the public product sales page (today's shop-single.html
// template). Distinct from /my-library/:slug below, which is the gated
// "read your purchased program" viewer (today's program.html) — same-
// sounding names, deliberately different routes and templates.
// ---------------------------------------------------------------------
function applyProductSeo(html, product) {
  const title = escapeHtml(product.name);
  const rawDescription = product.description || `${product.name} — a training & nutrition plan on Fitness Agency.`;
  const description = escapeHtml(rawDescription.length > 300 ? rawDescription.slice(0, 297) + "..." : rawDescription);
  const url = appUrl(`/program/${encodeURIComponent(product.slug)}`);
  const normalizedImage = product.imageUrl ? normalizeImageUrl(product.imageUrl) : "";
  const image = normalizedImage
    ? escapeHtml(/^https?:\/\//.test(normalizedImage) ? normalizedImage : appUrl(normalizedImage))
    : "";
  const price = (product.priceCents / 100).toFixed(2);

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: rawDescription,
    image: image || undefined,
    offers: {
      "@type": "Offer",
      price: price,
      priceCurrency: "USD",
      availability: "https://schema.org/InStock",
      url: url,
    },
  };

  const seoBlock =
    `<meta name="description" content="${description}">\n` +
    (product.seoTags && product.seoTags.length ? `    <meta name="keywords" content="${escapeHtml(product.seoTags.join(", "))}">\n` : "") +
    `    <link rel="canonical" href="${url}">\n` +
    `    <meta property="og:type" content="product">\n` +
    `    <meta property="og:title" content="${title} | Fitness Agency">\n` +
    `    <meta property="og:description" content="${description}">\n` +
    `    <meta property="og:url" content="${url}">\n` +
    (image ? `    <meta property="og:image" content="${image}">\n` : "") +
    `    <meta name="twitter:card" content="summary_large_image">\n` +
    `    <meta name="twitter:title" content="${title} | Fitness Agency">\n` +
    `    <meta name="twitter:description" content="${description}">\n` +
    (image ? `    <meta name="twitter:image" content="${image}">\n` : "") +
    `    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;

  return html
    .replace(/<title[^>]*>[^<]*<\/title>/, `<title data-brand-title="${title} | {brand}">${title} | Fitness Agency</title>`)
    .replace("<!--PROGRAM_SEO-->", seoBlock);
}

router.get("/program/:slug", async (req, res, next) => {
  const product = await prisma.product.findFirst({
    where: {
      status: "published",
      OR: [{ id: req.params.slug }, { slug: req.params.slug }],
    },
  });
  if (!product) return render404(req, res);

  // Canonicalize a raw-id lookup (an old bookmark, or a cart line predating
  // the slug being carried through) to the real slug URL, so a cuid never
  // persists as the crawlable/shared address.
  if (product.slug !== req.params.slug) {
    return res.redirect(301, `/program/${encodeURIComponent(product.slug)}`);
  }

  let html = await readTemplate("shop-single.html");
  if (html == null) return next();
  html = await inlineHeader(html, "shop-single.html");
  html = applyProductSeo(html, product);
  res.type("html").send(html);
});

// ---------------------------------------------------------------------
// Plain static routes — clean paths for pages with no per-request
// server-side context. Gating (or lack thereof) matches exactly what these
// pages already did as flat .html files: my-library.html/program.html are
// unauthenticated shells whose *data* is gated client-side/API-side (see
// assets/js/my-library.js, assets/js/program.js) — no new page-level
// auth gate is introduced here.
// ---------------------------------------------------------------------
const PAGE_META = {
  "/about": { file: "about.html", title: "About Us", description: "Learn about Fitness Agency's coaches and our approach to training and nutrition plans built for real results." },
  "/contact": { file: "contact.html", title: "Contact Us", description: "Get in touch with the Fitness Agency team for support, partnership inquiries, or questions about your plan." },
  "/cart": { file: "cart.html", title: "Your Cart", description: "Review the plans in your cart before checkout.", noindex: true },
  "/checkout": { file: "checkout.html", title: "Checkout", description: "Complete your purchase securely.", noindex: true },
  "/login": { file: "login.html", title: "Sign In", description: "Sign in to your Fitness Agency account to access your training plans.", noindex: true },
  "/register": { file: "register.html", title: "Create Account", description: "Create a Fitness Agency account to start training.", noindex: true },
  "/my-library": { file: "my-library.html", title: "My Library", description: "Your purchased training and nutrition plans, orders, and account settings.", noindex: true },
  "/blog": { file: "blog.html", title: "Blog", description: "Training tips, nutrition guidance, and stories from the Fitness Agency coaching team." },
  "/blog/grid": { file: "blog-grid.html", title: "Blog", description: "Training tips, nutrition guidance, and stories from the Fitness Agency coaching team." },
  "/blog/list": { file: "blog-list.html", title: "Blog", description: "Training tips, nutrition guidance, and stories from the Fitness Agency coaching team." },
  "/blog/article": { file: "blog-single.html", title: "Article", description: "Read the latest training and nutrition insights from the Fitness Agency coaching team." },
  // error.html is deliberately used site-wide as a placeholder destination
  // for pages that don't exist yet (FAQ, Refund Policy, Careers, Investors,
  // Terms, Privacy — footer links across every page). /coming-soon gives
  // that intentional destination a real clean URL instead of exposing
  // error.html directly; the same template is also what render404 above
  // renders for genuinely unmatched routes (with a 404 status there, vs.
  // 200 here since this is a real, intended page).
  "/coming-soon": { file: "error.html", title: "Coming Soon", description: "This page isn't available yet.", noindex: true },
};

for (const [route, meta] of Object.entries(PAGE_META)) {
  router.get(route, async (req, res, next) => {
    let html = await readTemplate(meta.file);
    if (html == null) return next();
    html = await inlineHeader(html, meta.file);
    html = applyStaticSeo(html, meta, route === "/coming-soon" ? null : route);
    // Cheap for pages with no slots: applyLandingAssets tests each slot's
    // pattern against the template and returns immediately when none match,
    // so this costs one regex test per slot and never touches the disk.
    html = applyLandingAssets(html);
    res.type("html").send(html);
  });
}

// /my-library/:slug — the gated in-platform program viewer (today's
// program.html). Its own client JS (assets/js/program.js) now reads the
// slug from the URL path instead of a ?product= query param. No single
// canonical URL makes sense here (gated, per-purchase content) — noindex
// only, same as the /my-library list page.
router.get("/my-library/:slug", async (req, res, next) => {
  let html = await readTemplate("program.html");
  if (html == null) return next();
  html = await inlineHeader(html, "program.html");
  html = applyStaticSeo(html, { title: "Your Program", description: "Your purchased training program.", noindex: true }, null);
  res.type("html").send(html);
});

// ---------------------------------------------------------------------
// Homepage — server-renders the hero's first slide (title/description/
// price/CTA/background image) directly into index.html, the same way
// applyShopContext server-renders shop.html's heading, so a crawler or
// no-JS visitor sees a real product immediately instead of an empty shell
// that only fills in after assets/js/hero-slideshow.js runs. That script
// recognizes this slide via data-hero-id and reuses it instead of
// re-rendering a duplicate.
// ---------------------------------------------------------------------

// Picks the same product the homepage hero slideshow will open on
// (assets/js/hero-slideshow.js's selectHeroProducts): the earliest-created
// featured product, or — if nothing is featured yet — the newest published
// product, so the hero is never empty on a fresh catalog.
async function resolveHeroProduct() {
  const featured = await prisma.product.findFirst({
    where: { status: "published", featured: true },
    orderBy: { createdAt: "asc" },
    include: { taxonomies: { include: { taxonomyNode: { include: { parent: true } } } } },
  });
  if (featured) return featured;
  return prisma.product.findFirst({
    where: { status: "published" },
    orderBy: { createdAt: "desc" },
    include: { taxonomies: { include: { taxonomyNode: { include: { parent: true } } } } },
  });
}

// One representative "category" for the hero meta line — mirrors the
// client-side buildTaxonomyIndex/describeMeta in assets/js/hero-slideshow.js.
function describeProductCategory(product) {
  const nodes = (product.taxonomies || []).map((t) => t.taxonomyNode);
  const leafWithParent = nodes.find((n) => n.parent);
  if (leafWithParent) return leafWithParent.parent.name;
  return nodes[0] ? nodes[0].name : null;
}

// The showcase section deliberately features a DIFFERENT plan from the hero
// where the catalog allows it — two sections pushing the identical product is
// a wasted slot, and the whole point of the section is a second entry point
// into the catalog. Falls back to the hero's product rather than rendering
// nothing when only one product is published.
async function resolveShowcaseProduct(heroProduct) {
  const excludeId = heroProduct ? heroProduct.id : null;
  const where = { status: "published", ...(excludeId ? { id: { not: excludeId } } : {}) };

  const featured = await prisma.product.findFirst({
    where: { ...where, featured: true },
    orderBy: { createdAt: "desc" },
    include: { taxonomies: { include: { taxonomyNode: { include: { parent: true } } } } },
  });
  if (featured) return featured;

  const newest = await prisma.product.findFirst({
    where,
    orderBy: { createdAt: "desc" },
    include: { taxonomies: { include: { taxonomyNode: { include: { parent: true } } } } },
  });
  return newest || heroProduct;
}

function applyShowcaseContext(html, product) {
  if (!product) return html;

  const category = describeProductCategory(product);
  const metaParts = [product.creator, category].filter(Boolean);
  const meta = escapeHtml(metaParts.join(" · "));
  const ctaHref = `/program/${encodeURIComponent(product.slug)}`;

  let result = html
    .replace(/(<section class="showcase-area[^"]*" data-showcase-id=")[^"]*(")/, `$1${escapeHtml(product.id)}$2`)
    .replace(/(<h2[^>]*data-showcase-title[^>]*>)[^<]*(<\/h2>)/, `$1${escapeHtml(product.name)}$2`)
    .replace(/(<p[^>]*data-showcase-meta[^>]*>)[^<]*(<\/p>)/, `$1${meta}$2`)
    .replace(/(<p[^>]*data-showcase-desc[^>]*>)[^<]*(<\/p>)/, `$1${escapeHtml(product.description || "")}$2`)
    .replace(
      /(<span[^>]*data-showcase-price[^>]*>)[^<]*(<\/span>)/,
      `$1${escapeHtml(formatProductPrice(product.priceCents))}$2`
    );

  result = result.replace(/<a\b[^>]*data-showcase-cta[^>]*>/, (tag) =>
    tag.replace(/href="[^"]*"/, `href="${ctaHref}"`)
  );

  // Image cascade: an art-directed assets/images/landing/showcase.* wins if the
  // operator has supplied one (applyLandingAssets fills it later in the
  // pipeline); otherwise this falls back to the product's OWN cover, which
  // already has responsive derivatives from the upload pipeline. Only if there
  // is neither does the slot stay empty and get the branded fallback — which
  // is still a deliberate-looking box, never a dimension label.
  if (!resolveSlot("showcase")) {
    const cover = coverMedia(product.imageUrl);
    const src = normalizeImageUrl(product.imageUrl);
    if (src) {
      const rendered = renderLandingSlot(
        { src, sizes: SLOTS.showcase.sizes, eager: false, cover },
        product.name
      );
      result = result.replace(
        /<div class="landing-slot([^"]*)"([^>]*?)data-landing-slot="showcase"([^>]*)></,
        (whole, extra, before, after) =>
          `<div class="landing-slot${extra} ${rendered.classes}"${before}data-landing-slot="showcase"${after}>${rendered.html}<`
      );
    }
  }

  return result;
}

async function applyHeroContext(html, product) {
  if (process.env.APP_URL) {
    html = html.replace("<!--HOME_CANONICAL-->", `<link rel="canonical" href="${appUrl("/")}">`);
  }

  if (!product) return html;

  const ctaHref = `/program/${encodeURIComponent(product.slug)}`;
  const cover = coverMedia(product.imageUrl);
  const src = normalizeImageUrl(product.imageUrl) || "";

  // The hero card's image. It is no longer a full-bleed blurred backdrop but a
  // ~320-420px CSS-wide card, so the widest derivative is waste: `sizes` tells
  // the browser the real display width and it picks accordingly. The old code
  // deliberately pinned src to the WIDEST derivative because the image was
  // full-bleed; that reasoning no longer applies and would now over-fetch by
  // roughly 4x on a phone.
  const HERO_SIZES = "(min-width: 992px) 420px, (min-width: 576px) 320px, 62vw";
  const webp = cover && (cover.sources || []).find((s) => s.type === "image/webp");

  let mediaHtml;
  if (cover && cover.sources && cover.sources.length) {
    const sources = cover.sources
      .map((so) => `<source type="${escapeHtml(so.type)}" srcset="${escapeHtml(so.srcset)}" sizes="${HERO_SIZES}">`)
      .join("");
    const lqip = cover.placeholder
      ? `<img class="pmedia__placeholder" src="${escapeHtml(cover.placeholder)}" alt="" aria-hidden="true" decoding="async">`
      : "";
    // Intrinsic width/height let the browser reserve the exact box before CSS
    // arrives, which is what keeps this at zero layout shift on a slow paint.
    const dims = cover.width && cover.height ? ` width="${cover.width}" height="${cover.height}"` : "";
    mediaHtml =
      lqip +
      `<picture>${sources}<img class="pmedia__img" data-instant src="${escapeHtml(src)}" sizes="${HERO_SIZES}" alt="${escapeHtml(product.name)}"${dims} fetchpriority="high" decoding="async"></picture>`;
  } else if (src) {
    mediaHtml = `<img class="pmedia__img" data-instant src="${escapeHtml(src)}" alt="${escapeHtml(product.name)}" fetchpriority="high" decoding="async">`;
  } else {
    mediaHtml = "";
  }

  // The fit mode is decided server-side from the image's real dimensions (see
  // chooseFit in lib/mediaDerivatives.js) — CSS cannot know an aspect ratio
  // before the image loads, and guessing is what produces jumping layouts.
  const fitClass = cover && cover.fit === "contain" ? "pmedia--contain" : "pmedia--cover";
  const vectorClass = cover && cover.orientation === "vector" ? " pmedia--vector" : "";

  function replaceAttrInTag(str, tagPattern, attrName, value) {
    return str.replace(tagPattern, (tag) =>
      tag.replace(new RegExp(`${attrName}="[^"]*"`), `${attrName}="${value}"`)
    );
  }

  let result = html
    .replace(/(<section class="hero" data-hero-id=")[^"]*(")/, `$1${escapeHtml(product.id)}$2`)
    .replace(/(<span[^>]*data-hero-title[^>]*>)[^<]*(<\/span>)/, `$1${escapeHtml(product.name)}$2`)
    .replace(/(<span[^>]*data-hero-price[^>]*>)[^<]*(<\/span>)/, `$1${escapeHtml(formatProductPrice(product.priceCents))}$2`)
    // The fit modifier goes on the CLASS LIST, not a data attribute — the
    // .pmedia rules in media-container.css key off .pmedia--cover /
    // .pmedia--contain / .pmedia--vector, and that is the same contract every
    // product card on the site already uses.
    //
    // `is-ready` (and `data-instant` on the <img> above) are the other half of
    // that contract, and this card was missing both. .pmedia__img starts at
    // opacity 0 and is revealed by MediaContainer.build()'s load handler — but
    // build() never runs on THIS card: hero-slideshow.js finds a server-
    // rendered <img> and sets dataset.attached = "1" precisely so it does not
    // overwrite the markup the preload points at. So the hero's first card —
    // the LCP element, preloaded and fetchpriority=high — painted invisible
    // and only appeared when the deck first rotated onto a client-built card.
    // Server-rendered media has no load event to wait for, which is exactly
    // what data-instant is for.
    .replace(
      /<span class="hero-card__media pmedia"([^>]*data-hero-media[^>]*)><\/span>/,
      `<span class="hero-card__media pmedia is-ready ${fitClass}${vectorClass}"$1>${mediaHtml}</span>`
    );

  result = replaceAttrInTag(result, /<a\b[^>]*data-hero-cta[^>]*>/, "href", ctaHref);

  if (src) {
    // Preload only THIS card. Every other card's image is attached by
    // hero-slideshow.js as it comes into the rotation window, so the first
    // paint never pays for slides the visitor may never see.
    //
    // imagesrcset/imagesizes must mirror the <img> exactly, or the browser
    // preloads one URL at high priority and then downloads a different one —
    // paying for the LCP image twice.
    const attrs = webp
      ? ` imagesrcset="${escapeHtml(webp.srcset)}" imagesizes="${HERO_SIZES}"`
      : "";
    result = result.replace(
      "<!--HERO_PRELOAD-->",
      `<link rel="preload" as="image" href="${escapeHtml(src)}"${attrs} fetchpriority="high">`
    );
  }
  return result;
}

// ---------------------------------------------------------------------
// Landing-page marketing slots.
//
// The template declares empty, named holes:
//
//   <div class="landing-slot" data-landing-slot="promo-primary"
//        data-landing-alt="..."></div>
//
// and this fills each one from whatever file is currently sitting in
// assets/images/landing/ (see server/src/lib/landingAssets.js). A slot with
// no file on disk is left exactly as authored — empty — and CSS paints a
// branded fallback into it. That is the invariant the "410X432" grey box
// violated: an unfilled slot must look deliberate, never technical.
//
// NOTE: no style="" anywhere below. The storefront CSP sends
// `style-src-attr 'self'`, so an inline style attribute is silently dropped
// (no console error, the rule just never applies). Every slot's aspect ratio
// therefore lives in CSS keyed off the slot name, not in the markup.
// ---------------------------------------------------------------------
function renderLandingSlot(slot, alt) {
  const cover = slot.cover;
  const altAttr = escapeHtml(alt || "");
  const sizes = escapeHtml(slot.sizes);
  // `contain` images are letterboxed on a blurred copy of themselves, exactly
  // as product cards do it, so an off-ratio marketing image still fills its
  // frame instead of floating on a flat slab.
  const fit = cover && cover.fit === "contain" ? "contain" : "cover";
  const loading = slot.eager ? "" : ' loading="lazy"';
  const priority = slot.eager ? ' fetchpriority="high"' : "";

  // No manifest yet (file dropped but tools/build-landing-assets.js not run):
  // still render a working image, just without srcset/LQIP. Degrading to the
  // original is the same fallback product covers take.
  if (!cover || !cover.sources || !cover.sources.length) {
    return {
      classes: `is-filled landing-slot--${fit}`,
      html: `<img class="landing-slot__img" src="${escapeHtml(slot.src)}" alt="${altAttr}"${loading}${priority} decoding="async">`,
    };
  }

  const sources = cover.sources
    .map((s) => `<source type="${escapeHtml(s.type)}" srcset="${escapeHtml(s.srcset)}" sizes="${sizes}">`)
    .join("");

  // The blurred backdrop behind a contained image: the narrowest derivative,
  // since it is scaled up and blurred to 18px anyway and resolution is
  // irrelevant. Skipped for cover, which has no letterbox area to fill.
  let backdrop = "";
  if (fit === "contain") {
    const webp = cover.sources.find((s) => s.type === "image/webp") || cover.sources[0];
    const smallest = String(webp.srcset).split(",")[0].trim().split(/\s+/)[0];
    if (smallest) backdrop = `<img class="landing-slot__backdrop" src="${escapeHtml(smallest)}" alt="" aria-hidden="true" decoding="async">`;
  }

  const lqip = cover.placeholder
    ? `<img class="landing-slot__lqip" src="${escapeHtml(cover.placeholder)}" alt="" aria-hidden="true" decoding="async">`
    : "";

  return {
    classes: `is-filled landing-slot--${fit}`,
    html:
      lqip +
      backdrop +
      `<picture>${sources}<img class="landing-slot__img" src="${escapeHtml(cover.src)}" alt="${altAttr}" sizes="${sizes}"${loading}${priority} decoding="async"></picture>`,
  };
}

function applyLandingAssets(html) {
  for (const name of Object.keys(SLOTS)) {
    // Matches the whole empty container for THIS slot, capturing its opening
    // tag so the alt text authored in markup survives. Bounded to a single
    // element (`[^>]*>` then the literal close) — it cannot run past the
    // container and swallow the rest of the section.
    const pattern = new RegExp(
      `<div class="landing-slot([^"]*)"([^>]*?)data-landing-slot="${name}"([^>]*)></div>`
    );
    if (!pattern.test(html)) continue;

    const slot = resolveSlot(name);
    html = html.replace(pattern, (whole, extraClasses, before, after) => {
      const attrs = before + after;
      const altMatch = attrs.match(/data-landing-alt="([^"]*)"/);
      const alt = altMatch ? altMatch[1] : "";

      // Empty slot: leave the hole exactly as authored. CSS renders the FA
      // mark on a brand surface — no <img>, so no broken-image request and
      // nothing technical is ever exposed to a visitor.
      if (!slot) return whole;

      const rendered = renderLandingSlot(slot, alt);
      return `<div class="landing-slot${extraClasses} ${rendered.classes}"${before}data-landing-slot="${name}"${after}>${rendered.html}</div>`;
    });
  }
  return html;
}

router.get("/", async (req, res, next) => {
  let html = await readTemplate("index.html");
  if (html == null) return next();
  html = await inlineHeader(html, "index.html");

  // Both server-rendered sections resolve from the same catalog read, so the
  // showcase can deliberately avoid repeating whatever the hero opened on. A
  // database failure degrades to the un-filled shells (the client-side
  // scripts still populate everything else) rather than 500ing the homepage.
  let heroProduct = null;
  let showcaseProduct = null;
  try {
    heroProduct = await resolveHeroProduct();
    showcaseProduct = await resolveShowcaseProduct(heroProduct);
  } catch (err) {
    console.error("Failed to load homepage products; rendering shells only.", err);
  }

  html = await applyHeroContext(html, heroProduct);
  html = applyShowcaseContext(html, showcaseProduct);
  html = applyLandingAssets(html);
  res.type("html").send(html);
});

// ---------------------------------------------------------------------
// robots.txt + sitemap.xml — generated from real data (every published
// product, every taxonomy leaf) instead of a static file that would go
// stale the moment the catalog changes. noindex-marked routes (cart,
// checkout, login, register, my-library) are excluded from the sitemap and
// disallowed in robots.txt to match.
// ---------------------------------------------------------------------
router.get("/robots.txt", (req, res) => {
  res.type("text/plain").send(
    [
      "User-agent: *",
      "Allow: /",
      "Disallow: /admin",
      "Disallow: /api/",
      "Disallow: /cart",
      "Disallow: /checkout",
      "Disallow: /login",
      "Disallow: /register",
      "Disallow: /my-library",
      // Private presentations are unlisted meeting decks. They're already
      // unguessable and never linked to, but a crawler that gets a link from
      // a pasted URL somewhere should still refuse it.
      "Disallow: /presentation",
      // Presentation product pages. Reachable only from inside a deck, and
      // never part of the store — they must not be indexed as if they were
      // things you can buy.
      "Disallow: /showcase",
      "",
      `Sitemap: ${appUrl("/sitemap.xml")}`,
      "",
    ].join("\n")
  );
});

router.get("/sitemap.xml", async (req, res) => {
  const staticUrls = ["/", "/shop", "/about", "/contact", "/blog"];

  const [products, trees] = await Promise.all([
    prisma.product.findMany({ where: { status: "published" }, select: { slug: true } }),
    safeGetAllTaxonomyTrees(),
  ]);

  const productUrls = products.map((p) => `/program/${encodeURIComponent(p.slug)}`);

  const goals = trees.find((t) => t.key === "goals");
  const goalUrls = goals ? goals.nodes.map((n) => `/goal/${encodeURIComponent(n.slug)}`) : [];

  const athletes = trees.find((t) => t.key === "athletes");
  const sportUrls = [];
  const athleteUrls = [];
  if (athletes) {
    athletes.nodes.forEach((sport) => {
      sportUrls.push(`/sport/${encodeURIComponent(sport.slug)}`);
      sport.children.forEach((athlete) => athleteUrls.push(`/athlete/${encodeURIComponent(athlete.slug)}`));
    });
  }

  const creators = trees.find((t) => t.key === "creators");
  const creatorUrls = [];
  if (creators) {
    creators.nodes.forEach((cat) => cat.children.forEach((leaf) => creatorUrls.push(`/creator/${encodeURIComponent(leaf.slug)}`)));
  }

  const allUrls = [...staticUrls, ...productUrls, ...goalUrls, ...sportUrls, ...athleteUrls, ...creatorUrls];

  const body =
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n` +
    allUrls.map((u) => `  <url><loc>${escapeHtml(appUrl(u))}</loc></url>`).join("\n") +
    `\n</urlset>\n`;

  res.type("application/xml").send(body);
});

// ---------------------------------------------------------------------
// 301 redirects: every old .html / query-param URL -> its new clean
// equivalent. Extends the exact res.redirect(301, ...) precedent that
// already existed for shop-2.html -> shop.html / index.html -> / (now
// carried a step further into index.js's mount of this router).
// ---------------------------------------------------------------------
const SIMPLE_REDIRECTS = [
  // shop-2.html was a byte-for-byte duplicate of shop.html (SEO duplicate
  // content + two shop pages to maintain).
  ["/shop-2.html", "/shop"],
  // The theme's three alternate homepage layouts, deleted 2026-08-11. Nothing
  // ever linked to them, but they were reachable through the static mount and
  // returned 200, so they were indexable near-duplicates of "/" — and they
  // still carried every placeholder, fabricated offer and vape-theme image
  // that the homepage had just been cleaned of. Redirected rather than left to
  // 404 for the same reason /index.html is: consolidate any crawled or
  // bookmarked URL onto the one canonical homepage.
  ["/index-2.html", "/"],
  ["/index-light.html", "/"],
  ["/index-2-light.html", "/"],
  // The homepage's only canonical URL is "/" — /index.html must never be a
  // second, independently-indexable copy or a URL that shows up in the
  // address bar. Every internal link already points at "/"; this only
  // exists to canonicalize old bookmarks/backlinks/crawled URLs.
  ["/index.html", "/"],
  ["/about.html", "/about"],
  ["/contact.html", "/contact"],
  ["/cart.html", "/cart"],
  ["/checkout.html", "/checkout"],
  ["/login.html", "/login"],
  ["/register.html", "/register"],
  ["/my-library.html", "/my-library"],
  ["/blog.html", "/blog"],
  ["/blog-grid.html", "/blog/grid"],
  ["/blog-list.html", "/blog/list"],
  ["/blog-single.html", "/blog/article"],
];
for (const [from, to] of SIMPLE_REDIRECTS) {
  router.get(from, (req, res) => {
    const qs = req.originalUrl.split("?")[1];
    res.redirect(301, to + (qs ? "?" + qs : ""));
  });
}

// shop.html itself is query-aware: the target route depends on which filter
// param (if any) it carried.
router.get("/shop.html", (req, res) => {
  const q = req.query;
  if (q.goal) return res.redirect(301, `/goal/${encodeURIComponent(q.goal)}`);
  if (q.athlete) return res.redirect(301, `/athlete/${encodeURIComponent(q.athlete)}`);
  if (q.sport) return res.redirect(301, `/sport/${encodeURIComponent(q.sport)}`);
  if (q.creator) return res.redirect(301, `/creator/${encodeURIComponent(q.creator)}`);
  const rest = new URLSearchParams(q);
  ["goal", "athlete", "sport", "creator"].forEach((k) => rest.delete(k));
  const qs = rest.toString();
  res.redirect(301, "/shop" + (qs ? "?" + qs : ""));
});

// shop-single.html?slug=X -> /program/X. The /program/:slug handler above
// then canonicalizes a raw id to the real slug if X was one (covers both a
// legacy bookmark and the pre-fix cart-link cuid case in one mechanism).
router.get("/shop-single.html", (req, res) => {
  const slug = req.query.slug;
  if (!slug) return res.redirect(301, "/shop");
  res.redirect(301, `/program/${encodeURIComponent(slug)}`);
});

// program.html?product=X -> /my-library/X
router.get("/program.html", (req, res) => {
  const product = req.query.product;
  if (!product) return res.redirect(301, "/my-library");
  res.redirect(301, `/my-library/${encodeURIComponent(product)}`);
});

module.exports = { router, render404, escapeHtml, appUrl };
