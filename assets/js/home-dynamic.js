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
  var vpCover = document.querySelector("[data-vp-cover]");
  var vpName = document.querySelector("[data-vp-name]");
  var vpCreator = document.querySelector("[data-vp-creator]");
  var vpWeeks = document.querySelector("[data-vp-weeks]");
  if (!dealTrack && !heroPrice && !vpName) return;

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

  // ---- "Inside Every Plan" preview: the identity strip of the program-viewer
  // illustration. Only the parts that CAN be true are filled from real data —
  // cover, name, creator and week count, all from the public product list this
  // function is already handed. The session rows below it stay illustrative
  // and stay aria-hidden: real trainingContent is gated behind requireAuth +
  // entitlement (server/src/routes/library.js), so a public page must not
  // render it.
  //
  // Every write here is a no-op when the data is absent, and the markup ships
  // neutral defaults, so a failed or empty catalog leaves a complete-looking
  // card rather than blanks. ----
  function renderValuePreview(products) {
    if (!vpName) return;
    var featured = products.filter(function (p) { return p.featured; });
    var p = (featured.length ? featured : products)[0];
    if (!p) return;

    vpName.textContent = p.name;
    if (vpCreator && p.creator) vpCreator.textContent = p.creator;

    // smallestDerivative, not applyResponsive: this tile is never painted
    // wider than 54px, and the smallest derivative the pipeline produces is
    // 320px — which the featured-programs strip above has already fetched for
    // this same product. Naming that one file directly guarantees the browser
    // reuses it (a cache hit, zero extra bytes) instead of letting a srcset
    // pick a larger candidate on a high-DPR screen. Falls back to the full
    // cover only when a product has no derivatives at all.
    var coverSrc = window.MediaContainer.smallestDerivative(p.cover) ||
      (p.cover && p.cover.src) || p.imageUrl;
    if (vpCover && coverSrc) {
      var img = document.createElement("img");
      img.src = coverSrc;
      img.alt = "";
      img.width = 54;
      img.height = 54;
      img.loading = "lazy";
      img.decoding = "async";
      // A cover that 404s must leave the neutral tile, not a broken-image
      // glyph inside an otherwise finished-looking card.
      img.onerror = function () { img.remove(); };
      vpCover.appendChild(img);
    }

    // One tick per week of the real programme. Capped at 16 so a long plan
    // cannot shrink the ticks into a smear; below that the rail is exact.
    if (vpWeeks && p.durationWeeks > 0) {
      var n = Math.min(p.durationWeeks, 16);
      var frag = document.createDocumentFragment();
      for (var i = 0; i < n; i++) {
        var tick = document.createElement("span");
        tick.className = "vp__week" + (i === 0 ? " vp__week--on" : "");
        frag.appendChild(tick);
      }
      vpWeeks.appendChild(frag);
    }
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

  window.ProFitAPI.listProducts().then(function (result) {
    var products = result.products || [];
    renderDealCards(products);
    renderValuePreview(products);
    renderHeroPrice(products);
  }).catch(function () {
    // Real data failed to load — hide the dynamic section rather than showing
    // stale/fake placeholders. The hero price is left empty; :empty hides it.
    if (dealSection) dealSection.style.display = "none";
  });
});
