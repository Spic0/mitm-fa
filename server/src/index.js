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
const accountRoutes = require("./routes/account");
const stripeWebhookRoutes = require("./routes/webhooksStripe");
const paypalWebhookRoutes = require("./routes/webhooksPaypal");
const configRoutes = require("./routes/config");
const adminRoutes = require("./routes/admin");
const taxonomyRoutes = require("./routes/taxonomy");
const demoRoutes = require("./routes/demo");
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

// Payment configuration is reported at boot rather than left to be discovered
// by a customer at the moment they try to pay. Deliberately a warning and not
// a throw: the storefront, library and admin are all perfectly usable without
// payments configured, and refusing to boot would turn a checkout
// misconfiguration into a total outage. The routes themselves answer 503 with
// customer-facing copy, and the checkout UI marks the method unavailable.
function reportPaymentConfig() {
  const missing = [];
  if (!/^sk_(test|live)_/.test(process.env.STRIPE_SECRET_KEY || "")) missing.push("STRIPE_SECRET_KEY");
  if (!/^pk_(test|live)_/.test(process.env.STRIPE_PUBLISHABLE_KEY || "")) missing.push("STRIPE_PUBLISHABLE_KEY");
  if (!/^whsec_/.test(process.env.STRIPE_WEBHOOK_SECRET || "")) missing.push("STRIPE_WEBHOOK_SECRET");
  if (missing.length) {
    console.warn(`[payments] Stripe is NOT operational — missing/invalid: ${missing.join(", ")}`);
  } else {
    const live = process.env.STRIPE_SECRET_KEY.startsWith("sk_live_");
    console.log(`[payments] Stripe configured (${live ? "LIVE" : "test"} mode)`);
  }

  if (!process.env.PAYPAL_CLIENT_ID || !process.env.PAYPAL_CLIENT_SECRET) {
    console.warn("[payments] PayPal is NOT operational — missing PAYPAL_CLIENT_ID / PAYPAL_CLIENT_SECRET");
  } else if (!process.env.PAYPAL_WEBHOOK_ID) {
    // Without this the PayPal webhook fails closed on every delivery, so a
    // buyer whose browser never returns after approving is never fulfilled —
    // the exact gap the webhook exists to cover. Worth its own line.
    console.warn("[payments] PayPal webhook DISABLED — PAYPAL_WEBHOOK_ID is not set");
  } else {
    const sandbox = (process.env.PAYPAL_API_BASE || "").includes("sandbox");
    console.log(`[payments] PayPal configured (${sandbox ? "sandbox" : "LIVE"} mode)`);
  }

  // A live Stripe key against a sandbox PayPal base (or vice versa) means one
  // provider is taking real money and the other is not — always a
  // misconfiguration, and invisible until someone reconciles the books.
  const stripeLive = (process.env.STRIPE_SECRET_KEY || "").startsWith("sk_live_");
  const paypalLive = process.env.PAYPAL_CLIENT_ID && !(process.env.PAYPAL_API_BASE || "").includes("sandbox");
  if (process.env.PAYPAL_CLIENT_ID && process.env.STRIPE_SECRET_KEY && stripeLive !== paypalLive) {
    console.warn("[payments] MODE MISMATCH — Stripe and PayPal are not both in live mode. Check STRIPE_SECRET_KEY and PAYPAL_API_BASE.");
  }

  // The secret and publishable keys must be from the same mode. A live secret
  // paired with a test publishable key (easy to do when copying them across
  // one at a time) fails at the browser AFTER the PaymentIntent already
  // exists, so it looks like an intermittent client bug rather than a
  // configuration error.
  const skMode = /^sk_(test|live)_/.exec(process.env.STRIPE_SECRET_KEY || "");
  const pkMode = /^pk_(test|live)_/.exec(process.env.STRIPE_PUBLISHABLE_KEY || "");
  if (skMode && pkMode && skMode[1] !== pkMode[1]) {
    console.warn(
      `[payments] STRIPE KEY MODE MISMATCH — secret key is ${skMode[1]} but publishable key is ${pkMode[1]}. Payments will fail in the browser.`
    );
  }

  // Running production against test/sandbox credentials takes no real money
  // while looking completely healthy — orders appear, entitlements are
  // granted, and nothing is ever settled. It must never be a silent state.
  if (process.env.NODE_ENV === "production") {
    if (skMode && skMode[1] === "test") {
      console.warn("[payments] NOT TAKING REAL MONEY — NODE_ENV=production but STRIPE_SECRET_KEY is a TEST key.");
    }
    if (process.env.PAYPAL_CLIENT_ID && (process.env.PAYPAL_API_BASE || "").includes("sandbox")) {
      console.warn("[payments] NOT TAKING REAL MONEY — NODE_ENV=production but PAYPAL_API_BASE points at sandbox.");
    }
  }
}
reportPaymentConfig();

// Transactional email is reported the same way, and for a sharper reason than
// it looks: magic-link sign-in is the ONLY way a customer can get back into
// their account after the purchase session ends (a password can be set, but
// only from inside an already-authenticated session, so a first-time buyer
// never has one). If Resend is misconfigured, the purchase receipt AND the
// sign-in link both vanish — and Resend's SDK resolves with an { error }
// object rather than throwing, so nothing anywhere would say so. That
// combination means a customer can pay, close the tab, and be permanently
// locked out of what they bought, with no error surfaced to anyone.
//
// A real key is "re_" plus ~33 characters; the placeholder that shipped in
// .env.example is far shorter, which is the case actually seen in production.
function reportEmailConfig() {
  const key = process.env.RESEND_API_KEY || "";
  if (!key) {
    console.warn("[email] DISABLED — RESEND_API_KEY is not set. Receipts and magic-link sign-in will NOT be delivered.");
  } else if (!/^re_/.test(key) || key.length < 30) {
    console.warn(
      `[email] RESEND_API_KEY looks like a placeholder (length ${key.length}, expected ~36). ` +
        "Receipts and magic-link sign-in will silently fail — customers will be unable to sign back in after purchase."
    );
  } else {
    console.log("[email] Resend configured");
  }
}
reportEmailConfig();

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

// Per-request CSP nonce. This exists for ONE reason: PayPal's SDK injects its
// own <style> elements into OUR document — the rules that position the button's
// iframes (`> iframe { position: absolute; top: 0; left: 0; width: 100%;
// height: 100% }`, `.component-frame { z-index: 100 }`, `.invisible { opacity:
// 0; pointer-events: none }`) and the whole of the overlay it shows while its
// popup is open (`position: fixed; z-index: 2147483647; width: 100vw; height:
// 100vh` plus its show/hide keyframes). Under `style-src 'self'` every one of
// them is blocked. Measured on production before this change: three
// securitypolicyviolation events on /checkout, all `style-src-elem`,
// `blockedURI: "inline"`, `sourceFile: https://www.paypal.com/sdk/js` — and the
// button host measured `position: static` with its iframes `position: static`
// stacked in normal flow instead of overlaid, while the overlay measured
// `position: static; z-index: auto`, transparent, 158px tall in page flow
// rather than a fixed full-viewport layer.
//
// The consequence that matters: that overlay is the ONLY thing telling a
// shopper "we opened a PayPal window" and the only way back to it if their
// browser did not raise it. Unstyled, it is invisible, so a popup sitting
// behind the main window is indistinguishable from a broken one.
//
// A hash won't work — every rule is keyed by a per-render zoid uid, so the
// content differs on every page view. 'unsafe-inline' on style-src would work
// but would relax the policy for the whole document. The nonce is the narrow
// option and the one PayPal documents: their SDK reads `data-csp-nonce` off its
// own <script> tag and stamps the value onto everything it injects, so ONLY
// PayPal's blocks are permitted and any injected style we did not author is
// still refused. assets/js/checkout-payments.js reads the value back out of the
// <meta name="csp-nonce"> that routes/pages.js renders.
const crypto = require("crypto");
app.use((req, res, next) => {
  res.locals.cspNonce = crypto.randomBytes(16).toString("base64");
  next();
});

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
  scriptSrc: [
    "'self'",
    "https://js.stripe.com",
    "https://www.paypal.com",
    (req, res) => `'nonce-${res.locals.cspNonce}'`,
  ],
  styleSrc: ["'self'", (req, res) => `'nonce-${res.locals.cspNonce}'`],
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
    // 'self': the Partner Profiles wizard previews a profile by framing the
    // REAL public page at /partners/:slug, which is the whole point — a
    // preview rendered by separate code would be a second renderer to keep in
    // step with the first. This permits framing THIS origin only; it grants
    // no third party anything, and frameAncestors below (unchanged, 'self')
    // still governs who may frame us.
    "'self'",
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
    // Helmet 8 defaults this to `same-origin`, which SILENTLY BREAKS PAYPAL.
    // PayPal's SDK (zoid) opens a popup and then drives it — it navigates the
    // window it opened and talks to it over the opener relationship. Under
    // `same-origin`, navigating that popup to paypal.com puts it in a new
    // browsing context group and the browser severs the link in both
    // directions, so the window the shopper is looking at stays on
    // about:blank forever. Measured on production: `checkoutnow` returned
    // 200 and PayPal's app booted (it even fired UL_CHECKOUT_INPUT_EMAIL),
    // while the visible popup reported `window.opener === null`, an empty
    // body, and a url of about:blank. It reproduced in Chrome, Brave and
    // Firefox alike, because all three implement COOP.
    //
    // `same-origin-allow-popups` is the value written for exactly this case:
    // it keeps this document isolated from any opener that tries to reach IN
    // (the protection COOP exists for), and only preserves the relationship
    // with popups WE open. Stripe is unaffected either way — the Payment
    // Element is an iframe, not a popup — so this is not a trade of one
    // provider against the other.
    crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  })
);

// Gzip every compressible response (HTML, CSS, JS, JSON) — neither this app
// nor the nginx reverse-proxy in front of it (a plain proxy_pass with no
// gzip directive) were compressing anything, so every asset was going out
// at full uncompressed size on every request.
app.use(compression());

// Both providers verify their webhook signature against the exact bytes they
// sent, so these must be mounted before the global express.json() below.
// Neither goes through cookieParser/attachUser either, which is why both are
// out of scope for CSRF — they're authenticated by provider signature, not by
// an ambient cookie.
app.use("/api/webhooks/stripe", express.raw({ type: "application/json" }), stripeWebhookRoutes);
app.use("/api/webhooks/paypal", express.raw({ type: "application/json" }), paypalWebhookRoutes);

app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use(attachUser);
app.use("/api", csrfProtection);

app.use("/api/auth", authRoutes);
app.use("/api/products", productsRoutes);
app.use("/api/contact", require("./routes/contact"));
app.use("/api/checkout", checkoutRoutes);
app.use("/api/library", libraryRoutes);
// The customer's own record. account.js applies requireAuth to its own
// router (same as library.js), so the guard travels with the routes rather
// than living in the mount line where it is easy to lose in a refactor.
app.use("/api/account", accountRoutes);
app.use("/api/config", configRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/taxonomy", taxonomyRoutes);
// Public, and deliberately not under /api/library: that router requires a
// session and an entitlement for everything it serves. This is one narrow
// window onto a server-sliced sneak peek of ONE paid program — see
// src/lib/demo.js for the slice and why it is enforced there and not in CSS.
app.use("/api/demo", demoRoutes);
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

// The express.static mount at the bottom is rooted at the whole REPO root
// (SITE_ROOT), not a public-assets subdirectory — so without these guards it
// happily serves the backend itself (server/), the build tooling (tools/),
// the VCS metadata (.git/), and internal security docs. That is a full
// source + git-history disclosure on a production host. Same guard pattern as
// /partials and /private above; `dotfiles:"deny"` on the static handler is
// the paired half that closes .git/* (send@0.19.2's legacy dotfile handling
// only checks the LAST path segment, so /.git/config would otherwise be
// served even though /.gitignore is not).
app.use(
  ["/server", "/tools", "/.git", "/SECURITY_AUDIT.md", "/INCIDENT_RESPONSE.md"],
  (req, res) => res.sendStatus(404)
);

// /.well-known/ — domain-verification files that a third party fetches over
// plain HTTP to prove we control this domain.
//
// This needs its own mount because the static handler below sets
// `dotfiles: "deny"`, which is what closes /.git/* and /.env — and it closes
// every dot-prefixed path with them, including this one. Apple Pay is the
// live case: Stripe verifies the domain by fetching
//   /.well-known/apple-developer-merchantid-domain-association
// and without this route that request 404s, so Apple Pay simply never
// appears in the Payment Element and nothing anywhere reports why.
//
// Deliberately narrow, so it reopens exactly one directory and not the
// dotfile rule in general: it serves ONLY files that already exist in
// SITE_ROOT/.well-known, with no directory listing and no index. Anything not
// placed there by hand still 404s.
app.use(
  "/.well-known",
  express.static(path.join(SITE_ROOT, ".well-known"), {
    dotfiles: "ignore",
    index: false,
    // These files are re-fetched by the verifying party on their own
    // schedule; a long cache would strand a rotated file.
    setHeaders: (res) => res.setHeader("Cache-Control", "public, max-age=300"),
  })
);

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
    // Closes every dotfile-containing path (.git/*, .env, ...). Without this,
    // express.static leaves `dotfiles` unset, which in send@0.19.x falls back
    // to legacy handling that only inspects the final path segment — serving
    // /.git/config while hiding /.gitignore. "deny" 403s them all.
    dotfiles: "deny",
    setHeaders: (res, filePath) => {
      // express.static -> send@0.19 resolves types with mime@1.x, whose table
      // predates AVIF, so every .avif falls through to
      // `application/octet-stream`. Combined with the nosniff header this app
      // sets, that is a mislabelled image the browser is explicitly told not
      // to re-interpret — and AVIF is the FIRST <source> in every <picture>
      // the media pipeline emits, so it is the variant most browsers pick.
      // Verified against production before changing: every AVIF derivative on
      // the live site is currently served as octet-stream.
      //
      // Set before the cache branches below so it applies to derivatives and
      // any hand-placed .avif alike.
      if (/\.avif$/.test(filePath)) {
        res.setHeader("Content-Type", "image/avif");
      }

      // Raster images are embeddable from other origins. helmet's default
      // Cross-Origin-Resource-Policy is `same-origin`, which is right for
      // this app's documents but wrong for the images in a transactional
      // email: a mail client renders our logo and product covers from a
      // different origin by definition, and a CORP-enforcing client blocks
      // them outright (Chrome reports ERR_BLOCKED_BY_RESPONSE.NotSameOrigin,
      // and the customer sees a broken image where the brand should be).
      // These files are already public and unauthenticated; CORP governs
      // embedding, not access, so relaxing it here grants nothing new.
      //
      // Deliberately NOT extended to .svg: uploaded SVG is user-supplied and
      // scriptable, and keeps the stricter treatment set further down. Email
      // never uses SVG anyway — no mail client renders it.
      if (/\.(?:png|jpe?g|gif|webp|avif|ico)$/i.test(filePath)) {
        res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
      }

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
