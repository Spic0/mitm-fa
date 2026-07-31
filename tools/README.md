# tools/

Build-time asset optimizations. This project has no bundler, so these are run
by hand and their **output is committed** — they are not part of serving a
request.

## FontAwesome subsetting

The site ships FontAwesome 6 Pro, which is enormous relative to what it uses:

| | before | after |
|---|---|---|
| `assets/webfonts/*.woff2` (7 files) | 1,945 KB | 67 KB |
| `assets/css/all.min.css` (gzipped) | 77 KB | 5 KB |

The landing page was downloading **1,133 KB of icon fonts to draw 8 icons**,
which was the single largest contributor to its load time — more than all its
CSS, JS and images combined.

The pristine vendor files live in `tools/fontawesome-src/` and are **never
written to**. Both scripts read from there and write into `assets/`, so a
rebuild is idempotent and the full icon set is always one re-run away.

```sh
cd tools && npm install     # once — installs subset-font
npm run fontawesome         # css + fonts + verify, in order
```

or individually, from the repo root:

```sh
node tools/subset-fontawesome-css.js     # -> assets/css/all.min.css
node tools/subset-fontawesome-fonts.js   # -> assets/webfonts/*.woff2
node tools/verify-fontawesome.js         # exits non-zero if anything is invisible
```

Both derive the icon inventory from one shared module,
`tools/fontawesome-inventory.js`, so they cannot disagree: scan every `.html`
and `.js` file for `fa-*` tokens, keep anything matching a real FontAwesome
icon name in the **pristine** stylesheet, discard the rest. The inventory is
deliberately over-inclusive (a missed icon renders as nothing, so the bias must
be toward keeping too much).

### The regression this structure exists to prevent

The first version of these scripts read and wrote the *same* files, which made
the served font the only surviving copy of the source. Running them a second
time — after the icon inventory had changed — subset an already-subset font,
and glyphs that had been dropped could never come back.

That shipped. `assets/webfonts/*.woff2` reached production carrying 79 icon
glyphs while `all.min.css` still mapped 106 icons, so **24 icons resolved to a
codepoint with no glyph**: the admin sidebar's dashboard, analytics and logout
icons, the mobile menu bars, the cart, and every warning/error triangle.

A missing glyph produces no console error and no failed request. The `<i>` is
still there, still the right size, and renders *nothing*. That is why it
survived review — and why `verify-fontawesome.js` now exists and gates the
build.

### Icons built at runtime

A static scan cannot see `"fa-chevron-" + (open ? "down" : "right")`; it only
leaves the useless token `fa-chevron`. Any such icon must be listed in
`tools/fontawesome-extra-icons.txt` or it will be stripped. The verifier prints
unrecognised `fa-*` tokens precisely so these are easy to spot.

### Why the CSS script is safe

It only touches rules of the exact shape `SELECTORS:before|:after{content:"…"}`
— the per-icon glyph mapping. Every structural rule (`@font-face`, `.fa` base
class, sizing, `.fa-spin`, stacking, fixed-width, list icons) is untouched, so
removing an unused icon's rule cannot affect a used one. It asserts the
structural pieces survived and prints `STRUCTURAL LOSS` if not.

Two subtleties it handles, both of which silently no-op'd earlier versions:

- grouped selectors carry the pseudo-element on every member except the last
  (`.fa-house:before,.fa-home:before{…}`), so members are filtered
  individually rather than the rule being dropped whole;
- duotone rules carry **two** escape sequences (`content:"\30\30"`), so the
  content pattern must allow one-or-more. Matching exactly one codepoint
  skipped all ~2,900 duotone rules and cut the saving from 93% to 23%.

### Verifying a re-subset

`node tools/verify-fontawesome.js` is the check, and it is mechanical rather
than visual. For every icon referenced in markup it asserts all three of:

1. the class is referenced somewhere (`.html` / `.js`, comments excluded);
2. `assets/css/all.min.css` maps that class to a codepoint;
3. `assets/webfonts/<family>.woff2` actually contains a glyph for it.

Step 3 is the one nothing checked before. It reads the real `cmap` table out of
each built WOFF2 (`tools/woff2-cmap.js` — brotli via Node's `zlib`, no
dependency) and compares it against the pristine font, so it knows which family
each icon legitimately belongs to and never demands a brand icon from
`fa-solid`. It exits non-zero on any miss, so it can gate a deploy.

Still worth a visual pass on `/`, `/shop`, `/about`, `/contact` and
`/admin/manage/dashboard` after a FontAwesome upgrade.

## Handbook demo media (gated program GIFs)

Exercise demos live in `server/storage/media/<productId>/` and were served as
the raw upload: one real demo was a **1920x1080, 27-frame, 15.5MB GIF painted
into an 88px tile**, six of them on a page, ~75MB per handbook. A GIF cannot be
progressively decoded and has no poster frame, so `loading="lazy"` only
deferred *when* that arrived, never *how much*.

`server/src/lib/animatedMedia.js` derives two things with sharp (no ffmpeg
needed, and animation survives):

| | size | vs original |
|---|---|---|
| original | 15.5 MB | — |
| `-poster.webp` (still first frame) | 19 KB | **815x** |
| `-anim.webp` (640px, animated) | 226 KB | **70x** |

Measured across the six real handbook GIFs: **72.3MB -> 108KB** for first
paint, with 1.1MB more only if every demo is actually looked at.

Both are addressed by `?variant=poster` / `?variant=anim` against the file's
existing gated URL, resolved in `routes/library.js`. That URL is baked into
`Product.trainingContent` at upload time and is never rewritten, so a variant
is *asked for* rather than stored — no migration, no backfill of content JSON,
and an ungenerated variant falls back to the original server-side.

Derivatives are generated in a background queue (`lib/mediaJobs.js`), never in
the upload request: one conversion is ~1.5s of CPU, and six inline was ~9s of a
single-process server answering nothing else.

```sh
node tools/backfill-animated-media.js [--force] [--dry]   # existing uploads
cd tools && npm run test:handbook-media                   # browser test
```

Run the backfill **on the machine that holds the media** — `server/storage/` is
gitignored and per-checkout, so deploying the code does not move derivatives.

## Critical CSS

`bootstrap.min.css` (33KB gz) and `style.css` (52KB gz) were the last thing
gating first paint — they finished at 2029ms and 2193ms on a Fast-3G profile,
and FCP fired at 2292ms. They are now fronted by `assets/css/critical.css`
(14KB gz), with the originals loading deferred.

| | render-blocking CSS | FCP (Fast-3G + 4x CPU) | FCP (broadband) |
|---|---|---|---|
| before | 82 KB gz | 2292 ms | 368 ms |
| after | 14 KB gz | **~1790 ms** | **~344 ms** |

The deferred sheets carry `fetchpriority="low"`, on the theory that
`rel=preload` fetching at high priority was starving critical.css. **It made no
measurable difference** (FCP 1788ms before, 1788ms after) — the attribute is
kept because it is semantically correct, not because it bought anything.

On Fast-3G, FCP is now gated by critical.css itself finishing at ~1714ms, and
the page pulls ~500KB in total on a ~200KB/s link. Getting meaningfully below
this would mean inlining (blocked by CSP, see above) or cutting total bytes
further — not more prioritisation tweaking.

```sh
node tools/build-critical-css.js [baseUrl]   # writes assets/css/critical.css
node tools/split-critical-css.js             # patches the HTML
node tools/split-critical-css.js --revert    # undoes the patch cleanly
```

`build-critical-css.js` needs the site running (default `http://localhost:3200`).
Re-run **both** after changing either source stylesheet, or after adding a page
whose fold differs from the ones already listed in its `PAGES` array.

### Not inlined, on purpose

The CSP is `style-src 'self'` with no `'unsafe-inline'`, and the site ships
zero inline styles. Inlining would need either `'unsafe-inline'` (weakens a
real XSS mitigation on every page of a site that takes payments) or a
per-build `sha256` in the CSP header (couples the header to build output, and
blanks the page if they ever drift). A separate stylesheet costs one round
trip and neither risk.

### Two traps this tool already fell into

Both produced a **completely unstyled first paint** while looking fine by
every other measure, so re-check the rendering — not just the file size — if
you change the extraction:

1. **`CSS.startRuleUsageTracking` is reset by navigation.** Starting it before
   `goto()` measures the `about:blank` document and reports almost nothing.
   Use `page.coverage.startCSSCoverage({ resetOnNavigation: false })`.
2. **Coverage byte ranges cannot be sliced and concatenated.** A rule inside
   `@media (...) { … }` comes back without its enclosing at-rule, so the braces
   stop balancing. That produced a 79KB file Chrome parsed into **9 rules**.
   The extraction goes through a PostCSS AST so kept rules stay inside their
   parent at-rule.

### Verifying a rebuild

The screenshot harness must be deterministic first: the hero slideshow rotates
on a 6000ms `setTimeout`, so a variable settle time captures a different slide
each run and every diff is noise. Capture on a fixed delay from
`domcontentloaded`, clear all pending timers, then shoot — and confirm a
control run (same state twice) diffs at 0.000% before trusting any result.

Then check both states:

- **final render** — pixel-diff every page at desktop and mobile against the
  pre-split state. Expect 0.000%.
- **first paint** — screenshot at FCP under throttling with the deferred sheets
  still pending. It should show the site's normal preloader, not raw HTML with
  bulleted lists and blue underlined links.

## Dependencies

Build-time only, and deliberately kept out of `server/package.json` so a tool
dependency can never reach the production dependency tree (`server/node_modules`
is a symlink to the production checkout's — see the deploy notes).

`subset-font` is declared in `tools/package.json`:

```sh
cd tools && npm install
```

`postcss` (critical CSS) is still ad-hoc:

```sh
npm install --no-save postcss
```
