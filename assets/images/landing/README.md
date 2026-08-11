# Landing-page marketing images

Drop files here, named exactly after the slot they fill, then run:

    node tools/build-landing-assets.js

| Filename | Where it appears | Size | Ratio |
|---|---|---|---|
| `promo-primary.<ext>` | Large left promo tile | 1280 × 720 | 16:9 |
| `promo-secondary-a.<ext>` | Small upper-right tile | 900 × 600 | 3:2 |
| `promo-secondary-b.<ext>` | Small lower-right tile | 900 × 600 | 3:2 |
| `showcase.<ext>` | Featured-plan showcase (optional — falls back to the product's own cover) | 1200 × 1500 | 4:5 |

`<ext>` is one of `jpg`, `png`, `webp`, `avif`, `svg`. WebP/AVIF derivatives are
generated for you; do not convert by hand and do not add version suffixes to the
filenames.

An empty slot renders a branded FA fallback, not a broken image — leaving one
empty is a supported state.

**These files are gitignored and exist only on this server.** Keep your
originals, and make sure this directory is in the server backup.

Full workflow, replacement procedure and verification steps:
`server/docs/landing-assets.md`.
