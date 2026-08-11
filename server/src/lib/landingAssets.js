const fs = require("fs");
const path = require("path");
const { coverMedia } = require("./media");
const { invalidate } = require("./mediaDerivatives");

// ---------------------------------------------------------------------------
// Landing-page marketing imagery — the "drop a file on the box" asset system.
// ---------------------------------------------------------------------------
//
// The problem this solves: every marketing image on the homepage used to be a
// hardcoded <img src> pointing at a file the purchased theme shipped. Three of
// them were literally grey "410X432" / "690X281" / "240X276" dimension
// placeholders, live in production, and changing one meant editing HTML.
//
// The rule here: THE SLOT IS DECLARED IN MARKUP, THE FILE IS DISCOVERED ON
// DISK. A slot is an empty, named hole in the page. Dropping
// `assets/images/landing/<slot>.<ext>` fills it; deleting the file empties it
// again. No template edit, no database row, no admin UI to keep in sync.
//
// Deliberately NOT a new media pipeline. Derivative generation, fit choice,
// LQIP, dominant colour and the sidecar manifest all come from
// lib/mediaDerivatives.js — the exact same code path product uploads use. This
// file only decides WHICH file belongs in WHICH hole. See
// tools/build-landing-assets.js for the generation step and
// server/docs/landing-assets.md for the operator workflow.
//
// An empty slot is not an error and never renders a broken image: the server
// drops the <img> entirely and marks the container, and CSS paints a branded
// fallback. A visitor must never see a technical placeholder — that is the
// whole reason this exists.

const SITE_ROOT = path.join(__dirname, "..", "..", "..");
const LANDING_DIR = path.join(SITE_ROOT, "assets", "images", "landing");
const LANDING_URL = "/assets/images/landing";

// Extensions accepted as a slot source, best format first. AVIF/WebP are
// accepted as SOURCES too (not just as generated derivatives) so an operator
// who already has an optimized file doesn't have to convert it back to JPEG
// just to feed the pipeline.
const SOURCE_EXTS = [".avif", ".webp", ".jpg", ".jpeg", ".png", ".svg"];

const MIME_BY_EXT = {
  ".avif": "image/avif",
  ".webp": "image/webp",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};

// The slot catalogue. `sizes` is the browser's width hint and must match how
// the slot is actually laid out in style/home-dynamic.css — getting it wrong
// makes the browser pick a derivative that is too small (soft) or too large
// (wasted bytes), which is the single easiest responsive-image mistake to make.
//
// `ideal` is quoted verbatim to the operator by the build tool, so the
// documented dimensions and the enforced ones can never drift apart.
const SLOTS = {
  showcase: {
    label: "Featured product showcase",
    ratio: "4 / 5",
    ideal: { width: 1200, height: 1500 },
    sizes: "(min-width: 1200px) 520px, (min-width: 768px) 46vw, 88vw",
    // Above the fold on tall phones once the hero is scrolled past, but never
    // the LCP element — the hero backdrop always is. Lazy is correct here.
    eager: false,
  },
  "promo-primary": {
    // The one slot whose shape CHANGES with the breakpoint: 16:9 while the
    // tiles are stacked, then roughly 0.85:1 on desktop, where this tile spans
    // the full height of the two beside it and its media absorbs the spare
    // column height. A square source is therefore the right thing to supply —
    // it cover-crops sensibly in both directions, whereas a 16:9 source loses
    // about half its width on desktop. Keep the subject centred.
    label: "Primary promo tile (large, left)",
    ratio: "16 / 9 stacked, ~0.85 / 1 on desktop",
    ideal: { width: 1200, height: 1200 },
    sizes: "(min-width: 992px) 800px, 92vw",
    eager: false,
  },
  "promo-secondary-a": {
    label: "Secondary promo tile (small, upper right)",
    ratio: "3 / 2",
    ideal: { width: 900, height: 600 },
    sizes: "(min-width: 992px) 380px, 92vw",
    eager: false,
  },
  "promo-secondary-b": {
    label: "Secondary promo tile (small, lower right)",
    ratio: "3 / 2",
    ideal: { width: 900, height: 600 },
    sizes: "(min-width: 992px) 380px, 92vw",
    eager: false,
  },
  // about.html's lead image. Replaced a "945X726" grey placeholder that sat
  // behind a play button wired to a YouTube "Scenic Relaxation Film" the theme
  // author left in.
  "about-lead": {
    label: "About page lead image",
    ratio: "4 / 3",
    ideal: { width: 1200, height: 900 },
    sizes: "(min-width: 992px) 560px, 92vw",
    eager: false,
  },
};

// Generated derivatives share the directory with their sources, so the slot
// scan has to be able to tell them apart. mediaDerivatives names them
// `<base>-<width>.<avif|webp>`; anything matching that is never a source.
const DERIVATIVE_SUFFIX = /-\d+\.(?:avif|webp)$/i;

function isSlotName(name) {
  return Object.prototype.hasOwnProperty.call(SLOTS, name);
}

// ---------------------------------------------------------------------------
// Disk scan, cached against the directory's mtime.
// ---------------------------------------------------------------------------
// Rebuilding the index on every homepage request would be a readdir per hit;
// never rebuilding it would mean a pm2 restart after every image drop. The
// directory's mtime changes whenever a file is added or removed from it — and
// the build tool always writes fresh derivative + manifest files alongside the
// source — so one stat() per request buys a zero-restart workflow.
//
// mediaDerivatives caches manifest MISSES for the process lifetime, which is
// what would otherwise pin a newly-filled slot to "empty" until a restart. So
// a changed directory also invalidates the manifest cache for every slot path.
let indexCache = null;
let indexCacheMtime = -1;

function scanSlots() {
  let entries;
  try {
    entries = fs.readdirSync(LANDING_DIR);
  } catch {
    return {}; // directory not created yet — every slot is simply empty
  }

  const found = {};
  for (const entry of entries) {
    const ext = path.extname(entry).toLowerCase();
    if (!SOURCE_EXTS.includes(ext)) continue;
    if (DERIVATIVE_SUFFIX.test(entry)) continue;

    const base = path.basename(entry, path.extname(entry));
    if (!isSlotName(base)) continue;

    // A slot with several extensions present (a leftover .png next to a new
    // .webp) resolves deterministically by SOURCE_EXTS order rather than by
    // whatever order the filesystem happened to return.
    const current = found[base];
    if (current && SOURCE_EXTS.indexOf(current.ext) <= SOURCE_EXTS.indexOf(ext)) continue;

    found[base] = { ext, fileName: entry, url: `${LANDING_URL}/${entry}` };
  }
  return found;
}

function slotIndex() {
  let mtime = -1;
  try {
    mtime = fs.statSync(LANDING_DIR).mtimeMs;
  } catch {
    mtime = 0;
  }
  if (indexCache && mtime === indexCacheMtime) return indexCache;

  const found = scanSlots();
  // The directory changed, so any manifest this process cached for a slot
  // path — including a cached `null` for a slot that was empty at boot — is
  // now suspect. Drop them all; there are only a handful.
  for (const name of Object.keys(SLOTS)) {
    for (const ext of SOURCE_EXTS) {
      invalidate(path.join(LANDING_DIR, name + ext));
    }
  }
  indexCache = found;
  indexCacheMtime = mtime;
  return found;
}

// ---------------------------------------------------------------------------
// Public read API
// ---------------------------------------------------------------------------

// Everything a renderer needs for one slot, or null when the slot is empty.
// `cover` is the same responsive payload shape product cards already consume,
// so anything that can render a product image can render a landing slot.
function resolveSlot(name) {
  const spec = SLOTS[name];
  if (!spec) return null;
  const file = slotIndex()[name];
  if (!file) return null;

  return {
    name,
    src: file.url,
    sizes: spec.sizes,
    ratio: spec.ratio,
    eager: spec.eager,
    // null for a source with no manifest yet (dropped but not built) — the
    // caller still gets a working <img src>, just without srcset/LQIP.
    cover: coverMedia(file.url),
  };
}

function resolveAll() {
  const out = {};
  for (const name of Object.keys(SLOTS)) out[name] = resolveSlot(name);
  return out;
}

module.exports = {
  SLOTS,
  SOURCE_EXTS,
  MIME_BY_EXT,
  DERIVATIVE_SUFFIX,
  LANDING_DIR,
  LANDING_URL,
  resolveSlot,
  resolveAll,
};
