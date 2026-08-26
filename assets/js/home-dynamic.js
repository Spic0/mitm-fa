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

  // ---- "Inside Every Plan": a real product, counted ----------------------
  // Fed by GET /api/demo, which is the only source of these numbers: they are
  // counted server-side from stored `trainingContent`, which is gated content
  // no public endpoint exposes. The section renders nothing it was not given —
  // a product with no creator, no difficulty or no nutrition simply produces
  // fewer chips and fewer rows.
  //
  // The section starts `hidden` in the markup and is only revealed once this
  // resolves. A failed request therefore leaves no heading, no frame and no
  // gap: the block is either true or absent.
  function renderValueProduct(demo) {
    var section = document.getElementById("valueArea");
    if (!section || !demo || !demo.product) return;
    var p = demo.product;
    var c = demo.contents || {};

    var name = section.querySelector("[data-vx-name]");
    if (name) name.textContent = p.name || "";
    var creator = section.querySelector("[data-vx-creator]");
    if (creator && p.creator) creator.textContent = "with " + p.creator;

    var cover = section.querySelector("[data-vx-cover]");
    // The same cover the featured strip above already fetched, at the same
    // derivative — a cache hit rather than a second image.
    var coverSrc = window.MediaContainer.smallestDerivative(p.cover) ||
      (p.cover && p.cover.src) || p.imageUrl;
    if (cover && coverSrc) {
      var img = document.createElement("img");
      img.src = coverSrc;
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";
      img.onerror = function () { img.remove(); };
      cover.appendChild(img);
    }

    var chips = section.querySelector("[data-vx-chips]");
    if (chips) {
      var values = [];
      if (p.durationWeeks) values.push(p.durationWeeks + (p.durationWeeks === 1 ? " week" : " weeks"));
      if (p.difficulty) values.push(p.difficulty.charAt(0).toUpperCase() + p.difficulty.slice(1));
      if (c.hasNutrition) values.push("Training + nutrition");
      values.forEach(function (v) {
        var li = document.createElement("li");
        li.textContent = v;
        chips.appendChild(li);
      });
    }

    // Counted rows only. A zero count renders nothing at all rather than
    // "0 nutrition meals", and `demos` is held to a share of the exercises
    // rather than merely being non-zero — 4 demos across 210 exercises is a
    // real number and not a feature.
    var spec = section.querySelector("[data-vx-spec]");
    var rows = [
      [c.weeks, "Weeks", "Structured start to finish."],
      [c.trainingDays, "Training days", "Each a full session with its own brief."],
      [c.exercises, "Exercises", c.movements ? "Across " + c.movements + " distinct movements." : ""],
      [c.coachingNotes, "Coaching notes", "Setup and execution cues, per exercise."],
      [c.swaps, "Listed swaps", "An alternative when the equipment is taken."],
      [c.meals, "Nutrition meals", "With macros, in the same plan."],
    ];
    if (c.demos && c.exercises && c.demos / c.exercises >= 0.25) {
      rows.push([c.demos, "Exercise demos", "Short demonstration clips."]);
    }
    if (spec) {
      rows.forEach(function (r) {
        if (!r[0]) return;
        var row = document.createElement("div");
        row.className = "value__spec-row";
        var dt = document.createElement("dt");
        dt.className = "value__spec-value";
        dt.textContent = String(r[0]);
        var dd = document.createElement("dd");
        dd.className = "value__spec-term";
        dd.appendChild(document.createTextNode(r[1]));
        if (r[2]) {
          var sub = document.createElement("span");
          sub.textContent = r[2];
          dd.appendChild(sub);
        }
        row.appendChild(dt);
        row.appendChild(dd);
        spec.appendChild(row);
      });
    }

    renderSession(section, demo);
    section.hidden = false;
  }

  // ---- The excerpt -------------------------------------------------------
  // `demo.preview` is ALREADY the whole of what the server is willing to give
  // a signed-out visitor: one week, one day, two exercises (demo.limits). It
  // is not a trimmed view of a larger payload that arrived — the rest of the
  // program never left the database. So this function renders everything it
  // is handed, and the closing line reports the difference between what is
  // here and what `contents` counted, which is the honest way to say "there
  // is more" without implying the rest is one CSS rule away.
  function renderSession(section, demo) {
    var wrap = section.querySelector("[data-vx-session]");
    var pv = demo.preview;
    if (!wrap || !pv || !pv.exercises || !pv.exercises.length) return;

    var week = section.querySelector("[data-vx-week]");
    if (week && pv.weekTitle) week.textContent = pv.weekTitle;
    var day = section.querySelector("[data-vx-day]");
    if (day && pv.dayTitle) day.textContent = pv.dayTitle;

    var list = section.querySelector("[data-vx-exercises]");
    if (list) {
      pv.exercises.forEach(function (ex) {
        var li = document.createElement("li");
        li.className = "value__ex";
        var name = document.createElement("span");
        name.className = "value__ex-name";
        name.textContent = ex.name || "";
        li.appendChild(name);
        // `reps` already reads "4x12" in the stored program; `sets` is a
        // separate optional field and is only shown when it carries something
        // reps does not.
        var load = ex.reps || ex.sets || "";
        if (load) {
          var span = document.createElement("span");
          span.className = "value__ex-load";
          span.textContent = load;
          li.appendChild(span);
        }
        list.appendChild(li);
      });
    }

    var rest = section.querySelector("[data-vx-rest]");
    var total = demo.contents && demo.contents.exercises;
    if (rest && total && total > pv.exercises.length) {
      rest.textContent = (total - pv.exercises.length) + " more exercises in the full plan.";
    } else if (rest) {
      rest.remove();
    }

    wrap.hidden = false;
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
