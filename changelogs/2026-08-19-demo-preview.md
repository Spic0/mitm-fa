# Public Program Preview (/demo) + Landing Reset — 2026-08-19

Scope: a new public route and API, a rebuilt landing section, a second hero
CTA, and one admin setting. **No change to checkout, cart, payments, the
entitlement system, customer library authorization, the product CMS schema,
partner profiles, private presentations or auth.** No migration.

## A production leak found on the way in, and closed

`sulek-strength-size-peak` was **`freeAccess = true` while `status =
published`**. Its entire 10-week program — 210 exercises, all coaching notes,
the nutrition plan and every exercise GIF — was readable by any anonymous
visitor at `GET /api/library/program/sulek-strength-size-peak`, while the
product was listed for sale at $34.49 and **two customers had already paid for
it**.

This was not deliberate. `/root/set-free-access.sh` set the product to
`unlisted + freeAccess` on 2026-08-01 — the documented pairing for a private
presentation (see the comment on `Product.freeAccess`: unlisted so no customer
stumbles in, free so a prospect can read the real thing). It was later
re-published from the admin panel without clearing the flag, and
`published + freeAccess` is the combination that leaks. The one live
`PrivatePresentation` does not reference this product, so nothing depended on
it.

`freeAccess` is now `false`. Reversible with
`bash /root/set-free-access.sh --revert` or one UPDATE.

This also had to be fixed before the rest of this work meant anything: a
limited preview of a product that is already entirely free is theatre.

## What was removed from the landing section

The second rebuild of `.value-area` in one day. The first pass reorganised a
feature section; this one deletes the idea of a feature section there.

| Removed | Why |
|---|---|
| `TRAIN` / `WATCH` / `KEEP`, one sentence each | Still three paragraphs of explanation. A number does the job better. |
| "Exercise demos … where the creator includes them" | The demo product carries **4 demos across 210 exercises**. Prose was the wrong medium for a claim the data barely supports. |
| The CSS-drawn program-viewer mock (`.vp-*`, ~120 lines of CSS) | It illustrated an interface using invented exercises. There is now a real preview of a real program at `/demo`. |
| "Everything you need to follow the work." | Vague by construction — the sentence you write when you will not commit to a number. |

## What the section shows instead

One real product and its **counted** contents, from `GET /api/demo`:

| | |
|---|---|
| 10 | Weeks |
| 40 | Training days |
| 210 | Exercises, across 21 distinct movements |
| 170 | Coaching notes |
| 170 | Listed swaps |
| 5 | Nutrition meals |

Every number is produced by `contentsOf()` in `server/src/lib/demo.js` counting
stored `trainingContent`. Nothing is hardcoded; a row whose count is zero is
not rendered; and if the request fails the whole section removes itself rather
than leaving a heading over an empty frame.

`demos` is reported by the API but only *rendered* when it is at least 25% of
the exercise count — 4 of 210 is a real number and not a feature.

## Hero

```
[ Explore Programs ]  [ See Demo ]
     .btn-one            .btn-two
```

Rank is carried by the existing components — filled primary, outlined
secondary, one step down in padding and type — not by a bespoke pair. Stacked
full-width below 480px: side by side they would be ~46vw each, under a
comfortable thumb width and reading as two halves of one control.

A secondary CTA was previously rejected here because the only candidate
("Browse by goal") pointed at `/shop`, the same place as the primary. That
objection does not apply to this one: it goes somewhere else, and answers the
question the primary cannot.

The supporting line was shortened; it remains hidden below 768px.

## The preview itself

`/demo` renders `demo.html` and loads **`program.css` and
`program-media.css` — the stylesheets the purchased program uses**. Exercise
rows are the viewer's own `.pg-ex` markup, the hero is `.pg-hero`, the button
is `.pg-btn`. There is no landing-page impression of the product interface;
there is the product interface. `demo.css` adds only what the real viewer has
no concept of: a spec table and a lock boundary.

`program-viewer.css` (the paginated handbook reader) and the storefront's
bootstrap/swiper/animate stack are deliberately not loaded — same call, same
reasoning, as `program.html`.

### How much is exposed

`LIMITS = { weeks: 1, days: 1, exercises: 2 }` — **one day of one week, two
exercises**. Against this product that is 2 of 210 exercises, **under 1%**.

Exposed: cover, name, creator, duration, level, first paragraph of the
overview, the public gallery, the counted totals, one week title, one day
title and its brief, two exercises with their prescription, coaching notes and
listed swap, plus the **titles** of the remaining days in week 1.

Withheld: everything else, including the rest of week 1's exercises, weeks
2–10 entirely, the nutrition plan, resources, and the second paragraph of the
overview.

### How the lock is enforced

**Server-side, by never sending it.** `sliceOf()` in `server/src/lib/demo.js`
cuts the program before serialization, so the response contains two exercises
and there is no hidden field in the payload for DevTools to find. The fade on
the client is presentation: the ghost rows below the last exercise carry **no
content at all**, blurred or otherwise — there is nothing in that DOM to
un-blur.

Exercise media needed one narrow door, because those stills live behind the
entitlement-gated media route. That door is:

- **media only** — `/program/:id` is *not* opened, so the demo product's full
  payload still requires a session and an entitlement even though two of its
  stills do not;
- **one product** — whichever `lib/demo.js` resolves;
- **two files** — recomputed from the same slice that built the response, so a
  third exercise in the same day is not reachable;
- **stills only** — `poster` and `thumb`. The `anim`, `mp4` and `webm`
  renditions stay entitlement-only.

The empty variant is **excluded**, and that is not cosmetic: a request with no
`variant` serves the file as stored, which for these exercises is the **12.9MB
source GIF**. An earlier draft allowed `""` on the reasoning that "no variant
means the default" and made the original anonymously downloadable. It was
caught by the boundary test below, which is why the test exists.

`tools/test-demo-preview.js` runs the real router, the real slice and the real
entitlements module against a fake database. All 21 checks pass, including:
sliced posters 200; the same file's `anim` 401; the same file with no variant
401; exercises 3 and 4 of the same day 401; another product's media 401; the
full program payload 401; the library listing and orders 401.

`tools/test-free-access.js` and `tools/test-program-page-media.js` still pass —
the existing gate is unchanged.

## Admin

`demoProductSlug` added to `Setting` (the existing key/value table — no schema
change) and to `EDITABLE_KEYS`, with a **product picker** on Manage → Settings
populated from the real catalog. Empty means "automatic". The server re-checks
that the chosen slug resolves to a `published` product before showing
anything, so pointing it at a draft falls back rather than publishing by
accident.

## Performance

`/demo`: **23 requests, 80.5KB of images.** The two exercise stills are 18.6KB
and 19.5KB — against 12.9MB for one source GIF. The cover reuses the same 320px
derivative the storefront already serves.

Homepage: request count unchanged. The value section's cover is the same
derivative the featured strip already fetched (a cache hit), and `GET
/api/demo` adds ~3KB of JSON, fetched independently so a failure there cannot
take the product strip or the hero price down with it.

## Verified

Rendered in headless Chrome against real data at 320, 375, 390, 430, 1280,
1440 and 1920, on `/` and `/demo`:

- No horizontal overflow at any width on either page.
- `/demo`: zero console errors and zero failed requests at every width.
- Full flow driven by real clicks: homepage → **See Demo** → `/demo` (Sam
  Sulek, 2 real exercises, locked counts 2/3/9) → **Get the full program** →
  `/program/sulek-strength-size-peak`, which renders `.product-price = $34.49`,
  matching the API.
- Touch targets: hero CTAs 56px and 53px, section CTA 48px, demo CTA 59px.
- Contrast on `/demo`: 7.35:1 to 16.66:1, all passing AA.
- The value section reveals **without a scroll event** — its contents carry no
  `wow fadeInUp`, because WOW.js reveals from a scroll handler that measures
  bounding boxes and a `hidden` ancestor has none, which could have left them
  permanently invisible.
- Correct under emulated `prefers-reduced-motion: reduce`.

## Known issue, unchanged

`--color-text-faint` / `--pg-faint` (`#9c9993`) measures **2.7:1**, below the
4.5:1 AA minimum. The two labels introduced here use the muted stop (7.4:1)
instead, but the shared token is left alone: it drives `.eyebrow` across 21
templates and the purchased-program viewer, so changing it is a palette
decision rather than part of this work. About `#737067` would clear 4.5:1.
