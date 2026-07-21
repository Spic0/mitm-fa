/* ===========================================================================
   PROGRAM HANDBOOK VIEWER

   Turns the payload from GET /api/library/program/:id into a paginated,
   fullscreen reading experience — a digital handbook rather than a popup.

   Pagination is derived entirely from CMS content, never hardcoded:
     cover -> overview -> [training day]* -> [nutrition meal]* -> [faq]* -> bonus
   A program with no nutrition plan simply yields no nutrition pages, and a
   12-week program yields however many day pages it actually has.

   Lazy loading: a page's markup is only built when it comes within one page of
   the current position (HYDRATE_RADIUS), so opening a 60-day program does not
   parse 60 pages of HTML or start 200 media downloads up front. Pages already
   built are cached and never rebuilt.

   Usage:
     window.ProgramViewer.open(payload);   // payload = the /api/library response

   Exposed on window so program.js (and any future entry point, e.g. a card in
   my-library) can launch it without importing anything.
   =========================================================================== */
(function () {
  "use strict";

  var HYDRATE_RADIUS = 1;      // pages built either side of the current one
  var SWIPE_RATIO = 0.18;      // fraction of width that commits a turn
  var SWIPE_VELOCITY = 0.45;   // px/ms that commits a turn regardless of distance
  var AXIS_LOCK_SLOP = 10;     // px before deciding the gesture is horizontal

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ---------------------------------------------------------------- pages ---
     Each page is { section, title, render() } — render is deferred so the HTML
     string for a page is only ever built if the reader actually reaches it. */

  function buildPages(p) {
    var pages = [];

    pages.push({
      section: "Cover",
      render: function () {
        var meta = [];
        if (p.difficulty) meta.push('<span class="pv-chip"><i class="fa-solid fa-signal"></i>' + esc(p.difficulty) + "</span>");
        if (p.durationWeeks) meta.push('<span class="pv-chip"><i class="fa-regular fa-calendar"></i>' + esc(p.durationWeeks) + "-week</span>");
        return (
          '<div class="pv-cover">' +
          (p.imageUrl
            ? '<div class="pv-cover__art"><img src="' + esc(p.imageUrl) + '" alt="' + esc(p.name) + '" decoding="async"></div>'
            : "") +
          "<h2>" + esc(p.name) + "</h2>" +
          (p.creator ? '<p class="pv-cover__author">' + esc(p.creator) + "</p>" : "") +
          (meta.length ? '<div class="pv-cover__meta">' + meta.join("") + "</div>" : "") +
          "</div>"
        );
      },
    });

    if (p.overview) {
      pages.push({
        section: "Introduction",
        render: function () {
          return (
            '<p class="pv-page__eyebrow">Introduction</p><h2>About this program</h2>' +
            '<p>' + esc(p.overview).replace(/\n+/g, "</p><p>") + "</p>"
          );
        },
      });
    }

    // ---- Training: one page per day, so a day is always a single spread ----
    var training = p.trainingContent || {};
    if (training.notes) {
      pages.push({
        section: "Training",
        render: function () {
          return '<p class="pv-page__eyebrow">Training</p><h2>How to train</h2><p>' +
            esc(training.notes).replace(/\n+/g, "</p><p>") + "</p>";
        },
      });
    }
    (training.weeks || []).forEach(function (week, wi) {
      var weekTitle = week.title || "Week " + (wi + 1);
      (week.days || []).forEach(function (day, di) {
        pages.push({
          section: "Training",
          render: function () {
            var exercises = (day.exercises || []).map(function (ex) {
              var prescription = [ex.sets, ex.reps].filter(Boolean).join(" × ");
              // Exercise demo GIFs/videos ride the gated /api/library/media
              // endpoint. preload="none" keeps a day of clips off the wire
              // until the page is actually reached.
              var media = "";
              if (ex.mediaUrl) {
                media = '<div class="pv-ex__media">' + (ex.mediaType === "video"
                  ? '<video src="' + esc(ex.mediaUrl) + '" muted loop playsinline preload="none" autoplay></video>'
                  : '<img src="' + esc(ex.mediaUrl) + '" alt="' + esc(ex.name || "Exercise") + '" loading="lazy" decoding="async">') +
                  "</div>";
              }
              return (
                '<div class="pv-ex">' + media +
                '<div class="pv-ex__body"><strong>' + esc(ex.name || "Exercise") + "</strong>" +
                (prescription ? '<span class="pv-ex__reps">' + esc(prescription) + "</span>" : "") +
                (ex.notes ? '<p class="pv-ex__note">' + esc(ex.notes) + "</p>" : "") +
                (ex.substitutions ? '<p class="pv-ex__note">Swap: ' + esc(ex.substitutions) + "</p>" : "") +
                "</div></div>"
              );
            }).join("");
            return (
              '<p class="pv-page__eyebrow">' + esc(weekTitle) + "</p>" +
              "<h2>" + esc(day.title || "Day " + (di + 1)) + "</h2>" +
              (day.notes ? "<p>" + esc(day.notes) + "</p>" : "") +
              (exercises || '<p class="pv-empty">No exercises listed for this day.</p>')
            );
          },
        });
      });
    });

    // ---- Nutrition ----
    var nutrition = p.nutritionContent || {};
    if (nutrition.notes) {
      pages.push({
        section: "Nutrition",
        render: function () {
          return '<p class="pv-page__eyebrow">Nutrition</p><h2>How to eat</h2><p>' +
            esc(nutrition.notes).replace(/\n+/g, "</p><p>") + "</p>";
        },
      });
    }
    (nutrition.meals || []).forEach(function (meal) {
      pages.push({
        section: "Nutrition",
        render: function () {
          return (
            '<p class="pv-page__eyebrow">Nutrition</p><h2>' + esc(meal.name || "Meal") + "</h2>" +
            (meal.macros ? '<div class="pv-block"><h4>Macros</h4><p>' + esc(meal.macros) + "</p></div>" : "") +
            (meal.ingredients ? '<div class="pv-block"><h4>Ingredients</h4><p>' + esc(meal.ingredients) + "</p></div>" : "") +
            (meal.notes ? '<div class="pv-block"><h4>Method</h4><p>' + esc(meal.notes) + "</p></div>" : "")
          );
        },
      });
    });

    // ---- FAQ, chunked so a page stays a readable spread ----
    var faqs = p.faqs || [];
    for (var i = 0; i < faqs.length; i += 4) {
      (function (chunk) {
        pages.push({
          section: "FAQ",
          render: function () {
            return '<p class="pv-page__eyebrow">Questions</p><h2>FAQ</h2>' +
              chunk.map(function (f) {
                return '<div class="pv-block"><h4>' + esc(f.question) + "</h4><p>" + esc(f.answer) + "</p></div>";
              }).join("");
          },
        });
      })(faqs.slice(i, i + 4));
    }

    // ---- Bonus material: PDFs, files, and embeddable video links ----
    var resources = p.resources || [];
    if (resources.length || p.bonusNotes) {
      pages.push({
        section: "Bonus",
        render: function () {
          var embeds = "";
          var links = "";
          resources.forEach(function (r) {
            var embedUrl = toEmbedUrl(r.url, r.type);
            if (embedUrl) {
              embeds +=
                '<div class="pv-block"><h4>' + esc(r.title) + "</h4>" +
                '<div class="pv-embed"><iframe src="' + esc(embedUrl) + '" title="' + esc(r.title) +
                '" loading="lazy" allow="accelerometer; encrypted-media; picture-in-picture" allowfullscreen></iframe></div></div>';
              return;
            }
            var isPdf = /\.pdf(\?|$)/i.test(r.url || "") || r.type === "file";
            links +=
              '<a class="pv-res" href="' + esc(r.url) + '" target="_blank" rel="noopener">' +
              '<span class="pv-res__icon"><i class="fa-solid ' + (isPdf ? "fa-file-pdf" : "fa-arrow-up-right-from-square") + '"></i></span>' +
              '<span class="pv-res__body"><strong>' + esc(r.title) + "</strong>" +
              (r.description ? "<span>" + esc(r.description) + "</span>" : "") + "</span></a>";
          });
          return (
            '<p class="pv-page__eyebrow">Extras</p><h2>Bonus material</h2>' +
            (p.bonusNotes ? "<p>" + esc(p.bonusNotes) + "</p>" : "") +
            embeds + links +
            (!embeds && !links ? '<p class="pv-empty">No bonus resources for this program.</p>' : "")
          );
        },
      });
    }

    return pages;
  }

  // YouTube/Vimeo links stored as ProductResource(type:"link") become real
  // inline players. Anything else stays a link — we never iframe an arbitrary
  // third-party URL.
  function toEmbedUrl(url, type) {
    if (type !== "link" || !url) return null;
    var yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/);
    if (yt) return "https://www.youtube.com/embed/" + yt[1];
    var vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vimeo) return "https://player.vimeo.com/video/" + vimeo[1];
    return null;
  }

  /* --------------------------------------------------------------- viewer --- */

  function open(payload) {
    var product = (payload && payload.product) || payload || {};
    var pages = buildPages(product);
    if (!pages.length) return;

    var index = 0;
    var built = [];              // hydrated page indices
    var lastFocused = document.activeElement;

    var root = document.createElement("div");
    root.className = "pv";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", (product.name || "Program") + " handbook");
    root.innerHTML =
      '<div class="pv__book">' +
        '<div class="pv__bar">' +
          '<h2 class="pv__title">' + esc(product.name || "Program") + "</h2>" +
          '<span class="pv__section" data-pv-section></span>' +
          '<button class="pv__close" type="button" aria-label="Close handbook"><i class="fa-solid fa-xmark"></i></button>' +
        "</div>" +
        '<div class="pv__progress"><div class="pv__progress-fill" data-pv-fill></div></div>' +
        '<div class="pv__stage">' +
          '<div class="pv__track" data-pv-track></div>' +
        "</div>" +
        '<div class="pv__nav">' +
          '<button class="pv__nav-btn" type="button" data-pv-prev aria-label="Previous page"><i class="fa-solid fa-chevron-left"></i></button>' +
          '<span class="pv__count" data-pv-count aria-live="polite"></span>' +
          '<button class="pv__nav-btn" type="button" data-pv-next aria-label="Next page"><i class="fa-solid fa-chevron-right"></i></button>' +
        "</div>" +
      "</div>";

    var track = root.querySelector("[data-pv-track]");
    var fill = root.querySelector("[data-pv-fill]");
    var countEl = root.querySelector("[data-pv-count]");
    var sectionEl = root.querySelector("[data-pv-section]");
    var prevBtn = root.querySelector("[data-pv-prev]");
    var nextBtn = root.querySelector("[data-pv-next]");

    // Empty shells first: the track needs its full width immediately so the
    // transform maths is correct, but the markup inside stays unbuilt.
    pages.forEach(function () {
      var page = document.createElement("div");
      page.className = "pv-page";
      page.innerHTML = '<div class="pv-page__inner"></div>';
      track.appendChild(page);
    });
    var pageEls = Array.prototype.slice.call(track.children);

    function hydrate(i) {
      if (i < 0 || i >= pages.length || built[i]) return;
      pageEls[i].firstChild.innerHTML = pages[i].render();
      built[i] = true;
    }

    function setTransform(offsetPx, animate) {
      track.classList.toggle("is-animating", !!animate);
      track.style.transform = "translate3d(calc(" + (-index * 100) + "% + " + (offsetPx || 0) + "px), 0, 0)";
    }

    function update(animate) {
      for (var i = index - HYDRATE_RADIUS; i <= index + HYDRATE_RADIUS; i++) hydrate(i);
      setTransform(0, animate);
      fill.style.width = ((index + 1) / pages.length) * 100 + "%";
      countEl.textContent = index + 1 + " of " + pages.length;
      sectionEl.textContent = pages[index].section || "";
      prevBtn.disabled = index === 0;
      nextBtn.disabled = index === pages.length - 1;
      // A turned-to page always starts at its own top, like a real book.
      if (pageEls[index]) pageEls[index].scrollTop = 0;
    }

    function goTo(next) {
      var clamped = Math.max(0, Math.min(pages.length - 1, next));
      if (clamped === index) { setTransform(0, true); return; }
      index = clamped;
      update(true);
    }

    /* ------------------------------------------------------------ gestures ---
       Pointer Events cover touch, pen and mouse in one path. The gesture only
       claims the drag once it is clearly horizontal, so vertical scrolling
       inside a long page is never stolen. */
    var startX = 0, startY = 0, startT = 0;
    var dragging = false, locked = false, axis = null;

    function onDown(e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      dragging = true; locked = false; axis = null;
      startX = e.clientX; startY = e.clientY; startT = Date.now();
      track.classList.remove("is-animating");
      // Without capture, lifting the finger outside the stage never fires
      // pointerup here and the drag stays stuck mid-turn.
      if (e.pointerId != null && stage.setPointerCapture) {
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
      }
    }

    function onMove(e) {
      if (!dragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;

      if (!locked) {
        if (Math.abs(dx) < AXIS_LOCK_SLOP && Math.abs(dy) < AXIS_LOCK_SLOP) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        locked = true;
        if (axis === "y") { dragging = false; return; }   // hand back to scroll
      }
      if (axis !== "x") return;
      if (e.cancelable) e.preventDefault();

      // Resist at the ends so the book feels bound, not broken.
      if ((index === 0 && dx > 0) || (index === pages.length - 1 && dx < 0)) dx *= 0.32;
      setTransform(dx, false);
    }

    // Elements that own their own tap and must never trigger a page turn.
    function isInteractive(el) {
      return !!(el && el.closest && el.closest("a, button, video, iframe, input, textarea, select, details, summary"));
    }

    function onUp(e) {
      if (!dragging) return;
      dragging = false;
      if (e.pointerId != null && stage.releasePointerCapture) {
        try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      }

      // Tap-to-turn. Handled here rather than with overlay elements: absolutely
      // positioned tap zones would sit on top of the page and swallow vertical
      // scrolling and link taps in the outer strips.
      if (!locked) {
        if (isInteractive(e.target)) return;
        var box = stage.getBoundingClientRect();
        var ratio = (e.clientX - box.left) / box.width;
        if (ratio <= 0.25) goTo(index - 1);
        else if (ratio >= 0.75) goTo(index + 1);
        return;
      }

      if (axis !== "x") return;
      var dx = e.clientX - startX;
      var velocity = Math.abs(dx) / Math.max(1, Date.now() - startT);
      var threshold = track.clientWidth * SWIPE_RATIO;
      if (dx <= -threshold || (dx < 0 && velocity > SWIPE_VELOCITY)) goTo(index + 1);
      else if (dx >= threshold || (dx > 0 && velocity > SWIPE_VELOCITY)) goTo(index - 1);
      else setTransform(0, true);
    }

    var stage = root.querySelector(".pv__stage");
    stage.addEventListener("pointerdown", onDown, { passive: true });
    // Non-passive: a horizontal turn must be able to preventDefault so the
    // browser does not also scroll or trigger back-navigation.
    stage.addEventListener("pointermove", onMove, { passive: false });
    stage.addEventListener("pointerup", onUp, { passive: true });
    stage.addEventListener("pointercancel", function () { dragging = false; setTransform(0, true); }, { passive: true });

    prevBtn.addEventListener("click", function () { goTo(index - 1); });
    nextBtn.addEventListener("click", function () { goTo(index + 1); });

    /* -------------------------------------------------------------- close --- */
    function close() {
      root.classList.remove("is-open");
      document.body.classList.remove("pv-open");
      document.removeEventListener("keydown", onKey);
      var done = function () { if (root.parentNode) root.parentNode.removeChild(root); };
      root.addEventListener("transitionend", done, { once: true });
      setTimeout(done, 600);   // guarantee teardown if the transition is skipped
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }

    function onKey(e) {
      if (e.key === "Escape") { close(); return; }
      if (e.key === "ArrowRight") { goTo(index + 1); return; }
      if (e.key === "ArrowLeft") { goTo(index - 1); return; }
      if (e.key !== "Tab") return;
      // Focus trap: keep tabbing inside the dialog while it is modal.
      var focusables = root.querySelectorAll('button:not([tabindex="-1"]):not(:disabled), a[href]');
      if (!focusables.length) return;
      var first = focusables[0];
      var last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    }

    root.querySelector(".pv__close").addEventListener("click", close);
    root.addEventListener("click", function (e) { if (e.target === root) close(); });
    document.addEventListener("keydown", onKey);

    document.body.appendChild(root);
    document.body.classList.add("pv-open");
    update(false);
    // Next frame, so the opening transition has an initial state to animate from.
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        root.classList.add("is-open");
        root.querySelector(".pv__close").focus();
      });
    });

    return { close: close };
  }

  // _buildPages is exposed for headless testing of the paginator (page counts,
  // section ordering, escaping) without needing a DOM. Not part of the public
  // surface — callers should only use open().
  window.ProgramViewer = { open: open, _buildPages: buildPages };
})();
