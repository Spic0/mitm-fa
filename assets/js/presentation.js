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
        "The same account on a phone. Swipe between the workout, the plan and the lesson.",
    };
    var current = "desktop";

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
        el.style.transform = "scaleX(" + ratio + ")";
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
  // CTA buttons + enquiry form
  // -------------------------------------------------------------------
  (function () {
    var form = document.getElementById("presContactForm");
    var intentEl = document.getElementById("presFormIntent");
    var statusEl = document.getElementById("presFormStatus");
    var submitBtn = document.getElementById("presFormSubmit");
    var ctaButtons = Array.prototype.slice.call(document.querySelectorAll("[data-cta]"));
    var links = document.getElementById("presCtaLinks");

    var intent = "Continue Partnership";

    // Per-CTA destination overrides, set by the admin per presentation. When
    // one is present the button becomes a real navigation (a booking link, a
    // calendar, a demo environment) instead of scrolling to the form.
    var overrides = {};
    if (links) {
      overrides["Continue Partnership"] = links.dataset.partnership || "";
      overrides["Schedule Meeting"] = links.dataset.meeting || "";
      overrides["Request Demo"] = links.dataset.demo || "";
    }

    ctaButtons.forEach(function (btn) {
      btn.addEventListener("click", function () {
        var label = btn.getAttribute("data-cta") || "";
        track.event("cta_click", label);

        var href = overrides[label];
        if (href) {
          // rel on a programmatic open: without noopener the destination
          // gets a window.opener handle back into this page.
          window.open(href, "_blank", "noopener,noreferrer");
          return;
        }

        intent = label;
        if (intentEl) intentEl.textContent = label;
        ctaButtons.forEach(function (other) {
          other.classList.toggle("is-active", other === btn);
        });
        if (form) {
          var nameField = document.getElementById("presName");
          form.scrollIntoView({
            behavior: prefersReducedMotion ? "auto" : "smooth",
            block: "center",
          });
          // Focus after the scroll settles, not during — focusing mid-scroll
          // makes the browser jump to the field and cancels the animation.
          window.setTimeout(function () {
            if (nameField) nameField.focus({ preventScroll: true });
          }, prefersReducedMotion ? 0 : 420);
        }
      });
    });

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
      var companyInput = document.getElementById("presCompany");
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
          company: companyInput ? companyInput.value.trim() : "",
          message: messageInput ? messageInput.value.trim() : "",
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
