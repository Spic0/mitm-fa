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
  function mediaListFor(p) {
    if (Array.isArray(p.media) && p.media.length) {
      return p.media
        .filter(function (m) { return m && m.url; })
        .map(function (m) {
          return { url: m.url, type: m.type || guessType(m.url) };
        });
    }
    return p.imageUrl ? [{ url: p.imageUrl, type: guessType(p.imageUrl) }] : [];
  }

  function guessType(url) {
    return /\.(mp4|webm|mov)(\?|$)/i.test(url) ? "video" : "image";
  }

  // Built as DOM nodes, never an HTML string: these URLs come back from the
  // API and would otherwise need escaping at every interpolation point.
  function slideNode(item, alt, isThumb) {
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
    img.src = item.url;
    img.alt = alt;
    // The first slide is the LCP element on this page — it must not be
    // lazy-loaded or it lands after first paint.
    img.loading = isThumb ? "lazy" : "eager";
    slide.appendChild(img);
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
      media.map(function (m) { return slideNode(m, p.name, false); })
    );

    if (thumbWrap) {
      thumbWrap.replaceChildren.apply(
        thumbWrap,
        media.map(function (m) { return slideNode(m, p.name, true); })
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
    document.getElementById("productPrice").textContent = window.ProFitAPI.formatPrice(p.priceCents);
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
