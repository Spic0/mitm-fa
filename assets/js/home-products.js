// Renders the homepage's "Latest / Top Rating / Featured" product tabs from
// the real product API instead of 16 hardcoded duplicate cards with no
// data-id (which meant Add to Cart on the homepage always fell back to a
// fake generated id and could never actually check out). Card markup itself
// comes from the shared ProductCard builder (assets/js/product-card.js).
document.addEventListener("DOMContentLoaded", function () {
  if (!window.ProFitAPI || !window.ProductCard) return;

  var grids = {
    latest: document.getElementById("homeGridLatest"),
    bestSellers: document.getElementById("homeGridBestSellers"),
    featured: document.getElementById("homeGridFeatured"),
  };
  var heroRow = document.getElementById("heroProductSlides");

  // Column widths differ between the index.html/index-light.html grid (4-up
  // at xl) and the index-2/index-2-light grid (3-up at xl) — each grid
  // container declares its own via data-col-class rather than the shared
  // renderer guessing which page it's on.
  function optsFor(grid) {
    return { colClass: grid ? grid.dataset.colClass : undefined };
  }

  // Reserve the grid's space before the request goes out, so the page below
  // doesn't jump when products arrive. Counts match what each grid typically
  // renders, so the swap is close to a no-op geometrically.
  // The three tab grids carry static skeleton markup in the HTML (see
  // tools/inject-grid-skeletons.js) so their space is reserved before any
  // script runs — re-rendering them here would be pure churn. The hero row
  // has no static equivalent, so it still gets one.
  window.ProductCard.renderSkeleton(heroRow, 3, { cardClass: "product__slider-item", colClass: "" });

  window.ProFitAPI.listProducts().then(function (data) {
    var products = data.products;
    var featured = products.filter(function (p) { return p.featured; });

    // Bestsellers: real paid-order volume. `bestsellerRank` is a 1-based
    // POSITION supplied by GET /api/products (server/src/lib/recommendations.js
    // -> getSalesRankMap); products with no sales carry null and are excluded
    // outright rather than sorted to the end, because "hasn't sold" and
    // "sold least" are different claims.
    //
    // This tab previously rendered `products` — byte-identical to Latest —
    // under the label "top ratting". A filter that changes its label but not
    // its contents teaches visitors the controls do nothing.
    var bestSellers = products
      .filter(function (p) { return typeof p.bestsellerRank === "number"; })
      .sort(function (a, b) { return a.bestsellerRank - b.bestsellerRank; });

    // Nothing has sold yet (a new catalog): drop the tab rather than present
    // an arbitrary order as a popularity ranking. The tab ships hidden in the
    // markup and is only revealed here, so no-JS visitors never see it either.
    var bestSellersTab = document.querySelector('[data-tab="best-sellers"]');
    if (bestSellers.length >= 2) {
      if (bestSellersTab) bestSellersTab.hidden = false;
    } else if (grids.bestSellers) {
      var pane = grids.bestSellers.closest(".tab-pane");
      if (pane) pane.remove();
      grids.bestSellers = null;
    }

    window.ProductCard.renderInto(grids.latest, products, optsFor(grids.latest));
    window.ProductCard.renderInto(grids.bestSellers, bestSellers, optsFor(grids.bestSellers));
    window.ProductCard.renderInto(grids.featured, featured, optsFor(grids.featured));

    window.ProductCard.renderInto(heroRow, featured.slice(0, 3), {
      cardClass: "product__slider-item",
      colClass: "",
    });
  }).catch(function () {
    // Leave the tabs/hero row empty rather than showing stale hardcoded products.
  });
});
