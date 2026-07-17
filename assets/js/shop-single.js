// Renders the product detail page for whichever product's slug is in the
// URL, instead of always showing the same hardcoded product. The add-to-bag
// button here isn't nested inside a .product__item card like the shop grid,
// so script.js's cart handler can't read name/price/image from sibling DOM
// text — it falls back to data-name/data-price/data-img, which we set
// explicitly below alongside the real data-id.
document.addEventListener("DOMContentLoaded", function () {
  var titleEl = document.getElementById("productTitle");
  if (!titleEl || !window.ProFitAPI) return;

  var slug = new URLSearchParams(window.location.search).get("slug");

  function showNotFound() {
    titleEl.textContent = "Plan not found";
    var descEl = document.getElementById("productDescriptionShort");
    if (descEl) descEl.textContent = "This plan may have been removed. Browse all current plans instead.";
    var priceEl = document.getElementById("productPrice");
    if (priceEl) priceEl.textContent = "";
  }

  if (!slug) {
    showNotFound();
    return;
  }

  window.ProFitAPI.getProduct(slug).then(function (data) {
    var p = data.product;

    titleEl.textContent = p.name;
    document.getElementById("productPrice").textContent = window.ProFitAPI.formatPrice(p.priceCents);
    document.getElementById("productDescriptionShort").textContent = p.description || "";

    var categoryLink = document.getElementById("productCategoryLink");
    if (categoryLink) categoryLink.textContent = p.category || "Training Plans";

    document.querySelectorAll(".product-gallery-img").forEach(function (img) {
      img.src = p.imageUrl;
      img.alt = p.name;
    });

    var addToCartBtn = document.getElementById("productAddToCart");
    if (addToCartBtn) {
      addToCartBtn.dataset.id = p.id;
      addToCartBtn.dataset.name = p.name;
      addToCartBtn.dataset.price = (p.priceCents / 100).toFixed(2);
      addToCartBtn.dataset.img = p.imageUrl;
    }
  }).catch(function () {
    showNotFound();
  });

  // Collapsed-by-default discount code — a small reveal, never competing
  // with the Add to Bag CTA for attention.
  var discountToggle = document.getElementById("discountToggle");
  var discountRow = document.getElementById("discountRow");
  if (discountToggle && discountRow) {
    discountToggle.addEventListener("click", function () {
      var showing = discountRow.style.display !== "none";
      discountRow.style.display = showing ? "none" : "flex";
      discountToggle.style.display = showing ? "" : "none";
    });
  }
});
