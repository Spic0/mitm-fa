// Renders the homepage's "Latest / Top Rating / Featured" product tabs from
// the real product API instead of 16 hardcoded duplicate cards with no
// data-id (which meant Add to Cart on the homepage always fell back to a
// fake generated id and could never actually check out). Card markup itself
// comes from the shared ProductCard builder (assets/js/product-card.js).
document.addEventListener("DOMContentLoaded", function () {
  if (!window.ProFitAPI || !window.ProductCard) return;

  var grids = {
    latest: document.getElementById("homeGridLatest"),
    topRated: document.getElementById("homeGridTopRated"),
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

  window.ProFitAPI.listProducts().then(function (data) {
    var products = data.products;
    var featured = products.filter(function (p) { return p.featured; });

    // No real "top rated" data exists yet (no review/rating model), so that
    // tab reuses the same catalog as Latest rather than showing fake stats.
    window.ProductCard.renderInto(grids.latest, products, optsFor(grids.latest));
    window.ProductCard.renderInto(grids.topRated, products, optsFor(grids.topRated));
    window.ProductCard.renderInto(grids.featured, featured, optsFor(grids.featured));

    window.ProductCard.renderInto(heroRow, featured.slice(0, 3), {
      cardClass: "product__slider-item",
      colClass: "",
    });
  }).catch(function () {
    // Leave the tabs/hero row empty rather than showing stale hardcoded products.
  });
});
