# tools/

Build-time asset optimizations. This project has no bundler, so these are run
by hand and their **output is committed** — they are not part of serving a
request.

## FontAwesome subsetting

The site ships FontAwesome 6 Pro, which is enormous relative to what it uses:

| | before | after |
|---|---|---|
| `assets/webfonts/*.woff2` (7 files) | 1,945 KB | 42 KB |
| `assets/css/all.min.css` (gzipped) | 77 KB | 5 KB |

The landing page was downloading **1,133 KB of icon fonts to draw 8 icons**,
which was the single largest contributor to its load time — more than all its
CSS, JS and images combined.

Both scripts derive the icon inventory the same way: scan every `.html` and
`.js` file in the repo for `fa-*` tokens, keep anything that matches a real
FontAwesome icon name, discard the rest. The inventory is deliberately
over-inclusive (a missed icon renders as a blank box, so the bias must be
toward keeping too much).

```sh
node tools/subset-fontawesome-fonts.js   # rewrites assets/webfonts/*.woff2
node tools/subset-fontawesome-css.js     # rewrites assets/css/all.min.css
```

### Both are destructive and NOT idempotent-safe against an upgrade

They rewrite the asset in place. Re-running them on already-subset files is
harmless (nothing left to remove), but there is no way to *recover* the full
icon set from a subset file.

**When you upgrade FontAwesome, or add an icon that isn't currently used
anywhere:** restore the full `all.min.css` and `assets/webfonts/` from the
vendor download first, then re-run both scripts. Running them against
already-subset files after adding a new icon will NOT bring that icon back —
its glyph is already gone from the font.

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

`tools/` has no test runner, so verify by hand after re-running:

1. Every used icon still has a rule — the CSS script prints kept/removed counts.
2. Icons still render: load `/`, `/shop`, `/about`, `/contact` and confirm no
   blank boxes. The font subset was originally validated by rasterising all 85
   used icons in all 4 styles from both the original and subset fonts and
   comparing them pixel for pixel (340/340 identical).

## Dependencies

`subset-font` is required by the font script only, and only at build time:

```sh
npm install --no-save subset-font
```
