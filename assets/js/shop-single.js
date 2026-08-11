// Renders the product detail page for whichever product's slug is in the
// URL, instead of always showing the same hardcoded product. The add-to-bag
// button here isn't nested inside a .product__item card like the shop grid,
// so script.js's cart handler can't read name/price/image from sibling DOM
// text — it falls back to data-name/data-price/data-img, which we set
// explicitly below alongside the real data-id.
document.addEventListener("DOMContentLoaded", function () {
  var titleEl = document.getElementById("productTitle");
  if (!titleEl || !window.ProFitAPI) return;

  var slug = decodeURIComponent(window.location.pathname.replace(/^\/program\//, "").split(/[/?#]/)[0] || "");

  function showNotFound() {
    titleEl.textContent = "Plan not found";
    var descEl = document.getElementById("productDescriptionShort");
    if (descEl) descEl.textContent = "This plan may have been removed. Browse all current plans instead.";
    var priceEl = document.getElementById("productPrice");
    if (priceEl) priceEl.textContent = "";
  }

  if (!slug) {
    showNotFound();
    return;
  }

  // The markup ships four placeholder slides, and this file used to set the
  // *same* p.imageUrl on every one of them — so every product rendered a
  // 4-slide carousel of one repeated image, with a thumb strip of four
  // identical thumbnails under it. Slides are now built from the product's
  // real media list, so a single-image product renders a single slide.
  //
  // p.media is the forward-compatible shape (an ordered array the CMS will
  // populate once Product gains a media relation — it has only imageUrl
  // today). Until then this resolves to exactly one image and the carousel
  // machinery below is simply a no-op, so nothing here waits on the schema.
  // Each entry carries its `cover` payload (responsive derivatives, intrinsic
  // size) alongside the raw url. That payload is what stops this page shipping
  // the full-resolution upload: a 1122x1402 / 2.0MB PNG cover was being handed
  // straight to <img src> here, eagerly, as the LCP element — 26x more bytes
  // than the 960px AVIF derivative that already existed on disk beside it.
  //
  // The cover derivatives have been generated since the upload pipeline landed;
  // the shop grid and the hero have used them all along via MediaContainer.
  // This renderer simply never asked for them, which is the same "two renderers,
  // one of them forgotten" failure the handbook media pipeline already hit.
  function mediaListFor(p) {
    if (Array.isArray(p.media) && p.media.length) {
      return p.media
        .filter(function (m) { return m && m.url; })
        .map(function (m) {
          return { url: m.url, type: m.type || guessType(m.url), cover: m.cover || null };
        });
    }
    return p.imageUrl ? [{ url: p.imageUrl, type: guessType(p.imageUrl), cover: p.cover || null }] : [];
  }

  function guessType(url) {
    return /\.(mp4|webm|mov)(\?|$)/i.test(url) ? "video" : "image";
  }

  // How wide the gallery actually renders, per breakpoint — read off the real
  // layout, not guessed. Desktop is a Bootstrap col-lg-6 inside the standard
  // container (~615px at 1440). Below 992px the gallery goes full width, and
  // on phones shop-single.css caps it at `max-height: 38vh` with `width: auto`,
  // which at 390x844 works out to roughly a 256px-wide box — so a phone pulls
  // the 320w derivative and never a desktop-sized asset.
  var MAIN_SIZES = "(min-width: 1200px) 615px, (min-width: 992px) 50vw, (min-width: 768px) 90vw, 60vw";
  // The thumb strip is desktop-only (hidden under 992px) at ~92px per cell.
  var THUMB_SIZES = "120px";

  // Built as DOM nodes, never an HTML string: these URLs come back from the
  // API and would otherwise need escaping at every interpolation point.
  function slideNode(item, alt, isThumb, isFirst) {
    var slide = document.createElement("div");
    slide.className = isThumb ? "swiper-slide slide-smoll" : "swiper-slide";

    // A video thumb still shows a still frame, so thumbs stay <img> where
    // possible; only the main slide plays.
    if (item.type === "video" && !isThumb) {
      var video = document.createElement("video");
      video.className = "product-gallery-img";
      video.src = item.url;
      video.muted = true;
      video.loop = true;
      video.autoplay = true;
      video.playsInline = true;
      // Autoplay is only permitted for muted inline video; `muted` must be
      // set as an attribute too or iOS Safari ignores it on some versions.
      video.setAttribute("muted", "");
      video.setAttribute("playsinline", "");
      video.preload = "none";
      slide.appendChild(video);
      return slide;
    }

    var img = document.createElement("img");
    img.className = "product-gallery-img";
    img.alt = alt;
    img.decoding = "async";
    // The first slide is the LCP element on this page — it must not be
    // lazy-loaded or it lands after first paint. Every LATER slide is off
    // screen behind the carousel, so it is lazy: a four-image gallery must not
    // cost four full downloads before the customer has swiped once.
    img.loading = isThumb || !isFirst ? "lazy" : "eager";
    if (isFirst && !isThumb) img.setAttribute("fetchpriority", "high");

    // src stays the original as the final fallback, exactly as before, so a
    // product whose image predates the derivative pipeline (or is an SVG/GIF,
    // which are deliberately never rasterised) renders identically to before.
    img.src = item.url;

    // Thumbs render at ~92px in a 1/1 box; the main slide fills the gallery
    // column. Asking for the right one is the whole point — a shared `sizes`
    // would have the thumb strip pulling 960px derivatives.
    var sizes = isThumb ? THUMB_SIZES : MAIN_SIZES;
    var node = window.MediaContainer
      ? window.MediaContainer.pictureFor(img, item.cover, sizes)
      : img;

    slide.appendChild(node);
    return slide;
  }

  function renderGallery(p) {
    var media = mediaListFor(p);
    if (!media.length) return;

    var mainWrap = document.querySelector("#productGallery .shop-single-slide .swiper-wrapper");
    var thumbWrap = document.querySelector("#productGallery .shop-slider-thumb .swiper-wrapper");
    if (!mainWrap) return;

    mainWrap.replaceChildren.apply(
      mainWrap,
      media.map(function (m, i) { return slideNode(m, p.name, false, i === 0); })
    );

    if (thumbWrap) {
      thumbWrap.replaceChildren.apply(
        thumbWrap,
        media.map(function (m, i) { return slideNode(m, p.name, true, i === 0); })
      );
      // One media item means the thumb strip is just a smaller copy of the
      // slide above it — hidden rather than rendered as a lone thumbnail.
      var thumbRoot = document.querySelector("#productGallery .shop-slider-thumb");
      if (thumbRoot) thumbRoot.style.display = media.length > 1 ? "" : "none";
    }

    // Swiper cached slide positions from the placeholder markup; without
    // this it keeps paginating over the old four.
    var instances = window.ProFitShopSwiper;
    if (instances) {
      if (instances.thumbs) instances.thumbs.update();
      if (instances.main) {
        instances.main.update();
        // loop clones are stale after a wholesale slide swap
        if (instances.main.params.loop) instances.main.loopDestroy();
        if (media.length > 1 && instances.main.params.loop) instances.main.loopCreate();
        instances.main.slideTo(0, 0);
        if (instances.main.pagination) instances.main.pagination.render();
        if (instances.main.pagination) instances.main.pagination.update();
      }
    }

    // A single item is not a carousel — no dots, no advancing.
    var gallery = document.getElementById("productGallery");
    if (gallery) gallery.classList.toggle("has-multiple-media", media.length > 1);
    if (media.length > 1) startAutoAdvance(media);
  }

  // Advance through the gallery on its own, but pace each slide by what is
  // actually on it: a fixed interval either cuts a video off partway or
  // leaves a still image sitting there long after the viewer has read it.
  //
  // Videos keep looping (the brief asks for muted/loop/autoplay) — this only
  // decides when to move on, after roughly one full pass of the clip.
  var advanceTimer = null;
  var IMAGE_MS = 4000;
  var VIDEO_MAX_MS = 8000;

  function startAutoAdvance(media) {
    var instances = window.ProFitShopSwiper;
    if (!instances || !instances.main) return;
    var sw = instances.main;

    function currentSlideEl() {
      return sw.slides && sw.slides[sw.activeIndex];
    }

    function scheduleNext() {
      clearTimeout(advanceTimer);
      var el = currentSlideEl();
      var video = el && el.querySelector("video");
      var wait = IMAGE_MS;

      if (video) {
        // Only start fetching a video once its slide is actually shown —
        // this is what keeps `preload="none"` meaningful and stops a
        // multi-video gallery from pulling megabytes at page load.
        if (video.preload === "none") video.preload = "auto";
        var play = video.play();
        if (play && play.catch) play.catch(function () {});
        var dur = video.duration;
        wait = dur && isFinite(dur) ? Math.min(dur * 1000, VIDEO_MAX_MS) : VIDEO_MAX_MS;
      }

      advanceTimer = setTimeout(function () {
        sw.slideNext();
      }, wait);
    }

    // Pausing off-screen matters more here than usual: this sits above the
    // fold, so without it every product page burns a timer (and a decoding
    // video) for as long as the tab is open in the background.
    function stop() { clearTimeout(advanceTimer); }

    sw.on("slideChange", scheduleNext);
    sw.on("touchStart", stop);
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) stop();
      else scheduleNext();
    });

    scheduleNext();
  }

  window.ProFitAPI.getProduct(slug).then(function (data) {
    var p = data.product;

    titleEl.textContent = p.name;
    document.getElementById("productPrice").textContent = window.ProFitAPI.formatProductPrice(p.priceCents);
    document.getElementById("productDescriptionShort").textContent = p.description || "";

    var categoryLink = document.getElementById("productCategoryLink");
    if (categoryLink) categoryLink.textContent = p.category || "Training Plans";

    // Creator is part of what the first screen has to answer ("what is this,
    // who made it, how much"). Hidden rather than left as an empty line when
    // the product has no creator set, so it never adds blank space.
    var creatorEl = document.getElementById("productCreator");
    if (creatorEl) {
      if (p.creator) {
        creatorEl.textContent = "by " + p.creator;
        creatorEl.style.display = "";
      } else {
        creatorEl.style.display = "none";
      }
    }

    renderGallery(p);

    var addToCartBtn = document.getElementById("productAddToCart");
    if (addToCartBtn) {
      addToCartBtn.dataset.id = p.id;
      addToCartBtn.dataset.slug = p.slug;
      addToCartBtn.dataset.name = p.name;
      addToCartBtn.dataset.price = (p.priceCents / 100).toFixed(2);
      addToCartBtn.dataset.img = p.imageUrl;
    }
  }).catch(function () {
    showNotFound();
  });

  // Collapsed-by-default discount code — a small reveal, never competing
  // with the Add to Bag CTA for attention.
  var discountToggle = document.getElementById("discountToggle");
  var discountRow = document.getElementById("discountRow");
  if (discountToggle && discountRow) {
    discountToggle.addEventListener("click", function () {
      var showing = discountRow.style.display !== "none";
      discountRow.style.display = showing ? "none" : "flex";
      discountToggle.style.display = showing ? "" : "none";
    });
  }
});
