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
             touch-sized hit area, playback rate, mute, Picture-in-Picture
             and fullscreen where the browser supports them, plus a source
             selector that appears ONLY when an item genuinely ships more
             than one rendition. The platform stores a single file per
             video today, so in practice it stays hidden rather than
             pretending to offer qualities that don't exist.
   Embeds  : YouTube/Vimeo keep their own player chrome — we give them the
             full stage and stay out of the way.

   Usage:
     window.ProgramMedia.open(items, startIndex, { onView: fn });

     items[] = {
       type: "image" | "video" | "embed",
       url, poster?, title?, subtitle?, key?,
       sources?: [{ src, label }]      // renders the source selector
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
    expand: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4H4v5M15 4h5v5M15 20h5v-5M9 20H4v-5"/></svg>',
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
          '<button type="button" class="pm__icon" data-pm-full aria-label="Fullscreen" title="Fullscreen (f)">' + ICON.expand + "</button>" +
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
    var fullBtn = root.querySelector("[data-pm-full]");
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
        slide.innerHTML =
          '<div class="pm-video">' +
          "<video playsinline preload=\"metadata\"" +
          (item.poster ? ' poster="' + esc(item.poster) + '"' : "") +
          (sources ? "" : ' src="' + esc(item.url) + '"') +
          ">" + sources + "</video>" +
          '<button type="button" class="pm-video__big" aria-label="Play">' + ICON.play + "</button>" +
          "</div>";
      } else {
        slide.innerHTML =
          '<div class="pm-image"><img src="' + esc(item.url) + '" alt="' + esc(item.alt || item.title || "") +
          '" decoding="async" draggable="false"></div>';
      }
      built[i] = true;
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
      startX = e.clientX;
      startY = e.clientY;
      startT = Date.now();
      panning = zoomState[index].scale > 1.01;
      panStart = { x: zoomState[index].x, y: zoomState[index].y };
      track.classList.remove("is-animating");
      if (e.pointerId != null && stage.setPointerCapture) {
        try { stage.setPointerCapture(e.pointerId); } catch (err) { /* not fatal */ }
      }
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
      if (e.cancelable) e.preventDefault();
      if ((index === 0 && dx > 0) || (index === items.length - 1 && dx < 0)) dx *= 0.32;
      setTransform(dx, false);
    }, { passive: false });

    function endPointer(e) {
      delete pointers[e.pointerId];
      if (pointerList().length < 2) pinchStart = 0;
      if (!dragging) return;
      dragging = false;
      if (e.pointerId != null && stage.releasePointerCapture) {
        try { stage.releasePointerCapture(e.pointerId); } catch (err) { /* already released */ }
      }
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
        if (e.target === stage || e.target === track || (e.target.classList && e.target.classList.contains("pm-slide"))) close();
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

    /* ---------------------------------------------- fullscreen + PiP --- */
    fullBtn.addEventListener("click", function () {
      if (document.fullscreenElement) { document.exitFullscreen(); return; }
      if (root.requestFullscreen) root.requestFullscreen().catch(function () {});
    });

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
          if (document.fullscreenElement) return; // let the browser exit fullscreen first
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
        case "f": fullBtn.click(); break;
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
      if (document.fullscreenElement && document.exitFullscreen) document.exitFullscreen().catch(function () {});
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
