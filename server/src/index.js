require("dotenv").config();
const path = require("path");
const express = require("express");
// Patches Express so a rejected promise inside any async route handler is
// forwarded to next(err) instead of crashing the process as an uncaught
// exception — every route below is `async (req, res) => ...` with no
// try/catch, and Express 4 does not catch those on its own.
require("express-async-errors");
const cookieParser = require("cookie-parser");
const multer = require("multer");
const helmet = require("helmet");
const compression = require("compression");

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
const promotionsRoutes = require("./routes/promotions");
const { router: pagesRouter, render404 } = require("./routes/pages");
const {
  pageRouter: presentationPageRouter,
  apiRouter: presentationApiRouter,
} = require("./routes/presentation");
const { isDevRoutesEnabled } = require("./lib/devMode");

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
  // youtube.com: the video lightbox on about.html/blog.html, and the
  // inline players the purchased-program Videos section builds from
  // ProductResource(type:"link") rows.
  // player.vimeo.com: the same, for Vimeo links. assets/js/program-viewer.js
  // has generated Vimeo embeds since it was written, but without this entry
  // every one of them was silently blocked — a creator who stored a Vimeo
  // bonus video got an empty frame. YouTube and Vimeo are the only two
  // hosts turned into iframes; anything else stays an ordinary link.
  frameSrc: [
    "https://js.stripe.com",
    "https://hooks.stripe.com",
    "https://www.paypal.com",
    "https://www.youtube.com",
    "https://player.vimeo.com",
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

// Gzip every compressible response (HTML, CSS, JS, JSON) — neither this app
// nor the nginx reverse-proxy in front of it (a plain proxy_pass with no
// gzip directive) were compressing anything, so every asset was going out
// at full uncompressed size on every request.
app.use(compression());

// Stripe requires the raw, unparsed body to verify webhook signatures, so this
// must be mounted before the global express.json() below.
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookRoutes);

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(attachUser);
app.use("/api", csrfProtection);

app.use("/api/auth", authRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/contact", require("./routes/contact"));
app.use("/api/checkout", checkoutRoutes);
app.use("/api/library", libraryRoutes);
app.use("/api/config", configRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/taxonomy", taxonomyRoutes);
app.use("/api/recommendations", recommendationsRoutes);
app.use("/api/promotions", promotionsRoutes);
// Anonymous by design (unlock / engagement beacons / enquiry form from a
// link-only deck) — see routes/presentation.js for why that's in scope for
// the rate limiters rather than CSRF.
app.use("/api/presentation", presentationApiRouter);

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

app.use("/partials", (req, res) => res.sendStatus(404));
// private/ holds the private-presentation deck template. It must never be
// reachable through the static mount below — fetching it directly would hand
// out the whole deck without passing the enabled/expiry/password gate in
// routes/presentation.js. Same guard, same reason, as /partials above.
app.use("/private", (req, res) => res.sendStatus(404));

// Private presentations: unlisted, link-only, and mounted BEFORE the static
// handler so /presentation/:slug resolves here rather than 404ing against a
// nonexistent file. Nothing links to these routes from anywhere on the
// public site, and robots.txt disallows the whole path.
app.use(presentationPageRouter);

// Every customer-facing page route (clean paths like /shop, /program/:slug,
// /creator/:slug, ... plus 301 redirects from the old .html/query-param
// URLs) lives in routes/pages.js — see that file for the route table.
app.use(pagesRouter);

// Filenames here aren't content-hashed (no build step), so a long/immutable
// cache would risk serving a stale asset after the next deploy — this is a
// moderate, safe middle ground: real repeat-visit caching without betting on
// a cache-busting scheme this app doesn't have. HTML is excluded entirely
// (route handlers above already send their own responses for every page
// that matters; anything falling through here is revalidated every time).
app.use(
  express.static(SITE_ROOT, {
    setHeaders: (res, filePath) => {
      if (/\.(?:js|css)$/.test(filePath)) {
        // `no-cache` means "revalidate before reuse", NOT "don't store": the
        // browser still keeps the file and still gets a 304 with no body when
        // it hasn't changed, so repeat visits cost one conditional request
        // rather than a full download.
        //
        // The previous `max-age=3600` meant a returning visitor kept running
        // the OLD css/js for up to an hour after a deploy, without even
        // asking whether it had changed — so a shipped fix could look like it
        // had never shipped. With no content hashing and no build step, that
        // is not a trade worth making for CSS and JS specifically; media
        // below is UUID-named and immutable, so it keeps its long cache.
        res.setHeader("Cache-Control", "no-cache");
      } else if (/\.svg$/.test(filePath)) {
        // Uploaded SVG is the one static asset that is user-supplied AND a
        // scriptable document format. lib/svgSanitize.js strips executable
        // constructs at upload time and fails closed, but a sanitizer should
        // never be the only thing standing between an upload and script
        // execution on this origin. These two headers are the layer that does
        // not depend on the sanitizer being perfect:
        //   sandbox          — drops the response into an opaque origin, so
        //                      even a script that survived cannot touch
        //                      cookies, session, or the DOM of fitness.agency
        //   script-src 'none'— nothing executes even when the file is opened
        //                      directly as a top-level document (the only
        //                      context where SVG script runs at all; via
        //                      <img>, which is how the site renders these,
        //                      browsers already refuse)
        //   nosniff          — a mislabelled upload can't be re-interpreted
        //                      as text/html
        res.setHeader("Content-Security-Policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.setHeader("Cache-Control", "public, max-age=86400");
      } else if (/-(?:320|640|960|1280)\.(?:avif|webp)$/.test(filePath)) {
        // Responsive derivatives generated by lib/mediaDerivatives.js. These
        // are genuinely immutable: the source they are cut from is UUID-named
        // and never rewritten in place, and the derivative's own name encodes
        // its width and format. A different image is always a different URL,
        // so there is no staleness risk in caching these for a year — unlike
        // the CSS/JS below, which keep `no-cache` precisely because their
        // filenames are NOT content-addressed and a stale copy after a deploy
        // would mean a shipped fix silently not appearing.
        res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
      } else if (/\.(?:png|jpe?g|webp|gif|ico|woff2?|ttf|mp4|mov|webm)$/.test(filePath)) {
        // Gallery video shares the image bucket: uploaded media is stored
        // under a fresh UUID filename and never rewritten in place, so a
        // repeat visitor re-downloading an autoplaying loop on every page
        // view is pure waste. (express.static answers Range requests here
        // on its own, which is what lets the video scrub and loop.)
        res.setHeader("Cache-Control", "public, max-age=86400");
      } else if (/\.html?$/.test(filePath)) {
        res.setHeader("Cache-Control", "no-cache");
      }
    },
  })
);

// Catch-all 404: anything that fell through every route above and the
// static mount. Previously there was no custom 404 at all — an unmatched
// path fell through express.static to Express's bare-text default
// ("Cannot GET /x"), never the site's actual error.html shell.
app.use((req, res, next) => {
  if (req.path.startsWith("/api/")) return res.status(404).json({ error: "Not found" });
  render404(req, res).catch(next);
});

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
    if (err.code === "LIMIT_FILE_SIZE") {
      // 413, not 400 — this is the same condition nginx reports with a 413
      // when the body exceeds ITS client_max_body_size, and the admin UI keys
      // off the status to explain the size limit. Keeping the two layers on
      // the same status is what makes that message correct wherever the
      // request was actually stopped.
      status = 413;
      message = "That file is too large. The limit is 100MB per file.";
    } else if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      status = 400;
      message = "Too many files in one upload.";
    } else {
      status = 400;
      message = err.message;
    }
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
  console.log(`Fitness Agency server running at ${process.env.APP_URL || `http://localhost:${PORT}`}`);
});

// Promotion notification thresholds (expiry countdowns, usage limits, unused/
// high-sales flags) are evaluated on a timer rather than a real job
// scheduler — this is a single-process pm2-managed app with no existing
// cron/agenda infra, so a dependency-free setInterval is the simplest thing
// that's actually correct here. Runs once at boot too, so a threshold
// crossed while the process was down still surfaces promptly instead of
// waiting up to 30 minutes for the first tick.
const { evaluateAndCreateNotifications } = require("./lib/promotionNotifications");
const NOTIFICATION_CHECK_INTERVAL_MS = 30 * 60 * 1000;
function runNotificationSweep() {
  evaluateAndCreateNotifications().catch((err) => {
    console.error("Failed to evaluate promotion notifications:", err);
  });
}
runNotificationSweep();
setInterval(runNotificationSweep, NOTIFICATION_CHECK_INTERVAL_MS);

// Scheduled publishing, same reasoning as the sweep above: one process, no job
// scheduler, so a timer is the honest implementation. Runs every minute
// because "scheduled for 09:00" landing at 09:29 would be a bug from the
// admin's point of view, and the query is a single indexed-ish scan over a
// handful of rows. Runs at boot too, so anything whose moment passed while the
// process was down goes live immediately on restart rather than never.
//
// Note this only ever moves scheduled -> published. It never un-publishes,
// so an admin who manually publishes early, or flips a scheduled product back
// to draft, is not fought by the timer on its next tick.
const { prisma: schedulerPrisma } = require("./db");
const { logEvent: logSchedulerEvent } = require("./lib/adminLog");
const PUBLISH_CHECK_INTERVAL_MS = 60 * 1000;
async function runScheduledPublishSweep() {
  const due = await schedulerPrisma.product.findMany({
    where: { status: "scheduled", publishAt: { lte: new Date() } },
    select: { id: true, name: true },
  });
  for (const product of due) {
    await schedulerPrisma.product.update({ where: { id: product.id }, data: { status: "published" } });
    await logSchedulerEvent({
      category: "product",
      message: `Scheduled publish: "${product.name}" is now live`,
    });
  }
}
runScheduledPublishSweep().catch((err) => console.error("Scheduled publish sweep failed:", err));
setInterval(() => {
  runScheduledPublishSweep().catch((err) => console.error("Scheduled publish sweep failed:", err));
}, PUBLISH_CHECK_INTERVAL_MS);

// Defense against slow-request/slowloris-style abuse: a client that never
// finishes sending headers or a body ties up a connection indefinitely
// otherwise. headersTimeout must stay above requestTimeout (Node
// requirement); both are generous enough for a 50MB resource upload (the
// largest allowed file) to complete on a slow connection.
server.requestTimeout = 2 * 60 * 1000;
server.headersTimeout = 2 * 60 * 1000 + 5000;
