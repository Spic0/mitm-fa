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
// THE HAND-OFF, AND WHY IT USED TO SHOW A HOLE
//
// The rule this component exists to hold is that there is ALWAYS a fully
// rendered product on screen — never a frame with an empty card, a blank
// plate, or a missing title and price. Three separate things were breaking it,
// and all three are fixed here and in home-dynamic.css:
//
//   1. OPACITY CROSSED AT THE MIDDLE. Outgoing and incoming ran the same
//      curve, so both sat near 0.70 for ~200ms and the page ground showed
//      through both. The curves are now asymmetric (--hero-ease-in /
//      --hero-ease-out) so their sum never dips. CSS side.
//   2. THE CAPTION HAD A GAP. The outgoing caption faded immediately while the
//      incoming one waited on a 150ms delay, so title, creator and price were
//      all effectively absent (measured: 8.8% peak opacity) mid-transition.
//      CSS side.
//   3. THE INCOMING IMAGE WAS NOT THERE YET. Attachment used to happen in the
//      frame a card became visible, so on a real connection it slid on empty.
//      That is what ATTACH_RADIUS and the readiness gate in tick() fix, below.
//
// Swipe runs through the same step() as autoplay, so there is one motion
// system and not two.
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

  // TWO windows, and the difference between them is the preload.
  //
  // STAGE_RADIUS is how many cards each side of the active one are on stage —
  // the active card plus its two flanks, which is all the composition has room
  // for. That never changes.
  //
  // ATTACH_RADIUS is how many carry an <img>, and it is deliberately ONE WIDER.
  // With a single window the card arriving at a flank had its image attached in
  // the very frame it became visible, so it slid onto the stage empty and
  // filled in afterwards — measured on 10/2 Mbps, the incoming plate was
  // unpainted for the whole of its entry, at every transition. One extra ring
  // means the cover for the product after next is already decoded in the
  // browser before its card is ever shown, so the animation never waits on the
  // network. It costs at most five live images however large the catalog is,
  // and nothing beyond the ring is attached at all.
  var STAGE_RADIUS = 1;
  var ATTACH_RADIUS = 2;

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
  // `mode` is "lcp" for the one card that is on stage at first paint, and
  // "preload" for every other card in the ring — on stage or waiting behind it.
  // Nothing here is ever lazy: see ATTACH_RADIUS above and opts.preload in
  // media-container.js.
  function attach(el, product, mode) {
    if (!el || el.dataset.attached === "1") return;
    var media = el.querySelector(".hero-card__media");
    if (!media) return;
    // No `ratio` passed: the plate's shape is fixed at 3:4 by
    // .hero-card__media in home-dynamic.css, which is also what the deck sizes
    // itself from, so --pmedia-ratio here would only be a second opinion.
    var box = window.MediaContainer.build(product, {
      sizes: SIZES,
      eager: mode === "lcp",
      preload: mode !== "lcp",
    });
    // build() returns its own .pmedia element; move its children and classes
    // onto the card's existing box rather than swapping the node, so the
    // card's own layout classes survive.
    media.className = "hero-card__media " + box.className;
    // The dominant-artwork colour build() resolved for the letterbox mat is
    // set on the box it created — which is discarded here — so it has to be
    // carried across explicitly or every hero plate falls back to the flat
    // default while its cover decodes.
    var bg = box.style.getPropertyValue("--pmedia-bg");
    if (bg) media.style.setProperty("--pmedia-bg", bg);
    while (box.firstChild) media.appendChild(box.firstChild);
    el.dataset.attached = "1";
    watchReady(el, media);
  }

  // build() wires its own reveal against the .pmedia box it created, and that
  // box does not survive attach() — only its children and class list move onto
  // the card's span. The already-cached path happens to work, because build()
  // has added `is-ready` to box.className before we copy it; the LOAD path does
  // not, because reveal() fires later and lands on a detached div. So on a COLD
  // CACHE — a first-time visitor, exactly the case in the brief — no hero plate
  // ever got `is-ready`, the LQIP never faded, and every cover sat behind a
  // full-opacity blurred thumbnail. Rewired here against the real box.
  //
  // The same handler records readiness for the rotation gate. `error` settles
  // it too: a broken image is a final visual state, and waiting for one that is
  // never coming would stop the carousel outright.
  function watchReady(el, media) {
    var img = media.querySelector(".pmedia__img");
    if (!img) {
      el.dataset.ready = "1"; // a product with no artwork has nothing to wait for
      return;
    }
    function settle() {
      el.dataset.ready = "1";
      media.classList.add("is-ready");
    }
    if (img.complete) { settle(); return; }
    img.addEventListener("load", settle, { once: true });
    img.addEventListener("error", settle, { once: true });
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
    media.style.removeProperty("--pmedia-bg");
    el.dataset.attached = "0";
    el.dataset.ready = "0";
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
        attach(ssrEl, slides[0], "lcp");
      }
    }
    if (ssrEl) {
      ssrEl.dataset.productId = slides[startIndex].id;
      // The SSR card already carries its own <picture>; mark it attached so
      // attach() never overwrites the markup the preload was pointed at.
      // Server-rendered media is `data-instant` and already `is-ready` (see
      // applyHeroContext) — there is no load event coming, so it also counts
      // as settled for the rotation gate below.
      if (ssrEl.querySelector("img")) {
        ssrEl.dataset.attached = "1";
        ssrEl.dataset.ready = "1";
      }
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

    // at() is the whole infinite loop: the index is unbounded and wraps here,
    // so E -> A is arithmetic, not a special case, and there is no cloned
    // "last" slide for it to jump to. Nothing else in this file knows the list
    // has ends.
    function at(i) { return slides[((i % n) + n) % n]; }

    // Starts at the stage window so the preload ring cannot compete with the
    // LCP image on first paint, then widens once the page has finished
    // loading. Everything the ring covers is fetched at fetchpriority=low, but
    // low is not free, and the first paint has exactly one image worth
    // hurrying.
    var attachRadius = STAGE_RADIUS;
    function widenRing() {
      if (attachRadius >= ATTACH_RADIUS) return;
      attachRadius = ATTACH_RADIUS;
      var ring = ringIds();
      slides.forEach(function (p) {
        if (ring[p.id]) attach(els[p.id], p, "preload");
      });
    }

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
    // Which products should be holding an image right now — the cards on stage
    // plus the preload ring behind them. Recomputed on demand rather than
    // captured, so a deferred teardown always tests against the CURRENT index.
    function ringIds() {
      var s = {};
      for (var d = -attachRadius; d <= attachRadius; d++) s[at(currentIndex + d).id] = true;
      return s;
    }

    function layout(dir) {
      var wanted = {};
      wanted[at(currentIndex).id] = "is-active";
      // With two products there is only one flank, and at(i-1) === at(i+1);
      // assigning next last means the single neighbour sits on the incoming
      // side, which is the one the eye is already tracking.
      if (n > 2) wanted[at(currentIndex - 1).id] = "is-prev";
      if (n > 1) wanted[at(currentIndex + 1).id] = "is-next";

      var ring = ringIds();

      slides.forEach(function (p) {
        var el = els[p.id];
        if (!el) return;
        var was = el.dataset.slot || "";
        var now = wanted[p.id];

        // Attachment follows the RING, not the stage: a card two steps out
        // carries its image so that by the time it is shown there is nothing
        // left to fetch.
        if (ring[p.id]) attach(el, p, now === "is-active" && dir === 0 ? "lcp" : "preload");

        if (now) {
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
          (function (card, id) {
            window.setTimeout(function () {
              // Re-check: a swipe could have brought it back on stage.
              if (card.dataset.slot === "is-exit-left" || card.dataset.slot === "is-exit-right") {
                setSlot(card, "");
                // Off stage is not the same as out of the ring. A card one step
                // behind stays attached, because a backward swipe brings it
                // straight back and re-fetching it would put an empty plate on
                // screen — the exact failure the ring exists to prevent.
                if (!ringIds()[id]) detach(card);
              }
            }, DUR + 60);
          })(el, p.id);
        }
      });

      paintProgress();
    }

    layout(0);

    if (n <= 1) return;

    // The preload ring opens once the page has finished loading. `load` has
    // already fired by the time this script runs on a warm cache, hence the
    // readyState branch.
    if (document.readyState === "complete") window.setTimeout(widenRing, 0);
    else window.addEventListener("load", widenRing, { once: true });

    // ---- rotation --------------------------------------------------------
    var timer = null;

    // dir is +1 forward, -1 backward. Autoplay and swipe both come through
    // here, so there is exactly one motion path — a manual swipe cannot end up
    // looking different from an automatic step because there is nothing else
    // for it to look like.
    function step(dir) {
      currentIndex = (((currentIndex + dir) % n) + n) % n;
      layout(dir);
    }

    // Would the card we are about to bring on stage arrive with artwork?
    function nextReady(dir) {
      var el = els[at(currentIndex + dir).id];
      return !el || el.dataset.ready === "1";
    }

    // How long the carousel will hold rather than show an empty plate, and how
    // often it re-checks. The cap exists so a genuinely unreachable image
    // (offline mid-session, a 404 with no error event) degrades to a slightly
    // late transition instead of stopping the hero for good.
    var GRACE = 120;
    var MAX_HOLD = 2000;
    var held = 0;

    function tick() {
      if (!nextReady(1) && held < MAX_HOLD) {
        // The incoming cover has not arrived. Hold on the CURRENT product: a
        // fully rendered plate held a beat too long is invisible to the
        // customer, an empty one sliding in is not. With the preload ring in
        // place this branch should be unreachable on any normal connection —
        // it is the backstop, not the mechanism.
        held += GRACE;
        timer = window.setTimeout(tick, GRACE);
        return;
      }
      held = 0;
      step(1);
      timer = window.setTimeout(tick, DWELL);
    }
    // Re-scheduled after each step rather than setInterval, so there is
    // always exactly one pending timer to clear, and a paused tab can never
    // accumulate a backlog of ticks that all fire at once on return.
    function schedule() {
      if (!timer) timer = window.setTimeout(tick, DWELL);
    }
    function pause() {
      if (timer) window.clearTimeout(timer);
      timer = null;
      isPaused = true;
      segs.forEach(function (s) { s.style.setProperty("animation-play-state", "paused"); });
    }
    function resume() {
      if (reduceMotion) return;
      isPaused = false;
      // A hold that was interrupted by a pause starts its budget over rather
      // than resuming part-spent, so returning to a backgrounded tab cannot
      // land on a forced transition into a cover that is still arriving.
      held = 0;
      segs.forEach(function (s) { s.style.removeProperty("animation-play-state"); });
      schedule();
    }

    // ---- swipe -----------------------------------------------------------
    // Manual navigation calls the SAME step() the timer does, so it produces
    // the same slot assignment and therefore the identical transition. There
    // is deliberately no separate touch animation to keep in step or to look
    // cheaper than the automatic one.
    var stage = section.querySelector(".hero__stage") || deck;
    var SWIPE_MIN = 40;    // px of horizontal travel before it counts as a swipe
    var SWIPE_SLOPE = 1.2; // ...and it must be this much more horizontal than vertical
    var touchX = 0;
    var touchY = 0;
    var tracking = false;

    stage.addEventListener("touchstart", function (e) {
      if (e.touches.length !== 1) { tracking = false; return; }
      touchX = e.touches[0].clientX;
      touchY = e.touches[0].clientY;
      tracking = true;
      pause();
    }, { passive: true });

    stage.addEventListener("touchend", function (e) {
      if (!tracking) return;
      tracking = false;
      var t = e.changedTouches && e.changedTouches[0];
      if (t) {
        var dx = t.clientX - touchX;
        var dy = t.clientY - touchY;
        // Distance AND horizontal dominance. Distance alone lets a diagonal
        // flick during an ordinary page scroll change the product under the
        // reader's thumb; the slope test is what makes a tap or a scroll a
        // no-op. Nothing in here calls preventDefault and every listener is
        // passive, so vertical scrolling is untouched.
        if (Math.abs(dx) >= SWIPE_MIN && Math.abs(dx) > Math.abs(dy) * SWIPE_SLOPE) {
          // Swipe LEFT (dx < 0) pulls the next product in from the right,
          // which is the direction the deck already travels on its own.
          //
          // Deliberately NOT gated on nextReady(): a gesture has to answer in
          // the frame it is made, and both neighbours are inside the preload
          // ring anyway, so there is nothing to wait for that waiting would
          // fix. The readiness hold belongs to autoplay, where a 120ms delay
          // costs the customer nothing.
          step(dx < 0 ? 1 : -1);
        }
      }
      // Restarts the dwell from zero, so a swipe is never immediately
      // overtaken by a timer that was already most of the way through.
      resume();
    }, { passive: true });

    stage.addEventListener("touchcancel", function () {
      tracking = false;
      resume();
    }, { passive: true });

    // A visitor who asked for reduced motion gets the deck as a still picture
    // and no autoplay — but swipe stays bound above, because that movement is
    // one they asked for. The CSS drops the transitions for them, so a swipe
    // cuts rather than travels, which is the correct reading of the
    // preference.
    if (reduceMotion) return;

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
