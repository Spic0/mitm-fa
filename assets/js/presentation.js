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
            '<h3 class="pres-form__done-title">Thank you — that\'s with us.</h3>' +
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
