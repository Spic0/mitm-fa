# Landing Page Brand, Typography & Asset Pass — 2026-08-11

Scope: the homepage (`index.html`, `assets/css/home-dynamic.css`,
`assets/js/home-*.js`) plus the server-side rendering that feeds it
(`server/src/routes/pages.js`). One new subsystem, `landingAssets`, replaces
hardcoded marketing image paths. No schema change, no migration.

The page still runs on the purchased "Odor — Vape Store WooCommerce" theme's
markup. The 2026-08-08 branding pass replaced the logo and favicons; this pass
removes the remaining theme content that was still being served to customers.

## Template remnants removed from the homepage

Every item below was **live in production** before this change.

### Placeholder images with dimensions painted into them

The theme ships grey PNG/JPEGs with their own size as the artwork. Four were
still on the homepage:

| File | Renders as | Was used for |
|---|---|---|
| `assets/images/shop/get-image.png` | grey box reading **410X432** | product showcase slide 1 |
| `assets/images/shop/get-image2.png` | grey box reading **410X432** | product showcase slide 2 |
| `assets/images/shop/get-bg.png` | grey box reading **520X520** | showcase backdrop |
| `assets/images/view/view-image1.jpg` | grey box reading **690X281** | large promo tile |
| `assets/images/view/view-image2.jpg` `view-image3.jpg` | grey box reading **240X276** | two small promo tiles |

### Vape imagery

- `assets/images/bg/view-bg.jpg` — a photograph of **coloured vape smoke**, used
  as the full-bleed background of the promo section. Removed from the homepage.
- `assets/images/footer/footer-bg.jpg` — dark smoke from the same set. **Still in
  use on 18 pages** including this one; left alone as a site-wide change, but
  it is from the same source and should be replaced.

### The orange icon

`assets/images/icon/fire.svg` is a flame filled `#FA4F09`. The site's design
system is monochrome (`--color-text #1a1a1a` on `--color-bg #fafaf9`) with no
accent colour at all, so this was the only chromatic element on the page. It
appeared three times:

1. Hero badge — CSS forced it white (`filter: brightness(0) invert(1)`), so it
   read as a white blob rather than orange.
2. `.off-btn` "GET 25% OFF NOW" in the promo section — rendered orange.
3. `<h4>` "GET 20% OFF YOUR FIRST PLAN" in the showcase section — rendered orange.

All three call sites are gone. The file remains on disk for the unrouted
`index-2*.html` / `index-light*.html` variants.

### Filler copy

- "Sell globally in minutes with localized currencies languages, and experie" —
  truncated theme filler.
- "Whereas recognition of the inherent dignity" — the UDHR preamble, which this
  theme ships as lorem ipsum. Used twice.

## Fabricated offers and data removed

None of these were backed by anything in the database.

- **"50% off" on every deal card.** `home-dynamic.js` stamped a hardcoded
  `50%<br>off` roundel onto every card it rendered, above the product's full,
  undiscounted price. Nothing in the product model expresses a "was" price, so
  there is no honest number to compute a percentage from. Real discounts live in
  the `Promotion` table and are applied at checkout.
- **A countdown that could never expire.** `assets/js/script.js` ran a rolling
  48-hour "HURRY UP! Offer end in:" timer persisted in `localStorage`, which
  re-armed itself forever on expiry. A countdown to a deadline that does not
  exist is a false urgency claim. The block is retained but now guarded on the
  markup existing, so it no longer runs a `setInterval` every second on every
  page of the site writing into elements that are gone.
- **"$79.00 → $49.00"** struck-through pricing matching no product.
- **"Get 20% off your first plan"** (hero) and **"GET 25% OFF NOW"** (promo).
- **Six fake endorsement logos.** The "trusted by athletes & coaches" section
  was a Swiper of `brand1.png`–`brand6.png`, the generic monster/robot marks the
  theme ships as filler, presented as organisations that trust the platform.
- **A "top ratting" tab that was a duplicate of Latest.** No rating model exists,
  so `home-products.js` rendered the identical product array into both tabs. A
  filter that changes its label but not its contents teaches visitors the
  controls do nothing.

## Typography: one capitalization system

Previously the page mixed five conventions arbitrarily — a Title Case
`Latest Plans & Programs` heading sat directly beside lowercase `latest item` /
`top ratting` / `featured products`, and the trust heading was lowercase at base
`<h3>` size with no rule of its own.

| Role | Treatment | Applied |
|---|---|---|
| Section heading | Title Case | in markup |
| Eyebrow / label | uppercase, `letter-spacing: .14em`, muted | `.eyebrow` (CSS) |
| Filter / sort | uppercase, `.1em`, smaller and quieter than the heading | CSS |
| CTA button | Title Case | in markup |
| Body | sentence case | in markup |

Uppercase is applied as **presentation via `text-transform`**, never typed into
the markup, so the DOM text and the accessible name stay readable.

Also fixed: **"top ratting" → "Best Sellers"** (and the `#top-ratting` anchor and
`homeGridTopRated` id renamed to match), and the duplicate second
`Latest Plans & Programs` `<h2>` in the showcase section removed.

The active-tab indicator moved from an absolutely-positioned dot at
`left: 10px; top: 3px` — which lands on top of the first letter once a label is
uppercase and tracked — to an underline.

## New: landing asset slots

`server/src/lib/landingAssets.js` + `tools/build-landing-assets.js`.

Marketing images are no longer paths in the HTML. The template declares empty,
named holes; the server fills them from whatever is in
`assets/images/landing/`:

```html
<div class="landing-slot" data-landing-slot="promo-primary" data-landing-alt="…"></div>
```

Four slots: `promo-primary`, `promo-secondary-a`, `promo-secondary-b` (3:2) and
`showcase` (4:5). Dropping `assets/images/landing/<slot>.<ext>` fills the slot;
deleting the file empties it.

`promo-primary` is the one slot whose shape changes with the viewport — 16:9
while the tiles are stacked, ~0.85:1 on desktop where that tile spans the height
of the two beside it and its media absorbs the spare column height (letting the
BODY absorb it instead left a 634px void under a 467px image). A square source
is therefore what the docs ask for.

- Derivative generation reuses the **product upload pipeline verbatim**
  (`lib/mediaDerivatives.js`) — AVIF + WebP at 320/640/960/1280, LQIP, dominant
  colour, fit decided from real measured dimensions. No second pipeline.
- **No restart needed.** The resolver caches against the directory's mtime and
  invalidates `mediaDerivatives`' manifest cache when it changes — that cache
  stores misses for the process lifetime, which would otherwise pin a newly
  filled slot to "empty" until a `pm2 restart`.
- **An empty slot is a supported state**, rendering the FA mark on a brand
  surface via CSS. This is the rule that replaces "410X432": an unfilled slot
  must look deliberate, never technical, and never like a broken image.
- Aspect ratios live in CSS keyed off the slot name, **not** inline — the
  storefront CSP sends `style-src-attr 'self'`, so a server-injected `style=""`
  is silently dropped.

Operator workflow: `server/docs/landing-assets.md`.

## Sections rebuilt

- **Promo tiles** (was `view-area`) — 3 tiles, images from landing slots, real
  copy, all linking to `/shop`.
- **Featured plan showcase** (was `get-now-area`) — one real product resolved
  server-side (`applyShowcaseContext`), deliberately a *different* product from
  the hero where the catalog allows it. Image cascade: `showcase` landing slot →
  the product's own cover → branded fallback.
- **Trust** (was `brand-area`) — uppercase tracked eyebrow, a real heading, and
  counted stats (plans published / coaches & creators / sports covered) from
  live API data. A stat renders only when its count is ≥ 2, and the whole section
  removes itself if nothing clears that bar — no social proof beats thin social
  proof, and inventing a number is not an option.

## Real bestseller ranking

`getSalesRankMap()` in `lib/recommendations.js` — a 1-based position among
products with at least one paid `OrderItem`, exposed as `bestsellerRank` on
`GET /api/products`.

Deliberately exposes the **order and never the counts**: "best sellers" is a
normal public sort, but how many units a specific plan has sold is private
business data, and once it ships in a JSON payload it is public forever.

Products with no sales carry `null` and are excluded outright rather than sorted
last — "hasn't sold" and "sold least" are different claims. The tab ships
`hidden` and is only revealed when at least 2 products have sold.

## Two bugs found on the way

- **Every AVIF on the site was served as `application/octet-stream`.**
  `express.static` → `send@0.19` resolves types with `mime@1.x`, whose table
  predates AVIF. Combined with this app's `X-Content-Type-Options: nosniff`,
  that is a mislabelled image the browser is told not to re-interpret — and AVIF
  is the *first* `<source>` in every `<picture>` the media pipeline emits.
  Verified against production before changing. Fixed at the static mount.
- **`$0.00` on a free product.** One published, featured product has
  `priceCents: 0`, and the storefront rendered that as `$0.00`, which reads as a
  pricing bug. Added `formatProductPrice()` (server) /
  `ProFitAPI.formatProductPrice()` (client), which render `Free`. Kept separate
  from `formatPrice`, which is for monetary amounts generally (cart subtotal,
  order total) where `$0.00` is correct.

## Testing

`tools/test-landing-responsive.js` — drives a real browser at 320, 360, 375,
390, 414, 430, 768, 1024, 1280, 1440 and 1920px and asserts no horizontal
overflow, no collapsed section, and a non-zero box for every landing slot.

An element wider than the viewport is only reported when **nothing clips it** —
the full-bleed hero backdrop and the product ticker are deliberately oversized
inside `overflow: hidden` ancestors, and reporting those would produce 100+
false positives per width and hide a real regression.

All 11 widths pass. Existing suites (`test-products-pagination`,
`test-admin-api-resilience`, `test-free-access`, `test-media-x-accel`,
`test-handbook-media`, `test-presentation-picker`) still pass.

## Theme homepage variants deleted

`index-2.html`, `index-light.html` and `index-2-light.html` are gone. Nothing
ever linked to them, but all three returned 200 through the static mount, so
they were indexable near-duplicates of `/` — and they still carried every
placeholder, fabricated offer and vape-theme image the homepage had just been
cleaned of.

Each now 301s to `/`, following the same convention as the existing
`/index.html` and `/shop-2.html` redirects: consolidate crawled or bookmarked
URLs onto the one canonical homepage rather than leaving them to 404.

Their removal made the theme's countdown block in `assets/js/script.js` fully
dead — they held the last `#day`/`#hour`/`#min`/`#sec` markup on the site — so
it is deleted rather than left guarded.

Now orphaned on disk, referenced by nothing (kept for now, pending a decision):
`icon/fire.svg`, `shop/get-image.png`, `shop/get-image2.png`, `shop/get-bg.png`,
`view/view-image1-3.jpg`, `bg/view-bg.jpg`. `brand/brand1-6.png` is NOT orphaned
— `about.html` still shows those same filler marks as endorsement logos.

## Not changed
- `assets/images/footer/footer-bg.jpg` — smoke artwork, 18 pages.
- `assets/css/critical.css` — regeneration not required; no `style.css` rule
  changed, and the new rules live in `home-dynamic.css`, which is already
  render-blocking.
