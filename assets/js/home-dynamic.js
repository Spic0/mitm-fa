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
  if (!dealTrack && !heroPrice) return;

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
    renderHeroPrice(products);
  }).catch(function () {
    // Real data failed to load — hide the dynamic section rather than showing
    // stale/fake placeholders. The hero price is left empty; :empty hides it.
    if (dealSection) dealSection.style.display = "none";
  });
});
