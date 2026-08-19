# "Inside Every Plan" — Product-Led Redesign — 2026-08-19

Scope: the homepage's `.value-area` section only — `index.html`,
`assets/css/home-dynamic.css`, `assets/js/home-dynamic.js`. No schema change,
no migration, no new endpoint, no new dependency, no change to checkout, cart,
payments, admin, partner profiles, presentations, auth or the media pipeline.

## What was wrong

Measured on the live section before the change:

| Problem | Evidence |
|---|---|
| Too much copy | A three-line lede that restated the headline, plus four paragraphs — ~500px of body text on a 390px screen |
| Too many equal-weight elements | Six focal points: headline, lede, preview, four numbered blocks, CTA |
| Generic feature grid | `01 YOUR PROGRAM` … `04 YOUR ACCESS` — four parallel nouns in a 4-up grid |
| Disconnected product shot | The preview was ~40% of the width and shorter than the text beside it |

The numbering was the clearest tell. Numbered markers encode a **sequence**;
these four were parallel, unordered capabilities, so `01`–`04` were decoration
pretending to be structure. That is the specific pattern Anthropic's
`frontend-design` skill calls out as a generic default.

## New information architecture

```
INSIDE EVERY PLAN
Everything you need to follow the work.
Workouts, guidance and resources — organized around your program.

[ PROGRAM VIEWER PREVIEW ]        <- the signature element

TRAIN / WATCH / KEEP              <- one line each

[ Find Your Program -> ]
```

Four blocks became three. Nouns became verbs, and the verb IS the structural
device, so the numbers are gone rather than restyled. Copy dropped from ~95
words to ~38. Every claim is one the schema backs:

| Point | Backed by |
|---|---|
| **Train** — every session laid out: exercises, sets, reps, progression | `Product.trainingContent` — `weeks[].days[].exercises[]` with `sets`, `reps`, `notes`, `substitutions` |
| **Watch** — demonstrations and coach notes, *where the creator includes them* | `ProductMedia` (`type: "video"`) + per-exercise media. Hedged deliberately: demos are per-product, not guaranteed |
| **Keep** — buy once, your program stays in your library | A paid `OrderItem` grants access and carries no expiry field |

Nutrition plans and handbooks lost their own column and are covered by
"resources" in the one-line lede — the reduction the section needed.

## The preview

Still **drawn in CSS**, deliberately: no request, no bytes, sharp at any
density, and no image to arrive late and shift the layout (zero CLS with no
reservation). It is also the only safe option — real `trainingContent` is
served exclusively by `GET /api/library/program/:id` behind `requireAuth` plus
an entitlement check, so a public page rendering it would be publishing paid
material. The session rows are illustrative, which is why the whole block keeps
`aria-hidden="true"`; nothing inside is focusable, so no keyboard user is
stranded, and the masthead plus the three points carry the full meaning.

What is now **real**: the identity strip — cover, program name, creator, and a
week rail with one tick per `durationWeeks` — read from the same
`GET /api/products` response the featured-programs strip above already fetched.
No extra request. The cover uses `MediaContainer.smallestDerivative()` rather
than `applyResponsive()`: the tile is never painted above 54px, the smallest
derivative the pipeline produces is 320px, and that exact file is already in
cache from the strip above — naming it directly guarantees reuse instead of
letting a srcset pick a larger candidate on a high-DPR screen. `loading="lazy"`,
explicit `width`/`height`, and an `onerror` that drops the `<img>` so a missing
cover leaves the neutral tile rather than a broken-image glyph.

Every write is a no-op when data is absent and the markup ships neutral
defaults, so an empty or failed catalog leaves a complete-looking card.

## Layout

| Width | Composition |
|---|---|
| < 768px | Single column, in the required order: eyebrow, headline, one line, large preview, three points, full-width CTA |
| >= 768px | Masthead splits (title over the preview, lede over the points) on the **same 1.25fr/1fr grid** as the body; preview left, points + CTA right, vertically centred against the card |

Two decisions worth recording:

- **The split starts at 768px, not 992px.** The Bootstrap container is already
  720px wide at 768 and stays 720 until 992, so the single column was not using
  the width it had. Leaving the split until 992 made the tablet range the
  tallest rendering of the section anywhere: **1261px at 768, against 854px
  once split.**
- **Points and CTA share one column.** With the CTA below the whole body, the
  desktop layout ended in an empty bottom-right quadrant plus a long trailing
  gap — 1069px tall. Moving both into one centred aside took it to 912px and
  removed the dead space. Mobile stacking order is unchanged.

## Motion

One orchestrated moment: the exercise rows land in sequence as the card enters,
like a session loading. No observer of its own — WOW.js already adds
`.animated` to the `.wow` element, so this is pure CSS keyed off that class.

The first attempt (160ms lead-in, 80ms steps) was measured holding **all four
rows at opacity 0 for 560ms** after the card appeared — `animation-fill-mode:
both` holds each row invisible through its own delay, so a long ladder leaves
the section's focal element looking empty. Now: no delay on row 1, 70ms steps,
380ms duration — the whole sequence lands in 590ms with the first row already
on screen.

Guarded by `@media (prefers-reduced-motion: no-preference)`, i.e. opt-**in**.
If the query is unsupported or motion is reduced, the rows are simply present;
there is no path where they stick at opacity 0. Verified under emulated
`prefers-reduced-motion: reduce`.

## Verified in headless Chrome against real `/api/products` data

At 320, 375, 390, 430, 768, 1440, 1920:

- `document.scrollWidth === innerWidth` at every width — no horizontal overflow,
  and no element inside the section exceeds the viewport.
- No console or page errors.
- Real data renders: creator "Cristiano Ronaldo", program "CR7 Elite
  Athleticism & Conditioning", 12 week ticks.
- Rows settle at opacity 1/1/1/0.42 (the fourth is the crop indicator).
- Preview `aria-hidden="true"` with **0** focusable descendants.
- Heading order H1 (hero) -> H2 (section) -> H3 (Train/Watch/Keep).
- CTA measures 48px tall (>= 44px) at every width; full width below 480px.
- Keyboard focus ring comes from the global `a:focus-visible` rule in style.css.

Section height: 1052px at 390 (was 1084) and 912px at 1440 (was 824) — the
desktop gain buys a preview that is 743x504 instead of a card smaller than the
text beside it.

## Known issue, not fixed here

`.eyebrow` uses `--color-text-faint` (`#9c9993`) on `--color-bg` (`#fafaf9`):
**2.72:1 measured**, against the 4.5:1 WCAG AA minimum for 11px bold text. This
is a site-wide token — the same eyebrow appears on the promo tiles and the
featured-plan showcase on this page alone, and `--color-text-faint` is used
across 21 templates. Darkening it to about `#737067` would clear 4.5:1, but
that is a brand-palette change across the whole site, not a change to this
section, so it is reported rather than applied. Every other text pair in the
section passes comfortably: lede and point copy 7.35:1, point titles 16.66:1,
the preview's day heading 17.10:1.
