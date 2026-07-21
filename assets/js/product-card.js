// Single shared "product card" builder used by every grid that lists
// products (home page tabs, hero slider, shop listing). Cards carry no
// separate Add to Cart / Buy Now buttons: the whole card is one tap target.
// A single anchor (the CTA strip at the bottom of the card) stretches over
// the entire card via .stretched-link, so tapping anywhere on the image or
// text adds the product to the cart and opens the cart drawer, where the
// Checkout button continues the purchase. The anchor's href points at the
// product detail page purely as a fallback for open-in-new-tab / no-JS —
// a normal tap is intercepted by the data-add-to-cart handler in script.js.
window.ProductCard = (function () {
  function build(p, opts) {
    opts = opts || {};
    var link = "/program/" + encodeURIComponent(p.slug);
    var price = window.ProFitAPI.formatPrice(p.priceCents);

    var col = document.createElement("div");
    col.className = opts.colClass || "col-xl-4 col-lg-6 col-md-6";

    var card = document.createElement("div");
    card.className = (opts.cardClass || "product__item") + " product__item--tap bor";

    var imageWrap = document.createElement("div");
    imageWrap.className = "product__image pt-20 d-block";
    var img = document.createElement("img");
    img.src = p.imageUrl || "";
    img.alt = p.name;
    imageWrap.appendChild(img);
    card.appendChild(imageWrap);

    var content = document.createElement("div");
    content.className = "product__content";

    var h4 = document.createElement("h4");
    h4.className = "mb-15";
    h4.textContent = p.name;
    content.appendChild(h4);

    var priceEl = document.createElement("span");
    priceEl.className = "primary-color";
    priceEl.textContent = price;
    content.appendChild(priceEl);

    if (opts.showCategory) {
      var category = document.createElement("p");
      category.className = "mt-15 mb-0";
      category.textContent = p.category || "";
      content.appendChild(category);
    }

    card.appendChild(content);

    var cta = document.createElement("a");
    cta.href = link;
    cta.className = "product__tap-cta stretched-link bor-top";
    cta.setAttribute("data-add-to-cart", "");
    cta.setAttribute("aria-label", "Add " + p.name + " to cart, " + price);
    cta.dataset.id = p.id;
    cta.dataset.slug = p.slug;
    cta.dataset.name = p.name;
    cta.dataset.price = (p.priceCents / 100).toFixed(2);
    cta.dataset.img = p.imageUrl || "";
    cta.innerHTML =
      '<span class="product__tap-cta-default"><i class="fa-regular fa-cart-shopping me-2" aria-hidden="true"></i>Add to Cart</span>' +
      '<span class="product__tap-cta-added" aria-hidden="true"><i class="fa-solid fa-check me-2"></i>Added &mdash; opening cart</span>';
    card.appendChild(cta);

    col.appendChild(card);
    return col;
  }

  function renderInto(container, products, opts) {
    if (!container) return;
    container.innerHTML = "";
    products.forEach(function (p) {
      container.appendChild(build(p, opts));
    });
  }

  return { build: build, renderInto: renderInto };
})();
