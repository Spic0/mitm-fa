// Builds the universal product media container.
//
// Everything that decides how an image is fitted was computed once, on the
// server, at upload time (see server/src/lib/mediaDerivatives.js) and arrives
// on the product payload as `cover`. This file only applies it. That split is
// deliberate: the browser cannot know an image's aspect ratio until it has
// downloaded it, so any fit decision made here would necessarily happen after
// layout — which is exactly the jumping this replaces.
//
// Degrades in a straight line:
//   cover present  -> <picture> with AVIF/WebP srcset, correct fit, LQIP
//   cover missing  -> plain <img src=imageUrl> in the same fixed-ratio box
//   no image       -> empty box of the right shape
// The box shape never depends on any of that, so the grid is stable in all
// three cases.
window.MediaContainer = (function () {
  // Matches the breakpoints the card actually renders at, so the browser can
  // pick a derivative rather than guessing the largest. Keep in step with the
  // grid columns in style.css.
  var DEFAULT_SIZES = "(min-width: 1200px) 380px, (min-width: 992px) 33vw, (min-width: 768px) 50vw, 92vw";

  function el(tag, cls) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    return n;
  }

  // First URL out of the narrowest srcset — used for the blurred backdrop,
  // where resolution is irrelevant and the original would be pure waste.
  function smallestDerivative(cover) {
    if (!cover || !cover.sources || !cover.sources.length) return null;
    // Prefer WebP over AVIF here: the backdrop is decorative and WebP decodes
    // faster, and every browser that supports AVIF also supports WebP.
    var pick = cover.sources.filter(function (s) { return s.type === "image/webp"; })[0] || cover.sources[0];
    var first = String(pick.srcset).split(",")[0].trim().split(/\s+/)[0];
    return first || null;
  }

  // `opts.eager` marks above-the-fold media: it skips lazy loading and asks
  // the browser to prioritise the fetch. Used for the first row of cards,
  // which is where the LCP element almost always is — lazy-loading that is a
  // measurable regression, not an optimization.
  //
  // `opts.preload` is the third state, for media that must be IN THE BROWSER
  // before it is shown but must not compete with the LCP: it fetches
  // immediately, like eager, but at low priority. The hero deck is the caller
  // — a card waiting off-stage is display:none, and a `loading="lazy"` image
  // inside a display:none subtree never intersects anything, so it would
  // never load at all and the card would slide onto the stage empty.
  function build(product, opts) {
    opts = opts || {};
    var cover = product.cover || null;
    var src = (cover && cover.src) || product.imageUrl || "";

    var box = el("div", "pmedia");
    var fit = cover ? cover.fit : "cover";
    if (cover && cover.orientation === "vector") box.classList.add("pmedia--vector");
    else box.classList.add(fit === "contain" ? "pmedia--contain" : "pmedia--cover");

    if (cover && cover.colour) box.style.setProperty("--pmedia-bg", cover.colour);
    if (opts.ratio) box.style.setProperty("--pmedia-ratio", opts.ratio);

    if (!src) return box;

    // LQIP: a ~100-byte inline data URI, so it costs no request and is painted
    // in the same frame as the card.
    if (cover && cover.placeholder) {
      var ph = el("img", "pmedia__placeholder");
      ph.src = cover.placeholder;
      ph.alt = "";
      ph.setAttribute("aria-hidden", "true");
      box.appendChild(ph);
    }

    // A letterboxed image gets a blurred copy of itself filling the gaps, so
    // odd aspect ratios still read as a designed card.
    if (fit === "contain" && cover && cover.orientation !== "vector") {
      var bd = el("img", "pmedia__backdrop");
      // The SMALLEST derivative, never the original. This is rendered behind
      // the real image at blur(18px) — no one can tell the difference — but
      // pointing it at `src` meant a 636KB cover was downloaded a second time
      // purely to be blurred into a background. Falls back to the original
      // only when no derivative exists (SVG/GIF, or a pre-backfill image).
      bd.src = smallestDerivative(cover) || src;
      bd.alt = "";
      bd.setAttribute("aria-hidden", "true");
      bd.decoding = "async";
      bd.loading = opts.eager || opts.preload ? "eager" : "lazy";
      bd.addEventListener("load", function () { bd.classList.add("is-loaded"); });
      box.appendChild(bd);
    }

    var img = el("img", "pmedia__img");
    img.alt = product.name || "";
    img.decoding = "async";
    img.loading = opts.eager || opts.preload ? "eager" : "lazy";
    if (opts.eager) img.setAttribute("fetchpriority", "high");
    else if (opts.preload) img.setAttribute("fetchpriority", "low");

    // Intrinsic dimensions let the browser reserve the right box even before
    // CSS applies, which keeps CLS at 0 on a slow first paint.
    if (cover && cover.width && cover.height) {
      img.width = cover.width;
      img.height = cover.height;
    }

    // An image smaller than the card is capped at 2x its own resolution rather
    // than being blown up to fill the box. Upscaling a 32x32 favicon to 330px
    // produces an unreadable smear — there are no pixels there to recover — so
    // it renders small and sharp, centred on its blurred backdrop instead.
    // 2x (not 1x) because these are usually icons/logos that read fine with a
    // little enlargement on a HiDPI screen.
    if (cover && cover.tiny && cover.width && cover.height) {
      box.classList.add("pmedia--tiny");
      img.style.maxWidth = cover.width * 2 + "px";
      img.style.maxHeight = cover.height * 2 + "px";
    }

    var node = img;
    if (cover && cover.sources && cover.sources.length) {
      var picture = el("picture");
      cover.sources.forEach(function (s) {
        var source = el("source");
        source.type = s.type;
        source.srcset = s.srcset;
        source.sizes = opts.sizes || DEFAULT_SIZES;
        picture.appendChild(source);
      });
      img.sizes = opts.sizes || DEFAULT_SIZES;
      picture.appendChild(img);
      node = picture;
    }
    img.src = src;

    function reveal() {
      img.classList.add("is-loaded");
      box.classList.add("is-ready");
    }
    // complete === already decoded from cache, in which case no load event is
    // coming and the fade would never start.
    if (img.complete && img.naturalWidth > 0) {
      img.setAttribute("data-instant", "");
      box.classList.add("is-ready");
    } else {
      img.addEventListener("load", reveal);
      // A broken image must not leave the card stuck behind a blurred
      // placeholder forever — drop to the flat background colour instead.
      img.addEventListener("error", function () {
        box.classList.add("is-ready");
        img.remove();
      });
    }

    box.appendChild(node);
    return box;
  }

  // Points an existing <img> at the responsive derivatives instead of the
  // original upload.
  //
  // For the places that manage their own <img> and only need the bytes fixed —
  // the hero backdrop and the deal-cards strip — rather than the full
  // container treatment. Both were assigning `product.imageUrl` directly,
  // which meant the landing page downloaded one 636KB original twice over.
  //
  // srcset only ever offers sizes that actually exist, and src keeps the
  // original as the final fallback, so an image with no manifest behaves
  // exactly as it did before.
  //
  // RETURNS THE NODE TO INSERT, which is not always the <img> that went in:
  // when derivatives exist it comes back wrapped in a <picture>. Callers must
  // append the return value, not the img they passed.
  //
  // It used to set `srcset` on the <img> directly. That works, but an <img>
  // carries exactly one srcset and therefore exactly one format — so it picked
  // WebP and left AVIF unused, even though every derivative is generated in
  // both and AVIF is typically 25-30% smaller again. Measured on the nav
  // thumbnail: 75KB WebP where the AVIF beside it is 52KB.
  function applyResponsive(img, product, sizes) {
    if (!img) return img;
    var cover = product && product.cover;
    var src = (cover && cover.src) || (product && product.imageUrl) || "";
    img.src = src;
    if (!cover || !cover.sources || !cover.sources.length) return img;
    return pictureFor(img, cover, sizes);
  }

  // Wraps a caller-owned <img> in a <picture> offering every derivative format.
  //
  // This exists alongside applyResponsive() because that one sets `srcset` on
  // the <img> directly, which can only ever offer ONE format — it picks WebP
  // and leaves AVIF (typically 25-30% smaller again) on the table. That is an
  // acceptable trade for a decorative backdrop; it is not acceptable for the
  // product page's main image, which is the LCP element on that page.
  //
  // The caller keeps ownership of the <img> — its classes, alt, loading and
  // fetchpriority are already set by the surface that created it, and the
  // gallery's CSS is bound to `.product-gallery-img`. So this returns either
  // the new <picture> or, when there are no derivatives, the original <img>
  // untouched, and the caller inserts whatever comes back.
  //
  // NOTE: <source> must precede the <img> inside <picture>, and the <img> must
  // stay the last child — the browser picks the first <source> whose type it
  // supports and falls back to the <img> only if none match.
  function pictureFor(img, cover, sizes) {
    if (!img) return img;
    if (!cover || !cover.sources || !cover.sources.length) return img;

    var picture = el("picture");
    cover.sources.forEach(function (s) {
      var source = el("source");
      source.type = s.type;
      source.srcset = s.srcset;
      source.sizes = sizes || DEFAULT_SIZES;
      picture.appendChild(source);
    });
    // `sizes` on the <img> as well: it applies to the fallback path and is what
    // the preload scanner reads.
    img.sizes = sizes || DEFAULT_SIZES;

    // Intrinsic dimensions reserve the box before any byte arrives. The
    // gallery's CSS already pins an aspect-ratio, so this is belt-and-braces
    // for the moment before the stylesheet applies.
    if (cover.width && cover.height) {
      img.width = cover.width;
      img.height = cover.height;
    }

    picture.appendChild(img);
    return picture;
  }

  return { build: build, applyResponsive: applyResponsive, pictureFor: pictureFor, smallestDerivative: smallestDerivative, DEFAULT_SIZES: DEFAULT_SIZES };
})();
