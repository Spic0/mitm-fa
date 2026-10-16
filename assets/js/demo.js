// PUBLIC PROGRAM PREVIEW (/demo)
//
// Renders whatever GET /api/demo returns and nothing else. There is no "full"
// payload here to hide, no second request that fetches the rest, and no
// client-side gate: the slicing happened on the server (server/src/lib/demo.js)
// and this file only has the two exercises it was given. Opening DevTools on
// this page shows exactly what the page shows.
//
// Every field is optional. A demo product with no creator, no difficulty, no
// nutrition or no exercise media renders a shorter page rather than a page
// with empty rows in it — the same rule the rest of the platform follows: show
// what exists, claim nothing that does not.
(function () {
  "use strict";

  var boot = document.getElementById("dmBoot");
  var main = document.getElementById("dmMain");
  var errorBox = document.getElementById("dmError");

  function show(el) { if (el) el.classList.remove("u-hidden"); }
  function hide(el) { if (el) el.classList.add("u-hidden"); }

  function fail() {
    hide(boot);
    hide(main);
    show(errorBox);
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  // "advanced" -> "Advanced". The stored values are lowercase enum-ish
  // strings; the interface is Title Case everywhere else.
  function titleCase(s) {
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : "";
  }

  function plural(n, one, many) {
    return n + " " + (n === 1 ? one : many);
  }

  function render(d) {
    var p = d.product || {};
    var c = d.contents || {};
    var pv = d.preview || {};
    var locked = d.locked || {};

    document.getElementById("dmTitle").textContent = p.name || "Program preview";
    var appbarTitle = document.getElementById("dmAppbarTitle");
    if (appbarTitle) appbarTitle.textContent = p.name || "";

    var creator = document.getElementById("dmCreator");
    if (p.creator) creator.textContent = "with " + p.creator;
    else creator.classList.add("u-hidden");

    var lede = document.getElementById("dmLede");
    if (p.lede) lede.textContent = p.lede; else lede.remove();

    // ---- Cover. The SAME responsive container the storefront cards use, so
    // the preview's poster is served from the same derivatives as everywhere
    // else — no new image, no new size, no full-resolution original. ----
    var poster = document.getElementById("dmPoster");
    var art = document.getElementById("dmArt");
    if (p.cover || p.imageUrl) {
      var img = document.createElement("img");
      img.alt = p.name || "";
      img.decoding = "async";
      // Above the fold and the largest thing on screen: this is the one image
      // on the page worth fetching eagerly.
      img.loading = "eager";
      poster.appendChild(window.MediaContainer.applyResponsive(img, p, "(min-width: 768px) 220px, 40vw"));

      // The blurred backdrop reuses the SMALLEST derivative — it is scaled up
      // and blurred behind a scrim, so anything larger is wasted bytes.
      var artSrc = window.MediaContainer.smallestDerivative(p.cover) || p.imageUrl;
      if (artSrc) {
        var bg = document.createElement("img");
        bg.src = artSrc;
        bg.alt = "";
        bg.decoding = "async";
        bg.loading = "eager";
        art.appendChild(bg);
      }
    }

    // ---- Chips: only the attributes this product actually has. ----
    var chips = document.getElementById("dmChips");
    var chipValues = [];
    if (p.durationWeeks) chipValues.push(plural(p.durationWeeks, "week", "weeks"));
    if (p.difficulty) chipValues.push(titleCase(p.difficulty));
    (p.categories || []).slice(0, 2).forEach(function (n) { chipValues.push(n); });
    if (c.hasNutrition) chipValues.push("Training + nutrition");
    chipValues.forEach(function (v) { chips.appendChild(el("li", null, v)); });

    // The hero deliberately has NO stat tiles. An earlier pass put weeks /
    // training days / exercises there and then repeated all three in the spec
    // table one screen below — the same three numbers, twice, in two
    // treatments. The chips carry the instant read (duration, level, whether
    // nutrition is included) and the spec table is the single place any count
    // is stated.

    // ---- The spec table. Counted facts, in descending order of how much
    // they tell a buyer. A row with a zero count is not rendered: an honest
    // absence beats "0 nutrition meals".
    //
    // `demos` is deliberately conditional on being a meaningful share of the
    // exercises rather than merely non-zero. The current demo product carries
    // 4 across 210, and printing "4 exercise demonstrations" beside "210
    // exercises" would read as a feature when it is a rounding error. ----
    var spec = document.getElementById("dmSpec");
    var rows = [
      [c.weeks, "Weeks", "Structured start to finish, in order."],
      [c.trainingDays, "Training days", "Each one a full session with its own brief."],
      [c.exercises, "Exercises", c.movements ? "Across " + plural(c.movements, "movement", "distinct movements") + "." : ""],
      [c.coachingNotes, "Coaching notes", "Setup and execution cues, written per exercise."],
      [c.swaps, "Listed swaps", "An alternative movement when equipment is taken."],
      [c.meals, "Nutrition meals", "With macros, in the same plan."],
    ];
    if (c.demos && c.exercises && c.demos / c.exercises >= 0.25) {
      rows.push([c.demos, "Exercise demos", "Short demonstration clips."]);
    }
    rows.forEach(function (r) {
      if (!r[0]) return;
      var row = el("div", "dm-spec__row");
      row.appendChild(el("dt", "dm-spec__value", String(r[0])));
      var dd = el("dd", "dm-spec__term");
      dd.appendChild(el("b", null, r[1]));
      if (r[2]) dd.appendChild(document.createTextNode(r[2]));
      row.appendChild(dd);
      spec.appendChild(row);
    });

    // ---- The sample session. ----
    document.getElementById("dmWeek").textContent = pv.weekTitle || "";
    document.getElementById("dmDay").textContent = pv.dayTitle || "";
    document.getElementById("dmNotes").textContent = pv.dayNotes || "";

    // Exercise rows use the purchased viewer's own .pg-ex markup (see
    // assets/js/program.js), so a customer who buys sees the identical row
    // they were shown here.
    var list = document.getElementById("dmExercises");
    (pv.exercises || []).forEach(function (ex) {
      var row = el("div", "pg-ex");

      if (ex.poster) {
        var media = el("span", "pg-ex__media");
        if (ex.aspectRatio) media.setAttribute("data-ar", String(ex.aspectRatio));
        var m = document.createElement("img");
        // The poster, and only ever the poster. The animation behind this
        // still is entitlement-gated and is not requested here — see the
        // demo allowlist in server/src/routes/library.js.
        m.src = ex.poster;
        m.alt = ex.name || "";
        m.loading = "lazy";
        m.decoding = "async";
        media.appendChild(m);
        row.appendChild(media);
      }

      var body = el("div", "pg-ex__body");
      body.appendChild(el("div", "pg-ex__name", ex.name || "Exercise"));
      var prescription = ex.sets && ex.reps ? ex.sets + " x " + ex.reps : (ex.reps || ex.sets || "");
      if (prescription) body.appendChild(el("span", "pg-ex__reps", prescription));
      if (ex.notes) body.appendChild(el("p", "pg-ex__note", ex.notes));
      if (ex.substitutions) {
        var swap = el("p", "pg-ex__note");
        swap.appendChild(el("b", null, "Swap: "));
        swap.appendChild(document.createTextNode(ex.substitutions));
        body.appendChild(swap);
      }
      row.appendChild(body);
      list.appendChild(row);
    });

    // ---- The lock. Counts of what was NOT sent. ----
    var counts = document.getElementById("dmLockCounts");
    [
      [locked.exercisesInThisDay, "more exercises in this session"],
      [locked.daysInThisWeek, "more days in this week"],
      [locked.weeks, "more weeks"],
    ].forEach(function (pair) {
      if (!pair[0]) return;
      var li = document.createElement("li");
      li.appendChild(el("b", null, String(pair[0])));
      li.appendChild(document.createTextNode(pair[1]));
      counts.appendChild(li);
    });

    var days = document.getElementById("dmLockDays");
    (d.lockedDayTitles || []).forEach(function (t) {
      days.appendChild(el("div", "dm-lock__day", t));
    });

    // The CTA goes to the product's own sales page — the real purchase route,
    // never a checkout shortcut and never a "free unlock".
    var cta = document.getElementById("dmCta");
    if (p.slug) cta.href = "/program/" + encodeURIComponent(p.slug);

    var price = document.getElementById("dmPrice");
    if (p.priceCents != null && window.ProFitAPI) {
      price.appendChild(document.createTextNode("Full program "));
      price.appendChild(el("b", null, window.ProFitAPI.formatPrice(p.priceCents)));
      price.appendChild(document.createTextNode(" · one payment, no subscription"));
    } else {
      price.remove();
    }

    hide(boot);
    show(main);
  }

  function load() {
    fetch("/api/demo", { headers: { Accept: "application/json" } })
      .then(function (r) {
        if (!r.ok) throw new Error("demo " + r.status);
        return r.json();
      })
      .then(render)
      .catch(fail);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", load);
  } else {
    load();
  }
})();
