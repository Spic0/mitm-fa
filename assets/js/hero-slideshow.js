// Homepage hero deck: an auto-rotating stack of real product cards, driven
// entirely by GET /api/products + GET /api/taxonomy. No hardcoded products,
// images or copy. Card 0 is server-rendered (applyHeroContext in
// server/src/routes/pages.js) so crawlers and no-JS visitors get a real
// product with a real link; this script recognises it by data-hero-id and
// reuses it rather than re-rendering a duplicate.
//
// WHAT CHANGED, AND WHY IT MATTERS
//
// This used to render each product as a full-bleed background at blur(22px)
// brightness(0.55) under a dark scrim. The product was unrecognisable — which
// defeated the point of showing products at all — and the <h1> over it was the
// product NAME, swapping every 6s, so the page never stated what the business
// sells. The headline and supporting copy are now fixed brand copy in the
// markup, and this file only manages the deck.
//
// Depth now comes from scale and opacity on the neighbouring cards. The active
// card is never blurred, never dimmed and never scaled down.
//
// Rotation is plain JS (setTimeout + an index), not the vendored Swiper.
// Swiper 8.3.2's `effect: "fade"` only animates between physically-adjacent
// slides; autoplay's wrap from last to first is a non-adjacent jump whose
// `transitionend` never fires, which leaves Swiper's internal `animating` flag
// stuck true and silently no-ops every later tick. That was the original
// "hero stops after two products" bug. A small manual carousel avoids it.
document.addEventListener("DOMContentLoaded", function () {
  var DELAY = 6000; // ms between slides
  var SIZES = "(min-width: 992px) 420px, (min-width: 576px) 320px, 62vw";
  // How many cards on each side of the active one get their image attached.
  // Only the active card and its two immediate neighbours are ever visible, so
  // a wider window would download bytes nothing can display. This is what
  // keeps a 300-product catalog from meaning 300 hero images.
  var WINDOW = 1;

  var section = document.querySelector(".hero");
  var deck = document.getElementById("heroDeck");
  if (!section || !deck || !window.ProFitAPI || !window.MediaContainer) return;

  // A visitor who has asked for reduced motion gets the first card, statically.
  // Not "the same animation, faster" — the request is for no motion, and a
  // deck that rotates on its own is exactly the kind of unrequested movement
  // the preference exists to switch off.
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // Every featured product (admin-curated, independent of taxonomy) or, if
  // none are featured, every published product newest-first so the hero is
  // never empty on a fresh catalog. Mirrors resolveHeroProduct() on the server.
  function selectHeroProducts(products) {
    var featured = products.filter(function (p) { return p.featured; });
    return featured.length
      ? featured
      : products.slice().sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
  }

  function buildCard(product) {
    var li = document.createElement("li");
    li.className = "hero-card";
    li.dataset.productId = product.id;

    var a = document.createElement("a");
    a.className = "hero-card__link";
    a.href = "/program/" + encodeURIComponent(product.slug);

    // The media box is deliberately built empty here and filled by attach()
    // below, so a card that never enters the window never costs a request.
    var media = document.createElement("span");
    media.className = "hero-card__media pmedia";

    var foot = document.createElement("span");
    foot.className = "hero-card__foot";
    var name = document.createElement("span");
    name.className = "hero-card__name";
    name.textContent = product.name;
    var price = document.createElement("span");
    price.className = "hero-card__price";
    price.textContent = window.ProFitAPI.formatProductPrice(product.priceCents);
    foot.appendChild(name);
    foot.appendChild(price);

    a.appendChild(media);
    a.appendChild(foot);
    li.appendChild(a);
    return li;
  }

  // Fills a card's media box using the shared container builder — the same one
  // every product grid uses — so the hero gets AVIF/WebP srcset, the LQIP, the
  // server-decided fit mode and intrinsic dimensions (hence no layout shift)
  // without a second implementation to keep in step.
  function attach(el, product, eager) {
    if (!el || el.dataset.attached === "1") return;
    var media = el.querySelector(".hero-card__media");
    if (!media) return;
    // No `ratio` passed: the card's shape comes from the deck (see
    // .hero__deck / .hero-card__media in home-dynamic.css), and setting
    // --pmedia-ratio here would be inert — the box has a definite width and a
    // flex-resolved height, so an aspect-ratio never applies.
    var box = window.MediaContainer.build(product, {
      sizes: SIZES,
      eager: !!eager,
    });
    // build() returns its own .pmedia element; move its children and classes
    // onto the card's existing box rather than swapping the node, so the
    // card's own layout classes survive.
    media.className = "hero-card__media " + box.className;
    while (box.firstChild) media.appendChild(box.firstChild);
    el.dataset.attached = "1";
  }

  // Releases a card that has rotated out of the window. Removing the nodes is
  // what actually frees the decoded image — leaving them in the DOM at
  // opacity 0 keeps every bitmap resident, which is the trap the handbook
  // viewer already documents.
  function detach(el) {
    if (!el || el.dataset.attached !== "1") return;
    var media = el.querySelector(".hero-card__media");
    if (!media) return;
    media.innerHTML = "";
    media.className = "hero-card__media pmedia";
    el.dataset.attached = "0";
  }

  Promise.all([
    window.ProFitAPI.listProducts(),
    window.ProFitAPI.getTaxonomy(),
  ]).then(function (results) {
    var products = results[0].products || [];
    if (!products.length) return; // leave the server-rendered card as-is

    var slides = selectHeroProducts(products);
    var ssrId = section.getAttribute("data-hero-id");
    var ssrEl = deck.querySelector("[data-hero-card]");
    var startIndex = slides.findIndex(function (p) { return String(p.id) === ssrId; });

    if (startIndex === -1) {
      // The server-rendered product is no longer in the client's set (it was
      // unpublished or un-featured between the two requests). Rebuild that one
      // card from real data rather than leaving stale copy on screen.
      startIndex = 0;
      if (ssrEl) {
        var fresh = buildCard(slides[0]);
        fresh.className = "hero-card is-active";
        fresh.setAttribute("data-hero-card", "");
        deck.replaceChild(fresh, ssrEl);
        ssrEl = fresh;
        attach(ssrEl, slides[0], true);
      }
    }
    if (ssrEl) {
      ssrEl.dataset.productId = slides[startIndex].id;
      // The SSR card already carries its own <picture>; mark it attached so
      // attach() never overwrites the markup the preload was pointed at.
      if (ssrEl.querySelector("img")) ssrEl.dataset.attached = "1";
    }

    var els = {};
    if (ssrEl) els[slides[startIndex].id] = ssrEl;
    slides.forEach(function (p, i) {
      if (i === startIndex) return;
      var el = buildCard(p);
      deck.appendChild(el);
      els[p.id] = el;
    });

    var currentIndex = startIndex;

    function at(i) {
      var n = slides.length;
      return slides[((i % n) + n) % n];
    }

    // Assigns the three visible roles and attaches/detaches images to match.
    // Everything else is left classless, which CSS renders as display:none —
    // so the deck's height is set by the active card alone and cannot grow
    // with the catalog.
    function layout() {
      var n = slides.length;
      var keep = {};
      for (var d = -WINDOW; d <= WINDOW; d++) keep[at(currentIndex + d).id] = true;

      slides.forEach(function (p, i) {
        var el = els[p.id];
        if (!el) return;
        var offset = i - currentIndex;
        // Shortest signed distance around the ring, so the card before index 0
        // is "prev", not "n-1 away".
        if (offset > n / 2) offset -= n;
        if (offset < -n / 2) offset += n;

        el.classList.remove("is-active", "is-prev", "is-next");
        if (offset === 0) el.classList.add("is-active");
        else if (offset === -1 && n > 1) el.classList.add("is-prev");
        else if (offset === 1 && n > 2) el.classList.add("is-next");

        // The active card is the only one a visitor can reach with a tap or
        // the keyboard; the flanking previews are decoration.
        var link = el.querySelector(".hero-card__link");
        if (link) {
          if (offset === 0) link.removeAttribute("tabindex");
          else link.setAttribute("tabindex", "-1");
        }
        el.setAttribute("aria-hidden", offset === 0 ? "false" : "true");

        if (keep[p.id]) attach(el, p, false);
        else detach(el);
      });
    }

    layout();

    if (slides.length <= 1 || reduceMotion) return;

    var timer = null;
    function scheduleNext() {
      // Re-scheduled after each step rather than setInterval, so there is
      // always exactly one pending timer to clear.
      timer = setTimeout(function () {
        currentIndex = (currentIndex + 1) % slides.length;
        layout();
        scheduleNext();
      }, DELAY);
    }
    function pause() {
      if (timer) clearTimeout(timer);
      timer = null;
    }
    function resume() {
      if (!timer) scheduleNext();
    }

    scheduleNext();
    section.addEventListener("mouseenter", pause);
    section.addEventListener("mouseleave", resume);
    // A backgrounded tab should not keep cycling: it burns nothing useful and
    // the visitor returns mid-rotation to a card they never saw start.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) pause();
      else resume();
    });
  }).catch(function () {
    // Real data failed to load — leave the server-rendered card exactly as it
    // is rather than emptying the hero.
  });
});
