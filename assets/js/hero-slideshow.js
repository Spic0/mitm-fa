// Homepage hero: a dynamic, auto-rotating product slideshow driven entirely
// by GET /api/products + GET /api/taxonomy — no hardcoded products, images,
// or copy. Slide 0 is already server-rendered into the page (see
// server/src/index.js -> applyHeroContext) so search engines and no-JS
// visitors see a real product immediately; this script recognizes that slide
// via data-hero-id, reuses it as slide 0, and adds the rest.
//
// Rotation is driven by plain JS (setTimeout + a currentIndex counter), not
// the vendored Swiper library: Swiper 8.3.2's `effect: "fade"` only animates
// correctly between physically-adjacent slides. Autoplay's own wrap-from-
// last-to-first step is a non-adjacent jump (and `loop: true`'s loopFix()
// realignment is effectively the same kind of jump), and either way the
// transition's `transitionend` never fires, which leaves Swiper's internal
// `animating`/`autoplay.paused` flags stuck `true` forever — every later
// autoplay tick then silently no-ops. Reproduced with Playwright: the hero
// advanced exactly once (slide 1 -> 2) and then froze for good, matching the
// reported "stops after two products" bug exactly. A small manual carousel
// sidesteps the bug entirely and is easier to reason about besides.
document.addEventListener("DOMContentLoaded", function () {
  var SPEED = 900; // ms; must match the .hero-slideshow__slide transition in home-dynamic.css
  var DELAY = 6000; // ms between slides, ~5-7s

  var section = document.querySelector(".hero-slideshow");
  var wrapper = document.getElementById("heroSwiperWrapper");
  var content = document.getElementById("heroContent");
  if (!section || !wrapper || !content || !window.ProFitAPI) return;

  var metaEl = content.querySelector("[data-hero-meta]");
  var titleEl = content.querySelector("[data-hero-title]");
  var descEl = content.querySelector("[data-hero-desc]");
  var priceEl = content.querySelector("[data-hero-price]");
  var ctaEl = content.querySelector("[data-hero-cta]");

  // ---- Selection: every featured product (admin-curated, spans every
  // taxonomy — "featured" is a product-level flag independent of which
  // goal/athlete/creator a product is tagged to) or, if none are featured
  // yet, every published product, newest first, so the hero is never empty
  // on a fresh catalog. Mirrors server/src/index.js's resolveHeroProduct().
  // No cap here — the hero must scale to however many products are
  // eligible, whether that's 3 or 300. ----
  function selectHeroProducts(products) {
    var featured = products.filter(function (p) { return p.featured; });
    return featured.length
      ? featured
      : products.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  }

  // Maps every taxonomy node id -> { name, parentName } so a product's flat
  // taxonomyNodeIds list can be turned into real, human-readable category/
  // athlete/creator names instead of opaque ids.
  function buildTaxonomyIndex(taxonomies) {
    var index = {};
    taxonomies.forEach(function (tree) {
      tree.nodes.forEach(function (node) {
        index[node.id] = { name: node.name, parentName: null };
        (node.children || []).forEach(function (child) {
          index[child.id] = { name: child.name, parentName: node.name };
        });
      });
    });
    return index;
  }

  // "Creator/Athlete · Category" line — creator is a direct product field;
  // category/athlete comes from the first resolvable taxonomy tag.
  function describeMeta(product, taxIndex) {
    var parts = [];
    if (product.creator) parts.push(product.creator);
    var tagged = (product.taxonomyNodeIds || [])
      .map(function (id) { return taxIndex[id]; })
      .filter(Boolean)[0];
    if (tagged) parts.push(tagged.parentName || tagged.name);
    return parts.join(" · ");
  }

  function updateContent(product, taxIndex) {
    if (metaEl) metaEl.textContent = describeMeta(product, taxIndex);
    if (titleEl) titleEl.textContent = product.name;
    if (descEl) descEl.textContent = product.description || "";
    if (priceEl) priceEl.textContent = window.ProFitAPI.formatPrice(product.priceCents);
    if (ctaEl) ctaEl.href = "/program/" + encodeURIComponent(product.slug);
    section.setAttribute("data-hero-id", product.id);
  }

  function buildSlideEl(product) {
    var slide = document.createElement("div");
    slide.className = "swiper-slide hero-slideshow__slide";
    // Starts hidden (only the SSR slide should show before this runs); the
    // CSS transition on .hero-slideshow__slide animates the fade in/out.
    slide.style.opacity = "0";
    var img = document.createElement("img");
    img.className = "hero-slideshow__bg-img";
    img.alt = "";
    img.loading = "lazy";
    window.MediaContainer.applyResponsive(img, product, "100vw");
    slide.appendChild(img);
    slide.dataset.productId = product.id;
    return slide;
  }

  // Warms the browser cache for one slide's image ahead of the transition
  // that will need it, instead of loading every slide's image up front.
  function preload(product) {
    if (!product || !product.imageUrl) return;
    var img = new Image();
    window.MediaContainer.applyResponsive(img, product, "100vw");
  }

  Promise.all([
    window.ProFitAPI.listProducts(),
    window.ProFitAPI.getTaxonomy(),
  ]).then(function (results) {
    var products = results[0].products || [];
    var taxonomies = results[1].taxonomies || [];
    if (!products.length) return; // leave the server-rendered slide 0 as-is

    var taxIndex = buildTaxonomyIndex(taxonomies);
    var slides = selectHeroProducts(products);

    var ssrId = section.getAttribute("data-hero-id");
    var ssrSlideEl = wrapper.querySelector(".swiper-slide");
    var startIndex = slides.findIndex(function (p) { return String(p.id) === ssrId; });

    if (startIndex === -1) {
      // Server-rendered slide isn't in the client's slide set (e.g. it was
      // unpublished/un-featured between the SSR response and this fetch) —
      // replace it with the first real slide rather than leaving stale copy.
      updateContent(slides[0], taxIndex);
      if (ssrSlideEl) {
        var freshImg = ssrSlideEl.querySelector("img");
        if (freshImg) window.MediaContainer.applyResponsive(freshImg, slides[0], "100vw");
      }
      startIndex = 0;
    }
    if (ssrSlideEl) {
      // Reuse the already-rendered/visible SSR slide as the active slide
      // (no flash); tag it with the product id and mark it opaque so later
      // opacity toggling has a real starting state to transition from.
      ssrSlideEl.dataset.productId = slides[startIndex].id;
      ssrSlideEl.style.opacity = "1";
    }

    // Map every product id -> its slide element, so rotation can jump
    // straight to "the element for index i" without caring about DOM order.
    var slideEls = {};
    if (ssrSlideEl) slideEls[slides[startIndex].id] = ssrSlideEl;
    slides.forEach(function (p, i) {
      if (i === startIndex) return;
      var el = buildSlideEl(p);
      wrapper.appendChild(el);
      slideEls[p.id] = el;
    });
    if (slides.length > 1) preload(slides[(startIndex + 1) % slides.length]);

    if (slides.length <= 1) return; // nothing to rotate to

    var currentIndex = startIndex;
    var timer = null;

    function goTo(nextIndex) {
      // Always wrap into range — handles any slide count, including after
      // the last one, without ever going out of bounds.
      nextIndex = ((nextIndex % slides.length) + slides.length) % slides.length;
      if (nextIndex === currentIndex) return;

      var current = slides[currentIndex];
      var next = slides[nextIndex];
      var currentEl = slideEls[current.id];
      var nextEl = slideEls[next.id];
      if (currentEl) currentEl.style.opacity = "0";
      if (nextEl) nextEl.style.opacity = "1";

      // Content fades/slides out, swaps at the transition midpoint, then
      // fades/slides back in — synced to the background's own fade so
      // nothing changes abruptly.
      content.classList.add("hero-slideshow__content--out");
      setTimeout(function () {
        updateContent(next, taxIndex);
        content.classList.remove("hero-slideshow__content--out");
      }, SPEED * 0.45);

      // Preload the slide after next, ahead of when it'll be needed.
      preload(slides[(nextIndex + 1) % slides.length]);

      currentIndex = nextIndex;
    }

    // Re-schedules itself after every transition rather than using
    // setInterval, so there is always exactly one pending timer — nothing to
    // leak or double-fire, and pausing is just clearing this one handle.
    function scheduleNext() {
      timer = setTimeout(function () {
        goTo(currentIndex + 1);
        scheduleNext();
      }, DELAY);
    }

    function pause() {
      if (timer) clearTimeout(timer);
      timer = null;
    }

    scheduleNext();
    section.addEventListener("mouseenter", pause); // desktop hover-pause
    section.addEventListener("mouseleave", function () {
      if (!timer) scheduleNext();
    });
  }).catch(function () {
    // Real data failed to load — leave the server-rendered first slide
    // exactly as it is rather than breaking the hero.
  });
});
