require("dotenv").config();
const path = require("path");
const fs = require("fs");
const express = require("express");
// Patches Express so a rejected promise inside any async route handler is
// forwarded to next(err) instead of crashing the process as an uncaught
// exception — every route below is `async (req, res) => ...` with no
// try/catch, and Express 4 does not catch those on its own.
require("express-async-errors");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const helmet = require("helmet");

const { attachUser, requireAdminPage } = require("./middleware/auth");
const { csrfProtection } = require("./middleware/csrf");
const authRoutes = require("./routes/auth");
const productsRoutes = require("./routes/products");
const checkoutRoutes = require("./routes/checkout");
const libraryRoutes = require("./routes/library");
const stripeWebhookRoutes = require("./routes/webhooksStripe");
const configRoutes = require("./routes/config");
const adminRoutes = require("./routes/admin");
const taxonomyRoutes = require("./routes/taxonomy");
const recommendationsRoutes = require("./routes/recommendations");
const { getAllTaxonomyTrees } = require("./lib/taxonomy");
const { isDevRoutesEnabled } = require("./lib/devMode");
const { prisma } = require("./db");

if (!process.env.CSRF_SECRET) {
  // Fail at startup, not on the first authenticated mutating request in
  // production — a missing secret should never be discovered via a wave of
  // confusing 500s from real users.
  throw new Error("CSRF_SECRET is not set — see server/.env.example");
}

const app = express();
const SITE_ROOT = path.join(__dirname, "..", "..");
const isDev = isDevRoutesEnabled;
const isProd = process.env.NODE_ENV === "production";

// Belt-and-suspenders alongside whatever TLS termination the host provides
// (most PaaS hosts terminate TLS upstream and forward plain HTTP internally,
// so this only fires for a request that actually arrived over HTTP).
if (isProd) {
  app.set("trust proxy", 1);
  app.use((req, res, next) => {
    if (req.secure || req.get("x-forwarded-proto") === "https") return next();
    res.redirect(301, `https://${req.get("host")}${req.originalUrl}`);
  });
}

// Strict CSP: no 'unsafe-inline', no 'unsafe-eval', anywhere. This was only
// possible because every inline style="" attribute, inline <style> block,
// and inline <script> block site-wide was eliminated first (moved to
// external CSS classes/files) — see assets/css/style.css's "CSP hardening"
// section and git history for that pass. Every remaining external origin
// below is something this app actually, functionally depends on; none are
// preemptive/guessed. See SECURITY_AUDIT.md's "Content Security Policy"
// section for the full domain-by-domain rationale, including why Resend,
// Supabase, and Cloudflare — all named in the original hardening brief —
// have no entries here.
const cspDirectives = {
  defaultSrc: ["'self'"],
  // js.stripe.com: Stripe Elements (card entry UI + fraud detection).
  // www.paypal.com: PayPal Buttons SDK, loaded dynamically at checkout.
  scriptSrc: ["'self'", "https://js.stripe.com", "https://www.paypal.com"],
  styleSrc: ["'self'"],
  // paypalobjects.com: card-brand/PayPal logo icons rendered by the PayPal SDK.
  imgSrc: ["'self'", "data:", "https://www.paypalobjects.com"],
  // data:: swiper-bundle.min.css embeds its nav-arrow/pagination icon font
  // as a base64 data URI — unrelated to the Inter webfont (self-hosted,
  // covered by 'self' alone), this is a bundled vendor library's own asset.
  fontSrc: ["'self'", "data:"],
  // api.stripe.com: Stripe Elements' own XHR calls (tokenization, Radar).
  // www.paypal.com: PayPal SDK's own XHR calls.
  connectSrc: ["'self'", "https://api.stripe.com", "https://www.paypal.com"],
  // hooks.stripe.com: 3D Secure / bank-redirect authentication flows.
  // www.paypal.com: PayPal's own checkout/login iframes and popups.
  // google.com: the Google Maps embed on contact.html.
  // youtube.com: the video lightbox on about.html/blog.html.
  frameSrc: [
    "https://js.stripe.com",
    "https://hooks.stripe.com",
    "https://www.paypal.com",
    "https://www.google.com",
    "https://www.youtube.com",
  ],
  objectSrc: ["'none'"],
  baseUri: ["'self'"],
  frameAncestors: ["'self'"],
  // Chart.js (admin dashboard only) sets canvas sizing via
  // style.setProperty(..., "important") for crisp high-DPI rendering —
  // well-documented upstream Chart.js behavior with no CSP-clean
  // workaround (confirmed empirically: neither disabling `responsive` nor
  // `devicePixelRatio` avoids it; it's inherent to canvas backing-store
  // scaling, not a resize-specific code path). style-src itself (still
  // 'self' only — <style> tags, stylesheets, @import) is untouched; this
  // relaxes *only* the narrower style-ATTRIBUTE fallback, and only for
  // /admin/* requests (helmet calls each array element that's a function
  // per-request with (req, res)). The customer-facing storefront and
  // checkout, where the stakes of any CSP relaxation are highest, get the
  // fully strict policy with no exception at all.
  styleSrcAttr: ["'self'", (req) => (req.path.startsWith("/admin") ? "'unsafe-inline'" : "")],
};
if (isProd) cspDirectives.upgradeInsecureRequests = [];

app.use(
  helmet({
    contentSecurityPolicy: { directives: cspDirectives },
    hsts: isProd ? { maxAge: 15552000, includeSubDomains: true } : false,
  })
);

// Stripe requires the raw, unparsed body to verify webhook signatures, so this
// must be mounted before the global express.json() below.
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookRoutes);

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(attachUser);
app.use("/api", csrfProtection);

app.use("/api/auth", authRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/checkout", checkoutRoutes);
app.use("/api/library", libraryRoutes);
app.use("/api/config", configRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/taxonomy", taxonomyRoutes);
app.use("/api/recommendations", recommendationsRoutes);

// Dev-only tools (instant admin login, test data, simulated purchases) — never
// mounted in production, regardless of what the frontend tries to call.
if (isDev) {
  app.use("/api/dev", require("./routes/dev"));
}

// The admin SPA shell — every /admin/manage/* deep link (dashboard, orders,
// settings, ...) serves the exact same shell file; the client router reads
// the section back out of the URL. Registered before the static mount below
// so it wins for these paths instead of 404ing against a nonexistent file.
const ADMIN_MANAGE_SHELL = path.join(SITE_ROOT, "admin", "manage.html");
app.get(["/admin/manage", "/admin/manage/*"], requireAdminPage, (req, res) => {
  res.sendFile(ADMIN_MANAGE_SHELL);
});

// Gate the admin dashboard's own HTML/JS/CSS bundle before the generic static
// handler below, so it's never served to a non-admin, not just its API data.
app.use("/admin", requireAdminPage, express.static(path.join(SITE_ROOT, "admin")));

// Single shared header component: every root-level page includes a
// <!--SHARED_HEADER--> marker instead of its own copy of the header markup.
// This inlines partials/header.html into the page HTML at request time, so
// there's one source of truth and no client-side fetch/FOUC to worry about.
const HEADER_PARTIAL_PATH = path.join(SITE_ROOT, "partials", "header.html");
const HEADER_MARKER = "<!--SHARED_HEADER-->";
const HIDDEN_HEADER_PAGES = new Set(["checkout.html"]);

app.use("/partials", (req, res) => res.sendStatus(404));

// shop-2.html was a byte-for-byte duplicate of shop.html (SEO duplicate
// content + two shop pages to maintain). Permanent-redirect it into the one
// real shop page, preserving any query string old links carry.
app.get("/shop-2.html", (req, res) => {
  const qs = req.originalUrl.split("?")[1];
  res.redirect(301, "/shop.html" + (qs ? "?" + qs : ""));
});

// The homepage's only canonical URL is "/" — /index.html must never be a
// second, independently-indexable copy (duplicate-content SEO issue) or a
// URL that shows up in the address bar. Every internal link already points
// at "/" (partials/header.html and every page's footer/breadcrumb); this
// redirect only exists to canonicalize old bookmarks/backlinks/crawled URLs.
app.get("/index.html", (req, res) => {
  const qs = req.originalUrl.split("?")[1];
  res.redirect(301, "/" + (qs ? "?" + qs : ""));
});

function escapeHtml(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

// Header mega-menu goal links and sport columns, generated live from the
// Taxonomy tables (server/src/lib/taxonomy.js) — the exact same source of
// truth the admin CMS reads and writes. A category/subcategory created,
// renamed, or deleted in Admin -> Navigation (or inline from the product
// wizard) is reflected here on the very next request; there is no
// intermediate file or cache to fall out of sync.
// Every node renders here regardless of product count — a category or
// subcategory created in Admin -> Navigation must be visible immediately,
// not only once something happens to be tagged to it. An empty item just
// leads to an empty (but not broken) shop grid until a product is assigned.
function navGoalLinksHtml(goalsTaxonomy) {
  if (!goalsTaxonomy) return "";
  return goalsTaxonomy.nodes
    .map((n) => `<li><a href="shop.html?goal=${encodeURIComponent(n.slug)}">${escapeHtml(n.name)}</a></li>`)
    .join("");
}

// One column per sport category, listing every one of its athlete
// subcategories directly (real server-rendered links, not a client-side
// scan of product fields) — a category or subcategory created, renamed, or
// deleted in Admin -> Navigation must show up here immediately and
// completely, whether or not a product has been tagged to it yet, so this
// deliberately never truncates the list.
function navSportColumnsHtml(athletesTaxonomy) {
  if (!athletesTaxonomy) return "";
  return athletesTaxonomy.nodes
    .map((n) => {
      const athleteLinks = n.children
        .map((a) => `<li><a href="shop.html?sport=${encodeURIComponent(n.slug)}&amp;athlete=${encodeURIComponent(a.slug)}">${escapeHtml(a.name)}</a></li>`)
        .join("");
      return (
        `<div class="mega-menu__col mega-menu__col--sport" data-sport="${escapeHtml(n.slug)}">` +
        `<span class="mega-menu__heading">${escapeHtml(n.name)}</span>` +
        `<ul data-role="sport-athletes">${athleteLinks}</ul>` +
        `<a href="shop.html?sport=${encodeURIComponent(n.slug)}" class="mega-menu__view-all">View All <i class="fa-regular fa-arrow-right" aria-hidden="true"></i></a>` +
        "</div>"
      );
    })
    .join("");
}

// The storefront shell (header nav, shop page title/crumb) must render even
// when taxonomy data can't be loaded — a DB outage or misconfiguration
// (e.g. missing DATABASE_URL) should degrade to empty nav sections, not take
// down every page on the site. Every caller of getAllTaxonomyTrees() in the
// page-rendering path goes through this wrapper instead of the raw import.
async function safeGetAllTaxonomyTrees() {
  try {
    return await getAllTaxonomyTrees();
  } catch (err) {
    console.error("Failed to load taxonomy trees; rendering storefront with empty navigation.", err);
    return [];
  }
}

async function applyNavContexts(headerHtml) {
  const trees = await safeGetAllTaxonomyTrees();
  const goals = trees.find((t) => t.key === "goals");
  const athletes = trees.find((t) => t.key === "athletes");
  return headerHtml
    .replace("<!--NAV_GOALS_TRAINING-->", navGoalLinksHtml(goals))
    .replace("<!--NAV_SPORTS_COLUMNS-->", navSportColumnsHtml(athletes));
}

async function resolveShopContext(query) {
  const trees = await safeGetAllTaxonomyTrees();
  const goals = trees.find((t) => t.key === "goals");
  const athletes = trees.find((t) => t.key === "athletes");

  const goalNode = goals && goals.nodes.find((n) => n.slug === query.goal);
  if (goalNode) {
    return {
      title: `${goalNode.name} Training & Nutrition Plans`,
      description: `Training and nutrition plans built around ${goalNode.name.toLowerCase()}, from real coaches and athletes.`,
      heading: goalNode.name,
      crumb: `Shop by Goal · ${goalNode.name}`,
      canonicalQs: `?goal=${encodeURIComponent(goalNode.slug)}`,
    };
  }
  const sportNode = athletes && athletes.nodes.find((n) => n.slug === query.sport);
  if (sportNode) {
    return {
      title: `${sportNode.name} Training Programs`,
      description: `Training plans built and used by ${sportNode.name.toLowerCase()} athletes.`,
      heading: `${sportNode.name} Training`,
      crumb: `Sports · ${sportNode.name}`,
      canonicalQs: `?sport=${encodeURIComponent(sportNode.slug)}`,
    };
  }
  return null;
}

async function applyShopContext(html, query) {
  const ctx = await resolveShopContext(query);
  const canonicalQs = ctx ? ctx.canonicalQs : "";
  if (process.env.APP_URL) {
    html = html.replace(
      "<!--SHOP_CANONICAL-->",
      `<link rel="canonical" href="${process.env.APP_URL.replace(/\/$/, "")}/shop.html${canonicalQs}">`
    );
  }
  if (!ctx) return html;

  const title = escapeHtml(ctx.title);
  return html
    .replace(/<title[^>]*>[^<]*<\/title>/, `<title data-brand-title="${title} | {brand}">${title} | ProFit</title>`)
    .replace(/(<meta name="description" data-shop-meta content=")[^"]*(")/, `$1${escapeHtml(ctx.description)}$2`)
    .replace(/(<h2[^>]*data-shop-heading[^>]*>)[^<]*(<\/h2>)/, `$1${escapeHtml(ctx.heading)}$2`)
    .replace(/(<p[^>]*data-shop-sub[^>]*>)[^<]*(<\/p>)/, `$1${escapeHtml(ctx.description)}$2`)
    .replace(/(<span[^>]*data-shop-crumb[^>]*>)[^<]*(<\/span>)/, `$1${escapeHtml(ctx.crumb)}$2`);
}

// Picks the same product the homepage hero slideshow will open on
// (assets/js/hero-slideshow.js's selectHeroProducts): the earliest-created
// featured product, or — if nothing is featured yet — the newest published
// product, so the hero is never empty on a fresh catalog. Only this one
// product needs a server round-trip; every other slide is client-rendered.
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

// One representative "category" for the hero meta line — a product can carry
// tags across all three taxonomy trees (goal/athlete/creator); prefer a
// leaf's parent category name (e.g. "Boxing"), falling back to a bare node
// name (e.g. a goal) if that's all it has. Mirrors the client-side
// buildTaxonomyIndex/describeMeta in assets/js/hero-slideshow.js.
function describeProductCategory(product) {
  const nodes = (product.taxonomies || []).map((t) => t.taxonomyNode);
  const leafWithParent = nodes.find((n) => n.parent);
  if (leafWithParent) return leafWithParent.parent.name;
  return nodes[0] ? nodes[0].name : null;
}

// Server-renders only the hero's first slide (title/description/price/CTA/
// background image) directly into index.html, the same way applyShopContext
// server-renders shop.html's heading — so a crawler or no-JS visitor sees a
// real product immediately instead of an empty shell that only fills in
// after assets/js/hero-slideshow.js runs. That script recognizes this slide
// via data-hero-id and reuses it instead of re-rendering a duplicate.
async function applyHeroContext(html) {
  if (process.env.APP_URL) {
    html = html.replace(
      "<!--HOME_CANONICAL-->",
      `<link rel="canonical" href="${process.env.APP_URL.replace(/\/$/, "")}/">`
    );
  }

  let product;
  try {
    product = await resolveHeroProduct();
  } catch (err) {
    console.error("Failed to load hero product; rendering hero shell only.", err);
    return html;
  }
  if (!product) return html;

  const category = describeProductCategory(product);
  const metaParts = [product.creator, category].filter(Boolean);
  const meta = escapeHtml(metaParts.join(" · "));
  const title = escapeHtml(product.name);
  const description = escapeHtml(product.description || "");
  const price = escapeHtml(`$${(product.priceCents / 100).toFixed(2)}`);
  const ctaHref = `shop-single.html?slug=${encodeURIComponent(product.slug)}`;
  const bgSrc = escapeHtml(product.imageUrl || "");

  // Replaces one attribute's value within whichever single tag matches
  // tagPattern, regardless of where that attribute falls in the tag's
  // attribute order (a plain "...marker[^>]*?attr=" regex silently fails to
  // match, and .replace() silently no-ops, whenever attr happens to appear
  // *before* the marker in the source — as href does on the CTA anchor).
  function replaceAttrInTag(str, tagPattern, attrName, value) {
    return str.replace(tagPattern, (tag) =>
      tag.replace(new RegExp(`${attrName}="[^"]*"`), `${attrName}="${value}"`)
    );
  }

  let result = html
    .replace(/(<section class="hero-slideshow" data-hero-id=")[^"]*(")/, `$1${escapeHtml(product.id)}$2`)
    .replace(/(<p[^>]*data-hero-meta[^>]*>)[^<]*(<\/p>)/, `$1${meta}$2`)
    .replace(/(<h1[^>]*data-hero-title[^>]*>)[^<]*(<\/h1>)/, `$1${title}$2`)
    .replace(/(<p[^>]*data-hero-desc[^>]*>)[^<]*(<\/p>)/, `$1${description}$2`)
    .replace(/(<span[^>]*data-hero-price[^>]*>)[^<]*(<\/span>)/, `$1${price}$2`);

  result = replaceAttrInTag(result, /<a\b[^>]*data-hero-cta[^>]*>/, "href", ctaHref);
  result = replaceAttrInTag(result, /<img\b[^>]*data-hero-bg-img[^>]*>/, "src", bgSrc);

  if (bgSrc) {
    result = result.replace(
      "<!--HERO_PRELOAD-->",
      `<link rel="preload" as="image" href="${bgSrc}">`
    );
  }
  return result;
}

app.get(/^\/([\w-]*\.html)?$/, async (req, res, next) => {
  const pageName = req.path === "/" ? "index.html" : req.path.slice(1);
  const filePath = path.join(SITE_ROOT, pageName);

  let html;
  try {
    html = await fs.promises.readFile(filePath, "utf8");
  } catch {
    return next();
  }
  if (!html.includes(HEADER_MARKER)) return next();

  let headerHtml;
  try {
    headerHtml = await fs.promises.readFile(HEADER_PARTIAL_PATH, "utf8");
  } catch (headerErr) {
    return next(headerErr);
  }

  if (HIDDEN_HEADER_PAGES.has(pageName)) {
    // A class, not an inline style="" — CSP's style-src has no 'unsafe-inline'.
    headerHtml = headerHtml.replace(
      '<header class="site-header">',
      '<header class="site-header u-hidden">'
    );
  }
  headerHtml = await applyNavContexts(headerHtml);

  let page = html.replace(HEADER_MARKER, headerHtml);
  if (pageName === "shop.html") page = await applyShopContext(page, req.query);
  if (pageName === "index.html") page = await applyHeroContext(page);
  res.type("html").send(page);
});

app.use(express.static(SITE_ROOT));

// Single place every route error lands (express-async-errors forwards async
// rejections here too) — without this, an uncaught error is a raw HTML dev
// error page for a page request, or worse, a crash that takes down the
// entire process for every visitor, not just the one bad request.
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  console.error(err);

  let status = err.status || err.statusCode || 500;
  let message = "Something went wrong. Please try again.";

  if (err instanceof multer.MulterError) {
    status = 400;
    message = err.code === "LIMIT_FILE_SIZE" ? "That file is too large." : err.message;
  } else if (err.code === "P2002") {
    status = 409;
    message = `That ${err.meta?.target?.[0] || "value"} is already in use.`;
  } else if (err.code === "P2025") {
    status = 404;
    message = "Not found.";
  } else if (status < 500) {
    message = err.message || message;
  }

  if (req.path.startsWith("/api/")) {
    return res.status(status).json({ error: message });
  }
  res.status(status).send(message);
});

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`ProFit server running at ${process.env.APP_URL || `http://localhost:${PORT}`}`);
});

// Defense against slow-request/slowloris-style abuse: a client that never
// finishes sending headers or a body ties up a connection indefinitely
// otherwise. headersTimeout must stay above requestTimeout (Node
// requirement); both are generous enough for a 50MB resource upload (the
// largest allowed file) to complete on a slow connection.
server.requestTimeout = 2 * 60 * 1000;
server.headersTimeout = 2 * 60 * 1000 + 5000;
