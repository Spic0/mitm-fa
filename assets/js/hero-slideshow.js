// Homepage hero: a depth stack of real product cards, driven entirely by
// GET /api/products + GET /api/taxonomy. No hardcoded products, images or copy.
// Card 0 is server-rendered (applyHeroContext in server/src/routes/pages.js) so
// crawlers and no-JS visitors get a real product with a real link; this script
// recognises it by data-hero-id and reuses it rather than re-rendering a
// duplicate.
//
// THE MOTION SYSTEM
//
// Cards are not animated individually. There are four SLOTS — prev, active,
// next, and a transient exit — and a card is only ever assigned to a slot. All
// geometry (position, Z depth, Y rotation, scale, blur, opacity, shadow) lives
// in home-dynamic.css against those slot classes, and every change is a class
// swap that the browser tweens. That is what makes the sequence coherent:
// the card leaving the stack and the card arriving are running the same
// transition on the same properties at the same time, so they read as one
// movement rather than two animations that happen to overlap.
//
//   forward:  active -> prev -> exit-left        next -> active
//   backward: active -> next -> exit-right       prev -> active
//
// A card only EXITS when it falls out of the window entirely, so with 4+
// products the visitor watches a continuous flow of plates travelling through
// the stack rather than three elements swapping states.
//
// Rotation is plain JS (setTimeout + an index), not the vendored Swiper.
// Swiper 8.3.2's `effect: "fade"` only animates between physically-adjacent
// slides; autoplay's wrap from last to first is a non-adjacent jump whose
// `transitionend` never fires, which leaves Swiper's internal `animating` flag
// stuck true and silently no-ops every later tick. That was the original
// "hero stops after two products" bug. A small manual carousel avoids it, and
// is also what keeps the DOM bounded — see WINDOW below.
document.addEventListener("DOMContentLoaded", function () {
  var section = document.querySelector(".hero");
  var deck = document.getElementById("heroDeck");
  if (!section || !deck || !window.ProFitAPI || !window.MediaContainer) return;

  // Timings are declared ONCE, in CSS (.hero), and read back here. Duplicating
  // them as JS literals is how a transition ends up half-finished when the
  // next tick fires — the two numbers drift the moment either is tuned.
  function ms(name, fallback) {
    var raw = getComputedStyle(section).getPropertyValue(name).trim();
    if (!raw) return fallback;
    var n = parseFloat(raw);
    if (isNaN(n)) return fallback;
    return /ms$/.test(raw) ? n : n * 1000;
  }
  var DUR = ms("--hero-dur", 620);
  var DWELL = ms("--hero-dwell", 3200);

  var SIZES = "(min-width: 992px) 420px, (min-width: 576px) 320px, 62vw";
  // How many cards on each side of the active one get their image attached.
  // Only the active card and its two immediate neighbours are ever on stage, so
  // a wider window would download bytes nothing can display. This is what keeps
  // a 300-product catalog from meaning 300 hero images, and it is why the
  // infinite loop costs no extra DOM: the deck holds one <li> per product but
  // at most four carry an <img>, and the rest are display:none.
  var WINDOW = 1;

  var SLOTS = ["is-active", "is-prev", "is-next", "is-exit-left", "is-exit-right"];

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

  // KEEP IN STEP WITH heroEyebrow/heroMeta in server/src/routes/pages.js, which
  // renders the same two fields for card 0. See the note there.
  function eyebrowFor(p) {
    var creator = (p.creator || "").trim();
    var name = (p.name || "").toLowerCase();
    if (creator && name.indexOf(creator.toLowerCase()) === -1) return creator;
    if (p.difficulty) return p.difficulty;
    return creator || "Training program";
  }
  function metaFor(p) {
    var parts = [window.ProFitAPI.formatProductPrice(p.priceCents)];
    if (p.durationWeeks) parts.push(p.durationWeeks + " weeks");
    return parts.join("  ·  ");
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

    var info = document.createElement("span");
    info.className = "hero-card__info";
    var eyebrow = document.createElement("span");
    eyebrow.className = "hero-card__eyebrow";
    eyebrow.textContent = eyebrowFor(product);
    var name = document.createElement("span");
    name.className = "hero-card__name";
    name.textContent = product.name;
    var meta = document.createElement("span");
    meta.className = "hero-card__meta";
    meta.textContent = metaFor(product);
    info.appendChild(eyebrow);
    info.appendChild(name);
    info.appendChild(meta);

    a.appendChild(media);
    a.appendChild(info);
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
    var box = window.MediaContainer.build(product, { sizes: SIZES, eager: !!eager });
    // build() returns its own .pmedia element; move its children and classes
    // onto the card's existing box rather than swapping the node, so the
    // card's own layout classes survive.
    media.className = "hero-card__media " + box.className;
    while (box.firstChild) media.appendChild(box.firstChild);
    el.dataset.attached = "1";
  }

  // Releases a card that has left the stack. Removing the nodes is what
  // actually frees the decoded image — leaving them in the DOM at opacity 0
  // keeps every bitmap resident, which is the trap the handbook viewer already
  // documents. This is the other half of the infinite loop's memory story: the
  // window slides, and everything behind it is torn back down to an empty box.
  function detach(el) {
    if (!el || el.dataset.attached !== "1") return;
    var media = el.querySelector(".hero-card__media");
    if (!media) return;
    media.innerHTML = "";
    media.className = "hero-card__media pmedia";
    el.dataset.attached = "0";
  }

  // Assigns a slot. `instant` suppresses the tween for one frame — used when a
  // card has to be repositioned somewhere it could not travel to continuously.
  function setSlot(el, slot, instant) {
    if (!el) return;
    if (el.dataset.slot === slot) return;
    if (instant) {
      el.classList.add("is-instant");
      // Force the class change to be picked up with transitions off before the
      // next paint, then re-enable them. Without the reflow the browser
      // collapses both class changes into one style recalculation and the
      // suppression never applies.
      SLOTS.forEach(function (s) { el.classList.remove(s); });
      if (slot) el.classList.add(slot);
      void el.offsetWidth;
      el.classList.remove("is-instant");
    } else {
      SLOTS.forEach(function (s) { el.classList.remove(s); });
      if (slot) el.classList.add(slot);
    }
    el.dataset.slot = slot || "";

    // Only the active card is reachable by tap or keyboard; the rest are
    // decoration and must not be tab stops behind the front plate.
    var link = el.querySelector(".hero-card__link");
    if (link) {
      if (slot === "is-active") link.removeAttribute("tabindex");
      else link.setAttribute("tabindex", "-1");
    }
    el.setAttribute("aria-hidden", slot === "is-active" ? "false" : "true");
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

    var n = slides.length;
    var currentIndex = startIndex;

    function at(i) { return slides[((i % n) + n) % n]; }

    // ---- progress -------------------------------------------------------
    var progressEl = section.querySelector("[data-hero-progress]");
    var segs = [];
    if (progressEl && n > 1) {
      slides.forEach(function () {
        var s = document.createElement("span");
        s.className = "hero__progress-seg";
        progressEl.appendChild(s);
        segs.push(s);
      });
    }
    var isPaused = false;
    function paintProgress() {
      segs.forEach(function (s, i) {
        s.classList.remove("is-active", "is-done");
        if (i < currentIndex) s.classList.add("is-done");
        else if (i === currentIndex) {
          // Restart the fill animation from zero on every step. Removing and
          // re-adding the class in the same frame is a no-op, so the node is
          // replaced instead — the cheapest reliable animation reset.
          var fresh = s.cloneNode(false);
          fresh.className = "hero__progress-seg is-active";
          // A step can land while the section is paused (a backgrounded tab
          // still runs the pending timeout once). The replacement node has no
          // memory of that, so the paused state has to be re-applied or the
          // bar animates on alone. CSSOM, not a style attribute — the site's
          // CSP sends `style-src-attr 'self'` and drops inline style attrs.
          if (isPaused) fresh.style.setProperty("animation-play-state", "paused");
          s.replaceWith(fresh);
          segs[i] = fresh;
        }
      });
    }

    // ---- slot assignment -------------------------------------------------
    // `dir` is +1 forward, -1 backward, 0 for the initial paint. It decides
    // which side a departing card leaves from, which is the whole reason the
    // motion reads as travel rather than as a crossfade.
    function layout(dir) {
      var wanted = {};
      wanted[at(currentIndex).id] = "is-active";
      // With two products there is only one flank, and at(i-1) === at(i+1);
      // assigning next last means the single neighbour sits on the incoming
      // side, which is the one the eye is already tracking.
      if (n > 2) wanted[at(currentIndex - 1).id] = "is-prev";
      if (n > 1) wanted[at(currentIndex + 1).id] = "is-next";

      slides.forEach(function (p) {
        var el = els[p.id];
        if (!el) return;
        var was = el.dataset.slot || "";
        var now = wanted[p.id];

        if (now) {
          attach(el, p, now === "is-active" && dir === 0);
          var arriving = !was || was === "is-exit-left" || was === "is-exit-right";
          // A wrap — only reachable with exactly three products, where the card
          // behind on one side becomes the card behind on the other. Moving it
          // continuously would drag it straight across the stage behind the
          // active plate, which is the one movement that would give the
          // illusion away.
          var wrapping = (was === "is-prev" && now === "is-next") || (was === "is-next" && now === "is-prev");

          if (arriving || wrapping) {
            // Placed with the tween suppressed so it does not fly in from
            // wherever it was last parked — then faded up on the spot, which
            // is the difference between a plate appearing and a plate popping.
            //
            // Never on the first paint: holding the active card at opacity 0
            // for two frames to fade it in would push back the LCP element the
            // preload exists to get on screen early.
            if (dir === 0) {
              setSlot(el, now, true);
            } else {
              el.classList.add("is-entering");
              setSlot(el, now, true);
              (function (card) {
                window.requestAnimationFrame(function () {
                  window.requestAnimationFrame(function () { card.classList.remove("is-entering"); });
                });
              })(el);
            }
          } else {
            setSlot(el, now);
          }
        } else if (was && was !== "is-exit-left" && was !== "is-exit-right") {
          // Falling out of the window: keep travelling in the direction of
          // the stack, then tear the image down once the exit has played.
          setSlot(el, dir < 0 ? "is-exit-right" : "is-exit-left");
          (function (card) {
            window.setTimeout(function () {
              // Re-check: a fast scrub could have brought it back on stage.
              if (card.dataset.slot === "is-exit-left" || card.dataset.slot === "is-exit-right") {
                setSlot(card, "");
                detach(card);
              }
            }, DUR + 60);
          })(el);
        }
      });

      paintProgress();
    }

    layout(0);

    if (n <= 1 || reduceMotion) return;

    // ---- rotation --------------------------------------------------------
    var timer = null;
    function step() {
      currentIndex = (currentIndex + 1) % n;
      layout(1);
    }
    function schedule() {
      // Re-scheduled after each step rather than setInterval, so there is
      // always exactly one pending timer to clear, and a paused tab can never
      // accumulate a backlog of ticks that all fire at once on return.
      timer = window.setTimeout(function () {
        step();
        schedule();
      }, DWELL);
    }
    function pause() {
      if (timer) window.clearTimeout(timer);
      timer = null;
      isPaused = true;
      segs.forEach(function (s) { s.style.setProperty("animation-play-state", "paused"); });
    }
    function resume() {
      isPaused = false;
      segs.forEach(function (s) { s.style.removeProperty("animation-play-state"); });
      if (!timer) schedule();
    }

    schedule();
    section.addEventListener("mouseenter", pause);
    section.addEventListener("mouseleave", resume);
    // A backgrounded tab should not keep cycling: it burns nothing useful and
    // the visitor returns mid-rotation to a card they never saw start.
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) pause();
      else resume();
    });
    // Nor should a hero that has been scrolled past. On a phone the section
    // leaves the viewport almost immediately, and animating four composited
    // layers off-screen is pure battery cost.
    if ("IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) {
          if (e.isIntersecting) { if (!document.hidden) resume(); }
          else pause();
        });
      }, { threshold: 0.15 }).observe(section);
    }
  }).catch(function () {
    // Real data failed to load — leave the server-rendered card exactly as it
    // is rather than emptying the hero.
  });
});
