# Removing the Post-Hero Ticker and the Athlete/Creator Pill Rail — 2026-08-19

Scope: the homepage only — `index.html`, `assets/css/home-dynamic.css`,
`assets/js/home-dynamic.js`. No schema change, no migration, no new data, no
change to any other page.

## What was there

Between the hero and the first product cards sat two strips:

1. `.people-marquee` — a continuously-scrolling ticker of product **titles**,
   each title rendered twice back-to-back because the CSS loop scrolls one
   copy-width and needs a second copy to wrap seamlessly.
2. `.people-strip-area` — "Shop by Athlete & Creator", a horizontal rail of
   rounded pills, each an initials avatar (`AC`, `BS`, `DO`) plus a name plus
   an `ATHLETE` or `CREATOR` label.

## Why the pill rail duplicated every person

This was not a rendering bug. `buildPeopleList()` flattened the `athletes`
taxonomy and the `creators` taxonomy into one array, and in this catalog the
**same people are nodes of both**:

| Person | In `athletes` | In `creators` |
|---|---|---|
| Amara Chen | Basketball | Fitness |
| Big Sam Coleman | Boxing | Powerlifting |
| Derrick Owens | Basketball | Bodybuilding |
| Dr. Lisa Moreno | MMA | Fitness |
| Elena Cho | MMA | Fitness |
| Jordan Blake | Football | Fitness |
| Marcus Reyes | Football | Fitness |
| Nadia Fischer | Boxing | Nutrition |
| Priya Nair | Boxing | Nutrition |
| Tom Whitfield | Football | Fitness |

Ten of the eleven people appeared twice, sorted by product count then name, so
the rail literally read `Amara Chen / Amara Chen / Big Sam Coleman / Big Sam
Coleman / …`. Deduplicating by slug would have fixed the repetition but broken
the section's only stated purpose: the `ATHLETE` / `CREATOR` label is the one
thing distinguishing the two entries, so collapsing them makes the label
meaningless — and it is that label, on every pill, that made the strip read as
a template ticker.

## Why both were removed rather than redesigned

- **The rail was redundant.** The header's *Browse Athletes* and *Browse
  Creators* mega-menus already carry the same taxonomy on **every page**, and
  carry more of it: sport/category grouping, per-person plan counts, featured
  creators with covers and prices, a creator search box, and a *Browse All A–Z*
  link. Nothing in the rail was unavailable one tap away, permanently, from the
  header.
- **The ticker was redundant too.** It showed the titles of the same products
  the card strip renders one screen lower — with a cover, a price and a CTA the
  ticker had none of.
- **Neither answered a buyer's question.** A name is not a product. The rail
  asked the visitor to pick a person before seeing a single plan, price, or
  cover; the ticker asked them to read a moving word. The audience for this
  page is deciding *what to buy*, and the first thing under a hero is the most
  expensive real estate on the page for a component that defers that decision.
- **The rail could not be made premium without new data.** Taxonomy nodes have
  no image field, which is why the pills carried CSS-drawn initials. A real
  creator rail would need a portrait per person — a schema change plus an
  operator asset pipeline — to replace something the header already does.
- **Motion is a poor mobile component.** A marquee has no swipe affordance, its
  link targets move under the thumb, and it occupies vertical space above the
  fold on a 320–430px screen without ever being tappable in a predictable spot.

Athlete and creator discovery is unchanged: it lives in the header mega-menus,
and `/athlete/<slug>` and `/creator/<slug>` are untouched.

## What is now first after the hero

`.deal-cards-area`, promoted and given the section header it never had (it
could do without one while a titled rail sat above it):

- eyebrow `FEATURED PROGRAMS`, heading `Start With a Complete Plan`, using the
  existing `.eyebrow` / `.section-header--stacked` pair from
  `brand-blocks.css` — no new heading treatment.
- The eyebrow is **data-driven**. `renderDealCards` shows products flagged
  `featured` when any exist and falls back to the newest ones when none do;
  in the fallback the JS rewrites the eyebrow to `ALL PROGRAMS` rather than
  claiming a curation that did not happen. Same rule as the removed "50% off"
  roundel and the removed "$79 → $49" price: no label the data cannot back.
- A single `Shop All Plans →` text link closes the section, because the strip
  caps at 8 products. Deliberately a text link, not a third button style — the
  hero owns `.btn-one`, the cards own `.btn-two`.

Section padding moved from the `pt-10 pb-60` utilities to
`clamp(48px, 8vw, 90px)`, matching `.promo-tiles-area` directly below it, so
the two stacked sections share one vertical rhythm instead of each inventing
its own.

The resulting order is: hero → **Featured Programs** → *Where To Start / Find
the Plan That Fits Your Goal* → *Latest Plans & Programs* → featured plan
showcase → *Inside Every Plan*.

## Layout

| Width | Behaviour |
|---|---|
| < 768px | swipe rail, `flex-basis` 88%/82%/68%/46% by breakpoint, `scroll-snap`, next card part-visible |
| 768–991px | swipe rail, 31% basis — three across fill the 720px container exactly |
| ≥ 992px | CSS **grid**, `repeat(auto-fit, minmax(300px, 1fr))`, no horizontal scroll |

Two changes make short catalogs fill their row instead of trailing off:

- `.deal-card` gained `flex-grow: 1`. When the cards no longer overflow there
  is free space and they take it; when there are enough products to overflow
  there is no free space, so the basis and the peek affordance are untouched.
- Desktop uses `auto-fit`, not a fixed column count. With three featured
  products — the current catalog — a fixed four-column row left a visible
  quarter of the section empty. `auto-fit` collapses the empty tracks, so any
  count from 1 to 8 fills its row edge to edge. `max-width: 520px` stops a lone
  product from becoming one 1434px-wide card.

## Verified

Rendered in headless Chrome against the real `/api/products` data at 320, 375,
390, 430, 768, 1440 and 1920px:

- `document.scrollWidth === innerWidth` at every width — no horizontal page
  overflow.
- No console or page errors.
- The rail scrolls at every width below 992px and does not at or above it.
- `Shop All Plans` measures 44px tall.

## Dead CSS

`assets/css/home-dynamic.css` is linked from `index.html` only, and no other
page used `.people-marquee` or `.people-chip`, so their rules were deleted
rather than left behind (~5.3KB). The **base** marquee rules
(`.marquee-wrapper`, `.marquee-inner`, `@keyframes marqueeLeft`) that those
overrode still live in `style.css`; nothing on the site uses them now.
`assets/css/critical.css` is generated from `style.css` and `bootstrap.min.css`
and still carries copies of those base rules — harmless (an extra rule is
wasted bytes, a missing one is a flash of unstyled content), and they will drop
out the next time `tools/build-critical-css.js` runs.
