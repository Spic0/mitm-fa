# Changelog

All notable changes made to this project since the original working version
are documented in this file. This snapshot marks a fresh version-control
history (`Initial Production Release - Digital Training Platform v1.0`); the
sections below describe what changed in the code itself between that
original version and this release.

## New Features

- Full **taxonomy system** (`server/src/lib/taxonomy.js`, `server/src/routes/taxonomy.js`,
  `server/src/routes/admin/taxonomy.js`): three admin-managed navigation/
  categorization trees — Shop by Goal, Browse Athletes, Browse Creators —
  backing both storefront navigation and per-product tagging.
- **Product recommendations engine** (`server/src/lib/recommendations.js`,
  `server/src/routes/recommendations.js`): classifies products (training vs.
  nutrition content) to power "customers also bought"-style cross-sell.
- **Admin Navigation panel** (`assets/js/admin/navigation.js`): CRUD UI for
  the taxonomy trees, reloading the full tree after every mutation to keep
  ordering/nesting always correct.
- **Signed, short-lived download tokens** (`server/src/lib/signedDownload.js`):
  HMAC-signed tokens that narrow a leaked download URL's useful lifetime from
  the full 30-day session window down to minutes.
- **Per-product demo media uploads** (GIF/image/short video), stored under
  `server/storage/media/<productId>/` and served only to entitled customers.
- **Stripe webhook event deduplication** (migration
  `20260710093904_add_webhook_event_dedup`): prevents duplicate order
  fulfillment from webhook retries.
- **Per-account login lockout** (`server/src/lib/loginAttempts.js`):
  progressive backoff after repeated failed logins for one email, independent
  of IP-based rate limiting.
- Product content model expanded with `difficulty`, `durationWeeks`,
  `overview`, `bonusNotes`, structured `trainingContent`/`nutritionContent`,
  and freeform SEO tags.

## UI / UX

- Homepage rebuilt around **live CMS data**: a people marquee and "Shop by
  Athlete & Creator" strip, and a real-product "deal cards" strip
  (`assets/js/home-dynamic.js`, `assets/css/home-dynamic.css`) — none of it
  hardcoded, all sourced from `GET /api/products` + `GET /api/taxonomy`.
- Header/mega-menu (`partials/header.html`, `assets/js/nav-featured.js`)
  rebuilt to render Shop-by-Goal links and Browse-Athletes sport columns from
  live taxonomy data instead of static markup.
- `shop.html`, `shop-single.html`, and `shop-2.html` had roughly 430 lines of
  hardcoded product markup removed in favor of data-driven rendering.

## Hero Section

- Replaced the static hero with a fully dynamic, CMS-driven homepage
  slideshow: server-renders the first slide for SEO/no-JS visitors, then
  hydrates and rotates through the rest client-side
  (`assets/js/hero-slideshow.js`).
- Selection logic: shows every **featured** product if any exist, otherwise
  falls back to every published product (newest first) — never empty on a
  fresh catalog.
- **Fixed:** the slideshow advanced once and then froze permanently. Root
  cause: the vendored Swiper 8.3.2 library's `effect: "fade"` only animates
  correctly between physically-adjacent slides; both autoplay's own
  wrap-to-first-slide step and `loop: true`'s slide-realignment are
  non-adjacent jumps, so the transition's completion event never fired,
  permanently wedging Swiper's internal autoplay state. Replaced with a
  small dependency-free manual carousel (index + modulo wraparound,
  self-rescheduling timer, CSS opacity crossfade) that isn't subject to the
  bug.
- **Fixed:** the hero was hard-capped to a maximum of 6 slides regardless of
  how many products qualified. The cap is removed — the hero now scales to
  however many products are eligible.
- Preloads only the current and next slide's image; the rest lazy-load, so
  performance doesn't degrade as the catalog grows.

## CMS

- Taxonomy nodes are fully admin-manageable (create, rename, reorder,
  nest) and drive both storefront navigation and per-product categorization.
- Products can be tagged against any number of taxonomy nodes
  (`ProductTaxonomy`), enabling `shop.html` to filter by goal, sport/athlete,
  or creator.
- SEO/search keyword tags added as a field separate from taxonomy, so they
  never affect storefront navigation/filtering.

## Admin Dashboard

- New **Navigation** management panel for the taxonomy trees.
- Product creation/edit wizard significantly expanded (upload flows for
  cover image, thumbnail, resources, and demo media; taxonomy tagging;
  training/nutrition content editing).
- All admin upload flows (product images/resources/media, site logo) now
  run through content-verified upload handling rather than trusting the
  client-supplied file type.

## Product Management

- Upload pipeline rewritten end-to-end: files are written under a random
  UUID filename (never the client's original filename) and then verified
  against their real, magic-byte-sniffed content type before being
  accepted — closing a spoofed-`Content-Type` upload path.
- SVG uploads are rejected outright for logos/images (an SVG can carry
  script/event-handler content and was being served directly from the
  public webroot).
- Product resources (PDFs, Office docs, zips, images) are never served
  inline — only as downloads — and are now also content-verified.

## Navigation

- Header mega-menu and shop filtering are now generated from live taxonomy
  data instead of hardcoded HTML.
- **Fixed:** a taxonomy/database load failure (e.g. `DATABASE_URL` unset or
  DB unreachable) used to 500 the entire storefront shell. Taxonomy loading
  used by the storefront now degrades gracefully to empty nav sections
  instead of failing the whole page. Admin/API taxonomy routes are
  unaffected and still surface real errors.

## Authentication

- Login and magic-link endpoints are now rate-limited by IP
  (`server/src/middleware/rateLimit.js`).
- Changing an **existing** password now requires re-entering the current
  password first, so a hijacked session cookie alone can't be used to plant
  a permanent password and retain access after the real owner signs out.

## Security

- **CSRF protection** added via a signed double-submit cookie
  (`server/src/lib/csrf.js`, `server/src/middleware/csrf.js`): the CSRF
  cookie value is an HMAC of the session's own token, so it needs no
  database row and automatically rotates with the session.
- **Credential-stuffing defenses**: IP-based rate limiting on
  auth-adjacent endpoints plus independent per-account failed-login
  backoff.
- **Signed, time-limited download tokens** narrow the exposure window of a
  leaked download URL from the length of a session to minutes.
- **Real upload content verification**: every uploaded file (product
  images, resources, demo media, site logo) is sniffed for its actual
  magic-byte file type after upload and rejected/deleted if it doesn't
  match the declared type — closing a spoofed-`Content-Type` attack
  surface that a fast-fail `fileFilter` alone doesn't cover.
- **SVG uploads blocked** for any image served from the public webroot
  (logo, product images) — regex-based SVG sanitization is a known-weak
  control, so raster formats only.
- **Stripe webhook idempotency**: duplicate webhook deliveries no longer
  risk double-fulfilling an order.

## Performance

- Hero slideshow preloads only the current and next product image and
  lazy-loads the rest, so load cost stays flat regardless of catalog size.
- Manual hero carousel avoids the extra DOM churn of a slider library's
  loop-mode slide duplication.

## Bug Fixes

- Fixed a preloader overlay (`.loading`) that only ever faded its opacity
  and never set `visibility`/`pointer-events`, letting its full-width
  fixed-position band silently block clicks anywhere on the page
  indefinitely after load.
- Fixed cart-drawer "you might also like" cards not being wired to
  navigate like the rest of the product grid.
- Fixed storefront pages returning a generic 500 whenever taxonomy/DB
  loading failed, instead of degrading gracefully.
- Fixed the hero slideshow freezing permanently after its second slide
  (see Hero Section above).
- Fixed the hero slideshow being hard-capped at 6 products regardless of
  catalog size (see Hero Section above).

## Refactoring

- `shop.html`, `shop-single.html`, and `shop-2.html` stripped of hardcoded
  product markup in favor of dynamic, data-driven rendering.
- Upload filename scheme unified and replaced across products, resources,
  media, and the site logo: from a timestamp + sanitized-original-name
  scheme to random UUID filenames, decoupled entirely from client-supplied
  names.
