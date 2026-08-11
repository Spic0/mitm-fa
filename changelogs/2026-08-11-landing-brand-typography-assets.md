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

## about.html cleaned to the same standard

The About page carried the same class of content, and in places worse.

**Imagery.** `service/service-image.png` is a PHOTOGRAPH OF A PERSON VAPING,
exhaling vapour, masked into an infinity shape — live on the About page of a
fitness company, beside a "Sign Up & Save 25%" heading. `bg/about-bg.jpg` is
vape smoke, used as that section's background. Four more grey dimension
placeholders: `about-image.jpg` ("945X726"), `testimonial1/2.png` ("427X371"),
`blog-image2/3.png` ("457X431"), `blog-image-sm.png` ("400X260").

**Fabricated testimonials — deleted, not restyled.** A "Customers Speak for Us"
slider carried two five-star reviews attributed to "Kenneth S. Fisher, marketing
manager" and "Francis A. Cote, Garden Maker", both quoting the same block of
Lorem Ipsum. Invented by the theme author. Fabricated reviews with star ratings
are false statements about real people's opinions and are specifically
prohibited in the UK/EU (DMCC Act 2024; UCPD Annex I). There is no review model,
so there is nothing to render honestly in their place.

**False commerce claims** for a business that sells downloads: "Free delivery —
For all orders above $45"; "180 Days Return — money back guranry" [sic], a
policy nothing backs and whose footer link goes to /coming-soon; "Top-notch
support — sayhello&gazacom", a corrupted placeholder email; "Sign Up & Save 25%".
Replaced by four statements the codebase can back.

**A tourism video.** The lead image's play button opened
`youtube.com/watch?v=Cn4G2lZ_g2I` — "Bangladesh In 4K - Land of Natural Beauty |
Scenic Relaxation Film", left in by the theme author.

**A duplicated article.** The blog teaser's two slides were the same post twice.
It now lists three real, distinct articles from /blog, with no thumbnails at all
rather than dimension placeholders — a text list is an honest teaser, a grey box
with its own pixel size printed on it is not.

**Shared, not copied.** `.eyebrow`, `.landing-slot` (and its branded empty
state) and the `.trust-*` band moved out of `home-dynamic.css` into
`assets/css/brand-blocks.css`, which both pages load; the trust renderer moved
into `assets/js/trust-stats.js`. The homepage passes its already-fetched data to
`TrustStats.render()`; About carries `data-trust-autoload` and fetches for
itself, so neither page requests the catalog twice.

New slot `about-lead` (1200x900, 4:3) replaces the "945X726" placeholder.

## Landing page closing section: trust band -> customer value

The homepage's trust band (counted plans / coaches / sports) is replaced by
"Everything you need to follow the plan."

The numbers were real, but they answered the wrong question. The landing page's
audience is the person deciding whether to BUY a plan, not a coach deciding
whether to publish one — and creator-side proof tells that visitor nothing about
what they receive or how they use it. The section now exists to reduce purchase
uncertainty: four numbered benefits (program / guidance / supporting material /
access) under a plain-language promise, ending in "Find Your Program".

No counts, no testimonials, no trust claims. Every line describes the product.

**The preview is drawn in CSS, not an image.** It costs no request and no bytes,
stays sharp at any density, and cannot go stale the way a screenshot would. Its
structure mirrors the real program viewer — week/day crumb, exercise name, a
`sets × reps` pill, a demo thumbnail — matching `trainingContent` in
`server/prisma/schema.prisma` and `.pg-ex__reps` in `assets/css/program.css`.
The third row fades so the card reads as a crop of something longer. It is
`aria-hidden`: it illustrates the interface, and a screen reader announcing three
illustrative exercise names as a real program would be misleading.

Two layout bugs found while measuring, both invisible until checked:

- The section ran **236% of viewport height at 320x568**. The largest single
  cause was stacking the number above its title, which cost a line per item
  (~108px across four). Setting them on one line — as the brief writes them,
  "01 YOUR PROGRAM" — plus tighter padding took it to 203% (128% at 390px).
- Body copy sat **11px lower in two of the four columns**. Each item stretches
  to the tallest sibling and a grid's `auto` rows soak up that leftover,
  inflating row 1 on the items with shorter copy. `align-content: start` collects
  the slack at the bottom instead. A second, narrower case: at 992-1100px the
  longest label wraps to two lines while the others do not, so the title box is
  reserved at two lines across the 4-up range.

Measured across 320/375/390/430/768/1024/1280/1440/1920: no horizontal overflow,
nothing clipped, CTA 48px tall at every width (>= 44px tap target), columns
stepping 1 -> 2 (600px) -> 4 (992px), no console errors.

**about.html keeps its trust band.** It was not in scope for this change, and
that page's context is different — it is partly about the company. The shared
`.trust-*` styles and `assets/js/trust-stats.js` therefore stay; only the
homepage's copy of the section is gone, and index.html no longer loads
trust-stats.js.

## Hero rebuilt: blurred backdrop -> sharp product deck

The hero used each product cover as a full-bleed background at
`filter: blur(22px) brightness(0.55)` under a dark scrim, with six text
elements stacked over it: a badge, a creator/category meta line, the product
name as the `<h1>`, a description, a price and a CTA.

Two faults compounded. That much blur destroys the product, so showing products
achieved nothing — and the `<h1>` was a PRODUCT NAME that swapped every six
seconds, so the page never stated what the business is.

Now: one fixed headline ("Train with a plan."), one supporting line, one CTA,
and the products as SHARP CARDS that are the dominant visual. Depth comes from
scale and opacity on the two flanking cards. The active card is never blurred,
never dimmed and never scaled down. The surface is the brand's own light ground,
so the cards are the sharpest thing in the section.

Text elements in the hero: six -> three.

**Still fully dynamic.** Same data (featured products, falling back to newest
published), same server-rendered first card for crawlers/no-JS, same
`data-hero-id` handshake. Only the presentation changed.

**Media.** Each card's image is built by `MediaContainer.build()` — the same
container every product grid uses — so the hero gets AVIF/WebP srcset, the LQIP,
the server-decided fit mode and intrinsic dimensions without a second
implementation. `sizes` now describes a ~320-420px card instead of `100vw`; the
old code deliberately pinned `src` to the WIDEST derivative because the image
was full-bleed, which would now over-fetch by roughly 4x on a phone.

Images are attached only for the active card and its two neighbours, and
stripped again on the way out — so a catalog of 300 featured products still
means three hero images. Measured: 3 of 5 cards hold images at any moment.

Four bugs found by measuring:

- **The `<h1>` was hidden behind the header.** `.site-header` is `position:
  fixed` at 65px (mobile) / 42px (desktop), and the hero is the first element in
  `<main>`, so its top padding is the only thing keeping the headline clear. At
  20px the headline was overlapped by 34-45px on every phone tested.
- **The flanking cards caused horizontal overflow** — 10 escaping elements at
  320px, 5 at 1024-1440. The section now clips, and the desktop overhang is
  scaled per breakpoint (20% at 992-1199, 34% above) so the preview tucks
  behind the active card instead of being sheared at the viewport edge.
- **The headline reflowed when Inter loaded.** Inter is self-hosted with
  `font-display: swap` and was never preloaded, so the `<h1>` painted in the
  fallback, then dropped from three lines to two — moving the whole hero up
  34px. That was the page's largest layout shift. Preloading the 700 weight
  (24KB) removed it: CLS at 390px went 0.0597 -> 0.0151, and what remains is
  the people/deal strips, not the hero.
- **Vector covers were inset 6%** by the grid preset, which is right in a 280px
  card and just makes the product smaller in a hero. 2% here. Contained RASTER
  covers keep their blurred backdrop untouched — program covers carry their
  title in the artwork, which is why the server chose `contain` for them and why
  cropping them would cut the name off.

Measured at 320/375/390/430/768/1024/1280/1440/1920: no header overlap, no
horizontal overflow, CTA fully above the fold at every width, 60-100% of the
first card visible in the first viewport, hero 599-821px tall, no console
errors, no broken images.

Throttled (Chrome DevTools network emulation): FCP 192-256ms and LCP 420-908ms
on both 20/10 Mbps and 10/2 Mbps, with the whole deck costing 38-64KB.

Rotation verified advancing past the third slide (the old Swiper bug), and
`prefers-reduced-motion` stops it outright rather than merely speeding it up.

## Not changed
- `assets/images/footer/footer-bg.jpg` — smoke artwork, 18 pages.
- `assets/css/critical.css` — regeneration not required; no `style.css` rule
  changed, and the new rules live in `home-dynamic.css`, which is already
  render-blocking.
