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
const { PROFILE_INCLUDE, buildPublicProfile, defaultMetaDescription } = require("../lib/partners");
const {
  ORGANIZATION,
  getService,
  listServices,
  relatedServices,
  audienceEntries,
} = require("../lib/services");

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
// /services and /services/:slug — the SEO service pages.
//
// Entirely server-rendered from lib/services.js, which is sourced from what
// Fitness Agency already says about itself in the partner deck. Each page
// gets its OWN title, description, canonical, OpenGraph/Twitter tags and
// JSON-LD — the brief's hard requirement that none of these are shared —
// and its own section mix, because these are different search intents rather
// than one template with the nouns swapped.
// ---------------------------------------------------------------------

function serviceUrl(slug) {
  return appUrl(`/services/${encodeURIComponent(slug)}`);
}

// Organization data reused across every service page, built from the real
// facts in lib/services.js. Emitted once per page as part of the JSON-LD
// graph rather than as a second, competing top-level block.
function organizationLd() {
  return {
    "@type": "Organization",
    "@id": appUrl("/#organization"),
    name: ORGANIZATION.name,
    url: appUrl("/"),
    description: ORGANIZATION.description,
    address: {
      "@type": "PostalAddress",
      addressLocality: ORGANIZATION.addressLocality,
      addressCountry: ORGANIZATION.addressCountry,
    },
  };
}

function renderServiceCta(service) {
  const heading = service
    ? `Interested in ${service.navLabel.toLowerCase()}?`
    : "Want to see what this looks like for you?";
  const body = service
    ? "We take on a small number of partners at a time, and fit matters more than size. Tell us about the audience and the method, and we'll tell you honestly whether we can build something worth selling."
    : "Tell us about the audience and the method, and we'll tell you honestly whether we can build something worth selling.";
  return (
    '<section class="svc-cta">' +
    `<h2>${escapeHtml(heading)}</h2>` +
    `<p>${escapeHtml(body)}</p>` +
    '<div class="svc-hero__actions">' +
    '<a class="svc-btn svc-btn--primary" href="/contact"><span>Start a conversation</span> <i class="fa-regular fa-arrow-right" aria-hidden="true"></i></a>' +
    '<a class="svc-btn svc-btn--ghost" href="/shop"><span>See what partners sell</span></a>' +
    "</div></section>"
  );
}

function renderServiceMain(service) {
  const related = relatedServices(service);
  const audience = audienceEntries(service);

  let out = '<main class="svc">';

  // Breadcrumb: real internal links, and the same trail the BreadcrumbList
  // structured data below describes.
  out +=
    '<nav class="svc-crumb" aria-label="Breadcrumb">' +
    '<a href="/">Home</a> <span aria-hidden="true">/</span> ' +
    '<a href="/services">Services</a> <span aria-hidden="true">/</span> ' +
    `<span>${escapeHtml(service.navLabel)}</span></nav>`;

  // ---- Hero: WHAT + FOR WHOM + WHY, and then it stops. ----
  out +=
    '<header class="svc-hero">' +
    `<span class="svc-hero__kicker">${escapeHtml(service.heroKicker)}</span>` +
    `<h1 class="svc-hero__title">${escapeHtml(service.name)}</h1>` +
    `<p class="svc-hero__lead">${escapeHtml(service.heroLead)}</p>` +
    '<div class="svc-hero__actions">' +
    '<a class="svc-btn svc-btn--primary" href="/contact"><span>Apply to partner</span> <i class="fa-regular fa-arrow-right" aria-hidden="true"></i></a>' +
    '<a class="svc-btn svc-btn--ghost" href="/services"><span>All services</span></a>' +
    "</div></header>";

  // ---- Value proposition ----
  out +=
    '<section class="svc-section">' +
    '<span class="svc-section__eyebrow">Why Fitness Agency</span>' +
    `<p class="svc-value">${escapeHtml(service.valueProp)}</p>` +
    "</section>";

  // ---- What it includes ----
  out +=
    '<section class="svc-section">' +
    '<span class="svc-section__eyebrow">What it includes</span>' +
    `<h2 class="svc-section__title">Everything ${escapeHtml(service.navLabel.toLowerCase())} covers</h2>` +
    `<div class="svc-grid${service.includes.length > 4 ? " svc-grid--3" : ""}">` +
    service.includes
      .map(
        (i) =>
          '<div class="svc-card">' +
          `<h3>${escapeHtml(i.title)}</h3>` +
          `<p>${escapeHtml(i.body)}</p>` +
          "</div>"
      )
      .join("") +
    "</div></section>";

  // ---- How we handle it ----
  out +=
    '<section class="svc-section">' +
    '<span class="svc-section__eyebrow">Our approach</span>' +
    `<h2 class="svc-section__title">${escapeHtml(service.approach.heading)}</h2>` +
    '<div class="svc-section__body">' +
    service.approach.body.map((p) => `<p>${escapeHtml(p)}</p>`).join("") +
    "</div></section>";

  // ---- Who it's for ----
  if (audience.length) {
    out +=
      '<section class="svc-section">' +
      '<span class="svc-section__eyebrow">Who it\'s for</span>' +
      '<h2 class="svc-section__title">Built for the people already doing the work</h2>' +
      '<div class="svc-grid">' +
      audience
        .map(
          (a) =>
            '<div class="svc-card">' +
            `<h3>${escapeHtml(a.key.charAt(0).toUpperCase() + a.key.slice(1))}</h3>` +
            `<p>${escapeHtml(a.text)}</p>` +
            "</div>"
        )
        .join("") +
      "</div></section>";
  }

  // ---- Benefits ----
  if (service.benefits && service.benefits.length) {
    out +=
      '<section class="svc-section">' +
      '<span class="svc-section__eyebrow">What changes</span>' +
      '<h2 class="svc-section__title">The difference you would notice</h2>' +
      '<ul class="svc-benefits">' +
      service.benefits
        .map((b) => `<li><i class="fa-solid fa-check" aria-hidden="true"></i><span>${escapeHtml(b)}</span></li>`)
        .join("") +
      "</ul></section>";
  }

  // ---- Process, only where one genuinely applies ----
  if (service.process && service.process.length) {
    out +=
      '<section class="svc-section">' +
      '<span class="svc-section__eyebrow">How it works</span>' +
      '<h2 class="svc-section__title">Six steps from first conversation to compounding revenue</h2>' +
      '<ol class="svc-steps">' +
      service.process
        .map(
          (s, i) =>
            '<li class="svc-step">' +
            `<span class="svc-step__num">${i + 1}</span>` +
            '<span class="svc-step__body">' +
            `<h3>${escapeHtml(s.title)}</h3>` +
            `<p>${escapeHtml(s.body)}</p>` +
            "</span></li>"
        )
        .join("") +
      "</ol></section>";
  }

  // ---- A real link into the catalogue, where one makes sense ----
  if (service.productHint) {
    out +=
      '<section class="svc-section">' +
      '<span class="svc-section__eyebrow">See it in practice</span>' +
      '<h2 class="svc-section__title">Real products, already selling</h2>' +
      '<div class="svc-section__body"><p>The storefront below is the same platform described on this page — every product on it was built, published and is supported by this team.</p></div>' +
      `<div class="svc-hero__actions"><a class="svc-btn svc-btn--ghost" href="${escapeHtml(service.productHint.path)}"><span>${escapeHtml(service.productHint.label)}</span> <i class="fa-regular fa-arrow-right" aria-hidden="true"></i></a></div>` +
      "</section>";
  }

  // ---- CTA ----
  out += renderServiceCta(service);

  // ---- Related services: the internal-linking half of the brief ----
  if (related.length) {
    out +=
      '<section class="svc-section">' +
      '<span class="svc-section__eyebrow">Related services</span>' +
      '<h2 class="svc-section__title">What usually comes with it</h2>' +
      '<div class="svc-grid svc-grid--3">' +
      related
        .map(
          (r) =>
            `<a class="svc-related-card" href="/services/${encodeURIComponent(r.slug)}">` +
            `<span><strong>${escapeHtml(r.name)}</strong><span>${escapeHtml(r.heroKicker)}</span></span>` +
            '<i class="fa-regular fa-arrow-right" aria-hidden="true"></i></a>'
        )
        .join("") +
      "</div></section>";
  }

  out += "</main>";
  return out;
}

function renderServicesIndex() {
  const services = listServices();
  let out = '<main class="svc">';

  out +=
    '<nav class="svc-crumb" aria-label="Breadcrumb">' +
    '<a href="/">Home</a> <span aria-hidden="true">/</span> <span>Services</span></nav>';

  out +=
    '<header class="svc-hero">' +
    '<span class="svc-hero__kicker">For athletes, influencers, creators and coaches</span>' +
    '<h1 class="svc-hero__title">Everything we handle</h1>' +
    '<p class="svc-hero__lead">Eleven separate systems a creator would otherwise have to buy, integrate and maintain themselves, plus an in-house studio that produces what a launch needs. Here they are one product.</p>' +
    '<div class="svc-hero__actions">' +
    '<a class="svc-btn svc-btn--primary" href="/contact"><span>Apply to partner</span> <i class="fa-regular fa-arrow-right" aria-hidden="true"></i></a>' +
    '<a class="svc-btn svc-btn--ghost" href="/shop"><span>See what partners sell</span></a>' +
    "</div></header>";

  out +=
    '<section class="svc-section">' +
    '<span class="svc-section__eyebrow">Services</span>' +
    '<h2 class="svc-section__title">Pick the part you need — or all of it</h2>' +
    '<div class="svc-grid svc-grid--3">' +
    services
      .map(
        (s) =>
          `<a class="svc-index-card" href="/services/${encodeURIComponent(s.slug)}">` +
          `<h2>${escapeHtml(s.name)}</h2>` +
          `<p>${escapeHtml(s.heroLead)}</p>` +
          '<span class="svc-index-card__more"><span>Learn more</span> <i class="fa-regular fa-arrow-right" aria-hidden="true"></i></span>' +
          "</a>"
      )
      .join("") +
    "</div></section>";

  out += renderServiceCta(null);
  out += "</main>";
  return out;
}

function applyServiceSeo(html, meta) {
  const title = escapeHtml(meta.title);
  const description = escapeHtml(meta.description);
  const url = meta.canonical;
  const image = appUrl("/assets/images/banner/inner-banner.jpg");

  const block =
    `<meta name="description" content="${description}">\n` +
    `    <link rel="canonical" href="${url}">\n` +
    `    <meta property="og:type" content="website">\n` +
    `    <meta property="og:title" content="${title} | Fitness Agency">\n` +
    `    <meta property="og:description" content="${description}">\n` +
    `    <meta property="og:url" content="${url}">\n` +
    `    <meta property="og:image" content="${image}">\n` +
    `    <meta name="twitter:card" content="summary_large_image">\n` +
    `    <meta name="twitter:title" content="${title} | Fitness Agency">\n` +
    `    <meta name="twitter:description" content="${description}">\n` +
    `    <meta name="twitter:image" content="${image}">\n` +
    `    <script type="application/ld+json">${JSON.stringify(meta.jsonLd)}</script>`;

  return html
    .replace(/<title[^>]*>[^<]*<\/title>/, `<title data-brand-title="${title} | {brand}">${title} | Fitness Agency</title>`)
    .replace("<!--SERVICE_SEO-->", block);
}

router.get("/services", async (req, res) => {
  let html = await readTemplate("service.html");
  if (html == null) return render404(req, res);
  html = await inlineHeader(html, "service.html");

  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      organizationLd(),
      {
        "@type": "CollectionPage",
        name: "Services | Fitness Agency",
        url: appUrl("/services"),
        description: ORGANIZATION.description,
        // An ItemList of the real services, each pointing at its own page —
        // this is what tells a crawler these eight URLs are a set.
        mainEntity: {
          "@type": "ItemList",
          itemListElement: listServices().map((s, i) => ({
            "@type": "ListItem",
            position: i + 1,
            name: s.name,
            url: serviceUrl(s.slug),
          })),
        },
      },
    ],
  };

  html = applyServiceSeo(html, {
    title: "Services",
    description:
      "Platform, production and partnership services for athletes, influencers, creators and coaches — storefront, products, payments, video, design and support as one system.",
    canonical: appUrl("/services"),
    jsonLd,
  });
  html = html.replace("<!--SERVICE_MAIN-->", renderServicesIndex());
  res.type("html").send(html);
});

router.get("/services/:slug", async (req, res) => {
  const service = getService(req.params.slug);
  if (!service) return render404(req, res);

  let html = await readTemplate("service.html");
  if (html == null) return render404(req, res);
  html = await inlineHeader(html, "service.html");

  // A Service node (the offering), the Organization that provides it, and the
  // breadcrumb trail — one graph rather than three competing blocks.
  //
  // Deliberately absent: aggregateRating, review, offers/price. None of those
  // exist as real data, and fabricating them is exactly what the brief rules
  // out.
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      organizationLd(),
      {
        "@type": "Service",
        name: service.name,
        serviceType: service.navLabel,
        description: service.description,
        url: serviceUrl(service.slug),
        provider: { "@id": appUrl("/#organization") },
        areaServed: "Worldwide",
        audience: audienceEntries(service).map((a) => ({
          "@type": "Audience",
          audienceType: a.key,
          description: a.text,
        })),
        hasOfferCatalog: {
          "@type": "OfferCatalog",
          name: `${service.name} — what it includes`,
          itemListElement: service.includes.map((i) => ({
            "@type": "Offer",
            itemOffered: { "@type": "Service", name: i.title, description: i.body },
          })),
        },
      },
      {
        "@type": "BreadcrumbList",
        itemListElement: [
          { "@type": "ListItem", position: 1, name: "Home", item: appUrl("/") },
          { "@type": "ListItem", position: 2, name: "Services", item: appUrl("/services") },
          { "@type": "ListItem", position: 3, name: service.navLabel, item: serviceUrl(service.slug) },
        ],
      },
    ],
  };

  html = applyServiceSeo(html, {
    title: service.title,
    description: service.description,
    canonical: serviceUrl(service.slug),
    jsonLd,
  });
  html = html.replace("<!--SERVICE_MAIN-->", renderServiceMain(service));
  res.type("html").send(html);
});

// ---------------------------------------------------------------------
// /partners/:slug — the public partner profile.
//
// Rendered ENTIRELY server-side. There is no client fetch and no page
// script: a crawler, a no-JS visitor and a phone on a slow connection all
// receive the finished header, links and product cards in the first
// response. That is also what makes the first screen cheap — the only thing
// the browser must fetch before the profile is readable is the avatar.
//
// Product data is read live through the PartnerProduct relation, so a price
// or cover changed in Admin -> Products is reflected here on the very next
// request. Nothing about a product is stored on the profile.
// ---------------------------------------------------------------------

// Renders one .pmedia box for a product cover / avatar, using the SAME
// responsive payload and the SAME class contract as every other product
// image on the site (assets/css/media-container.css).
//
// Two hooks are non-negotiable and have caused a live invisible-image bug
// before: `.pmedia__img` starts at `opacity: 0` and is only revealed by
// MediaContainer.build()'s load handler — which never runs on server-
// rendered markup. So server-rendered media MUST carry `data-instant` on
// the <img> and `is-ready` on the box, or it paints invisible forever.
function renderProfileMedia(imageUrl, alt, opts) {
  const options = opts || {};
  const src = normalizeImageUrl(imageUrl) || "";
  if (!src) return "";

  const cover = coverMedia(imageUrl);
  const sizes = options.sizes || "100vw";
  const loading = options.eager ? "" : ' loading="lazy"';
  const priority = options.eager ? ' fetchpriority="high"' : "";
  const fitClass = cover && cover.fit === "contain" ? "pmedia--contain" : "pmedia--cover";
  const vectorClass = cover && cover.orientation === "vector" ? " pmedia--vector" : "";
  const extraClass = options.className ? ` ${options.className}` : "";

  // No manifest (external URL, or an image predating the derivative
  // pipeline): degrade to the plain original, exactly as coverMedia's
  // contract says callers must.
  if (!cover || !cover.sources || !cover.sources.length) {
    return (
      `<span class="pmedia is-ready ${fitClass}${vectorClass}${extraClass}">` +
      `<img class="pmedia__img" data-instant src="${escapeHtml(src)}" alt="${escapeHtml(alt || "")}"${loading}${priority} decoding="async">` +
      "</span>"
    );
  }

  const sources = cover.sources
    .map((s) => `<source type="${escapeHtml(s.type)}" srcset="${escapeHtml(s.srcset)}" sizes="${escapeHtml(sizes)}">`)
    .join("");
  const lqip = cover.placeholder
    ? `<img class="pmedia__placeholder" src="${escapeHtml(cover.placeholder)}" alt="" aria-hidden="true" decoding="async">`
    : "";
  // Intrinsic dimensions let the browser reserve the exact box before CSS
  // arrives — this is what holds the page at zero layout shift.
  const dims = cover.width && cover.height ? ` width="${cover.width}" height="${cover.height}"` : "";

  return (
    `<span class="pmedia is-ready ${fitClass}${vectorClass}${extraClass}">` +
    lqip +
    `<picture>${sources}` +
    `<img class="pmedia__img" data-instant src="${escapeHtml(src)}" sizes="${escapeHtml(sizes)}" alt="${escapeHtml(alt || "")}"${dims}${loading}${priority} decoding="async">` +
    "</picture></span>"
  );
}

// Delay classes cap at 8 — see the note in assets/css/partner.css.
function revealClass(index) {
  return `pprofile__reveal pprofile__reveal--${Math.min(index + 1, 8)}`;
}

function renderPartnerAvatar(profile) {
  if (profile.avatarUrl) {
    const cover = coverMedia(profile.avatarUrl);
    const src = normalizeImageUrl(profile.avatarUrl);
    // Displayed at 96px (120px from 768px up), so even a 3x phone only needs
    // ~360px. `sizes` is what stops the browser reaching for the 1280w tier
    // for a thumbnail — the exact over-fetch this codebase has shipped
    // three times on other surfaces.
    const sizes = "(min-width: 768px) 120px, 96px";
    if (cover && cover.sources && cover.sources.length) {
      const sources = cover.sources
        .map((s) => `<source type="${escapeHtml(s.type)}" srcset="${escapeHtml(s.srcset)}" sizes="${sizes}">`)
        .join("");
      return (
        '<div class="pprofile__avatar">' +
        `<picture>${sources}<img src="${escapeHtml(src)}" sizes="${sizes}" alt="${escapeHtml(profile.displayName)}" width="120" height="120" fetchpriority="high" decoding="async"></picture>` +
        "</div>"
      );
    }
    return (
      '<div class="pprofile__avatar">' +
      `<img src="${escapeHtml(src)}" alt="${escapeHtml(profile.displayName)}" width="120" height="120" fetchpriority="high" decoding="async">` +
      "</div>"
    );
  }

  // No image: initials on a brand surface. Deliberate-looking, and it costs
  // no request at all.
  const initials = profile.displayName
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
  return `<div class="pprofile__avatar pprofile__avatar--initials">${escapeHtml(initials)}</div>`;
}

function renderPartnerSocials(profile) {
  // An unconfigured platform has no row at all (see lib/partners.js), so
  // this renders exactly what exists and nothing else — "do not show empty
  // social icons" holds structurally rather than by a truthiness check.
  const items = profile.socials.slice();
  if (profile.websiteUrl) {
    items.push({
      platform: "website",
      url: profile.websiteUrl,
      label: "Website",
      icon: "fa-globe",
    });
  }
  if (!items.length) return "";

  const links = items
    .map((s) => {
      // Font Awesome splits brand marks (fa-brands) from UI glyphs
      // (fa-solid); the website globe is the only non-brand icon here.
      const family = s.icon === "fa-globe" ? "fa-solid" : "fa-brands";
      return (
        `<a class="pprofile__social" href="${escapeHtml(s.url)}" target="_blank" rel="noopener nofollow" aria-label="${escapeHtml(profile.displayName)} on ${escapeHtml(s.label)}">` +
        `<i class="${family} ${escapeHtml(s.icon)}" aria-hidden="true"></i></a>`
      );
    })
    .join("");

  return `<div class="pprofile__socials">${links}</div>`;
}

function renderPartnerFeatureCard(product, ctaLabel) {
  const href = `/program/${encodeURIComponent(product.slug)}`;
  // The featured cover is the largest image on the page and sits just below
  // the fold on a phone. Eager, because it is the profile's primary
  // conversion surface and lazy-loading it would leave a hole exactly where
  // the visitor is heading.
  const media = renderProfileMedia(product.imageUrl, product.name, {
    eager: true,
    sizes: "(min-width: 576px) 512px, 100vw",
  });
  const eyebrow = product.creator && !product.name.toLowerCase().includes(product.creator.toLowerCase())
    ? product.creator
    : product.difficulty || "Training program";

  return (
    `<a class="pprofile__feature" href="${href}">` +
    media +
    '<div class="pprofile__feature-body">' +
    `<span class="pprofile__feature-eyebrow">${escapeHtml(eyebrow)}</span>` +
    `<h3 class="pprofile__feature-title">${escapeHtml(product.name)}</h3>` +
    '<div class="pprofile__feature-foot">' +
    `<span class="pprofile__price">${escapeHtml(formatProductPrice(product.priceCents))}</span>` +
    `<span class="pprofile__feature-action">${escapeHtml(ctaLabel || "View program")} <i class="fa-regular fa-arrow-right" aria-hidden="true"></i></span>` +
    "</div></div></a>"
  );
}

function renderPartnerProductRow(product, index) {
  const href = `/program/${encodeURIComponent(product.slug)}`;
  // 64px box; `sizes` keeps the browser on the 320w tier even at 3x.
  const media = renderProfileMedia(product.imageUrl, product.name, {
    eager: false,
    sizes: "64px",
  });
  const sub = [product.creator, product.durationWeeks ? `${product.durationWeeks} weeks` : null]
    .filter(Boolean)
    .join(" · ");

  return (
    `<a class="pprofile__row pprofile__row--product ${revealClass(index)}" href="${href}">` +
    `<span class="pprofile__thumb">${media}</span>` +
    '<span class="pprofile__row-body">' +
    `<span class="pprofile__row-title">${escapeHtml(product.name)}</span>` +
    (sub ? `<span class="pprofile__row-sub">${escapeHtml(sub)}</span>` : "") +
    "</span>" +
    `<span class="pprofile__row-price">${escapeHtml(formatProductPrice(product.priceCents))}</span>` +
    "</a>"
  );
}

function renderPartnerLinkRow(link, index) {
  // Off-site links get nofollow + noopener; in-platform ones (/shop,
  // /program/x) stay ordinary internal links so they pass crawl signal,
  // which is the internal-linking half of the brief.
  const external = /^https?:\/\//i.test(link.url);
  const relAttr = external ? ' target="_blank" rel="noopener nofollow"' : "";
  return (
    `<a class="pprofile__row ${revealClass(index)}" href="${escapeHtml(link.url)}"${relAttr}>` +
    `<span class="pprofile__row-icon"><i class="fa-solid ${escapeHtml(link.icon)}" aria-hidden="true"></i></span>` +
    '<span class="pprofile__row-body">' +
    `<span class="pprofile__row-title">${escapeHtml(link.title)}</span>` +
    (link.description ? `<span class="pprofile__row-sub">${escapeHtml(link.description)}</span>` : "") +
    "</span>" +
    '<span class="pprofile__row-chev"><i class="fa-regular fa-arrow-up-right-from-square" aria-hidden="true"></i></span>' +
    "</a>"
  );
}

// The whole <main>. Order is the brief's: identity -> socials -> primary CTA
// -> featured product -> products -> custom links -> brand mark.
function renderPartnerMain(profile, opts) {
  const options = opts || {};
  const featuredLink = profile.links.find((l) => l.featured) || null;
  const otherLinks = profile.links.filter((l) => l !== featuredLink);
  const featuredProduct = profile.products.find((p) => p.featured) || null;
  const otherProducts = profile.products.filter((p) => p !== featuredProduct);

  const previewBar = options.preview
    ? '<div class="pprofile__preview-bar"><i class="fa-solid fa-eye" aria-hidden="true"></i> ' +
      `Admin preview — this profile is ${escapeHtml(profile.status)} and is not publicly visible.</div>`
    : "";

  let out = `${previewBar}<main class="pprofile pprofile--${escapeHtml(profile.layout)}">`;

  // ---- Identity ----
  out += '<header class="pprofile__head">';
  out += renderPartnerAvatar(profile);
  out += `<h1 class="pprofile__name">${escapeHtml(profile.displayName)}</h1>`;
  out += '<div class="pprofile__meta">';
  out += `<span class="pprofile__badge"><i class="fa-solid fa-circle-check" aria-hidden="true"></i> ${escapeHtml(profile.typeLabel)}</span>`;
  if (profile.handle) out += `<span class="pprofile__handle">@${escapeHtml(profile.handle)}</span>`;
  out += "</div>";
  if (profile.bio) out += `<p class="pprofile__bio">${escapeHtml(profile.bio)}</p>`;
  out += renderPartnerSocials(profile);
  out += "</header>";

  // ---- Primary CTA ----
  // The featured custom link wins the slot if there is one; otherwise the
  // featured product's own card carries the action, so the page never shows
  // two competing primary buttons.
  if (featuredLink) {
    const external = /^https?:\/\//i.test(featuredLink.url);
    const relAttr = external ? ' target="_blank" rel="noopener nofollow"' : "";
    out +=
      `<a class="pprofile__cta pprofile__reveal pprofile__reveal--1" href="${escapeHtml(featuredLink.url)}"${relAttr}>` +
      `<span class="pprofile__cta-label">${escapeHtml(featuredLink.title)}</span>` +
      '<i class="fa-regular fa-arrow-right" aria-hidden="true"></i></a>';
  }

  // ---- Featured product ----
  if (featuredProduct) {
    out += '<section class="pprofile__section">';
    out += '<h2 class="pprofile__section-title">Featured</h2>';
    out += `<div class="pprofile__reveal pprofile__reveal--2">${renderPartnerFeatureCard(featuredProduct, profile.ctaLabel)}</div>`;
    out += "</section>";
  }

  // ---- Remaining products ----
  if (otherProducts.length) {
    out += '<section class="pprofile__section">';
    out += `<h2 class="pprofile__section-title">${featuredProduct ? "More programs" : "Programs"}</h2>`;
    out += '<div class="pprofile__links pprofile__links--products">';
    out += otherProducts.map((p, i) => renderPartnerProductRow(p, i)).join("");
    out += "</div></section>";
  }

  // ---- Custom links ----
  if (otherLinks.length) {
    out += '<section class="pprofile__section">';
    out += '<h2 class="pprofile__section-title">Links</h2>';
    out += '<div class="pprofile__links">';
    out += otherLinks.map((l, i) => renderPartnerLinkRow(l, i)).join("");
    out += "</div></section>";
  }

  // ---- Brand mark ----
  out +=
    '<div class="pprofile__mark"><a href="/">' +
    '<img src="/assets/images/logo/fa-logo.svg" alt="" height="22" data-brand-logo aria-hidden="true">' +
    "<span>Fitness Agency</span></a></div>";

  out += "</main>";
  return out;
}

function applyPartnerSeo(html, profile, opts) {
  const options = opts || {};
  const title = escapeHtml(profile.displayName);
  const rawDescription = profile.metaDescription || defaultMetaDescription(profile);
  const description = escapeHtml(rawDescription);
  const url = appUrl(`/partners/${encodeURIComponent(profile.slug)}`);

  const normalizedAvatar = profile.avatarUrl ? normalizeImageUrl(profile.avatarUrl) : "";
  const image = normalizedAvatar
    ? escapeHtml(/^https?:\/\//.test(normalizedAvatar) ? normalizedAvatar : appUrl(normalizedAvatar))
    : "";

  // JSON-LD: a ProfilePage whose mainEntity is the Person. `sameAs` carries
  // only social URLs that are actually configured — this is the machine-
  // readable claim "these accounts are the same person", so a guessed or
  // placeholder URL would be a false statement, not just a dead link.
  //
  // Nothing here is fabricated: no ratings, no reviews, no prices, no
  // invented credentials. Every field is a stored value.
  const sameAs = profile.socials.map((s) => s.url);
  if (profile.websiteUrl) sameAs.push(profile.websiteUrl);

  const person = {
    "@type": "Person",
    name: profile.displayName,
    url: url,
  };
  if (profile.bio) person.description = profile.bio;
  if (image) person.image = image;
  if (sameAs.length) person.sameAs = sameAs;
  if (profile.handle) person.alternateName = `@${profile.handle}`;

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "ProfilePage",
    name: `${profile.displayName} | Fitness Agency`,
    url: url,
    mainEntity: person,
  };

  // A draft/archived profile reached through admin preview must never be
  // indexed, and must not advertise a canonical URL that would consolidate
  // signal onto a page the public gets a 404 from.
  const indexable = profile.status === "published" && !options.preview;

  const block =
    `<meta name="description" content="${description}">\n` +
    (indexable ? `    <link rel="canonical" href="${url}">\n` : "") +
    (indexable ? "" : `    <meta name="robots" content="noindex, nofollow">\n`) +
    `    <meta property="og:type" content="profile">\n` +
    `    <meta property="og:title" content="${title} | Fitness Agency">\n` +
    `    <meta property="og:description" content="${description}">\n` +
    `    <meta property="og:url" content="${url}">\n` +
    (image ? `    <meta property="og:image" content="${image}">\n` : "") +
    `    <meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">\n` +
    `    <meta name="twitter:title" content="${title} | Fitness Agency">\n` +
    `    <meta name="twitter:description" content="${description}">\n` +
    (image ? `    <meta name="twitter:image" content="${image}">\n` : "") +
    `    <script type="application/ld+json">${JSON.stringify(jsonLd)}</script>`;

  let result = html
    .replace(/<title[^>]*>[^<]*<\/title>/, `<title data-brand-title="${title} | {brand}">${title} | Fitness Agency</title>`)
    .replace("<!--PARTNER_SEO-->", block);

  // Preload the avatar — the profile's first meaningful pixel.
  //
  // The preload MUST resolve to the same file the <picture> will pick, or the
  // browser fetches one image at high priority and then downloads a different
  // one, paying for the header image twice. The <picture> offers AVIF first,
  // so the preload advertises AVIF and carries `type` — a browser without
  // AVIF support ignores the hint entirely and simply loads the image from
  // the markup, which is already in this response and found by the preload
  // scanner anyway. Falling back to the widest-supported source instead would
  // reintroduce exactly the mismatch this avoids.
  if (normalizedAvatar) {
    const cover = coverMedia(profile.avatarUrl);
    const sources = (cover && cover.sources) || [];
    const preferred = sources.find((s) => s.type === "image/avif") || sources[0];
    const sizes = "(min-width: 768px) 120px, 96px";
    const tag = preferred
      ? `<link rel="preload" as="image" type="${escapeHtml(preferred.type)}" imagesrcset="${escapeHtml(preferred.srcset)}" imagesizes="${sizes}" fetchpriority="high">`
      : `<link rel="preload" as="image" href="${escapeHtml(normalizedAvatar)}" fetchpriority="high">`;
    result = result.replace("<!--PARTNER_PRELOAD-->", tag);
  }
  return result;
}

router.get("/partners/:slug", async (req, res) => {
  const slug = String(req.params.slug || "").toLowerCase();
  const partner = await prisma.partner.findUnique({
    where: { slug },
    include: PROFILE_INCLUDE,
  });

  // Not found, draft and archived are ONE response to the public: a 404.
  // Distinguishing them would leak which slugs exist as unpublished drafts.
  //
  // An authenticated admin is the single exception — they get the same page
  // with a preview banner and robots:noindex, which is what makes "preview
  // before publishing" work without a second renderer or a shareable token.
  const isAdmin = !!(req.user && req.user.role === "admin");
  if (!partner) return render404(req, res);
  if (partner.status !== "published" && !isAdmin) return render404(req, res);

  const preview = partner.status !== "published";
  const profile = buildPublicProfile(partner);

  let html = await readTemplate("partner.html");
  if (html == null) return render404(req, res);
  html = await inlineHeader(html, "partner.html");
  html = applyPartnerSeo(html, profile, { preview });
  html = html.replace("<!--PARTNER_MAIN-->", renderPartnerMain(profile, { preview }));
  // A draft previewed by an admin must never be cached by an intermediary
  // and served to someone else.
  if (preview) res.set("Cache-Control", "private, no-store");
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

// Hero caption fields.
//
// KEEP IN STEP WITH the identical pair in assets/js/hero-slideshow.js. The
// server renders card 0 for crawlers and no-JS visitors; the client renders
// every other card from GET /api/products. Two renderers of the same data is
// exactly the shape of bug this codebase has hit before, so
// tools/test-landing-responsive.js asserts that the server-rendered caption
// still matches the client-rendered one for the same product.
//
// The eyebrow is the ATTRIBUTION — "train like the ones you follow" only means
// anything if the name behind the program is the first thing read. It falls
// back to difficulty when the creator's name is already inside the product
// title, because "SAM SULEK / Sam Sulek Strength & Size Peak" reads as a
// stutter rather than a credit.
function heroEyebrow(product) {
  const creator = (product.creator || "").trim();
  const name = (product.name || "").toLowerCase();
  if (creator && !name.includes(creator.toLowerCase())) return creator;
  if (product.difficulty) return product.difficulty;
  return creator || "Training program";
}

function heroMeta(product) {
  const parts = [formatProductPrice(product.priceCents)];
  if (product.durationWeeks) parts.push(`${product.durationWeeks} weeks`);
  return parts.join("  ·  ");
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
    .replace(/(<span[^>]*data-hero-eyebrow[^>]*>)[^<]*(<\/span>)/, `$1${escapeHtml(heroEyebrow(product))}$2`)
    .replace(/(<span[^>]*data-hero-meta[^>]*>)[^<]*(<\/span>)/, `$1${escapeHtml(heroMeta(product))}$2`)
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
  const staticUrls = ["/", "/shop", "/about", "/contact", "/blog", "/services"];

  // Every service page. Static content, so these come from the catalogue in
  // lib/services.js rather than the database.
  const serviceUrls = listServices().map((s) => `/services/${encodeURIComponent(s.slug)}`);

  const [products, trees, partners] = await Promise.all([
    prisma.product.findMany({ where: { status: "published" }, select: { slug: true } }),
    safeGetAllTaxonomyTrees(),
    // Only published profiles. Drafts and archived profiles 404 for the
    // public, so listing them would be advertising dead URLs.
    prisma.partner.findMany({ where: { status: "published" }, select: { slug: true } }),
  ]);

  const productUrls = products.map((p) => `/program/${encodeURIComponent(p.slug)}`);
  const partnerUrls = partners.map((p) => `/partners/${encodeURIComponent(p.slug)}`);

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

  const allUrls = [
    ...staticUrls,
    ...serviceUrls,
    ...productUrls,
    ...goalUrls,
    ...sportUrls,
    ...athleteUrls,
    ...creatorUrls,
    ...partnerUrls,
  ];

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
