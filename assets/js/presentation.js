// Behaviour for the private presentation deck (/presentation/:slug).
//
// Five independent pieces, each safe to fail on its own: scroll reveals, the
// section rail + progress bar, the six-step wizard, the CTA/enquiry form, and
// engagement tracking. Nothing here is required to READ the deck — the page is
// complete server-rendered HTML, and every enhancement below is additive.
//
// Written in ES5-style function syntax with no build step, matching the rest
// of assets/js. No inline handlers or inline styles anywhere: the platform's
// CSP forbids both (see server/src/index.js).
(function () {
  "use strict";

  var boot = document.getElementById("presBoot");
  if (!boot) return;

  var SLUG = boot.dataset.slug || "";
  var VISIT_ID = boot.dataset.visitId || "";
  var prefersReducedMotion =
    window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // -------------------------------------------------------------------
  // Engagement tracking
  //
  // Deliberately small: furthest section, engaged time, wizard completion,
  // CTA clicks. Time only accrues while the tab is actually visible, so a
  // deck left open in a background tab after a meeting doesn't report six
  // hours of "engagement" — the number an admin reads has to mean something.
  // -------------------------------------------------------------------
  var track = (function () {
    if (!SLUG || !VISIT_ID) {
      // No visit row (the insert failed server-side). Everything else on the
      // page still works; this just becomes a no-op rather than a source of
      // failing requests for the whole meeting.
      return { bump: function () {}, event: function () {}, flush: function () {} };
    }

    var HEARTBEAT_MS = 30000;
    var state = { maxSectionIndex: 0, wizardCompleted: false };
    var dwellMs = 0;
    var since = document.visibilityState === "visible" ? Date.now() : 0;
    var dirty = false;
    var queue = [];

    function accrue() {
      if (since) {
        dwellMs += Date.now() - since;
        since = Date.now();
      }
    }

    function send(useBeacon) {
      accrue();
      var payload = {
        visitId: VISIT_ID,
        dwellMs: dwellMs,
        maxSectionIndex: state.maxSectionIndex,
        wizardCompleted: state.wizardCompleted,
        event: queue.shift() || null,
      };
      dirty = false;
      var url = "/api/presentation/" + encodeURIComponent(SLUG) + "/track";
      var body = JSON.stringify(payload);

      // sendBeacon survives the page actually going away, which fetch (even
      // with keepalive) does not reliably do on mobile Safari — and the
      // pagehide flush is precisely the sample that matters most, since it
      // carries the total time for the whole visit.
      if (useBeacon && navigator.sendBeacon) {
        navigator.sendBeacon(url, new Blob([body], { type: "application/json" }));
        return;
      }
      fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: body,
        keepalive: true,
        credentials: "same-origin",
      }).catch(function () {
        /* Analytics must never surface an error to a visitor mid-meeting. */
      });
    }

    function bump(patch) {
      if (patch.maxSectionIndex != null && patch.maxSectionIndex > state.maxSectionIndex) {
        state.maxSectionIndex = patch.maxSectionIndex;
        dirty = true;
      }
      if (patch.wizardCompleted && !state.wizardCompleted) {
        state.wizardCompleted = true;
        dirty = true;
        send(false); // completing the wizard is worth reporting immediately
      }
    }

    function event(type, label) {
      queue.push({ type: type, label: label });
      send(false);
    }

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "visible") {
        since = Date.now();
      } else {
        accrue();
        since = 0;
        send(true);
      }
    });

    // pagehide, not unload: unload is ignored by the back/forward cache on
    // every modern browser and simply never fires on iOS.
    window.addEventListener("pagehide", function () { send(true); });

    setInterval(function () {
      if (dirty || dwellMs > 0) send(false);
    }, HEARTBEAT_MS);

    return { bump: bump, event: event, flush: function () { send(false); } };
  })();

  // -------------------------------------------------------------------
  // Scroll reveals
  // -------------------------------------------------------------------
  (function () {
    var targets = document.querySelectorAll("[data-reveal]");
    if (!targets.length) return;

    // No IntersectionObserver (or motion suppressed): show everything at
    // once. Failing open is the only acceptable failure mode here — the
    // alternative is an invisible deck.
    if (!("IntersectionObserver" in window) || prefersReducedMotion) {
      Array.prototype.forEach.call(targets, function (el) { el.classList.add("is-revealed"); });
      return;
    }

    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          // One-shot: re-animating on the way back up makes a deck feel
          // twitchy when someone scrolls back to re-read a section.
          observer.unobserve(entry.target);
        });
      },
      // Fires slightly before the element's top edge clears the fold, so the
      // motion is already finishing as it arrives rather than starting then.
      { rootMargin: "0px 0px -12% 0px", threshold: 0.01 }
    );

    Array.prototype.forEach.call(targets, function (el) { observer.observe(el); });
  })();

  // -------------------------------------------------------------------
  // Progress bar + section rail
  //
  // The rail is built from the sections actually present in the DOM, which
  // is what keeps it correct when an admin switches sections off — those are
  // stripped server-side, so they simply aren't found here.
  // -------------------------------------------------------------------
  (function () {
    var sections = Array.prototype.slice.call(document.querySelectorAll("[data-section-id]"));
    var bar = document.getElementById("presProgressBar");
    var rail = document.getElementById("presRail");
    if (!sections.length) return;

    var items = [];
    if (rail) {
      sections.forEach(function (section, index) {
        var id = section.getAttribute("data-section-id");
        // The template already carries id="pres-<key>" on every section, so
        // the rail's hrefs are real anchors that work before this script runs
        // (and in the print/no-JS case). This is only a fallback.
        if (!section.id) section.id = "pres-" + id;

        var link = document.createElement("a");
        link.className = "pres-rail__item";
        link.href = "#" + section.id;
        link.setAttribute("aria-label", section.getAttribute("data-section-label") || id);

        var label = document.createElement("span");
        label.className = "pres-rail__label";
        label.textContent = section.getAttribute("data-section-label") || id;

        var dot = document.createElement("span");
        dot.className = "pres-rail__dot";

        link.appendChild(label);
        link.appendChild(dot);
        rail.appendChild(link);
        items.push({ el: link, index: index });
      });
    }

    var activeIndex = -1;
    function setActive(index) {
      if (index === activeIndex) return;
      activeIndex = index;
      items.forEach(function (item) {
        item.el.classList.toggle("is-active", item.index === index);
      });
      track.bump({ maxSectionIndex: index });
    }

    // Scroll work is split in two on purpose. The progress bar is cheap
    // (one transform) and runs rAF-throttled on scroll; deciding which
    // section is current is an IntersectionObserver's job, because doing it
    // from scroll position means calling getBoundingClientRect on every
    // section on every frame.
    var ticking = false;
    function onScroll() {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(function () {
        ticking = false;
        if (!bar) return;
        var max = document.documentElement.scrollHeight - window.innerHeight;
        var ratio = max > 0 ? Math.min(Math.max(window.scrollY / max, 0), 1) : 0;
        bar.style.transform = "scaleX(" + ratio + ")";
      });
    }
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();

    if ("IntersectionObserver" in window) {
      var current = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var index = sections.indexOf(entry.target);
            if (index !== -1) setActive(index);
          });
        },
        // A band across the middle of the viewport: a section counts as
        // "current" once it owns the centre of the screen, which matches
        // where a reader's attention actually is.
        { rootMargin: "-45% 0px -45% 0px", threshold: 0 }
      );
      sections.forEach(function (section) { current.observe(section); });
    }
  })();

  // -------------------------------------------------------------------
  // Step wizard
  //
  // One selection model driving two layouts (accordion below 1024px, fixed
  // rail + cross-faded panel above it — see §10 of presentation.css). The JS
  // knows nothing about which is showing except for one thing: below the
  // breakpoint it has to set an explicit max-height so the open/close can
  // animate, and above it that height must be released.
  // -------------------------------------------------------------------
  (function () {
    var wizard = document.getElementById("presWizard");
    if (!wizard) return;

    var steps = Array.prototype.slice.call(wizard.querySelectorAll(".pres-step"));
    var fill = document.getElementById("presWizardFill");
    if (!steps.length) return;

    var desktopQuery = window.matchMedia("(min-width: 1024px)");
    var activeIndex = 0;
    var visited = {};

    function isDesktop() {
      return desktopQuery.matches;
    }

    function applyHeights() {
      steps.forEach(function (step, index) {
        var body = step.querySelector(".pres-step__body");
        if (!body) return;
        if (isDesktop()) {
          // Cleared, not set to a number: the desktop layout stacks all six
          // panels in one grid cell and sizes them from content. A leftover
          // max-height from a resize would clip the tallest one.
          body.style.maxHeight = "";
        } else {
          body.style.maxHeight = index === activeIndex ? body.scrollHeight + "px" : "0px";
        }
      });
    }

    function setActive(index, opts) {
      if (index < 0 || index >= steps.length) return;
      activeIndex = index;

      steps.forEach(function (step, i) {
        var head = step.querySelector(".pres-step__head");
        step.classList.toggle("is-active", i === index);
        // "Complete" is everything already passed — it keeps the numbers
        // behind the current step filled in, so the rail reads as progress
        // rather than as a single highlighted row.
        step.classList.toggle("is-complete", i < index);
        if (head) head.setAttribute("aria-expanded", i === index ? "true" : "false");
      });

      applyHeights();

      if (fill) {
        var ratio = steps.length > 1 ? index / (steps.length - 1) : 1;
        fill.style.transform = "scaleY(" + ratio + ")";
      }

      visited[index] = true;
      // "Completed the wizard" means the last step was actually reached,
      // however the visitor got there — clicking through, or scrolling far
      // enough that auto-advance took them.
      if (index === steps.length - 1) track.bump({ wizardCompleted: true });

      if (opts && opts.scrollIntoView && !isDesktop() && !prefersReducedMotion) {
        var head = steps[index].querySelector(".pres-step__head");
        if (head) {
          var top = head.getBoundingClientRect().top + window.scrollY - 90;
          window.scrollTo({ top: top, behavior: "smooth" });
        }
      }
    }

    steps.forEach(function (step, index) {
      var head = step.querySelector(".pres-step__head");
      if (!head) return;
      head.addEventListener("click", function () {
        // On mobile a second tap on the open step collapses it; on desktop
        // there is always exactly one panel showing, so it's a no-op.
        if (index === activeIndex && !isDesktop()) {
          steps[index].classList.remove("is-active");
          head.setAttribute("aria-expanded", "false");
          var body = steps[index].querySelector(".pres-step__body");
          if (body) body.style.maxHeight = "0px";
          activeIndex = -1;
          return;
        }
        setActive(index, { scrollIntoView: false });
      });

      // Arrow keys move between steps once one has focus — the rail is a
      // sequence, and treating it as six unrelated buttons would make it
      // slower to get through with a keyboard than with a mouse.
      head.addEventListener("keydown", function (e) {
        var next = null;
        if (e.key === "ArrowDown" || e.key === "ArrowRight") next = index + 1;
        else if (e.key === "ArrowUp" || e.key === "ArrowLeft") next = index - 1;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = steps.length - 1;
        if (next == null || next < 0 || next >= steps.length) return;
        e.preventDefault();
        setActive(next, { scrollIntoView: false });
        var target = steps[next].querySelector(".pres-step__head");
        if (target) target.focus();
      });
    });

    // Recompute the open panel's height when the viewport changes: a phone
    // rotating to landscape re-wraps the copy, and a stale max-height would
    // clip it.
    var resizeTimer = null;
    window.addEventListener("resize", function () {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(applyHeights, 120);
    });
    // Fonts landing after first paint change the measured height too.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(applyHeights).catch(function () {});
    }

    setActive(0, { scrollIntoView: false });

    // Desktop auto-advance: walking down the section scrolls the panel
    // through the steps, so the deck presents itself while someone talks
    // over it. Off on mobile, where the accordion is the interaction and an
    // auto-advance would fight the reader's own scrolling.
    if ("IntersectionObserver" in window) {
      var advance = new IntersectionObserver(
        function (entries) {
          if (!isDesktop()) return;
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var index = steps.indexOf(entry.target);
            if (index !== -1) setActive(index, { scrollIntoView: false });
          });
        },
        { rootMargin: "-48% 0px -48% 0px", threshold: 0 }
      );
      steps.forEach(function (step) { advance.observe(step); });
    }
  })();

  // -------------------------------------------------------------------
  // Shared helpers for the motion systems below
  // -------------------------------------------------------------------
  function slice(list) {
    return Array.prototype.slice.call(list || []);
  }

  // A scroll/resize handler that runs at most once per frame. Every module
  // below that listens to scroll goes through this, so N modules cost one
  // rAF each rather than N synchronous handlers per scroll event.
  function rafThrottle(fn) {
    var queued = false;
    return function () {
      if (queued) return;
      queued = true;
      window.requestAnimationFrame(function () {
        queued = false;
        fn();
      });
    };
  }

  // Runs `on`/`off` as an element enters and leaves the viewport. Used to
  // keep every infinite loop on this page from running against the
  // compositor while it is three sections off screen.
  function whileVisible(el, on, off, margin) {
    if (!("IntersectionObserver" in window)) {
      on();
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) on();
          else off();
        });
      },
      { rootMargin: margin || "120px 0px", threshold: 0 }
    );
    observer.observe(el);
  }

  // -------------------------------------------------------------------
  // Hero slideshow
  //
  // Ten panels, one visible, advancing on a timer and wrapping forever.
  // The whole thing is a single index and a class swap: the cross-fade
  // itself is a CSS transition on opacity and transform (see §7d), so the
  // work per slide change is one class add, one class remove, and nothing
  // that touches layout. That is what holds the frame rate — there is no
  // per-frame JavaScript in this module at all, only timers.
  //
  // Autoplay stops whenever continuing to run would be either wasteful or
  // rude: off screen, tab hidden, pointer hovering, keyboard focus inside,
  // or a finger currently on the stage. Every one of those is a case where
  // the viewer is either not looking or is trying to control it themselves.
  // -------------------------------------------------------------------
  (function () {
    var root = document.getElementById("presHeroShow");
    var stage = document.getElementById("presHeroStage");
    var dotsWrap = document.getElementById("presHeroDots");
    if (!root || !stage) return;

    var slides = slice(stage.querySelectorAll("[data-hs-slide]"));
    if (slides.length < 2) return;

    var DELAY = 4600; // ms a panel holds before the next one takes over
    var index = 0;
    var timer = null;
    var dots = [];

    // Reasons autoplay is currently suspended. A set rather than a boolean
    // because they overlap constantly — a pointer leaving the stage must
    // not restart the timer if the section has meanwhile scrolled away.
    var holds = {};

    function hold(reason, on) {
      if (on) holds[reason] = true;
      else delete holds[reason];
      var blocked = false;
      for (var key in holds) {
        if (Object.prototype.hasOwnProperty.call(holds, key)) blocked = true;
      }
      if (blocked) stop();
      else start();
    }

    function stop() {
      if (timer) {
        window.clearTimeout(timer);
        timer = null;
      }
    }

    function start() {
      stop();
      if (prefersReducedMotion) return;
      timer = window.setTimeout(function () {
        go(index + 1);
      }, DELAY);
    }

    function go(next) {
      // Modulo both ways so a "previous" from slide 0 lands on the last
      // panel rather than on NaN.
      var target = ((next % slides.length) + slides.length) % slides.length;
      if (target === index) return;

      slides[index].classList.remove("is-active");
      slides[target].classList.add("is-active");
      if (dots[index]) {
        dots[index].classList.remove("is-active");
        dots[index].setAttribute("aria-selected", "false");
        dots[index].tabIndex = -1;
      }
      if (dots[target]) {
        dots[target].classList.add("is-active");
        dots[target].setAttribute("aria-selected", "true");
        dots[target].tabIndex = 0;
      }
      index = target;
      start();
    }

    // ---- Dots, built from the slides rather than authored twice ----
    if (dotsWrap) {
      slides.forEach(function (slide, i) {
        var dot = document.createElement("button");
        dot.type = "button";
        dot.className = "pres-hs__dot" + (i === 0 ? " is-active" : "");
        dot.setAttribute("role", "tab");
        dot.setAttribute("aria-selected", i === 0 ? "true" : "false");
        dot.setAttribute("aria-label", slide.getAttribute("data-hs-label") || "Slide " + (i + 1));
        dot.tabIndex = i === 0 ? 0 : -1;
        dot.addEventListener("click", function () {
          go(i);
        });
        dotsWrap.appendChild(dot);
        dots.push(dot);
      });
    }

    slice(root.querySelectorAll("[data-hs-prev]")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        go(index - 1);
      });
    });
    slice(root.querySelectorAll("[data-hs-next]")).forEach(function (btn) {
      btn.addEventListener("click", function () {
        go(index + 1);
      });
    });

    // ---- Keyboard. Arrow keys work anywhere inside the slideshow, which
    // is the convention a tablist sets up and the dots advertise. ----
    root.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") {
        go(index - 1);
        e.preventDefault();
      } else if (e.key === "ArrowRight") {
        go(index + 1);
        e.preventDefault();
      }
    });

    // ---- Swipe ----
    //
    // Pointer events rather than touch events, so a trackpad drag and a
    // stylus behave like a finger. The gesture is only claimed once it is
    // unambiguously horizontal: a vertical-first drag is the viewer
    // scrolling the page THROUGH the stage, and stealing that would make
    // the hero a scroll trap on a phone — which is exactly the bug most
    // hero carousels ship with.
    var startX = 0;
    var startY = 0;
    var tracking = false;
    var decided = false;
    var horizontal = false;
    var THRESHOLD = 44; // px of travel that counts as a swipe

    stage.addEventListener(
      "pointerdown",
      function (e) {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        tracking = true;
        decided = false;
        horizontal = false;
        startX = e.clientX;
        startY = e.clientY;
        hold("drag", true);
      },
      { passive: true }
    );

    stage.addEventListener(
      "pointermove",
      function (e) {
        if (!tracking) return;
        var dx = e.clientX - startX;
        var dy = e.clientY - startY;
        if (!decided) {
          // Wait for 8px of movement before deciding which axis this is;
          // below that the numbers are noise from the finger settling.
          if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
          decided = true;
          horizontal = Math.abs(dx) > Math.abs(dy);
          if (!horizontal) tracking = false;
        }
      },
      { passive: true }
    );

    function endDrag(e) {
      if (!tracking) {
        hold("drag", false);
        return;
      }
      tracking = false;
      var dx = (e.clientX || startX) - startX;
      if (horizontal && Math.abs(dx) > THRESHOLD) {
        go(dx < 0 ? index + 1 : index - 1);
      }
      hold("drag", false);
    }

    stage.addEventListener("pointerup", endDrag, { passive: true });
    stage.addEventListener("pointercancel", endDrag, { passive: true });
    stage.addEventListener("pointerleave", endDrag, { passive: true });

    // ---- Suspension ----
    root.addEventListener("pointerenter", function (e) {
      // Only a real hovering pointer. A touch "enters" on tap and would
      // otherwise leave autoplay held off for the rest of the visit.
      if (e.pointerType === "mouse") hold("hover", true);
    });
    root.addEventListener("pointerleave", function (e) {
      if (e.pointerType === "mouse") hold("hover", false);
    });
    root.addEventListener("focusin", function () {
      hold("focus", true);
    });
    root.addEventListener("focusout", function () {
      hold("focus", false);
    });
    document.addEventListener("visibilitychange", function () {
      hold("hidden", document.visibilityState !== "visible");
    });

    whileVisible(
      root,
      function () {
        hold("offscreen", false);
      },
      function () {
        hold("offscreen", true);
      },
      "80px 0px"
    );

    // Under a reduced-motion preference the panels still change on click,
    // swipe and keyboard — they simply never change on their own. Removing
    // the slideshow entirely would take nine tenths of the hero's content
    // away from the people who asked for less movement, not less content.
    if (!prefersReducedMotion) start();
  })();

  // -------------------------------------------------------------------
  // Benefit belt — the infinite carousel
  //
  // One transform on one track, advanced by rAF. The cards are cloned
  // until the strip is at least twice the viewport wide, and the offset
  // wraps against the width of a single copy, so there is no seam, no end
  // to reach and no snap back.
  //
  // Autoplay, drag and the keyboard all write to the same two numbers
  // (offset and velocity) rather than to three competing animations. That
  // is what lets a flick decay smoothly back into the resting pace
  // instead of stopping dead and restarting.
  // -------------------------------------------------------------------
  (function () {
    var belt = document.getElementById("presBelt");
    var viewport = document.getElementById("presBeltViewport");
    var strip = document.getElementById("presBeltTrack");
    if (!belt || !viewport || !strip) return;

    var originals = slice(strip.children);
    if (!originals.length) return;

    // Under a reduced-motion preference the stylesheet turns the viewport
    // into an ordinary snap-scroll container. Starting the engine on top
    // of that would fight the visitor's own scrolling.
    if (prefersReducedMotion) return;

    var SPEED = 34; // px/sec, the resting pace
    var DECAY = 0.6; // seconds for a fling to fall back toward SPEED
    var setWidth = 0; // width of exactly one copy of the cards
    var offset = 0;
    var velocity = -SPEED;
    var glide = 0; // px still owed to a keyboard nudge
    var hovering = false;
    var focused = false;
    var dragging = false;
    var running = false;
    var visible = false;
    var pointerId = null;
    var lastX = 0;
    var lastT = 0;
    var prevFrame = 0;
    var frameHandle = null;

    function build() {
      slice(strip.querySelectorAll("[data-clone]")).forEach(function (node) {
        strip.removeChild(node);
      });

      var styles = window.getComputedStyle(strip);
      var gap = parseFloat(styles.columnGap || styles.gap || "0") || 0;
      setWidth = 0;
      originals.forEach(function (card) {
        setWidth += card.getBoundingClientRect().width + gap;
      });
      if (!setWidth) return;

      // Enough copies that the strip always covers the viewport twice over
      // plus one full set, which is what guarantees the wrap point is never
      // on screen. The guard is only there so a zero-width measurement
      // (fonts still loading, container display:none) cannot spin forever.
      var needed = viewport.getBoundingClientRect().width * 2 + setWidth;
      var total = setWidth;
      var guard = 0;
      while (total < needed && guard < 12) {
        originals.forEach(function (card) {
          var clone = card.cloneNode(true);
          clone.setAttribute("data-clone", "");
          // The clones are the same twelve benefits again. A screen reader
          // should hear them once.
          clone.setAttribute("aria-hidden", "true");
          strip.appendChild(clone);
        });
        total += setWidth;
        guard += 1;
      }
    }

    function apply() {
      if (setWidth > 0) {
        while (offset <= -setWidth) offset += setWidth;
        while (offset > 0) offset -= setWidth;
      }
      strip.style.transform = "translate3d(" + offset.toFixed(2) + "px, 0, 0)";
    }

    function frame(now) {
      if (!running) return;
      frameHandle = window.requestAnimationFrame(frame);

      if (!prevFrame) prevFrame = now;
      // Clamped: coming back to a backgrounded tab hands us a delta of
      // several seconds, which would teleport the strip.
      var dt = Math.min((now - prevFrame) / 1000, 0.05);
      prevFrame = now;

      var target = hovering || focused ? 0 : -SPEED;
      // Exponential approach rather than a fixed step, so the same maths
      // handles both "settle from a 900px/s flick" and "ease to a stop
      // under the pointer".
      velocity += (target - velocity) * (1 - Math.exp(-dt / DECAY));
      offset += velocity * dt;

      if (glide) {
        var step = glide * (1 - Math.exp(-dt / 0.16));
        offset += step;
        glide -= step;
        if (Math.abs(glide) < 0.4) glide = 0;
      }

      apply();
    }

    function start() {
      if (running) return;
      running = true;
      prevFrame = 0;
      frameHandle = window.requestAnimationFrame(frame);
    }

    function stop() {
      running = false;
      if (frameHandle) window.cancelAnimationFrame(frameHandle);
      frameHandle = null;
    }

    function engage() {
      belt.classList.add("is-engaged");
    }

    // ---- Pointer drag, with momentum ----
    viewport.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragging = true;
      pointerId = e.pointerId;
      lastX = e.clientX;
      lastT = e.timeStamp || window.performance.now();
      velocity = 0;
      glide = 0;
      belt.classList.add("is-dragging");
      engage();
      try {
        viewport.setPointerCapture(e.pointerId);
      } catch (err) {
        /* Capture is an optimisation; dragging still works without it. */
      }
    });

    viewport.addEventListener("pointermove", function (e) {
      if (!dragging || e.pointerId !== pointerId) return;
      var now = e.timeStamp || window.performance.now();
      var dx = e.clientX - lastX;
      var dt = Math.max(now - lastT, 1) / 1000;
      offset += dx;
      // Smoothed, because the last sample before a finger lifts is often a
      // jittery one and would otherwise become the whole fling speed.
      velocity = velocity * 0.72 + (dx / dt) * 0.28;
      lastX = e.clientX;
      lastT = now;
      apply();
    });

    function endDrag(e) {
      if (!dragging || (e && e.pointerId !== pointerId)) return;
      dragging = false;
      belt.classList.remove("is-dragging");
      try {
        viewport.releasePointerCapture(pointerId);
      } catch (err) {
        /* Already released, or never captured. */
      }
      pointerId = null;
      // velocity is left exactly as the drag ended it. The frame loop
      // decays it into the resting pace from here, which is the momentum.
    }
    viewport.addEventListener("pointerup", endDrag);
    viewport.addEventListener("pointercancel", endDrag);

    // ---- Hover and focus pause ----
    viewport.addEventListener("mouseenter", function () {
      hovering = true;
      engage();
    });
    viewport.addEventListener("mouseleave", function () {
      hovering = false;
    });
    viewport.addEventListener("focusin", function () {
      focused = true;
    });
    viewport.addEventListener("focusout", function () {
      focused = false;
    });

    // ---- Keyboard ----
    viewport.addEventListener("keydown", function (e) {
      var dir = 0;
      if (e.key === "ArrowRight") dir = -1;
      else if (e.key === "ArrowLeft") dir = 1;
      if (!dir) return;
      e.preventDefault();
      engage();
      var card = originals[0];
      var step = card ? card.getBoundingClientRect().width + 16 : 240;
      glide += dir * step;
    });

    // ---- Lifecycle ----
    var hintTimer = null;
    whileVisible(
      belt,
      function () {
        visible = true;
        if (document.visibilityState !== "hidden") start();
        // The hint fades on its own a few seconds after the belt is
        // actually on screen, not a few seconds after page load: a visitor
        // still reading the hero has not had their chance to see it.
        if (hintTimer === null) hintTimer = window.setTimeout(engage, 7000);
      },
      function () {
        visible = false;
        stop();
      }
    );

    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden") stop();
      else if (visible) start();
    });

    var rebuildTimer = null;
    window.addEventListener("resize", function () {
      window.clearTimeout(rebuildTimer);
      rebuildTimer = window.setTimeout(function () {
        build();
        apply();
      }, 160);
    });

    // Inter arriving after first paint changes every card's measured width,
    // and a setWidth taken against the fallback face would wrap early.
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready
        .then(function () {
          build();
          apply();
        })
        .catch(function () {});
    }

    build();
    apply();
  })();

  // -------------------------------------------------------------------
  // Product showcase — device switcher, mockup scaling, in-phone swiper
  //
  // Both mockups are authored at a fixed design size and scaled into
  // their frame with one transform, so the internal proportions are
  // identical at 320px and at 2560px. The scale is recomputed from the
  // measured frame rather than guessed at, and a ResizeObserver keeps it
  // exact through the stage's own height transition.
  // -------------------------------------------------------------------
  (function () {
    var stage = document.getElementById("presStage");
    if (!stage) return;

    var switcher = document.getElementById("presSwitch");
    var thumb = document.getElementById("presSwitchThumb");
    var caption = document.getElementById("presStageCaption");
    var buttons = slice(switcher ? switcher.querySelectorAll("[data-device]") : []);
    var panes = {
      desktop: document.getElementById("presPaneDesktop"),
      phone: document.getElementById("presPanePhone"),
    };
    var CAPTIONS = {
      desktop:
        "The member area on a laptop. Everything they own, one click from the front page.",
      phone:
        "The same account on a phone. Swipe between the library, the workout, the plan, the lesson and their progress.",
    };
    var current = "desktop";
    // Set by the phone deck below once it initialises, and read by the page
    // rail after it, so one control can drive both devices. Null until then
    // and null forever if the phone markup is absent — every read is
    // guarded rather than assuming the two always ship together.
    var phoneDeck = null;

    // ---- Scale each mockup to its frame ----
    function fit() {
      slice(stage.querySelectorAll(".pres-fit")).forEach(function (el) {
        var design = parseFloat(el.getAttribute("data-fit-width"));
        var host = el.parentNode;
        if (!design || !host) return;
        var width = host.clientWidth;
        if (width > 0) el.style.setProperty("--fit-scale", (width / design).toFixed(4));
      });
    }

    if (window.ResizeObserver) {
      // Observing the screens, not the window: this also fires on every
      // frame of the height transition when the device changes, which is
      // what keeps the mockup filling its frame the whole way across
      // rather than snapping to the right size at the end.
      var observer = new ResizeObserver(fit);
      slice(stage.querySelectorAll(".pres-shell__screen")).forEach(function (el) {
        observer.observe(el);
      });
    } else {
      window.addEventListener("resize", rafThrottle(fit), { passive: true });
    }

    // ---- Device switching ----
    function moveThumb(btn) {
      if (!thumb || !btn) return;
      thumb.style.width = btn.offsetWidth + "px";
      thumb.style.setProperty("--thumb-x", btn.offsetLeft - 5 + "px");
    }

    function select(device) {
      if (!panes[device] || device === current) return;
      current = device;

      buttons.forEach(function (btn) {
        var on = btn.getAttribute("data-device") === device;
        btn.classList.toggle("is-active", on);
        btn.setAttribute("aria-selected", on ? "true" : "false");
        // Roving tabindex: the tablist is one tab stop, arrow keys move
        // within it, which is what a tablist is supposed to do.
        btn.tabIndex = on ? 0 : -1;
        if (on) moveThumb(btn);
      });

      Object.keys(panes).forEach(function (key) {
        if (panes[key]) panes[key].classList.toggle("is-active", key === device);
      });

      stage.setAttribute("data-device", device);

      if (caption) {
        caption.classList.add("is-swapping");
        window.setTimeout(
          function () {
            caption.textContent = CAPTIONS[device] || "";
            caption.classList.remove("is-swapping");
          },
          prefersReducedMotion ? 0 : 220
        );
      }
    }

    buttons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        select(btn.getAttribute("data-device"));
      });
      btn.addEventListener("keydown", function (e) {
        var index = buttons.indexOf(btn);
        var next = null;
        if (e.key === "ArrowRight" || e.key === "ArrowDown") next = index + 1;
        else if (e.key === "ArrowLeft" || e.key === "ArrowUp") next = index - 1;
        else if (e.key === "Home") next = 0;
        else if (e.key === "End") next = buttons.length - 1;
        if (next === null || next < 0 || next >= buttons.length) return;
        e.preventDefault();
        select(buttons[next].getAttribute("data-device"));
        buttons[next].focus();
      });
    });

    // ---- First paint: size the thumb to the selected tab ----
    var initial = buttons.filter(function (b) {
      return b.classList.contains("is-active");
    })[0];
    if (initial) moveThumb(initial);
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready
        .then(function () {
          var active = buttons.filter(function (b) {
            return b.classList.contains("is-active");
          })[0];
          if (active) moveThumb(active);
          fit();
        })
        .catch(function () {});
    }
    window.addEventListener(
      "resize",
      rafThrottle(function () {
        var active = buttons.filter(function (b) {
          return b.classList.contains("is-active");
        })[0];
        if (active) moveThumb(active);
      }),
      { passive: true }
    );

    // ---- Bring the mockups to life once, on arrival ----
    function goLive() {
      if (stage.classList.contains("is-live")) return;
      stage.classList.add("is-live");
      slice(stage.querySelectorAll("[data-fill]")).forEach(function (el) {
        var value = parseFloat(el.getAttribute("data-fill"));
        if (!isFinite(value)) return;
        var ratio = Math.max(0, Math.min(100, value)) / 100;
        // Column charts grow upward, progress bars rightward. Both are a
        // scale on an already-composited element rather than a height or a
        // width, which is what keeps them off the layout path inside a
        // subtree that is itself being scaled.
        var vertical = el.parentNode && /(mock|mockp)__bars/.test(el.parentNode.className || "");
        el.style.transform = vertical ? "scaleY(" + ratio + ")" : "scaleX(" + ratio + ")";
      });
    }

    if ("IntersectionObserver" in window) {
      var live = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            goLive();
            live.unobserve(entry.target);
          });
        },
        { rootMargin: "0px 0px -15% 0px", threshold: 0.01 }
      );
      live.observe(stage);
    } else {
      goLive();
    }

    fit();

    // ---- The swipeable deck inside the phone ----
    (function () {
      var deck = document.getElementById("presPhoneDeck");
      var slides = document.getElementById("presPhoneSlides");
      var dots = document.getElementById("presPhoneDots");
      if (!deck || !slides) return;

      var panels = slice(slides.children);
      var marks = slice(dots ? dots.children : []);
      if (panels.length < 2) return;

      // The slide width in the mockup's own design pixels. Everything in
      // here is measured in that space and converted at the boundary,
      // because the whole phone is sitting inside a scale() transform.
      var SLIDE = 340;
      var index = 0;
      var dragging = false;
      var pointerId = null;
      var startX = 0;
      var shift = 0;
      var timer = null;

      function scale() {
        // Rendered width over layout width is exactly the transform's
        // scale factor, whatever presentation.js last set it to.
        var rendered = deck.getBoundingClientRect().width;
        var layout = deck.offsetWidth;
        return layout > 0 && rendered > 0 ? rendered / layout : 1;
      }

      function apply(extra) {
        slides.style.transform =
          "translate3d(" + (-index * SLIDE + (extra || 0)) + "px, 0, 0)";
      }

      function go(next) {
        index = (next + panels.length) % panels.length;
        apply(0);
        marks.forEach(function (mark, i) {
          mark.classList.toggle("is-on", i === index);
        });
      }

      function autoplay() {
        stopAuto();
        if (prefersReducedMotion) return;
        timer = window.setInterval(function () {
          // Only while the phone is the device on screen, and only while
          // the visitor is not mid-drag.
          if (dragging) return;
          if (stage.getAttribute("data-device") !== "phone") return;
          if (document.visibilityState === "hidden") return;
          go(index + 1);
        }, 3600);
      }
      function stopAuto() {
        if (timer) window.clearInterval(timer);
        timer = null;
      }

      deck.addEventListener("pointerdown", function (e) {
        if (e.pointerType === "mouse" && e.button !== 0) return;
        dragging = true;
        pointerId = e.pointerId;
        startX = e.clientX;
        shift = 0;
        slides.classList.add("is-dragging");
        try {
          deck.setPointerCapture(e.pointerId);
        } catch (err) {
          /* Optional. */
        }
      });

      deck.addEventListener("pointermove", function (e) {
        if (!dragging || e.pointerId !== pointerId) return;
        shift = (e.clientX - startX) / scale();
        // Resistance at the two ends, so the deck feels bounded rather
        // than broken when there is nothing further to reach.
        if ((index === 0 && shift > 0) || (index === panels.length - 1 && shift < 0)) {
          shift *= 0.32;
        }
        apply(shift);
      });

      function release(e) {
        if (!dragging || (e && e.pointerId !== pointerId)) return;
        dragging = false;
        slides.classList.remove("is-dragging");
        try {
          deck.releasePointerCapture(pointerId);
        } catch (err) {
          /* Already released. */
        }
        pointerId = null;
        // A quarter of a slide is enough to commit. Anything less springs
        // back to where it started.
        if (shift < -SLIDE * 0.25) go(index + 1);
        else if (shift > SLIDE * 0.25) go(index - 1);
        else apply(0);
        shift = 0;
      }
      deck.addEventListener("pointerup", release);
      deck.addEventListener("pointercancel", release);

      deck.addEventListener("mouseenter", stopAuto);
      deck.addEventListener("mouseleave", autoplay);

      go(0);
      autoplay();

      // Exposed so the page rail below can drive the phone as well as the
      // desktop — one control, whichever device happens to be on stage.
      phoneDeck = { go: go, count: panels.length };
    })();

    // -----------------------------------------------------------------
    // The desktop deck + the shared page rail
    //
    // Four pages inside the laptop, advancing on their own and steerable
    // from the rail under the stage. The rail is the single source of
    // truth for "which page are we on": it moves the desktop pages, the
    // sidebar highlight and — when the phone is the visible device — the
    // equivalent phone slide, so switching device mid-demo keeps the
    // viewer on the subject they were looking at instead of resetting.
    //
    // Page order matches the phone's slide order deliberately; PHONE_FOR
    // maps between them rather than assuming they are the same index,
    // because the phone has an extra video slide the desktop folds into
    // its workout page.
    // -----------------------------------------------------------------
    (function () {
      var pagesHost = document.getElementById("presDeskPages");
      var pager = document.getElementById("presPager");
      if (!pagesHost && !pager) return;

      var pages = slice(pagesHost ? pagesHost.querySelectorAll("[data-desk-page]") : []);
      var tabs = slice(pager ? pager.querySelectorAll("[data-page]") : []);
      var navRows = slice(stage.querySelectorAll("[data-desk-nav]"));
      if (!pages.length && !tabs.length) return;

      var ORDER = ["library", "workout", "nutrition", "progress"];
      // library -> phone slide 0, workout -> 1 (the session), nutrition -> 2,
      // progress -> 4 (slide 3 is the video lesson, which has no desktop
      // page of its own).
      var PHONE_FOR = { library: 0, workout: 1, nutrition: 2, progress: 4 };

      // The address bar moves with the page. It is a small thing, but a
      // browser chrome that says /my-library while the nutrition planner is
      // on screen is the detail that gives away that nobody is really
      // clicking anything.
      var URLS = {
        library: "yourbrand.com/my-library",
        workout: "yourbrand.com/train/week-3",
        nutrition: "yourbrand.com/nutrition/day-12",
        progress: "yourbrand.com/progress",
      };
      var urlEl = stage.querySelector(".mock--desktop .mock__url");

      var current = "library";
      var timer = null;
      var paused = false;

      function show(key) {
        if (!key || key === current) return;
        current = key;

        if (urlEl && URLS[key]) urlEl.textContent = URLS[key];

        pages.forEach(function (page) {
          page.classList.toggle("is-active", page.getAttribute("data-desk-page") === key);
        });
        navRows.forEach(function (row) {
          row.classList.toggle("is-active", row.getAttribute("data-desk-nav") === key);
        });
        tabs.forEach(function (tab) {
          var on = tab.getAttribute("data-page") === key;
          tab.classList.toggle("is-active", on);
          tab.setAttribute("aria-selected", on ? "true" : "false");
          tab.tabIndex = on ? 0 : -1;
        });

        // Keep the phone in step even while it is off stage, so switching
        // to it shows the page the viewer just asked for.
        if (phoneDeck && PHONE_FOR[key] != null && PHONE_FOR[key] < phoneDeck.count) {
          phoneDeck.go(PHONE_FOR[key]);
        }
      }

      function advance() {
        var next = (ORDER.indexOf(current) + 1) % ORDER.length;
        show(ORDER[next]);
      }

      function start() {
        stop();
        if (prefersReducedMotion || paused) return;
        // Slower than the hero: these panels carry real detail and a
        // viewer is expected to actually read one before it moves on.
        timer = window.setInterval(function () {
          if (document.visibilityState !== "visible") return;
          if (stage.getAttribute("data-device") !== "desktop") return;
          advance();
        }, 5200);
      }
      function stop() {
        if (timer) window.clearInterval(timer);
        timer = null;
      }

      tabs.forEach(function (tab, i) {
        tab.addEventListener("click", function () {
          // A deliberate choice pauses the rotation for good. Continuing to
          // auto-advance off a page somebody just asked for is the single
          // most irritating thing a demo carousel can do.
          paused = true;
          stop();
          show(tab.getAttribute("data-page"));
        });
        tab.addEventListener("keydown", function (e) {
          var next = null;
          if (e.key === "ArrowRight") next = i + 1;
          else if (e.key === "ArrowLeft") next = i - 1;
          else if (e.key === "Home") next = 0;
          else if (e.key === "End") next = tabs.length - 1;
          if (next === null || next < 0 || next >= tabs.length) return;
          e.preventDefault();
          paused = true;
          stop();
          show(tabs[next].getAttribute("data-page"));
          tabs[next].focus();
        });
      });

      // Clicking a row in the mock sidebar navigates too. It looks
      // clickable, so it had better be.
      navRows.forEach(function (row) {
        row.addEventListener("click", function () {
          paused = true;
          stop();
          show(row.getAttribute("data-desk-nav"));
        });
      });

      // Swipe across the laptop, same gesture as the phone deck and the
      // hero. Horizontal-only for the same reason: the page must still
      // scroll through it.
      if (pagesHost) {
        var sx = 0;
        var sy = 0;
        var live = false;
        var axis = null;

        pagesHost.addEventListener(
          "pointerdown",
          function (e) {
            if (e.pointerType === "mouse" && e.button !== 0) return;
            live = true;
            axis = null;
            sx = e.clientX;
            sy = e.clientY;
          },
          { passive: true }
        );
        pagesHost.addEventListener(
          "pointermove",
          function (e) {
            if (!live || axis) return;
            var dx = e.clientX - sx;
            var dy = e.clientY - sy;
            if (Math.abs(dx) < 8 && Math.abs(dy) < 8) return;
            axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
            if (axis === "y") live = false;
          },
          { passive: true }
        );
        pagesHost.addEventListener(
          "pointerup",
          function (e) {
            if (!live) return;
            live = false;
            var dx = e.clientX - sx;
            if (axis !== "x" || Math.abs(dx) < 44) return;
            paused = true;
            stop();
            var at = ORDER.indexOf(current);
            var to = dx < 0 ? at + 1 : at - 1;
            show(ORDER[(to + ORDER.length) % ORDER.length]);
          },
          { passive: true }
        );
      }

      if (pagesHost) {
        pagesHost.addEventListener("mouseenter", stop);
        pagesHost.addEventListener("mouseleave", start);
      }

      // Only runs while the showcase is actually on screen.
      whileVisible(
        stage,
        function () {
          start();
        },
        function () {
          stop();
        },
        "100px 0px"
      );
    })();
  })();

  // -------------------------------------------------------------------
  // Customer journey — scroll-driven progression
  //
  // The fill and the lit nodes track how far the block has travelled
  // through the viewport rather than a timer, so the sequence plays at
  // the speed it is being read and rewinds correctly on the way back up.
  // -------------------------------------------------------------------
  (function () {
    var journey = document.getElementById("presJourney");
    if (!journey) return;

    var steps = slice(journey.querySelectorAll(".pres-journey__step"));
    if (!steps.length) return;

    if (prefersReducedMotion) {
      journey.style.setProperty("--journey", "1");
      steps.forEach(function (step) {
        step.classList.add("is-lit");
      });
      return;
    }

    var active = false;

    var update = rafThrottle(function () {
      if (!active) return;
      var rect = journey.getBoundingClientRect();
      var vh = window.innerHeight || document.documentElement.clientHeight;
      // Zero when the block's top edge is 80% down the viewport, one when
      // its bottom edge has climbed to 38%. The band is deliberately wide:
      // the whole sequence should be finishing as the reader arrives at
      // the last label, not two screens earlier.
      var from = vh * 0.8;
      var to = vh * 0.38;
      var span = from - to + rect.height;
      var p = span > 0 ? (from - rect.top) / span : 0;
      p = Math.min(Math.max(p, 0), 1);

      journey.style.setProperty("--journey", p.toFixed(4));
      steps.forEach(function (step, i) {
        // Offset by a third of a step so the first node lights just after
        // the fill starts moving rather than being lit before it does.
        step.classList.toggle("is-lit", p >= (i + 0.35) / steps.length);
      });
    });

    whileVisible(
      journey,
      function () {
        active = true;
        update();
      },
      function () {
        active = false;
      },
      "200px 0px"
    );

    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update, { passive: true });
    update();
  })();

  // -------------------------------------------------------------------
  // Coming soon — the ambient drift
  //
  // The animation itself is entirely CSS (see §18b). This does two things
  // and then gets out of the way: duplicates each row's cards so the
  // -50% loop is seamless, and pauses the whole section while it is off
  // screen.
  //
  // The clone is aria-hidden. Without that, a screen reader reads all
  // thirteen features twice, which is the usual cost of the marquee
  // duplication trick and the usual thing people forget.
  // -------------------------------------------------------------------
  (function () {
    var soon = document.getElementById("presSoon");
    if (!soon) return;

    var tracks = slice(soon.querySelectorAll("[data-soon-track]"));
    if (!tracks.length) return;

    tracks.forEach(function (track) {
      var originals = slice(track.children);
      if (!originals.length) return;
      originals.forEach(function (card) {
        var copy = card.cloneNode(true);
        copy.setAttribute("aria-hidden", "true");
        // Same marker the benefit belt's clones carry, and for the same
        // reason: §24 drops them when printing, so a printed deck lists
        // each feature once instead of twice.
        copy.setAttribute("data-clone", "");
        track.appendChild(copy);
      });
    });

    // Reduced motion: the stylesheet stops the animation (§23) and the
    // rows become ordinary horizontal scrollers, so there is nothing to
    // pause and no reason to keep an observer alive for it.
    if (prefersReducedMotion) return;

    whileVisible(
      soon,
      function () {
        soon.classList.remove("is-paused");
      },
      function () {
        soon.classList.add("is-paused");
      },
      "120px 0px"
    );
  })();

  // -------------------------------------------------------------------
  // Campaign chart
  //
  // Ten bars that grow once, when the card first reaches the viewport.
  // Same scaleY-from-the-baseline approach as the showcase's charts, and
  // the same reason: a height animation on ten elements is ten layout
  // passes a frame, a scale is none.
  // -------------------------------------------------------------------
  (function () {
    var chart = document.querySelector(".pres-camp__chart");
    if (!chart) return;

    var bars = slice(chart.querySelectorAll("[data-camp-bar]"));
    if (!bars.length) return;

    function fill() {
      bars.forEach(function (bar, i) {
        var value = parseFloat(bar.getAttribute("data-camp-bar"));
        if (!isFinite(value)) return;
        var ratio = Math.max(0, Math.min(100, value)) / 100;
        if (prefersReducedMotion) {
          bar.style.transform = "scaleY(" + ratio + ")";
          return;
        }
        // A short stagger left to right, so the chart draws itself rather
        // than snapping to its final state all at once.
        window.setTimeout(function () {
          bar.style.transform = "scaleY(" + ratio + ")";
        }, i * 55);
      });
    }

    if (!("IntersectionObserver" in window)) {
      fill();
      return;
    }
    var seen = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          fill();
          seen.unobserve(entry.target);
        });
      },
      { rootMargin: "0px 0px -12% 0px", threshold: 0.01 }
    );
    seen.observe(chart);
  })();

  // -------------------------------------------------------------------
  // Parallax on the decorative fields
  //
  // Applied to the aura container, never to the orbs themselves: those
  // carry their own drift keyframes, and a second writer on the same
  // transform would cancel one or the other.
  // -------------------------------------------------------------------
  (function () {
    var layers = slice(document.querySelectorAll("[data-parallax]"));
    if (!layers.length || prefersReducedMotion) return;
    // Desktop only. On a phone the page already moves fast enough that a
    // second layer at a different rate reads as jitter, and it costs a
    // frame budget better spent on the belt.
    if (!window.matchMedia("(min-width: 900px)").matches) return;

    var items = layers.map(function (el) {
      return { el: el, factor: parseFloat(el.getAttribute("data-parallax")) || 0, mid: 0 };
    });

    // Positions are measured on resize, not per frame: reading a rect
    // inside the scroll handler forces a layout flush on every one of the
    // sixty frames a second this runs.
    function measure() {
      items.forEach(function (item) {
        var rect = item.el.getBoundingClientRect();
        item.mid = rect.top + window.scrollY + rect.height / 2;
      });
    }

    var update = rafThrottle(function () {
      var centre = window.scrollY + (window.innerHeight || 800) / 2;
      items.forEach(function (item) {
        var shift = (centre - item.mid) * item.factor;
        item.el.style.transform = "translate3d(0, " + shift.toFixed(1) + "px, 0)";
      });
    });

    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener(
      "resize",
      rafThrottle(function () {
        measure();
        update();
      }),
      { passive: true }
    );

    measure();
    update();
  })();

  // -------------------------------------------------------------------
  // Magnetic hover
  //
  // Writes two custom properties; the composed transform lives in CSS
  // (see §11) so it can share the element with the reveal system and the
  // hover lift without any of the three overwriting the others.
  // -------------------------------------------------------------------
  (function () {
    if (prefersReducedMotion) return;
    // A pointer that cannot hover has nothing to be magnetic about, and
    // running this on touch would move a card out from under the finger
    // that is trying to read it.
    if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;

    var nodes = slice(document.querySelectorAll("[data-magnetic]"));
    if (!nodes.length) return;

    var STRENGTH = 0.16;
    var MAX = 10;

    nodes.forEach(function (el) {
      var box = null;

      el.addEventListener("pointerenter", function () {
        box = el.getBoundingClientRect();
      });

      el.addEventListener("pointermove", function (e) {
        if (!box) box = el.getBoundingClientRect();
        var x = (e.clientX - (box.left + box.width / 2)) * STRENGTH;
        var y = (e.clientY - (box.top + box.height / 2)) * STRENGTH;
        el.style.setProperty("--mx", Math.max(-MAX, Math.min(MAX, x)).toFixed(2) + "px");
        el.style.setProperty("--my", Math.max(-MAX, Math.min(MAX, y)).toFixed(2) + "px");
      });

      el.addEventListener("pointerleave", function () {
        box = null;
        el.style.setProperty("--mx", "0px");
        el.style.setProperty("--my", "0px");
      });
    });
  })();

  // -------------------------------------------------------------------
  // Setup wizard — the partnership estimator
  //
  // Five steps and a result. The number it produces is a REVENUE SHARE,
  // not a price: 10% for the platform on its own, rising to 30% when
  // every service is selected.
  //
  // The arithmetic is deliberately simple and lives in the markup. Each
  // service carries a data-weight, the weights of the twelve services sum
  // to exactly 20, and the estimate is 10 + (selected weight). That means
  // the floor and the ceiling are structural rather than clamped after
  // the fact — you cannot get 9% or 31% out of this, and adding a service
  // to the HTML without rebalancing the others is a visible arithmetic
  // error rather than a silent drift past 30.
  //
  // Nothing here submits or reloads. The estimate is visible without an
  // email address, on purpose: gating the number behind a form is what
  // made the old contact section the weakest part of the deck.
  // -------------------------------------------------------------------

  // Written by the wizard, read by the enquiry form below it.
  var setupState = { scope: "platform", pct: 10, low: 10, high: 12, services: [] };

  function setupSummaryLine() {
    var parts = [
      "Estimated partnership range: " + setupState.low + "% – " + setupState.high + "%",
      "Scope: " + (setupState.scope === "platform" ? "Platform only" : "Platform and services"),
    ];
    if (setupState.services.length) {
      parts.push("Services selected: " + setupState.services.join(", "));
    }
    parts.push("(Visitor's own wizard estimate — not a quoted rate.)");
    return parts.join("\n");
  }

  (function () {
    var root = document.getElementById("presSetup");
    if (!root) return;

    var steps = slice(root.querySelectorAll("[data-setup-step]"));
    var dotsHost = document.getElementById("presSetupDots");
    var progress = document.getElementById("presSetupProgress");
    var pctEl = document.getElementById("presSetupPct");
    var gauge = document.getElementById("presSetupGauge");
    var noteEl = document.getElementById("presSetupNote");
    var rangeEl = document.getElementById("presSetupRange");
    var summaryEl = document.getElementById("presSetupSummary");
    var stepNumEl = document.getElementById("presSetupStepNum");
    var backBtn = document.getElementById("presSetupBack");
    var nextBtn = document.getElementById("presSetupNext");
    var nextLabel = document.getElementById("presSetupNextLabel");
    if (steps.length < 2 || !nextBtn) return;

    var BASE = 10;
    var CEILING = 30;
    var RESULT = steps.length - 1; // the result panel is the last step
    var QUESTIONS = RESULT; // 5 question steps
    var index = 0;

    var stepsHost = document.getElementById("presSetupSteps");
    var boxes = slice(root.querySelectorAll("[data-service]"));
    var scopeInputs = slice(root.querySelectorAll('input[name="setupScope"]'));

    // Keeps the panel exactly as tall as whichever step is showing. Read
    // after the class swap, so the measured element is the one that is
    // about to be visible.
    function sizeToStep() {
      if (!stepsHost) return;
      var active = steps[index];
      if (!active) return;
      stepsHost.style.height = active.offsetHeight + "px";
    }

    // Built below, but declared and filled before anything can call go().
    var dots = [];
    if (dotsHost) {
      steps.forEach(function (step, i) {
        var li = document.createElement("li");
        li.className = "pres-setup__dot" + (i === 0 ? " is-active" : "");
        dotsHost.appendChild(li);
        dots.push(li);
      });
    }

    function scope() {
      var picked = scopeInputs.filter(function (i) {
        return i.checked;
      })[0];
      return picked ? picked.value : "platform";
    }

    function platformOnly() {
      return scope() === "platform";
    }

    // ---- The estimate ----
    function compute() {
      if (platformOnly()) {
        return { pct: BASE, services: [] };
      }
      var total = BASE;
      var chosen = [];
      boxes.forEach(function (box) {
        if (!box.checked) return;
        var w = parseFloat(box.getAttribute("data-weight"));
        if (isFinite(w)) total += w;
        chosen.push(box.getAttribute("data-service") || "");
      });
      return { pct: Math.min(total, CEILING), services: chosen.filter(Boolean) };
    }

    function paint() {
      var out = compute();
      // Half-points are real (a 1.5-weight service on its own gives 11.5)
      // but a fractional percentage reads as false precision on an
      // estimate. Round for display, keep the exact figure for the range.
      var shown = Math.round(out.pct);

      // The range widens with scope: a platform-only answer is something we
      // can be nearly exact about, a twelve-service one genuinely is not.
      var spread = platformOnly() ? 2 : out.services.length > 6 ? 4 : 3;
      var low = Math.max(BASE, Math.round(out.pct - spread / 2));
      var high = Math.min(CEILING, low + spread);

      setupState.scope = scope();
      setupState.pct = shown;
      setupState.low = low;
      setupState.high = high;
      setupState.services = out.services;

      if (pctEl) pctEl.textContent = String(shown);
      if (gauge) {
        // A scale, not a width: the gauge is 100% wide and squashed from
        // the left edge, so it never triggers layout as it moves.
        var ratio = (out.pct - BASE) / (CEILING - BASE);
        gauge.style.transform = "scaleX(" + Math.max(0, Math.min(1, ratio)).toFixed(4) + ")";
      }
      if (noteEl) {
        noteEl.textContent = platformOnly()
          ? "Platform only. Add services and this moves."
          : out.services.length
          ? out.services.length + (out.services.length === 1 ? " service selected." : " services selected.")
          : "No services selected yet.";
      }
      if (rangeEl) rangeEl.textContent = low + "% – " + high + "%";
      if (summaryEl) {
        summaryEl.textContent = platformOnly()
          ? "The platform on its own, with no additional services."
          : out.services.length
          ? "Platform, plus " + out.services.join(", ").toLowerCase() + "."
          : "Platform and services, with nothing selected yet.";
      }
    }

    // ---- Step machinery ----
    //
    // "Platform only" skips the four service steps entirely. next()/prev()
    // ask for the next REACHABLE step rather than index ± 1, so the skip
    // works identically in both directions and the progress bar stays
    // honest about how much is left.
    function reachable(i) {
      if (i <= 0 || i >= RESULT) return true;
      return !platformOnly();
    }

    function seek(from, dir) {
      var i = from + dir;
      while (i > 0 && i < RESULT && !reachable(i)) i += dir;
      return Math.max(0, Math.min(RESULT, i));
    }

    function go(target) {
      index = Math.max(0, Math.min(RESULT, target));

      steps.forEach(function (step, i) {
        var on = i === index;
        step.classList.toggle("is-active", on);
        // Disabling the fieldset takes every control inside it out of the
        // tab order in one attribute — without it a keyboard user tabs
        // straight off the visible step into the hidden ones.
        if (step.tagName === "FIELDSET") step.disabled = !on;
      });

      if (backBtn) backBtn.disabled = index === 0;
      if (nextBtn) nextBtn.classList.toggle("u-hidden", index === RESULT);
      if (nextLabel) {
        nextLabel.textContent = seek(index, 1) === RESULT ? "See my estimate" : "Continue";
      }
      if (stepNumEl) stepNumEl.textContent = String(Math.min(index + 1, QUESTIONS));
      if (progress) {
        var ratio = index / RESULT;
        progress.style.transform = "scaleX(" + ratio.toFixed(4) + ")";
      }
      dots.forEach(function (dot, i) {
        dot.classList.toggle("is-active", i === index);
        dot.classList.toggle("is-done", i < index);
        dot.classList.toggle("is-skipped", !reachable(i));
      });

      sizeToStep();

      if (index === RESULT) {
        paint();
        track.bump({ wizardCompleted: true });
        track.event("setup_wizard", setupState.low + "-" + setupState.high + "%");
      }
    }

    nextBtn.addEventListener("click", function () {
      go(seek(index, 1));
    });
    if (backBtn) {
      backBtn.addEventListener("click", function () {
        go(seek(index, -1));
      });
    }

    // Every input repaints the estimate immediately — that live number is
    // the reason to keep answering.
    boxes.forEach(function (box) {
      box.addEventListener("change", paint);
    });
    scopeInputs.forEach(function (input) {
      input.addEventListener("change", function () {
        // Switching back to platform-only must not leave a dozen ticked
        // boxes silently contributing to a later answer.
        if (platformOnly()) {
          boxes.forEach(function (box) {
            box.checked = false;
          });
        }
        if (nextLabel) {
          nextLabel.textContent = seek(index, 1) === RESULT ? "See my estimate" : "Continue";
        }
        dots.forEach(function (dot, i) {
          dot.classList.toggle("is-skipped", !reachable(i));
        });
        paint();
      });
    });

    // Enter anywhere in the wizard advances it, the way a real form would.
    root.addEventListener("keydown", function (e) {
      if (e.key !== "Enter") return;
      // Except inside the enquiry form, which has its own submit.
      if (e.target && e.target.closest && e.target.closest("#presContactForm")) return;
      e.preventDefault();
      if (index < RESULT) go(seek(index, 1));
    });

    // Re-measure when the step's own height changes underneath us: a
    // reflow at a new viewport width, a font finally loading, or the
    // enquiry form being replaced by its confirmation panel — that last
    // one happens inside the result step long after any navigation.
    if (window.ResizeObserver && stepsHost) {
      var sizer = new ResizeObserver(rafThrottle(sizeToStep));
      steps.forEach(function (step) {
        sizer.observe(step);
      });
    } else {
      window.addEventListener("resize", rafThrottle(sizeToStep), { passive: true });
    }
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(sizeToStep).catch(function () {});
    }

    paint();
    go(0);
  })();

  // -------------------------------------------------------------------
  // Admin CTA links + enquiry form
  //
  // The three CTA BUTTONS are gone — the setup wizard is the closing
  // action now. The three admin-configured DESTINATIONS are not: a deck
  // cut for a partner mid-negotiation still wants its booking link. They
  // render here as a quiet row of links under the wizard, and only the
  // ones the admin actually filled in appear at all.
  // -------------------------------------------------------------------
  (function () {
    var form = document.getElementById("presContactForm");
    var intentEl = document.getElementById("presFormIntent");
    var statusEl = document.getElementById("presFormStatus");
    var submitBtn = document.getElementById("presFormSubmit");
    var links = document.getElementById("presCtaLinks");

    var intent = "Partnership estimate";

    if (links) {
      [
        ["Continue partnership", links.dataset.partnership],
        ["Schedule a meeting", links.dataset.meeting],
        ["Request a demo", links.dataset.demo],
      ].forEach(function (pair) {
        var label = pair[0];
        var href = pair[1] || "";
        if (!href) return;
        var a = document.createElement("a");
        a.className = "pres-cta__link";
        a.href = href;
        a.target = "_blank";
        // Without noopener the destination gets a window.opener handle
        // back into this page.
        a.rel = "noopener noreferrer";
        a.textContent = label;
        a.addEventListener("click", function () {
          track.event("cta_click", label);
        });
        links.appendChild(a);
      });
    }

    if (!form) return;

    function setFieldError(input, message) {
      var field = input.closest(".pres-field");
      if (!field) return;
      field.classList.toggle("is-invalid", !!message);
      var existing = field.querySelector(".pres-field__error");
      if (!message) {
        if (existing) existing.remove();
        input.removeAttribute("aria-invalid");
        return;
      }
      input.setAttribute("aria-invalid", "true");
      if (!existing) {
        existing = document.createElement("p");
        existing.className = "pres-field__error";
        field.appendChild(existing);
      }
      existing.textContent = message;
    }

    function showStatus(message, kind) {
      if (!statusEl) return;
      statusEl.textContent = message;
      statusEl.className = "pres-form__status pres-form__status--" + kind;
    }

    // Clear a field's error as soon as the visitor starts fixing it, rather
    // than leaving it red until the next submit.
    ["presName", "presEmail"].forEach(function (id) {
      var input = document.getElementById(id);
      if (input) input.addEventListener("input", function () { setFieldError(input, ""); });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();

      var nameInput = document.getElementById("presName");
      var emailInput = document.getElementById("presEmail");
      var messageInput = document.getElementById("presMessage");

      var name = nameInput.value.trim();
      var email = emailInput.value.trim();
      var valid = true;

      if (!name) {
        setFieldError(nameInput, "Please enter your name.");
        valid = false;
      }
      // Same permissive check the server uses — the point is catching typos,
      // not policing valid addresses.
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
        setFieldError(emailInput, "Please enter a valid email address.");
        valid = false;
      }
      if (!valid) {
        var firstBad = form.querySelector(".pres-field.is-invalid .pres-field__input");
        if (firstBad) firstBad.focus();
        return;
      }

      if (statusEl) statusEl.className = "pres-form__status u-hidden";
      submitBtn.classList.add("is-busy");
      submitBtn.disabled = true;

      fetch("/api/presentation/" + encodeURIComponent(SLUG) + "/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          visitId: VISIT_ID,
          intent: intent,
          name: name,
          email: email,
          company: "",
          // The estimate and the exact services they chose are prepended to
          // whatever they typed. Without it the notification email says
          // somebody wants to talk, but not about what — and the whole
          // point of the wizard is that the first reply can be specific.
          message: [setupSummaryLine(), messageInput ? messageInput.value.trim() : ""]
            .filter(Boolean)
            .join("\n\n"),
        }),
      })
        .then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (data) {
            if (!res.ok) throw new Error(data.error || "We couldn't send that just now.");
            return data;
          });
        })
        .then(function () {
          // The form is replaced rather than reset: re-submitting the same
          // enquiry twice from a meeting is noise, and the confirmation is
          // the more useful thing to leave on screen.
          var done = document.createElement("div");
          done.className = "pres-form__done";
          done.innerHTML =
            '<div class="pres-form__done-mark" aria-hidden="true"></div>' +
            '<h3 class="pres-form__done-title">Thank you. That\'s with us.</h3>' +
            '<p class="pres-form__done-body">We\'ll follow up personally within one business day.</p>';
          form.replaceWith(done);
          done.setAttribute("role", "status");
        })
        .catch(function (err) {
          showStatus(err.message || "We couldn't send that just now.", "error");
          submitBtn.classList.remove("is-busy");
          submitBtn.disabled = false;
        });
    });
  })();
})();
