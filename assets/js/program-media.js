/* ===========================================================================
   PROGRAM MEDIA VIEWER

   The fullscreen viewer behind every image and video in a purchased
   program. Nothing in the program view plays or displays media in place at
   thumbnail size — a tile is an invitation, this is where the media
   actually lives.

   Images  : pinch-zoom, wheel-zoom, double-tap zoom, drag-to-pan, swipe
             between items. Panning takes over from swiping while zoomed in,
             so a zoomed photo can be explored without falling to the next
             slide.
   Video   : custom large-target controls (48px minimum), scrub bar with a
             touch-sized hit area, playback rate, mute, Picture-in-Picture,
             plus a source selector that appears ONLY when an item genuinely
             ships more than one rendition.
   Embeds  : YouTube/Vimeo keep their own player chrome — we give them the
             full stage and stay out of the way.

   THIS VIEWER IS A CSS OVERLAY, not a Fullscreen API client. It is fixed to
   the viewport, pins the page scroll behind it and sizes its own media box.
   It deliberately does NOT call requestFullscreen and offers no control that
   does — see the note above the PiP handler for why that split is not worth
   having.

   Usage:
     window.ProgramMedia.open(items, startIndex, { onView: fn });

     items[] = {
       type: "image" | "video" | "embed",
       url, poster?, title?, subtitle?, key?,
       aspectRatio?: number,              // reserves the box before media loads
       sources?: [{ src, label }],        // renders the source selector
       fallbackSources?: [{ src, label }] // used if every `sources` entry fails
     }

   `onView(item, index)` fires when an item is actually looked at — for
   video, once it has been played rather than merely opened — which is what
   program.js records as "watched".
   =========================================================================== */
(function () {
  "use strict";

  var MAX_ZOOM = 4;
  var MIN_ZOOM = 1;
  var DOUBLE_TAP_ZOOM = 2.5;
  var SWIPE_RATIO = 0.2;
  var SWIPE_VELOCITY = 0.5;
  var AXIS_LOCK_SLOP = 10;
  var WATCHED_RATIO = 0.15;   // fraction of a video that counts as watched
  var CONTROLS_IDLE_MS = 2600;

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function fmtTime(seconds) {
    if (!isFinite(seconds) || seconds < 0) seconds = 0;
    var total = Math.floor(seconds);
    var m = Math.floor(total / 60);
    var s = total % 60;
    var h = Math.floor(m / 60);
    if (h > 0) return h + ":" + String(m % 60).padStart(2, "0") + ":" + String(s).padStart(2, "0");
    return m + ":" + String(s).padStart(2, "0");
  }

  // 24px line icons, inline so the viewer has no icon-font dependency of
  // its own (this page deliberately doesn't load all.min.css).
  var ICON = {
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true" class="is-solid"><path d="M8 5.2v13.6L19 12z"/></svg>',
    pause: '<svg viewBox="0 0 24 24" aria-hidden="true" class="is-solid"><rect x="7" y="5" width="3.4" height="14" rx="1"/><rect x="13.6" y="5" width="3.4" height="14" rx="1"/></svg>',
    volume: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6.5 9H3v6h3.5L11 19z"/><path d="M15.5 8.5a5 5 0 010 7"/><path d="M18.5 6a9 9 0 010 12"/></svg>',
    muted: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M11 5L6.5 9H3v6h3.5L11 19z"/><path d="M16 9.5l5 5M21 9.5l-5 5"/></svg>',
    pip: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><rect x="12" y="12" width="7" height="5" rx="1.2"/></svg>',
    zoomIn: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M11 8.5v5M8.5 11h5M20 20l-3.9-3.9"/></svg>',
    zoomOut: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M8.5 11h5M20 20l-3.9-3.9"/></svg>',
    speed: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20a8 8 0 118-8"/><path d="M12 12l4.5-3"/></svg>',
  };

  function open(items, startIndex, opts) {
    items = (items || []).filter(Boolean);
    if (!items.length) return null;

    var options = opts || {};
    var index = Math.max(0, Math.min(items.length - 1, startIndex || 0));
    var lastFocused = document.activeElement;
    var viewed = {};

    /* ------------------------------------------------------------ shell --- */
    var root = document.createElement("div");
    root.className = "pm";
    root.setAttribute("role", "dialog");
    root.setAttribute("aria-modal", "true");
    root.setAttribute("aria-label", "Media viewer");
    root.innerHTML =
      '<div class="pm__bar">' +
        '<div class="pm__meta">' +
          '<strong data-pm-title></strong>' +
          '<span data-pm-sub></span>' +
        "</div>" +
        '<span class="pm__count" data-pm-count aria-live="polite"></span>' +
        '<div class="pm__bar-actions">' +
          '<button type="button" class="pm__icon" data-pm-pip aria-label="Picture in picture" title="Picture in picture (p)">' + ICON.pip + "</button>" +
          '<button type="button" class="pm__icon pm__icon--close" data-pm-close aria-label="Close viewer" title="Close (Esc)">' + ICON.close + "</button>" +
        "</div>" +
      "</div>" +
      '<div class="pm__stage" data-pm-stage>' +
        '<div class="pm__track" data-pm-track></div>' +
        '<button type="button" class="pm__arrow pm__arrow--prev" data-pm-prev aria-label="Previous">' + ICON.prev + "</button>" +
        '<button type="button" class="pm__arrow pm__arrow--next" data-pm-next aria-label="Next">' + ICON.next + "</button>" +
      "</div>" +
      '<div class="pm__foot" data-pm-foot></div>';

    var track = root.querySelector("[data-pm-track]");
    var stage = root.querySelector("[data-pm-stage]");
    var foot = root.querySelector("[data-pm-foot]");
    var titleEl = root.querySelector("[data-pm-title]");
    var subEl = root.querySelector("[data-pm-sub]");
    var countEl = root.querySelector("[data-pm-count]");
    var pipBtn = root.querySelector("[data-pm-pip]");
    var prevBtn = root.querySelector("[data-pm-prev]");
    var nextBtn = root.querySelector("[data-pm-next]");

    // Empty slides first so the track has its full width immediately and the
    // transform maths is correct before anything is hydrated.
    items.forEach(function () {
      var slide = document.createElement("div");
      slide.className = "pm-slide";
      track.appendChild(slide);
    });
    var slides = Array.prototype.slice.call(track.children);
    var built = [];
    var zoomState = items.map(function () { return { scale: 1, x: 0, y: 0 }; });

    /* ---------------------------------------------------------- hydrate --- */
    function hydrate(i) {
      if (i < 0 || i >= items.length || built[i]) return;
      var item = items[i];
      var slide = slides[i];

      if (item.type === "embed") {
        slide.innerHTML =
          '<div class="pm-embed"><iframe src="' + esc(item.url) + '" title="' + esc(item.title || "Video") +
          '" loading="lazy" allow="accelerometer; autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe></div>';
      } else if (item.type === "video") {
        // preload="metadata": enough for a duration and a first frame, not
        // a full download of a clip that may never be played.
        var sources = item.sources && item.sources.length
          ? item.sources.map(function (s) { return '<source src="' + esc(s.src) + '">'; }).join("")
          : "";
        // The hold frame. `.pm-video video` has a black background and the
        // viewer's source may be a rendition the tile never fetched, so
        // between opening and the first decoded frame there is a window where
        // the stage is just black. The poster here is the still the tile was
        // already showing — in cache, decoded, free — painted over the video
        // until it has a frame of its own. `poster=` alone is not enough: it
        // is dropped the moment load() is called on a source swap.
        var hold = item.poster
          ? '<img class="pm-video__hold" src="' + esc(item.poster) + '" alt="" aria-hidden="true" decoding="async">'
          : "";
        // The media box is reserved from the manifest's aspect ratio — the
        // same number the inline tiles size themselves with — so it is correct
        // before any media loads and does not move when metadata arrives.
        // Without a ratio the frame simply fills the stage; the video's own
        // box is metadata-independent either way, and object-fit keeps the
        // picture honest.
        // The ratio is applied through the CSSOM below, NOT as a style
        // attribute in this markup. The site sends `style-src-attr 'self'`,
        // which blocks inline style attributes outright — a style="" written
        // here is silently dropped, --pm-ratio never lands, the min() that
        // depends on it becomes invalid, and the frame falls back to width
        // auto: a 320x180 stamp of the poster's intrinsic size. CSP does not
        // restrict CSSOM writes, so el.style.setProperty is the way in.
        var ratio = Number(item.aspectRatio) > 0 ? Number(item.aspectRatio) : 0;
        var frameAttrs = ratio
          ? ' class="pm-video__frame pm-video__frame--ratio"'
          : ' class="pm-video__frame"';
        slide.innerHTML =
          '<div class="pm-video">' +
          "<div" + frameAttrs + ">" +
          "<video playsinline preload=\"metadata\"" +
          (item.poster ? ' poster="' + esc(item.poster) + '"' : "") +
          (sources ? "" : ' src="' + esc(item.url) + '"') +
          ">" + sources + "</video>" + hold +
          // Inside the frame, so it centres on the PICTURE rather than on the
          // letterboxed stage around it.
          '<button type="button" class="pm-video__big" aria-label="Play">' + ICON.play + "</button>" +
          "</div>" +
          "</div>";
        if (ratio) {
          var frameEl = slide.querySelector(".pm-video__frame");
          if (frameEl) frameEl.style.setProperty("--pm-ratio", String(ratio));
        }
        wireVideoLoad(slide, item);
      } else {
        slide.innerHTML =
          '<div class="pm-image"><img src="' + esc(item.url) + '" alt="' + esc(item.alt || item.title || "") +
          '" decoding="async" draggable="false"></div>';
      }
      built[i] = true;
    }

    // Two things that only matter for the fullscreen rendition, both of them
    // about never showing the customer a failure:
    //
    //   1. The hold frame comes off on `loadeddata` — the first moment the
    //      element has a real frame to paint — and not before.
    //   2. If every source fails, drop to `fallbackSources` once. The HD pair
    //      is only offered when the manifest says both files exist, so this
    //      covers the case where the manifest and the disk disagree (a file
    //      removed, a transcode deleted, a half-finished backfill). The tile
    //      rendition is already proven to load: it is what the tile played.
    function wireVideoLoad(slide, item) {
      var v = slide.querySelector("video");
      if (!v) return;
      var holdEl = slide.querySelector(".pm-video__hold");
      var released = false;
      function release() {
        if (released) return;
        released = true;
        if (holdEl && holdEl.parentNode) holdEl.parentNode.removeChild(holdEl);
      }
      v.addEventListener("loadeddata", release);
      // A frame can also arrive without loadeddata firing where we can see it
      // (a cached response decoded before this listener attached).
      if (v.readyState >= 2) release();

      // The ONE swap that can still happen after the element is attached, and
      // only on failure. The viewer already opens directly on the rendition it
      // means to play (program.js picks -hd or the tile pair BEFORE the <video>
      // exists), so a healthy open performs no swap at all and calls load()
      // zero times. This guard makes sure a broken one cannot loop.
      var fellBack = false;
      v.addEventListener("error", function () {
        var alt = item.fallbackSources;
        if (fellBack || !alt || !alt.length) return release();
        fellBack = true;
        // Carry position and play state across the reset. An error normally
        // means nothing decoded and currentTime is 0, but a source that dies
        // mid-playback would otherwise silently restart from the beginning.
        var at = v.currentTime;
        var wasPlaying = !v.paused;
        while (v.firstChild) v.removeChild(v.firstChild);
        alt.forEach(function (s) {
          var el = document.createElement("source");
          el.src = s.src;
          v.appendChild(el);
        });
        v.addEventListener("loadedmetadata", function restore() {
          v.removeEventListener("loadedmetadata", restore);
          if (at > 0 && isFinite(v.duration)) v.currentTime = Math.min(at, v.duration);
          if (wasPlaying) v.play().catch(function () {});
        });
        // Keep the hold frame up across the swap — this is precisely the
        // moment the stage would otherwise go black. The box does not move:
        // it comes from the frame's reserved ratio, not from the source.
        v.load();
      });
    }

    /* ------------------------------------------------------------ zoom --- */
    function imageEl(i) {
      var slide = slides[i];
      return slide ? slide.querySelector(".pm-image img") : null;
    }

    function applyZoom(i) {
      var img = imageEl(i);
      if (!img) return;
      var z = zoomState[i];
      img.style.transform = "translate3d(" + z.x + "px," + z.y + "px,0) scale(" + z.scale + ")";
      img.parentNode.classList.toggle("is-zoomed", z.scale > 1.01);
      root.classList.toggle("is-zoomed", z.scale > 1.01);
    }

    // Keeps a zoomed image's edges from being dragged inside the viewport —
    // the picture always fills at least the frame it's being panned in.
    function clampPan(i) {
      var img = imageEl(i);
      if (!img) return;
      var z = zoomState[i];
      if (z.scale <= 1) { z.x = 0; z.y = 0; return; }
      var box = img.getBoundingClientRect();
      var baseW = box.width / z.scale;
      var baseH = box.height / z.scale;
      var maxX = Math.max(0, (baseW * z.scale - stage.clientWidth) / 2);
      var maxY = Math.max(0, (baseH * z.scale - stage.clientHeight) / 2);
      z.x = Math.max(-maxX, Math.min(maxX, z.x));
      z.y = Math.max(-maxY, Math.min(maxY, z.y));
    }

    function setZoom(i, scale, originX, originY) {
      var z = zoomState[i];
      var next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, scale));
      if (next === z.scale) return;
      if (next === 1) {
        z.x = 0;
        z.y = 0;
      } else if (originX != null) {
        // Zoom about the pointer rather than the centre, so the detail the
        // customer aimed at is the detail that grows.
        var box = stage.getBoundingClientRect();
        var cx = originX - box.left - box.width / 2;
        var cy = originY - box.top - box.height / 2;
        var ratio = next / z.scale;
        z.x = cx - (cx - z.x) * ratio;
        z.y = cy - (cy - z.y) * ratio;
      }
      z.scale = next;
      clampPan(i);
      applyZoom(i);
      syncZoomButtons();
    }

    function resetZoom(i) {
      zoomState[i] = { scale: 1, x: 0, y: 0 };
      applyZoom(i);
    }

    /* ---------------------------------------------------------- footer --- */
    // The footer is rebuilt per item: an image gets zoom controls, a video
    // gets a transport, an embed gets nothing at all.
    var video = null;
    var rafId = 0;

    function teardownFoot() {
      if (rafId) { cancelAnimationFrame(rafId); rafId = 0; }
      foot.innerHTML = "";
      foot.syncMute = null;
      video = null;
    }

    function buildFoot() {
      teardownFoot();
      var item = items[index];

      if (item.type === "image") {
        foot.innerHTML =
          '<div class="pm-tools">' +
            '<button type="button" class="pm__icon" data-pm-zoomout aria-label="Zoom out" title="Zoom out (-)">' + ICON.zoomOut + "</button>" +
            '<span class="pm-tools__level" data-pm-level>100%</span>' +
            '<button type="button" class="pm__icon" data-pm-zoomin aria-label="Zoom in" title="Zoom in (+)">' + ICON.zoomIn + "</button>" +
          "</div>" +
          '<p class="pm-hint">Double-tap or scroll to zoom · drag to pan</p>';
        foot.querySelector("[data-pm-zoomin]").addEventListener("click", function () { setZoom(index, zoomState[index].scale + 0.6); });
        foot.querySelector("[data-pm-zoomout]").addEventListener("click", function () { setZoom(index, zoomState[index].scale - 0.6); });
        syncZoomButtons();
        return;
      }

      if (item.type !== "video") return;

      var hasSources = !!(item.sources && item.sources.length > 1);
      foot.innerHTML =
        '<div class="pm-player">' +
          '<div class="pm-player__scrub" data-pm-scrub role="slider" tabindex="0" aria-label="Seek" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0">' +
            '<div class="pm-player__buffer" data-pm-buffer></div>' +
            '<div class="pm-player__played" data-pm-played></div>' +
            '<div class="pm-player__knob" data-pm-knob></div>' +
          "</div>" +
          '<div class="pm-player__row">' +
            '<button type="button" class="pm__icon pm__icon--lg" data-pm-play aria-label="Play">' + ICON.play + "</button>" +
            '<span class="pm-player__time"><b data-pm-cur>0:00</b> / <span data-pm-dur>0:00</span></span>' +
            '<div class="pm-player__spacer"></div>' +
            '<button type="button" class="pm__icon pm-player__rate" data-pm-rate aria-label="Playback speed">1&times;</button>' +
            '<button type="button" class="pm__icon" data-pm-mute aria-label="Mute">' + ICON.volume + "</button>" +
            (hasSources ? '<select class="pm-player__quality" data-pm-quality aria-label="Quality"></select>' : "") +
          "</div>" +
        "</div>";

      video = slides[index].querySelector("video");
      if (!video) return;

      var playBtn = foot.querySelector("[data-pm-play]");
      var bigBtn = slides[index].querySelector(".pm-video__big");
      var muteBtn = foot.querySelector("[data-pm-mute]");
      var rateBtn = foot.querySelector("[data-pm-rate]");
      var scrub = foot.querySelector("[data-pm-scrub]");
      var played = foot.querySelector("[data-pm-played]");
      var buffer = foot.querySelector("[data-pm-buffer]");
      var knob = foot.querySelector("[data-pm-knob]");
      var curEl = foot.querySelector("[data-pm-cur]");
      var durEl = foot.querySelector("[data-pm-dur]");

      function syncPlayIcon() {
        var playing = !video.paused && !video.ended;
        playBtn.innerHTML = playing ? ICON.pause : ICON.play;
        playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
        slides[index].classList.toggle("is-playing", playing);
      }

      function syncProgress() {
        var d = video.duration;
        var pct = isFinite(d) && d > 0 ? (video.currentTime / d) * 100 : 0;
        played.style.width = pct + "%";
        knob.style.left = pct + "%";
        curEl.textContent = fmtTime(video.currentTime);
        durEl.textContent = fmtTime(d);
        scrub.setAttribute("aria-valuenow", Math.round(pct));
        scrub.setAttribute("aria-valuetext", fmtTime(video.currentTime) + " of " + fmtTime(d));
        if (video.buffered.length && isFinite(d) && d > 0) {
          buffer.style.width = (video.buffered.end(video.buffered.length - 1) / d) * 100 + "%";
        }
        // Counts as watched once past the threshold — opening a video and
        // immediately closing it is not "watched".
        if (isFinite(d) && d > 0 && video.currentTime / d >= WATCHED_RATIO) markViewed(index);
      }

      function tick() {
        syncProgress();
        rafId = requestAnimationFrame(tick);
      }

      video.addEventListener("play", function () { syncPlayIcon(); if (!rafId) rafId = requestAnimationFrame(tick); });
      video.addEventListener("pause", function () { syncPlayIcon(); if (rafId) { cancelAnimationFrame(rafId); rafId = 0; } syncProgress(); });
      video.addEventListener("ended", function () { syncPlayIcon(); markViewed(index); });
      video.addEventListener("loadedmetadata", syncProgress);

      function toggle() { if (video.paused) video.play().catch(function () {}); else video.pause(); }
      playBtn.addEventListener("click", toggle);
      if (bigBtn) bigBtn.addEventListener("click", toggle);

      function syncMute() {
        muteBtn.innerHTML = video.muted ? ICON.muted : ICON.volume;
        muteBtn.setAttribute("aria-label", video.muted ? "Unmute" : "Mute");
      }
      muteBtn.addEventListener("click", function () { video.muted = !video.muted; syncMute(); });
      // Exposed so the "m" shortcut can repaint the button without
      // rebuilding the footer — buildFoot() re-binds every transport
      // listener onto the same <video>, so calling it per keypress would
      // stack duplicate play/pause/timeupdate handlers.
      foot.syncMute = syncMute;

      var RATES = [1, 1.25, 1.5, 2, 0.75];
      var rateIdx = 0;
      rateBtn.addEventListener("click", function () {
        rateIdx = (rateIdx + 1) % RATES.length;
        video.playbackRate = RATES[rateIdx];
        rateBtn.innerHTML = RATES[rateIdx] + "&times;";
      });

      // Scrubbing: pointer events so touch, pen and mouse share one path,
      // with capture so a drag that leaves the bar still tracks.
      var scrubbing = false;
      function seekTo(clientX) {
        var box = scrub.getBoundingClientRect();
        var ratio = Math.max(0, Math.min(1, (clientX - box.left) / box.width));
        if (isFinite(video.duration)) video.currentTime = ratio * video.duration;
        syncProgress();
      }
      scrub.addEventListener("pointerdown", function (e) {
        scrubbing = true;
        scrub.setPointerCapture && scrub.setPointerCapture(e.pointerId);
        seekTo(e.clientX);
      });
      scrub.addEventListener("pointermove", function (e) { if (scrubbing) seekTo(e.clientX); });
      scrub.addEventListener("pointerup", function () { scrubbing = false; });
      scrub.addEventListener("pointercancel", function () { scrubbing = false; });
      scrub.addEventListener("keydown", function (e) {
        if (e.key === "ArrowRight" || e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); video.currentTime += 5; }
        else if (e.key === "ArrowLeft" || e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); video.currentTime -= 5; }
      });

      if (hasSources) {
        var select = foot.querySelector("[data-pm-quality]");
        select.innerHTML = item.sources.map(function (s, si) {
          return '<option value="' + si + '">' + esc(s.label || "Source " + (si + 1)) + "</option>";
        }).join("");
        select.addEventListener("change", function () {
          // Swapping src resets the element, so the position and play state
          // are restored by hand.
          var at = video.currentTime;
          var wasPlaying = !video.paused;
          video.src = item.sources[Number(select.value)].src;
          video.currentTime = at;
          if (wasPlaying) video.play().catch(function () {});
        });
      }

      syncPlayIcon();
      syncProgress();
    }

    function syncZoomButtons() {
      var level = foot.querySelector("[data-pm-level]");
      if (level) level.textContent = Math.round(zoomState[index].scale * 100) + "%";
    }

    /* ------------------------------------------------------- navigation --- */
    function markViewed(i) {
      if (viewed[i]) return;
      viewed[i] = true;
      if (options.onView) {
        try { options.onView(items[i], i); } catch (err) { /* never break the viewer over a callback */ }
      }
    }

    function setTransform(offsetPx, animate) {
      track.classList.toggle("is-animating", !!animate);
      track.style.transform = "translate3d(calc(" + (-index * 100) + "% + " + (offsetPx || 0) + "px), 0, 0)";
    }

    function update(animate) {
      for (var i = index - 1; i <= index + 1; i++) hydrate(i);
      // Anything playing on a slide we just left keeps playing audio
      // otherwise — silence every video but the current one.
      slides.forEach(function (slide, si) {
        var v = slide.querySelector("video");
        if (v && si !== index) { v.pause(); slide.classList.remove("is-playing"); }
        if (si !== index) resetZoom(si);
      });

      setTransform(0, animate);
      var item = items[index];
      titleEl.textContent = item.title || "";
      subEl.textContent = item.subtitle || "";
      countEl.textContent = items.length > 1 ? index + 1 + " / " + items.length : "";
      prevBtn.disabled = index === 0;
      nextBtn.disabled = index === items.length - 1;
      prevBtn.hidden = nextBtn.hidden = items.length < 2;
      root.classList.toggle("is-video", item.type === "video");

      // PiP is video-only and not universally implemented; the control is
      // hidden rather than shown-and-broken where it isn't available.
      var canPip = item.type === "video" && document.pictureInPictureEnabled;
      pipBtn.hidden = !canPip;

      buildFoot();
      applyZoom(index);
      // An image is "viewed" as soon as it's on screen; a video only once
      // it has actually been played (handled in the transport above).
      if (item.type !== "video") markViewed(index);
      showControls();
    }

    function goTo(next) {
      var clamped = Math.max(0, Math.min(items.length - 1, next));
      if (clamped === index) { setTransform(0, true); return; }
      index = clamped;
      update(true);
    }

    prevBtn.addEventListener("click", function () { goTo(index - 1); });
    nextBtn.addEventListener("click", function () { goTo(index + 1); });

    /* --------------------------------------------------------- gestures --- */
    var startX = 0, startY = 0, startT = 0;
    var dragging = false, locked = false, axis = null, panning = false;
    var panStart = null;
    var pointers = {};
    var pinchStart = 0, pinchScale = 1;
    var lastTap = 0;
    // The element genuinely under the finger when the gesture started.
    //
    // It has to be recorded here because pointerup CANNOT be trusted to say:
    // the pointerdown handler calls stage.setPointerCapture (so a drag that
    // leaves the stage still tracks), and pointer capture RETARGETS every
    // later pointer event for that pointer to the capturing element. Measured
    // on one real click of the centre play button:
    //
    //   pointerdown  target=path            (the icon inside the button)
    //   pointerup    target=div.pm__stage   (retargeted by the capture)
    //
    // The dismiss test below compares against the stage, so with e.target it
    // was true for a tap ANYWHERE in the viewer — including on the play
    // button, whose own click handler then never ran because close() had
    // already torn the element out of the DOM.
    var downTarget = null;

    // A tap dismisses only when it started on the backdrop ITSELF, never on a
    // descendant. `.pm-video` is included because it is the letterboxing
    // around a contain-fitted frame — genuine empty space beside the picture —
    // while `.pm-video__frame`, the <video> and every control are not.
    function isBackdrop(el) {
      if (!el || el.nodeType !== 1) return false;
      return el === stage || el === track ||
        (el.classList && (el.classList.contains("pm-slide") || el.classList.contains("pm-video")));
    }

    // Pointer capture is taken ONLY once a gesture is genuinely a drag — never
    // on pointerdown.
    //
    // While a pointer is captured, the compatibility mouse events are
    // retargeted to the capture element, and that includes `click`. Measured
    // with capture taken on pointerdown: clicking the centre play button gave
    // clickTargets ["div.pm__stage"] and the button's own handler ran 0 times,
    // so the control was unreachable even once the dismiss bug was fixed.
    //
    // A drag still needs capture — it is what keeps a swipe tracking after the
    // finger leaves the stage — so it is taken at the moment the movement
    // threshold is crossed. Below that threshold the gesture is a tap, and a
    // tap must reach whatever it was aimed at.
    var captured = false;
    function capturePointer(e) {
      if (captured || e.pointerId == null || !stage.setPointerCapture) return;
      captured = true;
      try { stage.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
    }

    function distance(a, b) {
      return Math.sqrt(Math.pow(a.x - b.x, 2) + Math.pow(a.y - b.y, 2));
    }
    function pointerList() {
      return Object.keys(pointers).map(function (k) { return pointers[k]; });
    }

    stage.addEventListener("pointerdown", function (e) {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      showControls();

      var list = pointerList();
      if (list.length === 2) {
        pinchStart = distance(list[0], list[1]);
        pinchScale = zoomState[index].scale;
        dragging = false;
        return;
      }

      dragging = true;
      locked = false;
      axis = null;
      downTarget = e.target;
      startX = e.clientX;
      startY = e.clientY;
      startT = Date.now();
      panning = zoomState[index].scale > 1.01;
      panStart = { x: zoomState[index].x, y: zoomState[index].y };
      captured = false;
      track.classList.remove("is-animating");
    }, { passive: true });

    // Non-passive: a horizontal swipe (or a pinch) must be able to
    // preventDefault so the browser doesn't also scroll or navigate back.
    stage.addEventListener("pointermove", function (e) {
      if (!(e.pointerId in pointers)) return;
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };

      var list = pointerList();
      if (list.length === 2 && pinchStart > 0) {
        if (e.cancelable) e.preventDefault();
        var ratio = distance(list[0], list[1]) / pinchStart;
        var mid = { x: (list[0].x + list[1].x) / 2, y: (list[0].y + list[1].y) / 2 };
        setZoom(index, pinchScale * ratio, mid.x, mid.y);
        return;
      }

      if (!dragging) return;
      var dx = e.clientX - startX;
      var dy = e.clientY - startY;

      // Zoomed in: the drag pans the picture instead of turning the page.
      if (panning) {
        if (Math.abs(dx) < AXIS_LOCK_SLOP && Math.abs(dy) < AXIS_LOCK_SLOP) return;
        capturePointer(e);
        if (e.cancelable) e.preventDefault();
        zoomState[index].x = panStart.x + dx;
        zoomState[index].y = panStart.y + dy;
        clampPan(index);
        applyZoom(index);
        return;
      }

      if (!locked) {
        if (Math.abs(dx) < AXIS_LOCK_SLOP && Math.abs(dy) < AXIS_LOCK_SLOP) return;
        axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
        locked = true;
        // A vertical drag on an un-zoomed slide is the dismiss gesture.
        if (axis === "y") { dragging = false; return; }
      }
      if (axis !== "x" || items.length < 2) return;
      // Past the threshold and committed to a horizontal swipe: now take the
      // pointer, so the drag survives leaving the stage.
      capturePointer(e);
      if (e.cancelable) e.preventDefault();
      if ((index === 0 && dx > 0) || (index === items.length - 1 && dx < 0)) dx *= 0.32;
      setTransform(dx, false);
    }, { passive: false });

    function endPointer(e) {
      delete pointers[e.pointerId];
      if (pointerList().length < 2) pinchStart = 0;
      if (!dragging) return;
      dragging = false;
      if (captured && e.pointerId != null && stage.releasePointerCapture) {
        try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      }
      captured = false;
      if (panning) { panning = false; return; }

      if (!locked) {
        // Tap. Double-tap toggles zoom on an image; a single tap on empty
        // space closes, matching every native photo viewer.
        var now = Date.now();
        var isImage = items[index].type === "image";
        if (isImage && now - lastTap < 300) {
          lastTap = 0;
          setZoom(index, zoomState[index].scale > 1.01 ? 1 : DOUBLE_TAP_ZOOM, e.clientX, e.clientY);
          return;
        }
        lastTap = now;
        // downTarget, not e.target — see the note where it is declared.
        if (isBackdrop(downTarget)) close();
        return;
      }

      if (axis !== "x" || items.length < 2) return;
      var dx = e.clientX - startX;
      var velocity = Math.abs(dx) / Math.max(1, Date.now() - startT);
      var threshold = stage.clientWidth * SWIPE_RATIO;
      if (dx <= -threshold || (dx < 0 && velocity > SWIPE_VELOCITY)) goTo(index + 1);
      else if (dx >= threshold || (dx > 0 && velocity > SWIPE_VELOCITY)) goTo(index - 1);
      else setTransform(0, true);
    }

    stage.addEventListener("pointerup", endPointer, { passive: true });
    stage.addEventListener("pointercancel", function (e) {
      delete pointers[e.pointerId];
      dragging = false;
      panning = false;
      pinchStart = 0;
      setTransform(0, true);
    }, { passive: true });

    stage.addEventListener("wheel", function (e) {
      if (items[index].type !== "image") return;
      e.preventDefault();
      setZoom(index, zoomState[index].scale * (e.deltaY < 0 ? 1.14 : 1 / 1.14), e.clientX, e.clientY);
    }, { passive: false });

    stage.addEventListener("dblclick", function (e) {
      if (items[index].type !== "image") return;
      setZoom(index, zoomState[index].scale > 1.01 ? 1 : DOUBLE_TAP_ZOOM, e.clientX, e.clientY);
    });

    /* ------------------------------------------------------- chrome idle --- */
    // The bar and transport fade out while a video plays untouched, and come
    // straight back on any input — the media is the point, not the chrome.
    var idleTimer = 0;
    function showControls() {
      root.classList.remove("is-idle");
      clearTimeout(idleTimer);
      idleTimer = setTimeout(function () {
        if (video && !video.paused) root.classList.add("is-idle");
      }, CONTROLS_IDLE_MS);
    }
    root.addEventListener("pointermove", showControls, { passive: true });

    /* ------------------------------------------------------------- PiP --- */
    // FULLSCREEN MODEL: this viewer is a CSS overlay, and only that.
    //
    // It was previously both — an overlay that also offered the real
    // Fullscreen API on its root, which is the hybrid that made "it only sizes
    // correctly after using the browser's own fullscreen control" true: the
    // overlay did not size its video, so entering real fullscreen was the only
    // way to get a stage small enough for the intrinsically-sized element to
    // fill. With the box fixed, real fullscreen adds nothing but the removal
    // of browser chrome, and it costs a genuine platform split: iOS Safari
    // does not implement requestFullscreen on arbitrary elements, only
    // webkitEnterFullscreen on the <video> itself, which hands the clip to the
    // native player and takes the custom transport, the swipe gesture and the
    // rest of the gallery with it. One model everywhere beats a viewer that is
    // a different product on iPhone.
    //
    // `.pm` is position: fixed / inset: 0 with safe-area padding and
    // body.pm-open pins the scroll, so the overlay already occupies the whole
    // viewport. `playsinline` on every <video> is what stops iOS promoting the
    // clip into its own fullscreen player and re-introducing the split.
    pipBtn.addEventListener("click", function () {
      if (!video) return;
      if (document.pictureInPictureElement) { document.exitPictureInPicture().catch(function () {}); return; }
      if (video.requestPictureInPicture) video.requestPictureInPicture().catch(function () {});
    });

    /* -------------------------------------------------------- keyboard --- */
    function onKey(e) {
      // Let the scrub slider and the quality select own their own keys.
      if (e.target && e.target.closest && e.target.closest("[data-pm-scrub], select")) return;

      switch (e.key) {
        case "Escape":
          close();
          break;
        case "ArrowRight": e.preventDefault(); goTo(index + 1); break;
        case "ArrowLeft": e.preventDefault(); goTo(index - 1); break;
        case " ":
        case "k":
          if (video) { e.preventDefault(); if (video.paused) video.play().catch(function () {}); else video.pause(); }
          break;
        case "l": if (video) video.currentTime += 10; break;
        case "j": if (video) video.currentTime -= 10; break;
        case "m": if (video) { video.muted = !video.muted; if (foot.syncMute) foot.syncMute(); } break;
        case "p": if (!pipBtn.hidden) pipBtn.click(); break;
        case "+":
        case "=": setZoom(index, zoomState[index].scale + 0.6); break;
        case "-": setZoom(index, zoomState[index].scale - 0.6); break;
        case "0": resetZoom(index); syncZoomButtons(); break;
        default:
          if (e.key !== "Tab") return;
          // Focus trap: keep tabbing inside the dialog while it is modal.
          var focusables = root.querySelectorAll("button:not([hidden]):not(:disabled), select, [tabindex='0']");
          if (!focusables.length) return;
          var first = focusables[0];
          var last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
          else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
          return;
      }
      showControls();
    }

    /* ----------------------------------------------------------- close --- */
    var closed = false;
    function close() {
      if (closed) return;
      closed = true;
      teardownFoot();
      slides.forEach(function (slide) {
        var v = slide.querySelector("video");
        if (v) { v.pause(); v.removeAttribute("src"); v.load(); }
        var frame = slide.querySelector("iframe");
        if (frame) frame.removeAttribute("src");   // stops a YouTube embed dead
      });
      clearTimeout(idleTimer);
      document.removeEventListener("keydown", onKey);
      root.classList.remove("is-open");
      document.body.classList.remove("pm-open");
      var done = function () { if (root.parentNode) root.parentNode.removeChild(root); };
      root.addEventListener("transitionend", done, { once: true });
      setTimeout(done, 600);   // guarantee teardown if the transition is skipped
      if (lastFocused && lastFocused.focus) lastFocused.focus();
    }

    root.querySelector("[data-pm-close]").addEventListener("click", close);
    document.addEventListener("keydown", onKey);

    document.body.appendChild(root);
    document.body.classList.add("pm-open");
    update(false);
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        root.classList.add("is-open");
        root.querySelector("[data-pm-close]").focus();
      });
    });

    return { close: close };
  }

  window.ProgramMedia = { open: open };
})();
