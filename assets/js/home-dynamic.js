// Homepage-only dynamic sections: the program-preview block ("See exactly what
// you get") and the hero's starting price. Driven entirely by real backend
// data (GET /api/demo, GET /api/products) — nothing here is hardcoded HTML, so
// a product added, renamed, repriced or removed in the admin panel shows up on
// the very next page load with no template changes.
//
// Removed 2026-08-19: a scrolling ticker of product titles and a "Shop by
// Athlete & Creator" pill rail. The rail rendered every person twice (once as
// ATHLETE, once as CREATOR) because the same people are nodes of BOTH the
// `athletes` and the `creators` taxonomy — a duplication the data model
// guarantees, not a bug in the loop. Athlete/creator browsing is unaffected:
// the header mega-menus own it, on every page.
// See changelogs/2026-08-19-hero-strip-removal.md.
//
// Removed 2026-08-26: the "Featured Programs" deal-card rail and everything
// that fed it (dealCard/renderDealCards). It rendered the same four products,
// with the same covers and the same prices, that the product grid one screen
// below renders — the homepage was listing the whole catalogue twice under two
// different headings. The grid is the one that stayed: it lists every plan
// rather than the featured subset, and it carries Add to Cart. See
// changelogs/2026-08-26-landing-art-direction.md.
document.addEventListener("DOMContentLoaded", function () {
  if (!window.ProFitAPI) return;

  var heroPrice = document.getElementById("heroStartingPrice");
  if (!heroPrice && !document.getElementById("valueArea")) return;

  // ---- Hero "starting price": real lowest current product price, not the
  // hardcoded (and inaccurate) "$99.00" the old hero used. Left empty
  // (:empty CSS hides it) if the catalog can't be loaded rather than
  // showing a stale/fake number. ----
  function renderHeroPrice(products) {
    if (!heroPrice || !products.length) return;
    var min = products.reduce(function (m, p) { return Math.min(m, p.priceCents); }, products[0].priceCents);
    heroPrice.textContent = "Plans from " + window.ProFitAPI.formatPrice(min);
  }

  // ---- Product showcase: the program, in the device you will use it on ---
  // Fed by GET /api/demo — the same server-cut slice the /demo page renders.
  // Both device screens are painted from that one payload; the phone and the
  // laptop differ only in COMPOSITION, exactly as the real product does at
  // those widths. The section starts `hidden` in the markup and is only
  // revealed once the fetch resolves, so a failed request leaves no heading,
  // no empty device frame and no gap.
  var CHEVRON = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M15 5l-7 7 7 7"/></svg>';
  var FA_LOGO = '<img src="/assets/images/logo/fa-logo.svg" alt="" loading="lazy" decoding="async">';

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function chipValues(p, c) {
    var values = [];
    if (p.durationWeeks) values.push(p.durationWeeks + (p.durationWeeks === 1 ? " week" : " weeks"));
    if (p.difficulty) values.push(p.difficulty.charAt(0).toUpperCase() + p.difficulty.slice(1));
    if (c.hasNutrition) values.push("Training + nutrition");
    return values;
  }

  // The cover, at the derivative the box needs — never the stored original.
  // smallestDerivative resolves against the same payload the hero already
  // fetched, so this is usually a cache hit rather than a second image.
  function coverImg(p) {
    var src = window.MediaContainer.smallestDerivative(p.cover) || (p.cover && p.cover.src) || p.imageUrl;
    if (!src) return null;
    var img = document.createElement("img");
    img.src = src;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.onerror = function () { img.remove(); };
    return img;
  }

  // An exercise's poster still. The server sent the poster URL and nothing
  // heavier (see publicExercise in server/src/lib/demo.js); width/height
  // from the real aspect ratio reserve the box before the image arrives.
  function posterImg(ex, boxPx) {
    if (!ex.poster) return null;
    var img = document.createElement("img");
    img.src = ex.poster;
    img.alt = "";
    img.loading = "lazy";
    img.decoding = "async";
    img.width = boxPx;
    img.height = Math.round(boxPx / (ex.aspectRatio || 1.778));
    img.onerror = function () { img.closest("[data-dv-exmedia]") && img.closest("[data-dv-exmedia]").remove(); };
    return img;
  }

  function exerciseRow(ex, prefix, mediaPx) {
    var row = el("div", prefix + "__ex");
    var media = el("span", prefix + "__ex-media");
    media.setAttribute("data-dv-exmedia", "");
    var img = posterImg(ex, mediaPx);
    if (img) { media.appendChild(img); row.appendChild(media); }
    var body = el("span", prefix + "__ex-body");
    body.appendChild(el("strong", prefix + "__ex-name", ex.name || ""));
    var load = ex.reps || ex.sets || "";
    if (load) body.appendChild(el("span", prefix + "__ex-load", load));
    if (prefix === "dvp" && ex.substitutions) {
      body.appendChild(el("span", prefix + "__ex-swap", "Swap: " + ex.substitutions));
    }
    row.appendChild(body);
    return row;
  }

  // The dark identity block both screens share: cover, name, creator, chips,
  // grounded on the cover's own stored colour (via the CSSOM — the CSP
  // drops style="" attributes silently).
  function paintGround(node, p) {
    if (p.cover && p.cover.colour) {
      node.style.setProperty("background", "linear-gradient(180deg, " + p.cover.colour + " 0%, #141414 100%)");
    }
  }

  function phoneScreen(demo) {
    var p = demo.product, c = demo.contents || {}, pv = demo.preview;
    var root = el("div", "dvp");

    var bar = el("div", "dvp__bar");
    bar.innerHTML = CHEVRON + FA_LOGO;
    root.appendChild(bar);

    var hero = el("div", "dvp__hero");
    paintGround(hero, p);
    var cov = coverImg(p);
    if (cov) {
      var covBox = el("span", "dvp__hero-cover");
      covBox.appendChild(cov);
      hero.appendChild(covBox);
    }
    hero.appendChild(el("p", "dvp__hero-eyebrow", "Free preview"));
    hero.appendChild(el("h4", "dvp__hero-name", p.name || ""));
    if (p.creator) hero.appendChild(el("p", "dvp__hero-creator", "with " + p.creator));
    var chips = el("ul", "dvp__chips");
    chipValues(p, c).forEach(function (v) { chips.appendChild(el("li", null, v)); });
    hero.appendChild(chips);
    root.appendChild(hero);

    var session = el("div", "dvp__session");
    if (pv.weekTitle) session.appendChild(el("p", "dvp__week", pv.weekTitle));
    if (pv.dayTitle) session.appendChild(el("h5", "dvp__day", pv.dayTitle));
    if (pv.dayNotes) session.appendChild(el("p", "dvp__notes", pv.dayNotes));
    (pv.exercises || []).forEach(function (ex) { session.appendChild(exerciseRow(ex, "dvp", 64)); });

    // The boundary: empty shapes and a count. The server never sent what
    // they stand for, so there is nothing behind them to reveal.
    var ghosts = el("div", "dvp__ghosts");
    ghosts.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 3; i++) ghosts.appendChild(el("span", "dvp__ghost"));
    session.appendChild(ghosts);
    var total = c.exercises || 0;
    var shown = (pv.exercises || []).length;
    if (total > shown) session.appendChild(el("p", "dvp__more", (total - shown) + " more exercises in the full plan"));
    root.appendChild(session);
    return root;
  }

  function laptopScreen(demo) {
    var p = demo.product, c = demo.contents || {}, pv = demo.preview;
    var root = el("div", "dvl");

    var bar = el("div", "dvl__bar");
    bar.innerHTML = CHEVRON + FA_LOGO;
    root.appendChild(bar);

    var main = el("div", "dvl__main");

    var id = el("div", "dvl__id");
    paintGround(id, p);
    var cov = coverImg(p);
    if (cov) {
      var covBox = el("span", "dvl__id-cover");
      covBox.appendChild(cov);
      id.appendChild(covBox);
    }
    id.appendChild(el("h4", "dvl__id-name", p.name || ""));
    if (p.creator) id.appendChild(el("p", "dvl__id-creator", "with " + p.creator));
    var chips = el("ul", "dvl__id-chips");
    chipValues(p, c).forEach(function (v) { chips.appendChild(el("li", null, v)); });
    id.appendChild(chips);
    main.appendChild(id);

    var session = el("div", "dvl__session");
    if (pv.weekTitle) session.appendChild(el("p", "dvl__week", pv.weekTitle));
    if (pv.dayTitle) session.appendChild(el("h5", "dvl__day", pv.dayTitle));
    (pv.exercises || []).forEach(function (ex) { session.appendChild(exerciseRow(ex, "dvl", 56)); });
    var ghosts = el("div", "dvl__ghosts");
    ghosts.setAttribute("aria-hidden", "true");
    for (var i = 0; i < 2; i++) ghosts.appendChild(el("span", "dvl__ghost"));
    session.appendChild(ghosts);
    var total = c.exercises || 0;
    var shown = (pv.exercises || []).length;
    if (total > shown) session.appendChild(el("p", "dvl__more", (total - shown) + " more exercises in the full plan"));
    main.appendChild(session);

    root.appendChild(main);
    return root;
  }

  function renderFacts(section, demo) {
    var p = demo.product, c = demo.contents || {};
    var creator = section.querySelector("[data-dv-creator]");
    if (creator && p.creator) creator.textContent = "with " + p.creator;
    var name = section.querySelector("[data-dv-name]");
    if (name) name.textContent = p.name || "";

    var facts = section.querySelector("[data-dv-facts]");
    if (!facts) return;
    var rows = [
      ["Length", p.durationWeeks ? p.durationWeeks + (p.durationWeeks === 1 ? " week" : " weeks") : ""],
      ["Level", p.difficulty ? p.difficulty.charAt(0).toUpperCase() + p.difficulty.slice(1) : ""],
      ["Training days", c.trainingDays ? String(c.trainingDays) : ""],
      ["Includes", c.hasNutrition ? "Training + nutrition" : ""],
      ["Handbook", c.handbookPages ? c.handbookPages + " pages" : ""],
      ["Price", typeof p.priceCents === "number" ? window.ProFitAPI.formatProductPrice(p.priceCents) : ""],
    ];
    rows.forEach(function (r) {
      if (!r[1]) return;
      var row = el("div", "dv__fact");
      row.appendChild(el("dt", null, r[0]));
      row.appendChild(el("dd", null, r[1]));
      facts.appendChild(row);
    });
  }

  // ---- The handbook: the REAL viewer, loaded only when asked for ---------
  // program-viewer.css/js are the purchased program's reader. Neither is on
  // the landing page's critical path — they are injected on the first click,
  // then fed GET /api/demo/handbook, a viewer-shaped payload the server cut
  // to the same 1-week/1-day/2-exercise slice, ending on a locked page.
  var viewerReady = null;
  function loadViewer() {
    if (viewerReady) return viewerReady;
    viewerReady = new Promise(function (resolve, reject) {
      var link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = "/assets/css/program-viewer.css?v=20260826";
      document.head.appendChild(link);
      var script = document.createElement("script");
      script.src = "/assets/js/program-viewer.js?v=20260826";
      script.onload = function () { resolve(); };
      script.onerror = function () { viewerReady = null; reject(new Error("viewer failed to load")); };
      document.head.appendChild(script);
    });
    return viewerReady;
  }

  function wireHandbook(section, demo) {
    var btn = section.querySelector("[data-dv-handbook]");
    if (!btn) return;
    var payload = null;
    btn.addEventListener("click", function () {
      btn.disabled = true;
      Promise.all([
        loadViewer(),
        payload ? Promise.resolve(payload) : fetch("/api/demo/handbook", { headers: { Accept: "application/json" } })
          .then(function (r) { if (!r.ok) throw new Error("handbook preview unavailable"); return r.json(); })
          .then(function (d) { payload = d; return d; }),
      ]).then(function (results) {
        btn.disabled = false;
        if (window.ProgramViewer && window.ProgramViewer.open) window.ProgramViewer.open(results[1]);
      }).catch(function () {
        // No viewer, no modal: the demo page shows the same content and
        // needs nothing loaded, so the button becomes the honest fallback.
        btn.disabled = false;
        window.location.href = "/demo";
      });
    });
  }

  function wireToggle(section) {
    var stage = section.querySelector("[data-dv-stage]");
    var buttons = section.querySelectorAll("[data-dv-mode]");
    if (!stage || !buttons.length) return;
    Array.prototype.forEach.call(buttons, function (btn) {
      btn.addEventListener("click", function () {
        var mode = btn.getAttribute("data-dv-mode");
        if (stage.getAttribute("data-mode") === mode) return;
        stage.setAttribute("data-mode", mode);
        Array.prototype.forEach.call(buttons, function (b) {
          var active = b === btn;
          b.classList.toggle("is-active", active);
          b.setAttribute("aria-pressed", String(active));
        });
        // The hidden device is inert for assistive tech; the visible one is
        // the product being demonstrated.
        Array.prototype.forEach.call(stage.querySelectorAll("[data-dv-device]"), function (d) {
          d.setAttribute("aria-hidden", String(d.getAttribute("data-dv-device") !== mode));
        });
      });
    });
  }

  function renderValueProduct(demo) {
    var section = document.getElementById("valueArea");
    if (!section || !demo || !demo.product || !demo.preview || !(demo.preview.exercises || []).length) return;

    var phone = section.querySelector('[data-dv-screen="phone"]');
    var laptop = section.querySelector('[data-dv-screen="laptop"]');
    if (phone) phone.appendChild(phoneScreen(demo));
    if (laptop) laptop.appendChild(laptopScreen(demo));

    renderFacts(section, demo);

    var productBtn = section.querySelector("[data-dv-product]");
    if (productBtn && demo.product.slug) productBtn.href = "/program/" + encodeURIComponent(demo.product.slug);

    wireToggle(section);
    wireHandbook(section, demo);

    section.hidden = false;

    // Gentle entry once the device is actually looked at. The class is added
    // when the stage nears the viewport; under reduced motion the CSS shows
    // everything immediately and this is a no-op.
    if (typeof IntersectionObserver === "function") {
      var io = new IntersectionObserver(function (entries) {
        if (entries.some(function (e) { return e.isIntersecting; })) {
          section.classList.add("is-in");
          io.disconnect();
        }
      }, { rootMargin: "0px 0px -10% 0px" });
      io.observe(section);
    } else {
      section.classList.add("is-in");
    }
  }

  // The demo payload is small (~3KB) and independent of the product list, so
  // it is fetched alongside rather than after — and its failure is isolated:
  // a dead /api/demo hides one section, it does not take the product strip
  // or the hero price down with it.
  fetch("/api/demo", { headers: { Accept: "application/json" } })
    .then(function (r) { return r.ok ? r.json() : null; })
    .then(function (d) { if (d) renderValueProduct(d); })
    .catch(function () {});

  window.ProFitAPI.listProducts().then(function (result) {
    renderHeroPrice(result.products || []);
  }).catch(function () {
    // Real data failed to load. The hero price is simply left empty; :empty
    // hides it, so nothing stale or invented is ever shown in its place.
  });
});
