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

   Every page carries a stable `key` derived from the content it renders
   ("chapter:day:2:1", "chapter:meal:0", ...) rather than its ordinal, so a
   customer's reading position survives the creator adding a week in the
   middle of the program. program.js persists those keys as progress; see
   the ProgramProgress comment in server/prisma/schema.prisma.

   Usage:
     window.ProgramViewer.open(payload, {
       startKey,                  // resume here instead of the cover
       onPage: function (page, index, total) {},
     });

   Exposed on window so program.js (and any future entry point, e.g. a card in
   my-library) can launch it without importing anything.
   =========================================================================== */
(function () {
  "use strict";

  var HYDRATE_RADIUS = 1;      // pages built either side of the current one
  // Pages kept built behind/ahead of the current one before being torn down
  // again. Deliberately wider than HYDRATE_RADIUS so a page-turn and its
  // immediate reversal never re-render anything — the reader flicking back and
  // forth between two days should cost nothing. Beyond this the page's markup
  // (and every video element in it) is discarded and rebuilt on return, which
  // is what stops a 70-demo handbook ending the session with 70 live tiles.
  var KEEP_RADIUS = 2;
  var SWIPE_RATIO = 0.18;      // fraction of width that commits a turn
  var SWIPE_VELOCITY = 0.45;   // px/ms that commits a turn regardless of distance
  var AXIS_LOCK_SLOP = 10;     // px before deciding the gesture is horizontal

  // 24px inline icons. This page deliberately does not load all.min.css
  // (see the <head> comment in program.html), so the viewer carries the
  // handful of glyphs it needs rather than a 100KB icon font.
  var ICON = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    level: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V14M12 20V8M19 20V4"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/></svg>',
    pdf: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3.5H7.5A2 2 0 005.5 5.5v13a2 2 0 002 2h9a2 2 0 002-2V8z"/><path d="M14 3.5V8h4.5"/></svg>',
    external: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v5a1.8 1.8 0 01-1.8 1.8H5A1.8 1.8 0 013.2 19V7.8A1.8 1.8 0 015 6h5"/></svg>',
  };

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  /* ------------------------------------------------------------- demo media ---
     Every media url arrives from the server already resolved, on `ex.media`
     (see resolveTrainingMedia in server/src/routes/library.js). There is
     deliberately no variantUrl() helper here any more: building variant urls
     in the client is what allowed one of the two renderers to skip the step
     entirely and ship the raw 12.9MB original into <img src>. If a url is
     needed, it comes from the payload or from a data-* attribute that came
     from the payload — it is never constructed. */

  var reduceMotion = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  // One observer for the whole viewer. A demo swaps from its poster to the
  // animated derivative only once it is actually on screen — pages are
  // hydrated one either side of the current one, so "built" is a long way
  // from "being looked at", and pre-fetching every animation would put the
  // bytes back that the poster just saved.
  var animObserver = null;
  function ensureAnimObserver() {
    if (animObserver || reduceMotion || typeof IntersectionObserver !== "function") return animObserver;
    animObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var img = entry.target;
        animObserver.unobserve(img);
        var anim = img.getAttribute("data-anim");
        if (!anim) return;
        // Decode into cache first, then swap. Assigning src directly would
        // blank the tile for as long as the animation takes to arrive, which
        // on a slow connection is exactly the flash of nothing the poster
        // exists to prevent.
        var loader = new Image();
        loader.onload = function () { img.src = anim; };
        loader.onerror = function () { /* poster stays; nothing to recover */ };
        loader.src = anim;
      });
    }, { rootMargin: "200px" });
    return animObserver;
  }

  /* ------------------------------------------------------- video lifecycle ---
     The reason the handbook renders <video> instead of an animated <img>: a
     video can be turned OFF. An <img> playing an animated WebP has no pause,
     no way to drop its decoded frames, and no preload control, so a handbook
     with 70-100 demos accumulates animation buffers that nothing can reclaim.

     Each tile therefore has two states, and this observer moves it between
     them as it approaches and leaves the viewport:

       attached  — <source> elements present, metadata (or more) loaded, playing
       released  — sources REMOVED and load() called, which is what actually
                   makes the browser free the decoder and the buffered data.
                   Dropping .src alone does not; the element keeps its media
                   resource until it is told to reload from nothing.

     Only the poster survives a release, so a released tile still looks right —
     it just isn't moving and isn't costing anything. */

  var VIDEO_MARGIN = "300px";   // ~one tile of runway before it's on screen
  var videoObserver = null;

  function attachVideo(v) {
    if (v.getAttribute("data-attached") === "1") return;
    v.setAttribute("data-attached", "1");
    var webm = v.getAttribute("data-webm");
    var mp4 = v.getAttribute("data-mp4");
    // WebM first: VP9 is ~40% smaller than the openh264 MP4 at the same
    // quality, so every browser that can take it should. Safari can't, and
    // falls through to the MP4.
    if (webm) v.appendChild(sourceEl(webm, "video/webm"));
    if (mp4) v.appendChild(sourceEl(mp4, "video/mp4"));
    v.load();
    if (!reduceMotion) {
      // play() rejects on some browsers if the gesture/autoplay rules aren't
      // met. A demo that sits on its poster is a fine outcome; an unhandled
      // rejection in the console is not.
      var p = v.play();
      if (p && typeof p.catch === "function") p.catch(function () {});
    }
  }

  function sourceEl(src, type) {
    var s = document.createElement("source");
    s.src = src;
    s.type = type;
    return s;
  }

  function releaseVideo(v) {
    if (v.getAttribute("data-attached") !== "1") return;
    v.removeAttribute("data-attached");
    try {
      v.pause();
      while (v.firstChild) v.removeChild(v.firstChild);
      v.removeAttribute("src");
      // The load() is the part that actually frees anything. Without it the
      // element holds its buffer and decoder for as long as it exists.
      v.load();
    } catch (err) { /* a tile that won't release is not worth throwing over */ }
  }

  function ensureVideoObserver() {
    if (videoObserver || typeof IntersectionObserver !== "function") return videoObserver;
    videoObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) attachVideo(entry.target);
        else releaseVideo(entry.target);
      });
    }, { rootMargin: VIDEO_MARGIN });
    return videoObserver;
  }

  // Used when a page is torn down: the observer callback never fires for an
  // element that has already left the document, so release has to be explicit.
  function releaseMediaIn(el) {
    if (!el) return;
    var vids = el.querySelectorAll("video[data-pv-vid]");
    for (var i = 0; i < vids.length; i++) {
      if (videoObserver) videoObserver.unobserve(vids[i]);
      releaseVideo(vids[i]);
    }
    if (animObserver) {
      var imgs = el.querySelectorAll("img[data-anim]");
      for (var j = 0; j < imgs.length; j++) animObserver.unobserve(imgs[j]);
    }
  }

  // Every demo on a page becomes one lightbox gallery, so a reader can swipe
  // between the day's exercises once they've opened one. The viewer
  // (program-media.js) already provides zoom, pan, keyboard nav and native
  // fullscreen — the handbook simply never called it.
  function wireExerciseMedia(pageEl) {
    var obs = ensureAnimObserver();
    var btns = Array.prototype.slice.call(pageEl.querySelectorAll("[data-pv-media]"));
    if (!btns.length) return;

    if (obs) {
      btns.forEach(function (btn) {
        var img = btn.querySelector("img[data-anim]");
        if (img) obs.observe(img);
      });
    }

    var vobs = ensureVideoObserver();
    if (vobs) {
      btns.forEach(function (btn) {
        var vid = btn.querySelector("video[data-pv-vid]");
        if (vid) vobs.observe(vid);
      });
    } else {
      // No IntersectionObserver (very old browser): attach everything on this
      // page rather than leaving dead posters. A hydrated page is at most one
      // day of demos, which is the same handful the old <img> path loaded.
      btns.forEach(function (btn) {
        var vid = btn.querySelector("video[data-pv-vid]");
        if (vid) attachVideo(vid);
      });
    }

    // Every url the lightbox needs is already in the DOM, put there from the
    // server-resolved payload. Nothing is derived from data-pv-url — that is
    // now the poster, and appending a second ?variant= to it would produce a
    // url that resolves to nothing.
    var items = btns.map(function (btn) {
      var title = btn.getAttribute("data-pv-title") || "";
      var vid = btn.querySelector("video[data-pv-vid]");
      // Fullscreen gets a capped derivative, never the multi-megabyte original:
      // 640px is already more than the viewer can show on any phone, and the
      // zoom works on the rendered frame either way. A transcoded demo opens as
      // real video (seekable, pausable).
      if (vid) {
        return {
          type: "video",
          url: vid.getAttribute("data-mp4"),
          sources: [
            { src: vid.getAttribute("data-webm"), label: "WebM" },
            { src: vid.getAttribute("data-mp4"), label: "MP4" },
          ],
          poster: vid.getAttribute("poster"),
          title: title,
        };
      }
      var plainVid = btn.querySelector("video");
      if (plainVid) {
        return { type: "video", url: plainVid.getAttribute("src"), title: title };
      }
      var img = btn.querySelector("img");
      var anim = img && img.getAttribute("data-anim");
      return {
        type: "image",
        url: anim || (img && img.getAttribute("src")) || btn.getAttribute("data-pv-url"),
        poster: anim ? img.getAttribute("src") : undefined,
        title: title,
      };
    });

    btns.forEach(function (btn, i) {
      btn.addEventListener("click", function () {
        if (window.ProgramMedia && window.ProgramMedia.open) window.ProgramMedia.open(items, i);
      });
    });
  }

  /* ---------------------------------------------------------------- pages ---
     Each page is { section, title, render() } — render is deferred so the HTML
     string for a page is only ever built if the reader actually reaches it. */

  function buildPages(p) {
    var pages = [];

    pages.push({
      key: "chapter:cover",
      section: "Cover",
      title: p.name || "Cover",
      render: function () {
        var meta = [];
        if (p.difficulty) meta.push('<span class="pv-chip">' + ICON.level + esc(p.difficulty) + "</span>");
        if (p.durationWeeks) meta.push('<span class="pv-chip">' + ICON.calendar + esc(p.durationWeeks) + "-week</span>");
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
        key: "chapter:intro",
        section: "Introduction",
        title: "About this program",
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
        key: "chapter:training-notes",
        section: "Training",
        title: "How to train",
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
          key: "chapter:day:" + wi + ":" + di,
          section: "Training",
          title: day.title || "Day " + (di + 1),
          render: function () {
            var exercises = (day.exercises || []).map(function (ex) {
              var prescription = [ex.sets, ex.reps].filter(Boolean).join(" × ");
              // Exercise demo GIFs/videos ride the gated /api/library/media
              // endpoint. preload="none" keeps a day of clips off the wire
              // until the page is actually reached.
              //
              // A demo GIF is loaded as its still poster (~19KB) rather than
              // the original (~15MB, 1920x1080, painted into a ~400px box).
              // wireExerciseMedia() below swaps in the animated derivative
              // (~226KB) once the tile is genuinely on screen. Both are
              // resolved by ?variant= against the SAME stored URL, and both
              // fall back to the original server-side when a derivative
              // hasn't been generated, so a program uploaded before the
              // pipeline existed renders exactly as it always did.
              var media = "";
              if (ex.mediaUrl) {
                var mediaLabel = esc(ex.name || "Exercise");
                // Resolved server-side (resolveTrainingMedia in
                // routes/library.js). This renderer no longer builds variant
                // urls or looks anything up: it is handed finished urls, which
                // is what makes it impossible for a renderer to forget.
                var facts = ex.media || null;
                // Reserve the tile's box from the aspect ratio so the poster
                // arriving never shifts the text beside it.
                var ratioStyle = facts && facts.aspectRatio
                  ? ' style="aspect-ratio:' + facts.aspectRatio + '"' : "";

                var inner;
                if (facts && facts.kind === "video") {
                  // Transcoded demo. Sources are deliberately NOT set here —
                  // markup carries them as data-* and the lifecycle observer
                  // below attaches them when the tile nears the viewport and
                  // strips them again when it leaves. A <source> in the markup
                  // would start fetching the moment the page is hydrated,
                  // which for a pre-built neighbouring page is exactly the
                  // speculative download this whole design exists to avoid.
                  inner = '<video class="pv-ex__video" data-pv-vid' +
                    ' data-mp4="' + esc(facts.mp4) + '"' +
                    ' data-webm="' + esc(facts.webm) + '"' +
                    ' poster="' + esc(facts.thumb || facts.poster) + '"' +
                    ' muted loop playsinline preload="metadata"' +
                    ' aria-label="' + mediaLabel + ' demonstration"></video>';
                } else if (ex.mediaType === "video" && !facts) {
                  inner = '<video src="' + esc(ex.mediaUrl) + '" muted loop playsinline preload="none" autoplay></video>';
                } else if (facts && facts.kind === "animated-image") {
                  // Animated but not transcoded (ffmpeg absent, or the job
                  // failed). Poster now, animation when it is looked at.
                  inner = '<img src="' + esc(facts.poster) + '"' +
                    ' data-anim="' + esc(facts.anim) + '"' +
                    ' alt="' + mediaLabel + '" loading="lazy" decoding="async">';
                } else {
                  // Static image — nothing moves, so there is nothing lighter
                  // to serve than the (already resolved) still. ex.mediaUrl is
                  // the poster where one exists and the original otherwise,
                  // which for these is a few KB at most.
                  inner = '<img src="' + esc(ex.mediaUrl) + '"' +
                    ' alt="' + mediaLabel + '" loading="lazy" decoding="async">';
                }

                media = '<div class="pv-ex__media"' + ratioStyle + '>' +
                  '<button type="button" class="pv-ex__media-btn" data-pv-media' +
                  ' data-pv-url="' + esc(ex.mediaUrl) + '"' +
                  ' data-pv-kind="' + (ex.mediaType === "video" ? "video" : "image") + '"' +
                  ' data-pv-title="' + mediaLabel + '"' +
                  ' aria-label="Open ' + mediaLabel + ' demo full screen">' +
                  inner +
                  '<span class="pv-ex__media-expand" aria-hidden="true"></span>' +
                  "</button></div>";
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
        key: "chapter:nutrition-notes",
        section: "Nutrition",
        title: "How to eat",
        render: function () {
          return '<p class="pv-page__eyebrow">Nutrition</p><h2>How to eat</h2><p>' +
            esc(nutrition.notes).replace(/\n+/g, "</p><p>") + "</p>";
        },
      });
    }
    (nutrition.meals || []).forEach(function (meal, mi) {
      pages.push({
        key: "chapter:meal:" + mi,
        section: "Nutrition",
        title: meal.name || "Meal " + (mi + 1),
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
      (function (chunk, ci) {
        pages.push({
          key: "chapter:faq:" + ci,
          section: "FAQ",
          title: "FAQ",
          render: function () {
            return '<p class="pv-page__eyebrow">Questions</p><h2>FAQ</h2>' +
              chunk.map(function (f) {
                return '<div class="pv-block"><h4>' + esc(f.question) + "</h4><p>" + esc(f.answer) + "</p></div>";
              }).join("");
          },
        });
      })(faqs.slice(i, i + 4), i / 4);
    }

    // ---- Bonus material: PDFs, files, and embeddable video links ----
    var resources = p.resources || [];
    if (resources.length || p.bonusNotes) {
      pages.push({
        key: "chapter:bonus",
        section: "Bonus",
        title: "Bonus material",
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
              '<span class="pv-res__icon">' + (isPdf ? ICON.pdf : ICON.external) + "</span>" +
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

  function open(payload, opts) {
    var product = (payload && payload.product) || payload || {};
    var options = opts || {};
    var pages = buildPages(product);
    if (!pages.length) return;

    // Resume. An unknown startKey (content edited since it was stored) is
    // not an error — it simply falls back to the cover.
    var index = 0;
    if (options.startKey) {
      for (var si = 0; si < pages.length; si++) {
        if (pages[si].key === options.startKey) { index = si; break; }
      }
    }
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
          '<button class="pv__close" type="button" aria-label="Close handbook">' + ICON.close + "</button>" +
        "</div>" +
        '<div class="pv__progress"><div class="pv__progress-fill" data-pv-fill></div></div>' +
        '<div class="pv__stage">' +
          '<div class="pv__track" data-pv-track></div>' +
        "</div>" +
        '<div class="pv__nav">' +
          '<button class="pv__nav-btn" type="button" data-pv-prev aria-label="Previous page">' + ICON.prev + "</button>" +
          '<span class="pv__count" data-pv-count aria-live="polite"></span>' +
          '<button class="pv__nav-btn" type="button" data-pv-next aria-label="Next page">' + ICON.next + "</button>" +
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
      // Demo tiles only exist once their page has been built, so observation
      // and the lightbox wiring have to happen here rather than once up front.
      wireExerciseMedia(pageEls[i].firstChild);
    }

    // The other half of hydrate(). Discarding the markup is what releases the
    // video elements; releaseMediaIn() first because an element removed from
    // the document never gets another observer callback, so it would otherwise
    // keep its buffer until GC decided otherwise.
    function dehydrate(i) {
      if (i < 0 || i >= pages.length || !built[i]) return;
      var inner = pageEls[i].firstChild;
      releaseMediaIn(inner);
      inner.innerHTML = "";
      built[i] = false;
    }

    function setTransform(offsetPx, animate) {
      track.classList.toggle("is-animating", !!animate);
      track.style.transform = "translate3d(calc(" + (-index * 100) + "% + " + (offsetPx || 0) + "px), 0, 0)";
    }

    function update(animate) {
      for (var i = index - HYDRATE_RADIUS; i <= index + HYDRATE_RADIUS; i++) hydrate(i);
      // Virtualization: anything further away than KEEP_RADIUS goes back to an
      // empty shell. The shells themselves always stay — the track's width is
      // what the swipe transform is measured against.
      for (var d = 0; d < pages.length; d++) {
        if (d < index - KEEP_RADIUS || d > index + KEEP_RADIUS) dehydrate(d);
      }
      setTransform(0, animate);
      fill.style.width = ((index + 1) / pages.length) * 100 + "%";
      countEl.textContent = index + 1 + " of " + pages.length;
      sectionEl.textContent = pages[index].section || "";
      prevBtn.disabled = index === 0;
      nextBtn.disabled = index === pages.length - 1;
      // A turned-to page always starts at its own top, like a real book.
      if (pageEls[index]) pageEls[index].scrollTop = 0;

      // Reaching a page is what marks it read — program.js turns this into
      // both the "chapters completed" count and the resume position.
      if (options.onPage) {
        try { options.onPage(pages[index], index, pages.length); }
        catch (err) { /* never break the reader over a callback */ }
      }
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
      // Never claim the pointer for something that owns its own tap.
      //
      // setPointerCapture retargets the whole interaction — INCLUDING the
      // click that follows — to the capturing element, so with the stage
      // capturing every pointerdown, the click on a button inside a page was
      // delivered to .pv__stage and the button's own handler never ran. That
      // made every button, link, video control and iframe inside a program
      // page dead to real pointer input; only synthetic .click() worked.
      // onUp's isInteractive() check already keeps these from turning the
      // page, but that runs far too late to save the click.
      if (isInteractive(e.target)) { dragging = false; return; }
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
      // Stop and free every demo before the fade-out starts. Waiting for the
      // node removal would leave videos decoding through the transition, and
      // a closed handbook has no business still playing anything.
      releaseMediaIn(track);
      var done = function () { if (root.parentNode) root.parentNode.removeChild(root); };
      root.addEventListener("transitionend", done, { once: true });
      setTimeout(done, 600);   // guarantee teardown if the transition is skipped
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }

    function onKey(e) {
      // The fullscreen media viewer layers on top of the handbook and owns the
      // keyboard while it is open. Both bind keydown on document and neither
      // stops propagation, so without this one Escape would close the media
      // viewer AND the handbook underneath it, and Arrow keys would turn the
      // page behind the image being looked at. program-media.js sets this
      // class on <body> for exactly the length of its own lifetime.
      if (document.body.classList.contains("pm-open")) return;
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

    return {
      close: close,
      goToKey: function (key) {
        for (var i = 0; i < pages.length; i++) {
          if (pages[i].key === key) { goTo(i); return true; }
        }
        return false;
      },
    };
  }

  // _buildPages is exposed for headless testing of the paginator (page counts,
  // section ordering, escaping) without needing a DOM. Not part of the public
  // surface — callers should only use open().
  window.ProgramViewer = { open: open, _buildPages: buildPages };
})();
