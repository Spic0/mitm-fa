// /partnership behaviour: hero video and parallax, the demo dialog, Calendly
// (inline iframe loaded early, popup widget.js only off-page), the setup wizard frame, and
// PostHog events (only when analytics is configured: assets/js/analytics.js).
(function () {
  var reduceMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  function track(event, props) {
    if (window.faTrack) window.faTrack.capture(event, props);
  }

  track("partnership_page_viewed");
  document.querySelectorAll("[data-cta-location]").forEach(function (el) {
    el.addEventListener("click", function () {
      track("partnership_cta_clicked", { location: el.getAttribute("data-cta-location") });
    });
  });

  // ---- Hero video: after the page has loaded, never with reduced motion or
  // Save-Data. The poster <img> stays underneath and is the LCP image.
  var media = document.querySelector("[data-hero-media]");
  function startVideo() {
    if (!media || reduceMotion || (navigator.connection && navigator.connection.saveData)) return;
    var portrait = window.matchMedia("(max-width: 767px) and (orientation: portrait)").matches;
    var base = media.getAttribute(portrait ? "data-video-m" : "data-video");
    var v = document.createElement("video");
    v.muted = true;
    v.loop = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute("muted", "");
    v.setAttribute("playsinline", "");
    v.setAttribute("aria-hidden", "true");
    [["webm", "video/webm"], ["mp4", "video/mp4"]].forEach(function (s) {
      var src = document.createElement("source");
      src.src = base + "." + s[0];
      src.type = s[1];
      v.appendChild(src);
    });
    v.addEventListener("playing", function () { v.classList.add("is-playing"); }, { once: true });
    media.appendChild(v);
    // Paused whenever the hero is off screen.
    new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) {
          var p = v.play();
          if (p && p.catch) p.catch(function () {});
        } else {
          v.pause();
        }
      });
    }).observe(media);
  }
  if (document.readyState === "complete") setTimeout(startVideo, 200);
  else window.addEventListener("load", function () { setTimeout(startVideo, 200); });

  // ---- Parallax: transform only, only while the hero is in view.
  var hero = document.querySelector(".ph");
  var float = document.querySelector(".ph__float");
  if (hero && media && !reduceMotion) {
    var ticking = false;
    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(function () {
        ticking = false;
        var y = window.scrollY;
        if (y > hero.offsetTop + hero.offsetHeight) return;
        media.style.transform = "translate3d(0," + (y * 0.18).toFixed(1) + "px,0)";
        if (float) float.style.translate = "0 " + (-y * 0.1).toFixed(1) + "px";
      });
    }, { passive: true });
  }

  // ---- Demo dialog. Native <dialog>: modal, Esc closes, focus returns to
  // the opener. Without showModal the link opens the demo page itself.
  var dialog = document.getElementById("ptDemo");
  document.querySelectorAll("[data-demo-open]").forEach(function (a) {
    a.addEventListener("click", function (e) {
      if (!dialog || typeof dialog.showModal !== "function") return;
      e.preventDefault();
      dialog.showModal();
    });
  });
  if (dialog) {
    dialog.querySelector("[data-demo-close]").addEventListener("click", function () { dialog.close(); });
    dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });
  }

  // ---- Calendly. Every booking button is a real link to the booking page,
  // so a failed load or no JS still gets there.
  //
  // Inline: a plain iframe, no widget.js. It starts loading well before the
  // section is reached (1200px ahead, or when the page goes idle after load,
  // whichever is first) behind a same-size skeleton, and cross-fades in once
  // Calendly has drawn. Its height follows Calendly's own calendly.page_height so it never
  // scrolls inside; CSS sets the month-view floor it can never shrink below.
  var CAL_BASE = "https://assets.calendly.com/assets/external/widget";
  var inline = document.querySelector("[data-calendly-inline]");
  var calFrame = null;
  function startInline() {
    if (!inline || calFrame) return;
    calFrame = document.createElement("iframe");
    calFrame.title = "Book a 30-minute call";
    // Desktop: Calendly draws its own bordered card inside the (>=1000px,
    // two-column) frame, so the frame blends into the page (#fafaf9).
    // Mobile: Calendly fills the frame, which is our card (#fdfdfc).
    var wide = window.matchMedia("(min-width: 1064px)").matches;
    calFrame.src = inline.getAttribute("data-src") + "&background_color=" + (wide ? "fafaf9" : "fdfdfc") +
      "&embed_domain=" + encodeURIComponent(location.host);
    calFrame.addEventListener("load", watchStall, { once: true });
    inline.classList.add("is-loading");
    inline.appendChild(calFrame);
  }
  // The skeleton stays until Calendly says the calendar is drawn, not until
  // iframe load: Calendly renders nothing while the frame is off screen, and
  // load also fires for a blocked or error page. On screen for 5s with no
  // word from Calendly at all means it was blocked: offer the link instead.
  var calSeen = false;
  function calShow() { inline.classList.add("is-ready"); }
  function watchStall() {
    if (!("IntersectionObserver" in window)) { calShow(); return; }
    var timer = null;
    var io = new IntersectionObserver(function (entries) {
      clearTimeout(timer);
      if (!entries.some(function (e) { return e.isIntersecting; })) return;
      timer = setTimeout(function () {
        io.disconnect();
        if (inline.classList.contains("is-ready")) return;
        if (calSeen) calShow();
        else inline.classList.add("is-slow");
      }, 5000);
    }, { threshold: 0.25 });
    io.observe(inline);
  }
  if (inline) {
    if ("IntersectionObserver" in window) {
      var calIo = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) { calIo.disconnect(); startInline(); }
      }, { rootMargin: "1200px 0px" });
      calIo.observe(inline);
    }
    var idle = window.requestIdleCallback || function (fn) { return setTimeout(fn, 1); };
    if (document.readyState === "complete") idle(startInline, { timeout: 2000 });
    else window.addEventListener("load", function () { idle(startInline, { timeout: 2000 }); });
  }
  function headerBottom() {
    var h = document.querySelector(".header-section, header");
    if (!h || getComputedStyle(h).position !== "fixed") return 0;
    return Math.max(0, Math.round(h.getBoundingClientRect().bottom));
  }

  // Popup: only where the inline section is not on the page. widget.js is
  // prefetched on the first hover/focus/touch of a booking button, not on load.
  var calLoading = null;
  function loadCalendly() {
    if (window.Calendly) return Promise.resolve();
    if (!calLoading) {
      calLoading = new Promise(function (resolve, reject) {
        var css = document.createElement("link");
        css.rel = "stylesheet";
        css.href = CAL_BASE + ".css";
        document.head.appendChild(css);
        var s = document.createElement("script");
        s.src = CAL_BASE + ".js";
        s.async = true;
        s.onload = function () { if (window.Calendly) resolve(); else reject(new Error("no Calendly")); };
        s.onerror = reject;
        document.head.appendChild(s);
      });
      calLoading.catch(function () { calLoading = null; });
    }
    return calLoading;
  }
  document.querySelectorAll("[data-calendly-popup]").forEach(function (a) {
    if (!inline) {
      var prefetch = function () { loadCalendly().catch(function () {}); };
      ["pointerenter", "focus", "touchstart"].forEach(function (t) { a.addEventListener(t, prefetch, { once: true, passive: true }); });
    }
    a.addEventListener("click", function (e) {
      e.preventDefault();
      if (inline) {
        // The calendar is on this page: bring it up under the fixed header.
        startInline();
        var section = inline.closest("section") || inline;
        var top = section.getBoundingClientRect().top + window.pageYOffset - headerBottom();
        window.scrollTo({ top: top, behavior: reduceMotion ? "auto" : "smooth" });
        return;
      }
      loadCalendly()
        .then(function () { window.Calendly.initPopupWidget({ url: a.href }); })
        .catch(function () { window.open(a.href, "_blank", "noopener"); });
    });
  });

  // ---- Messages: Calendly booking events (no invitee data is forwarded)
  // and the setup wizard frame's height and sent notices.
  var frame = document.querySelector("[data-offer-frame]");
  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d) return;
    if (e.origin === "https://calendly.com" && typeof d.event === "string") {
      if (calFrame && e.source === calFrame.contentWindow) {
        calSeen = true;
        if (d.event === "calendly.event_type_viewed") calShow();
        if (d.event === "calendly.page_height") {
          var ph = parseFloat(d.payload && d.payload.height);
          if (ph > 0) inline.style.setProperty("--cal-content", Math.ceil(ph) + "px");
          return;
        }
      }
      if (d.event === "calendly.event_scheduled") track("partnership_call_booked");
      else if (d.event === "calendly.date_and_time_selected") track("partnership_call_time_selected");
      return;
    }
    if (e.origin !== window.location.origin || !frame || e.source !== frame.contentWindow) return;
    if (d.type === "fa-offer-height" && d.height > 0) frame.style.height = Math.ceil(d.height) + "px";
    if (d.type === "fa-offer-sent") track("partnership_offer_submitted", { form: "setup_wizard", intent: d.intent || null });
  });
})();
