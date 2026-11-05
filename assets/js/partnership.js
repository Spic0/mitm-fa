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

  // ---- Demo viewer. Native <dialog>: modal (the page behind is inert, so
  // focus stays inside), Esc closes, and focus returns to the opener. Inside:
  // REAL pages in same-origin iframes with ?demo=1, which the server and
  // assets/js/demo-mode.js turn into a no-sale, noindex, untracked copy.
  // No iframe exists before the visitor shows intent (hover, focus, touch on
  // a "See a demo" button warms the first tab); each other tab's iframe is
  // built the first time that tab is shown. Without showModal the button
  // stays a plain link to the storefront.
  var dialog = document.getElementById("ptDemo");
  if (dialog && typeof dialog.showModal === "function") wireDemo(dialog);

  function wireDemo(dialog) {
    var stage = dialog.querySelector(".pt-demo__stage");
    var screen = dialog.querySelector(".pt-demo__screen");
    var view = dialog.querySelector(".pt-demo__view");
    var tabs = [].slice.call(dialog.querySelectorAll("[data-demo-tab]"));
    var devs = [].slice.call(dialog.querySelectorAll("[data-demo-device]"));
    var full = dialog.querySelector("[data-demo-full]");
    var book = dialog.querySelector("[data-demo-book]");
    // Real viewports: a 1440 x 900 laptop and a 390 x 844 phone.
    var SIZE = { desktop: [1440, 900], phone: [390, 844] };
    var BASE = 10; // the laptop base under the screen (.pt-demo__device::after)
    var phoneScreen = window.matchMedia("(max-width: 767px)");
    var frames = {};
    var tab = tabs[0];
    var device = phoneScreen.matches ? "phone" : "desktop";
    var opener = null;
    var returnTo = null;

    function key() { return tab.getAttribute("data-demo-tab"); }

    function fit() {
      var size = SIZE[device];
      var native = device === "phone" && phoneScreen.matches;
      stage.classList.toggle("is-native", native);
      if (native) {
        screen.style.width = screen.style.height = "";
        view.style.width = view.style.height = "100%";
        view.style.transform = "none";
        return;
      }
      var st = getComputedStyle(stage);
      var sc = getComputedStyle(screen);
      var w = stage.clientWidth - parseFloat(st.paddingLeft) - parseFloat(st.paddingRight) - parseFloat(sc.borderLeftWidth) - parseFloat(sc.borderRightWidth);
      var h = stage.clientHeight - parseFloat(st.paddingTop) - parseFloat(st.paddingBottom) - parseFloat(sc.borderTopWidth) - parseFloat(sc.borderBottomWidth) - (device === "desktop" ? BASE : 0);
      var s = Math.max(0.1, Math.min(1, w / size[0], h / size[1]));
      screen.style.width = Math.floor(size[0] * s) + "px";
      screen.style.height = Math.floor(size[1] * s) + "px";
      view.style.width = size[0] + "px";
      view.style.height = size[1] + "px";
      view.style.transform = "scale(" + s + ")";
    }

    // Esc inside a frame belongs to the viewer too. Each load is a new
    // window (the visitor clicked through), so this re-attaches every time.
    function onFrameLoad(f) {
      f.faLoaded = true;
      if (frames[key()] === f) view.classList.add("is-loaded");
      try {
        f.contentWindow.addEventListener("keydown", function (e) {
          if (e.key === "Escape" && !e.defaultPrevented) dialog.close();
        });
      } catch (err) { /* not same-origin: nothing to attach to */ }
    }

    function show(t, quiet) {
      tab = t;
      var k = key();
      tabs.forEach(function (b) {
        var on = b === t;
        b.setAttribute("aria-selected", String(on));
        b.tabIndex = on ? 0 : -1;
      });
      stage.setAttribute("aria-labelledby", t.id);
      var f = frames[k];
      if (!f) {
        f = frames[k] = document.createElement("iframe");
        f.title = t.textContent + " (live demo)";
        f.addEventListener("load", function () { onFrameLoad(f); });
        f.src = t.getAttribute("data-src");
        view.appendChild(f);
      }
      Object.keys(frames).forEach(function (n) { frames[n].hidden = n !== k; });
      view.classList.toggle("is-loaded", !!f.faLoaded);
      full.href = t.getAttribute("data-src");
      if (!quiet) track("partnership_demo_tab_viewed", { tab: k, device: device });
    }

    function setDevice(d, quiet) {
      device = d;
      devs.forEach(function (b) { b.setAttribute("aria-pressed", String(b.getAttribute("data-demo-device") === d)); });
      stage.setAttribute("data-device", d);
      fit();
      if (!quiet) track("partnership_demo_tab_viewed", { tab: key(), device: d });
    }

    // Warm: lay the closed dialog out off screen (never reparent an iframe:
    // that reloads it) and start the first tab at its real viewport size.
    function warm() {
      if (dialog.open || frames[key()]) return;
      dialog.classList.add("is-warming");
      setDevice(device, true);
      show(tab, true);
    }

    function open(e) {
      e.preventDefault();
      opener = e.currentTarget;
      returnTo = null;
      dialog.classList.remove("is-warming");
      document.documentElement.classList.add("pt-demo-lock");
      dialog.showModal();
      track("partnership_demo_opened", { location: opener.getAttribute("data-cta-location") });
      setDevice(device, true);
      show(tab);
    }

    document.querySelectorAll("[data-demo-open]").forEach(function (a) {
      a.addEventListener("pointerenter", warm);
      a.addEventListener("focus", warm);
      a.addEventListener("touchstart", warm, { passive: true });
      a.addEventListener("click", open);
    });
    tabs.forEach(function (b) {
      b.addEventListener("click", function () { if (b !== tab) show(b); });
    });
    // Arrow keys move between tabs (one tab stop for the whole list).
    dialog.querySelector(".pt-demo__tabs").addEventListener("keydown", function (e) {
      var i = tabs.indexOf(document.activeElement);
      var n = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key];
      if (i < 0 || n === undefined) return;
      e.preventDefault();
      var next = tabs[(n + tabs.length) % tabs.length];
      next.focus();
      show(next);
    });
    devs.forEach(function (b) {
      b.addEventListener("click", function () {
        var d = b.getAttribute("data-demo-device");
        if (d !== device) setDevice(d);
      });
    });
    full.addEventListener("click", function () {
      // Where the visitor has clicked to inside the frame, not where the tab began.
      try {
        var loc = frames[key()].contentWindow.location;
        if (loc.origin === location.origin && /[?&]demo=1\b/.test(loc.search)) full.href = loc.href;
      } catch (err) { /* keep the tab's own URL */ }
      track("partnership_demo_full_opened", { tab: key(), device: device });
    });
    book.addEventListener("click", function (e) {
      var target = document.getElementById("book");
      if (!target) return;
      e.preventDefault();
      returnTo = target;
      dialog.close();
    });
    dialog.querySelector("[data-demo-close]").addEventListener("click", function () { dialog.close(); });
    dialog.addEventListener("click", function (e) { if (e.target === dialog) dialog.close(); });
    dialog.addEventListener("close", function () {
      document.documentElement.classList.remove("pt-demo-lock");
      if (returnTo) {
        if (!returnTo.hasAttribute("tabindex")) returnTo.setAttribute("tabindex", "-1");
        returnTo.focus({ preventScroll: true });
        returnTo.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
      } else if (opener) {
        opener.focus({ preventScroll: true });
      }
    });

    var raf = 0;
    function refit() {
      if (raf) return;
      raf = requestAnimationFrame(function () { raf = 0; if (dialog.open) fit(); });
    }
    if ("ResizeObserver" in window) new ResizeObserver(refit).observe(stage);
    else window.addEventListener("resize", refit);
    if (phoneScreen.addEventListener) phoneScreen.addEventListener("change", refit);
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
