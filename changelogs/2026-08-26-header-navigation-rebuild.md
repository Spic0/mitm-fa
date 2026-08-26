# One Data-Driven Header Navigation, Replacing Three Dropdowns — 2026-08-26

Scope: the site header's category menus (desktop mega-menu and mobile drawer),
the shop page's context engine, the URL scheme for taxonomy pages, and the
admin Navigation section. One additive migration
(`20260826120000_taxonomy_navigation`). No change to checkout, cart, the
customer area, Partner Profiles, Private Presentations, or authentication.

## What was there

Three hand-authored `<li>` blocks in `partials/header.html`, one per category,
with three unrelated compositions and two different data paths:

| | Layout | Data |
|---|---|---|
| Shop by Goal | goal list + "Top Picks" cards | list server-rendered, cards fetched client-side |
| Browse Athletes | one column per sport | fully server-rendered |
| Browse Creators | featured cards + a search box + an A–Z toggle | fetched client-side |

and three fixed pixel widths in `style.css`: `540px`, `760px`, `580px`, with
`flex: 1` columns inside them.

## Root cause of the reported symptoms

**The panel's size was decided before its content existed.** A 760px box
divided between four short sport columns is empty by construction — the
"huge empty panel" in the screenshot is that arithmetic, not a spacing
mistake. No amount of padding, font or shadow tuning fixes a fixed box.

Everything else followed from the menus being authored per category rather
than generated: four "View All" links in one panel because each column had its
own; `ATHLETE` / `CREATOR` tags repeated under a heading that already said so;
and no consistency between the three, because there was nothing they shared to
be consistent *with*. A category an admin added could never appear at all —
there was no code path for a fourth.

`assets/js/nav-featured.js` also fetched the **entire product catalogue**
(`/api/products`) on every page of the site, purely to fill two menu panels.

## What replaced it

`server/src/lib/navigation.js` — one renderer, over the Taxonomy table:

```
Taxonomy row  ->  layout resolution  ->  presentation model  ->  HTML
(CMS)             (structure + one     (columns, tiles,        (one
                   stored hint)         optional feature)       template)
```

Layout resolution is mostly **structural**, so a category created tomorrow
gets a sensible panel with no configuration: a flat tree renders a balanced
link index, a nested one renders a column per group. Only `"people"` is
stored, because it is the one fact a tree's shape cannot tell you — that the
leaves are humans and deserve a face.

Panel width is `max-content` and height is unset: both come from the content,
at every category, permanently. Four items make a narrow panel; twenty make a
wide one. The column split is computed from the real item count server-side
(`columnsFor`) and handed to CSS as `data-rows`, because CSS cannot `ceil()`
and a fixed row count mis-splits every count that is not a multiple of it.

## Four new columns on `Taxonomy`

| Column | Why it could not be derived |
|---|---|
| `showInNav` | Nothing recorded whether a category should be advertised. Hiding one is not the same as deleting it. |
| `navLayout` | "These leaves are people" is invisible in the tree's shape. `"auto"` derives the rest. |
| `nodeRoute` | The URL segment for a leaf. Previously hardcoded as four express routes, so a new category's items had no reachable URL at all. |
| `groupRoute` | The segment for a branch, `null` where branches organize the menu but are not listing pages — which is exactly the Creators tree today. |

Backfilled to the values the code previously hardcoded, so **every existing
URL, canonical and sitemap entry is byte-identical**: `/goal/:slug`,
`/sport/:slug`, `/athlete/:slug`, `/creator/:slug`. They are simply no longer
spelled out in code — `routes/pages.js` now resolves one
`/:segment/:slug` route against those columns, and `assets/js/shop.js` reads
the same columns out of `/api/taxonomy` to build its banner and filter chips.
`Taxonomy.route` (`/shop/<key>`), a column nothing had ever read, became the
real landing page each panel's single "View all" points at.

## Notes for the next person

- **The header is cached** (it is byte-identical on every page) and
  invalidated by one hook on every non-GET `/api/admin/*` request, plus a
  60s TTL as a backstop. A new admin route needs no invalidation call.
- **`loading="lazy"` does not defer a closed panel's images.** Measured: a
  closed desktop panel is `visibility: hidden` with a real box 47px below the
  top of the viewport, well inside the lazy threshold, so Chrome fetched the
  whole menu's imagery on every page. Thumbnails now ship with no `src` and no
  live `srcset` and are promoted by `script.js` on first contact with the nav.
  Deferring the `<img>`'s `src` alone is not enough — inside a `<picture>` a
  live `<source srcset>` selects and fetches on its own.
- **The header's fill hole is an element (`<li data-nav-slot>`), not a comment
  token.** The first version used `<!--NAV_MENUS-->` and the explanatory
  comment above it mentioned the token; `String.replace` takes the first
  occurrence, so the entire menu was substituted into the comment and the
  header rendered with no categories, silently.
- `assets/js/nav-featured.js` is **deleted**, and with it a full-catalogue
  fetch on 21 pages.

## Deploy

The migration was applied to the `public` and `builder_test` schemas by hand.
Its bookkeeping row could not be written, so before the next
`prisma migrate deploy` on the box, run:

```
cd /var/www/mitm-fa/server
npx prisma migrate resolve --applied 20260826120000_taxonomy_navigation
```

or `migrate deploy` will try to re-apply it and fail on "column already
exists". `npx prisma generate` is also needed, since the shared
`node_modules` client must know the four new columns.
