// Homepage-only dynamic sections: the "Featured Programs" product strip that
// is now the first section after the hero, and the hero's starting price.
// Driven entirely by real backend data (GET /api/products) — nothing here is
// hardcoded HTML, so a product added, renamed, repriced or removed in the
// admin panel shows up on the very next page load with no template changes.
//
// Removed 2026-08-19: a scrolling ticker of product titles and a "Shop by
// Athlete & Creator" pill rail, both of which sat between the hero and this
// strip. The rail rendered every person twice (once as ATHLETE, once as
// CREATOR) because the same people are nodes of BOTH the `athletes` and the
// `creators` taxonomy — a duplication the data model guarantees, not a bug in
// the loop. Dropping it also drops this file's GET /api/taxonomy call, so the
// homepage now makes one product request instead of two parallel requests.
// Athlete/creator browsing is unaffected: the header mega-menus own it, on
// every page. See changelogs/2026-08-19-hero-strip-removal.md.
document.addEventListener("DOMContentLoaded", function () {
  if (!window.ProFitAPI) return;

  var dealTrack = document.getElementById("dealCardsTrack");
  var dealSection = dealTrack ? dealTrack.closest(".deal-cards-area") : null;
  var dealEyebrow = dealSection ? dealSection.querySelector("[data-deal-eyebrow]") : null;
  var heroPrice = document.getElementById("heroStartingPrice");
  if (!dealTrack && !heroPrice && !document.getElementById("valueArea")) return;

  // ---- Hero "starting price": real lowest current product price, not the
  // hardcoded (and inaccurate) "$99.00" the old hero used. Left empty
  // (:empty CSS hides it) if the catalog can't be loaded rather than
  // showing a stale/fake number. ----
  function renderHeroPrice(products) {
    if (!heroPrice || !products.length) return;
    var min = products.reduce(function (m, p) { return Math.min(m, p.priceCents); }, products[0].priceCents);
    heroPrice.textContent = "Plans from " + window.ProFitAPI.formatPrice(min);
  }

  // ---- Deal cards: real products, admin-set price, no description. Whole
  // card is a single <a> (simplest possible full-card tap target on mobile —
  // no stretched-link/z-index layering needed), with a purely visual "Shop
  // Now" pill inside so the CTA stays visible per spec. ----
  function dealCard(p) {
    var a = document.createElement("a");
    a.className = "deal-card";
    a.href = "/program/" + encodeURIComponent(p.slug);

    // A hardcoded "50% off" roundel used to be stamped on EVERY card here,
    // regardless of the product, with no discount behind it — the price
    // rendered below it was simply the full admin-set price. Removed rather
    // than made conditional: nothing in the product model expresses a "was"
    // price, so there is no honest number to compute a percentage from.
    // Real discounts live in the Promotion table and are applied at checkout
    // (server/src/lib/promotions.js); if a badge is wanted here later it must
    // read from there.

    var imageWrap = document.createElement("span");
    imageWrap.className = "deal-card__image";
    var img = document.createElement("img");
    img.alt = p.name;
    img.loading = "lazy";
    img.decoding = "async";
    // `node`, not `img` — applyResponsive returns a <picture> wrapper when
    // derivatives exist, and appending the bare img would drop the AVIF source.
    var node = window.MediaContainer.applyResponsive(img, p, "(min-width: 768px) 320px, 82vw");
    imageWrap.appendChild(node);
    a.appendChild(imageWrap);

    var content = document.createElement("span");
    content.className = "deal-card__content";

    var name = document.createElement("span");
    name.className = "deal-card__name";
    name.textContent = p.name;
    content.appendChild(name);

    var price = document.createElement("span");
    price.className = "deal-card__price";
    price.textContent = window.ProFitAPI.formatProductPrice(p.priceCents);
    content.appendChild(price);

    var cta = document.createElement("span");
    cta.className = "btn-two deal-card__cta";
    cta.innerHTML = "<span>Shop Now</span>";
    content.appendChild(cta);

    a.appendChild(content);
    return a;
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

    section.hidden = false;
  }

  function renderDealCards(products) {
    if (!dealTrack) return;
    var featured = products.filter(function (p) { return p.featured; });
    var picks = (featured.length ? featured : products).slice(0, 8);
    if (!picks.length) {
      if (dealSection) dealSection.style.display = "none";
      return;
    }
    // The markup says "Featured Programs" because that is the normal case.
    // When an operator has flagged nothing, this strip is the newest products
    // instead, and the label has to say so rather than assert a curation that
    // did not happen.
    if (dealEyebrow && !featured.length) dealEyebrow.textContent = "All Programs";
    dealTrack.innerHTML = "";
    picks.forEach(function (p) { dealTrack.appendChild(dealCard(p)); });
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
    var products = result.products || [];
    renderDealCards(products);
    renderHeroPrice(products);
  }).catch(function () {
    // Real data failed to load — hide the dynamic section rather than showing
    // stale/fake placeholders. The hero price is left empty; :empty hides it.
    if (dealSection) dealSection.style.display = "none";
  });
});
