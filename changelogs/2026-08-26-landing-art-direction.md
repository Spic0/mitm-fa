# Montserrat, and an art-direction pass over the landing page

2026-08-26

The brief: the landing page still read as "simple, generic and unfinished",
and the fix was not to move the same elements around again. Four things
changed: the type system, the hero's product presentation, what sections the
page has at all, and the copy in them.

## 1. Montserrat is the platform's one type family

Inter was self-hosted and referenced through two aliases (`--prosto-one`,
`--montserrat`, both pointing at it) left over from the purchased template.
Montserrat now occupies exactly the same architecture, so no call site
changed:

* `assets/fonts/montserrat/` — six latin `woff2` files from
  `@fontsource/montserrat` 5.3.0 (400/500/600/700/800 + 400 italic), the same
  weights the stylesheets actually call for. **124KB, against Inter's 152KB.**
* `@font-face` declared in the four files that declare faces — `style.css`,
  `critical.css`, `presentation.css`, `program.css` — all with
  `font-display: swap`, all local URLs. No `fonts.googleapis.com` /
  `fonts.gstatic.com` anywhere, as before.
* Tokens: `--prosto-one`, `--montserrat`, `--p-font` (deck), `--pg-font`
  (program viewer), the `program-media.css` literal, the `account.css`
  fallback, and `FONT` in `emailLayout.js` + the two inline stacks in
  `email.js`.
* `assets/fonts/inter/` is deleted. Nothing referenced it.

**The hero's font preload was warming the wrong file.** It named
`inter-latin-700`; the headline is set in 800. It now preloads
`montserrat-latin-800-normal.woff2`, which is the face the largest text on the
site actually asks for.

`critical.css` was regenerated from source (`tools/build-critical-css.js`,
which runs now that `postcss` is in `tools/package.json`), so it is also back
in sync with the Bootstrap subset it had drifted from.

## 2. The hero

**The eyebrow is gone.** `Train like` was set at 13px/0.36em tracking above a
68px display line — a small uppercase tag on a big heading, and it demoted the
sentence's verb to a caption, so what a visitor actually read was
"THE ONES YOU FOLLOW". Both spans are now the same size, weight and colour;
the split only controls where the line breaks (three lines on a phone, the
`TRAIN LIKE / THE ONES YOU FOLLOW` lockup from 1200px up).

**The desktop headline is sized in `cqi`, not `vw`.** The long line has to fit
the copy COLUMN, and the column is a fraction of a max-width container, not of
the viewport. Sized in `vw` it overflowed: measured at 1280, the headline took
917px and left the STAGE 116px — an `fr` track's automatic minimum is its
content's min-content width, so a too-wide headline silently eats the other
column. Fixed with `min-width: 0` on the copy column and `min(8.35cqi, 78px)`
on the headline, which lands the long line flush with the column's right edge
at every width from 1200 up.

**The product is an object, not a card.** The plate used to paint a
`--color-surface-2` mount, a 7%-black inset hairline, a 3px radius and a
three-part `box-shadow`. Covers are 4:5 and 5:7 against a 3:4 box, so that
mount showed as pale bands above and below every cover: a white frame with a
rounded corner and a shadow. Now:

* the box paints nothing and clips nothing (`--pmedia-bg: transparent`,
  `overflow: visible`, no border, no shadow, no radius);
* the shadow moved onto the `<img>` as two `drop-shadow()`s, which trace the
  artwork's real alpha rather than the rectangle around it;
* the blurred `.pmedia__backdrop` is off — with no letterbox to fill, all it
  could do was redraw the frame in blur;
* the reserved box is 4:5, which is what the covers in the catalogue measure;
* `object-position: 50% 100%` puts every cover on one baseline, so the gap
  between the product and its caption no longer changes from product to
  product.

**The neighbours are legible.** 0.26 opacity + 1px blur on a #fafaf9 ground
washed a dark cover out to a pale ghost that read as broken. Now 0.55 and no
blur on a phone, 0.52 and 0.5px on the depth stage. Dominance is carried by
the sliver, not the dimming: the widest neighbour still shows 12% of the
active card (harness ceiling 30%).

**The CTA row is a row.** Two full-bleed pills, 56px and 50px tall, stacked,
came to 120px of solid button under a 76vw product, and pushed the secondary
past the fold at 390x844. One row now: primary takes the free space, secondary
takes its label. Both stay >= 44px tall down to 320px, and the row costs 48px.

**Fold, measured, `Explore Programs` + `See Demo` fully visible:** 320x568,
360x640, 375x667, 390x844, 414x896, 430x932, 768x1024 and every desktop width.
Two short-screen tiers make that true: under 700px of height the supporting
line is dropped, under 660px the headline steps down and the plate gives up
~40px.

## 3. Sections: two removed, one replaced, one moved

* **REMOVED — the "Featured Programs" deal-card rail.** It rendered the same
  four products, with the same covers and the same prices, as the product grid
  one screen below. The homepage was listing the catalogue twice under two
  headings. The grid stayed because it lists every plan and carries Add to
  Cart.
* **REPLACED — the three promo tiles.** All three linked to plain `/shop`, so
  three tiles offered one choice; their goal names matched nothing in the
  taxonomy, so they could not filter even in principle; and each was mostly a
  `data-landing-slot` image, and those slots are **empty in production** —
  the section rendered as ~1,390px of grey placeholder. In its place is a
  server-rendered index of the real `goals` taxonomy with real product counts,
  linking to the real `/goal/<slug>` listings. No images, no fetch, no CLS.
* **MOVED — the program preview is now the first section after the hero**,
  which is where the evidence belongs and where the hero's `See Demo` points.
* **De-templated the product grid**: the `.title-icon` dot before the heading
  is gone, and so is `pt-130 pb-130 mt-130` (130px of padding on top of a
  130px margin, i.e. 260px above one grid, against the clamp(48px, 8vw, 90px)
  every other section uses). Below 1200px the heading and the filter tabs
  stack instead of being centred together on one line.

## 4. A real preview, not a description of one

The preview section already counted a real program. It now also quotes one:
the week, the day and the first two exercises with their real loads, from
`GET /api/demo`. That endpoint is the same server-limited payload `/demo`
uses — 1 week, 1 day, 2 exercises, cut BEFORE the response leaves the server —
so this is not a full program hidden behind CSS. `tools/test-demo-preview.js`
asserts the boundary: no `trainingContent` key in the payload, exercises 3 and
4 absent, their media 401s, path traversal refused. The closing line states
what was withheld ("208 more exercises in the full plan") rather than
implying the rest is one rule away.

## 5. Em dashes

Removed from every customer-facing surface: 17 in page copy (about, blog,
blog-single, checkout, contact, login, register, shop-single, order-success,
welcome, demo), 10 in client JS strings that reach the DOM, 28 in
server-rendered copy (`services.js`, the service page HTML, SEO descriptions,
`auth.js`, `contact.js`, `partners.js`), 1 in the email layout, and 3 stored
values in the database (a product name, a product overview and a partner's
meta description). Rollback SQL for the database rows is in
`/root/git-backups/`. What is deliberately left: code comments, `console.*`
and server log strings, and the partner presentation deck, none of which is
customer-facing UI.

Also removed, per the same brief: four decorative eyebrows outside the landing
page — `How It Works`, `From the Blog` and `Trusted by Athletes & Coaches` on
/about, and `Partnerships` over the /contact `<h1>`. Kept, because they carry
information rather than decorate: the hero card's creator credit, the program
viewer's `Section 01..07` (a real sequence), `/demo`'s "Free preview", the
account area's section headings, and the product page's category link.

## 6. A live pricing bug, found on the way

**The homepage advertised a $19.99 plan at 9.99.** Every "fill this element"
substitution in `server/src/routes/pages.js` was written as a replacement
STRING of the form `` `$1${value}$2` ``. `String.prototype.replace` reads `$n`
in a replacement string as a backreference: with two capture groups,
`$1$19.99$2` is read as `$1`, then `$19` (no group 19, falls back to `$1`) —
so the OPENING TAG was emitted twice and the `$1` of the price was swallowed.
Any price from $10 to $29.99 hit it, in the showcase price, the showcase
description and the hero's price line. All 13 call sites now go through
`fillBetween()`, which uses a replacer FUNCTION — no `$n` syntax, so the value
is inserted verbatim whatever it contains.

## Measured

`tools/measure-page-network.js --net slow --view mobile`, cold cache, before
(production) -> after: LCP 476 -> 488ms, FCP 360 -> 372ms, total 1.02 ->
0.99MB, 64 requests either side, no duplicates, no original upload fetched.
Flat, with a section added and the type system swapped.

`test-landing-responsive.js` passes at all 11 widths; `test-hero-carousel.js`
passes including the hand-off guards (artwork never drops below 0.98 opacity
through a transition, caption never below 0.93, no card enters the stage
without its artwork, every card that fades also travels);
`test-demo-preview.js` passes all 21 boundary checks.

Two harness assertions were updated to match deliberate changes, both with the
reasoning recorded at the call site: the plate ratio (3:4 -> 4:5) and the
neighbour opacity ceiling (0.35 -> 0.60).
