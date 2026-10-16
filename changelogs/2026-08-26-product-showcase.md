# The Product Showcase — Rebuilding "See Exactly What You Get" — 2026-08-26

Scope: the landing page's first section after the hero, plus the preview
endpoints and viewer support it needs. No schema change, no migration. Nothing
in checkout, cart, payments, admin, Partner Profiles, Private Presentations or
authentication is touched.

## What was there, and why it went

The second rebuild of this section (2026-08-19) replaced feature cards with a
real product's counted contents: a white card holding the cover, chips, a grey
session excerpt and a six-row spec table. Honest, but it still *described* the
product. The owner's judgement was that it read as a generic template, and the
brief for this third rebuild was explicit: the customer should understand the
product by looking at it.

## What is there now

The product itself, in the device a customer will use it on.

- One device mockup, switchable between **Phone** and **Laptop**. Each screen
  is the real program interface painted with real data: the phone shows the
  mobile composition (appbar, dark cover hero, session sheet with poster-thumb
  exercise rows), the laptop shows the same content in the wide composition
  (identity rail beside the session). The phone screen genuinely scrolls.
- A short facts column read entirely from the product row: creator, name,
  length, level, training days, includes, handbook page count, price.
- **Open the handbook** — loads `program-viewer.js`, the exact component a
  purchased program is read in, and feeds it a server-cut preview payload.
- **Get the full program** — the product page.

Headline: "See the program before you buy." One supporting sentence. No
feature cards, no eyebrow tags, no invented statistics.

## The preview boundary (server-enforced)

Two payloads, both cut before serialization — there is nothing in the DOM to
un-blur, on either surface:

- `GET /api/demo` (existing, unchanged limits): 1 week, 1 day, 2 exercises,
  poster stills only. Now also carries `contents.handbookPages`, computed by
  `handbookPagesOf()` in `server/src/lib/demo.js` the same way the viewer
  paginates, so "79 pages" is a fact rather than copy.
- `GET /api/demo/handbook` (new, `server/src/routes/demo.js`): the same slice
  reshaped for the viewer — `trainingContent` holds exactly one week, one day,
  two exercises; media is the two already-allowlisted posters (`?variant=
  poster`); overview rides along (it is already public on every product card);
  nutrition, FAQs, resources and bonus notes are omitted entirely. `preview`
  carries locked counts, locked day titles, the page count, the price and the
  product URL. `imageUrl` is the **640w webp derivative**, not the 2.3MB
  original — the recurring renderer-ships-the-original bug, caught before an
  eighth occurrence.

The viewer (additively) understands `product.preview`: it appends a final
locked page — counts, day-title chips, "Get the full program" — so the preview
handbook paginates cover → introduction → the sample day → locked, 4 pages.
A purchased payload carries no `preview` and renders exactly as before.

The media gate is untouched: `demoMediaRequest` in `routes/library.js` already
allowlists precisely the sliced posters, and the handbook payload references
only those.

## Performance

- The viewer's CSS and JS load **on the first click** of the handbook button,
  never on page load. If either fails, the button falls back to `/demo`.
- Section imagery: two poster stills (~19KB each) and the 320w cover
  derivative, all `loading="lazy"`, boxes reserved from real aspect ratios.
- One `/api/demo` fetch feeds both screens and the facts column; the handbook
  payload is fetched once and cached for repeat opens.

## Guards

- `tools/test-demo-preview.js` (extended): the handbook payload's week/day/
  exercise counts, absent content (unsent exercises, other weeks' briefs,
  nutrition), posters-only media, and the untouched gates.
- `tools/test-product-showcase.js` (new, in `npm test`): from the browser —
  DOM holds exactly what the server sent, gated requests are stills only, the
  handbook opens/paginates/locks/closes, the locked CTA is legible (the
  global span-colour trap), no stored original fetched anywhere on the
  landing page, device toggle switches both ways without moving the layout
  below, and the full responsive sweep at 320/375/390/430/1280/1440/1920.

## A note for the next person

`tools/test-landing-responsive.js` takes `--url`, not `--base`, and silently
falls back to :3200 — a stale dev server — if given the wrong flag. Both of
today's "pre-existing baseline failures" on this page were that. The suite
passes 11/11 widths against this build.
