# Landing-page images: where they live and how to replace them

Everything below is about the **marketing imagery on the homepage** — the promo
tiles and the featured-plan showcase. Product covers are a different system
(admin panel upload) and are covered at the bottom.

The short version:

```bash
# 1. copy the image onto the box
scp promo-primary.jpg root@fitness.agency:/var/www/mitm-fa/assets/images/landing/

# 2. generate the responsive derivatives
cd /var/www/mitm-fa && node tools/build-landing-assets.js

# 3. reload the page — no restart, no rebuild, no code edit
```

That is the whole workflow. There is no step where you edit HTML.

---

## A. Where landing-page assets are stored

| What | Where |
|---|---|
| Source images you drop | `/var/www/mitm-fa/assets/images/landing/` |
| Generated derivatives | same directory, named `<slot>-<width>.<avif\|webp>` |
| Generated metadata | same directory, `<slot>.media.json` |
| Product cover uploads | `/var/www/mitm-fa/assets/images/product/uploads/` (admin panel writes these — do not hand-place files here) |
| Logo / favicon | `assets/images/logo/fa-logo.svg`, `assets/images/favicon/` |

The slot catalogue lives in one place in code:
`server/src/lib/landingAssets.js`. Adding a new slot means adding an entry
there plus a `<div class="landing-slot" data-landing-slot="…">` in
`index.html` — nothing else.

## B. Which VPS directory receives the files

```
/var/www/mitm-fa/assets/images/landing/
```

**This is on the production checkout**, which is the box that serves the site.
The file must be named exactly after the slot it fills:

| Filename | Where it appears | Recommended size | Ratio |
|---|---|---|---|
| `promo-primary.<ext>` | Large left promo tile, "Browse Every Plan" | **1200 × 1200** | square — see note |
| `promo-secondary-a.<ext>` | Small upper-right tile, "New to Training" | **900 × 600** | 3:2 |
| `promo-secondary-b.<ext>` | Small lower-right tile, "Nutrition & Diet" | **900 × 600** | 3:2 |
| `showcase.<ext>` | Featured-plan showcase image | **1200 × 1500** | 4:5 portrait |

A filename that isn't a slot name is ignored, and
`node tools/build-landing-assets.js` prints a warning naming the valid slots —
a typo'd filename is by far the most common reason a slot "doesn't work".

**`promo-primary` is the one slot whose shape changes with the viewport.** While
the tiles are stacked it is 16:9; on desktop that tile spans the full height of
the two beside it and its image absorbs the spare height, making the box roughly
0.85:1. Supply a **square** image with the subject centred — it crops sensibly
both ways. A 16:9 source loses about half its width on desktop.

`showcase` is optional and behaves differently from the other three: when it is
empty, the section falls back to the **real cover image of the featured
product**, which is usually what you want. Only supply `showcase.*` when you
want an art-directed shot instead of the product's own cover.

## C. Required image formats

Accepted sources: **`.jpg` / `.jpeg`, `.png`, `.webp`, `.avif`, `.svg`**.

Use JPEG for photographs and PNG only when you need transparency. You do *not*
need to convert to WebP/AVIF yourself — that is what step 2 does.

## D. Recommended dimensions

Per-slot sizes are in the table in section B. General rules:

- Supply **roughly 2× the slot's display width**, and no more. The largest
  derivative generated is 1280px wide, so anything above ~1600px source is
  wasted upload; a 4000px export gains nothing and is downscaled anyway.
- Match the slot's ratio where you can. An off-ratio image is not rejected and
  is never distorted — it is either cropped slightly (`cover`) or shown whole on
  a blurred copy of itself (`contain`), decided per image from its real measured
  dimensions. But a 16:9 photo in the 4:5 showcase slot will lose a lot of its
  sides.
- Minimum useful width is ~960px. Below that the build tool prints a
  `notice: … may look soft on high-resolution screens`.

## E. Is WebP/AVIF supported?

Yes, and both are generated automatically. Each source produces up to 8
derivatives — AVIF and WebP at 320/640/960/1280 — and the page serves them via
`<picture>`, so each browser downloads the smallest format it understands at the
width it actually needs. The original stays on disk purely as the final
fallback.

Upscaling never happens: a 900px source gets 320/640 derivatives and nothing
larger.

For reference, a 1600×900 JPEG source of 211KB produced a 640px WebP of **1.9KB**
and a 1280px AVIF of **19KB** — that is what the page actually ships, not the
211KB.

## F. Should filenames be hashed or versioned?

**No — and do not rename the slot files.** The slot name *is* the filename;
`promo-primary-v2.jpg` fills nothing.

Cache behaviour differs between the two kinds of file, deliberately:

- **Derivatives** (`promo-primary-640.webp`) are served
  `Cache-Control: public, max-age=31536000, immutable`.
- **The source you drop** is served with a 1-day cache.

Because derivative filenames are *not* content-hashed, replacing a slot image
with a different picture under the same name means returning visitors can hold
the old derivative for up to a year. See section I for the safe way to do that.

## G. How the frontend references the files

It doesn't reference them by URL at all. `index.html` declares an empty,
named hole:

```html
<div class="landing-slot promo-tile__media"
     data-landing-slot="promo-primary"
     data-landing-alt="Fitness Agency training programmes"></div>
```

`applyLandingAssets()` in `server/src/routes/pages.js` fills it at request time
from whatever is on disk. **Never put an image path in the HTML** — that is
precisely what this replaced.

If a slot is empty, the hole is left as-is and CSS paints a branded FA fallback
into it. A visitor never sees a broken image or a technical placeholder.

Alt text comes from `data-landing-alt` in the markup, so it stays correct when
the image behind it changes.

## H. Is a restart or rebuild required?

**No.** The server watches the directory's modification time and re-reads it
when it changes, so a new image is live on the next page load.

You do need to run `node tools/build-landing-assets.js` after copying a file —
without it the image still displays, but as the raw original with no
WebP/AVIF and no responsive sizes.

There is no build step, no bundler and no cache to purge.

## I. Replacing an existing image safely

```bash
cd /var/www/mitm-fa/assets/images/landing/
rm -f promo-primary.*                       # source AND its derivatives/manifest
cp ~/new-promo.jpg promo-primary.jpg
cd /var/www/mitm-fa && node tools/build-landing-assets.js
```

The `rm` matters. Two traps it avoids:

1. **Stale derivatives.** The build tool skips a source that already has a
   manifest. If you overwrite `promo-primary.jpg` in place and re-run, nothing
   is regenerated and the page keeps serving derivatives cut from the *old*
   picture. (`--force` also fixes this.)
2. **Two sources for one slot.** Dropping `promo-primary.png` while
   `promo-primary.jpg` is still there leaves two candidates. The resolver picks
   deterministically by format preference, which may not be the file you just
   added.

Because derivatives are cached `immutable` for a year, a returning visitor may
keep the old image. If a change must be seen immediately by everyone, the
reliable fix is a genuinely different URL, which today means a new slot. For
routine marketing refreshes this is not worth worrying about.

To empty a slot, delete its files and re-run the tool — the branded fallback
takes over.

## J. Verifying the asset is actually being served

```bash
# 1. the tool's own report — what it built, and which slots are still empty
node tools/build-landing-assets.js

# 2. is the slot filled in the HTML the server sends?
curl -s https://fitness.agency/ | grep -o 'data-landing-slot="[^"]*"[^>]*' | head
#    a filled slot's container carries  class="… is-filled landing-slot--cover"

# 3. are the derivatives reachable, and correctly typed?
curl -sI https://fitness.agency/assets/images/landing/promo-primary-640.webp \
  | grep -i 'HTTP\|content-type\|cache-control'
#    expect: 200, image/webp, max-age=31536000

# 4. end-to-end, in a real browser, at every breakpoint
node tools/test-landing-responsive.js --url https://fitness.agency/
```

`test-landing-responsive.js` reports each slot's rendered box per width, so a
slot that resolved but collapsed to `0x0` shows up immediately.

---

## Backups — read this

`assets/images/landing/` is **gitignored**. These files live only on the
production box and are not in git history.

That is intentional: production deploys with `git merge --ff-only`, and an
untracked file on the box blocks any merge that would add a tracked file of the
same name — so tracking them would let an image drop wedge a deploy. The
trade-off is that they are not recoverable from the repo. Include
`/var/www/mitm-fa/assets/images/landing/` in the server backup, and keep your
originals locally.

The same applies to `assets/images/product/uploads/` (admin panel uploads),
which has always been gitignored for the same reason.

## Product cover images are a different system

Product covers, gallery slides and program media are **not** handled here.
Those are uploaded through the admin panel, stored under
`assets/images/product/uploads/`, and go through the same derivative pipeline
automatically on upload — no tool run needed. Do not hand-place files in that
directory; the admin panel records the filename in the database, and a file it
doesn't know about is invisible to the storefront.

To backfill derivatives for covers uploaded before that pipeline existed:

```bash
node tools/backfill-media-derivatives.js
```
