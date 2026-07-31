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

    // The media container owns the card's shape. It is a fixed-ratio box, so
    // nothing an admin uploads — a 1920x480 banner, a 32x32 icon, a phone
    // screenshot — can change this card's height or break the row it sits in.
    // See assets/css/media-container.css and assets/js/media-container.js.
    var imageWrap = document.createElement("div");
    // The --pmedia marker is what lets media-container.css drop the legacy
    // `max-width:280px; margin:0 auto` on this wrapper without affecting any
    // other .product__image on the site. See the note in that file for why
    // the auto margin actively breaks the container.
    imageWrap.className = "product__image product__image--pmedia pt-20 d-block";
    imageWrap.appendChild(
      window.MediaContainer.build(p, {
        // The first row is above the fold and holds the LCP element on every
        // grid on the site; lazy-loading it would delay the largest paint
        // rather than help. Callers pass `eagerCount` for their layout.
        eager: opts.eager || (typeof opts.index === "number" && opts.index < (opts.eagerCount || 0)),
        sizes: opts.sizes,
      })
    );
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

  // Placeholder cards drawn immediately, before the product API has answered.
  //
  // Products are fetched client-side, so every grid on the site was empty at
  // first paint and then suddenly filled — pushing everything below it down
  // and producing the bulk of the page's layout shift. These reserve the exact
  // same geometry the real cards will occupy (same column wrapper, same
  // fixed-ratio media box, same content block), so the swap is like for like
  // and the page below never moves.
  //
  // aria-hidden + no text: this is scaffolding, not content, and a screen
  // reader announcing eight empty cards would be worse than announcing
  // nothing.
  function renderSkeleton(container, count, opts) {
    if (!container) return;
    opts = opts || {};
    container.innerHTML = "";
    for (var i = 0; i < (count || 8); i++) {
      var col = document.createElement("div");
      col.className = opts.colClass || "col-xl-4 col-lg-6 col-md-6";
      col.setAttribute("aria-hidden", "true");

      var card = document.createElement("div");
      card.className = (opts.cardClass || "product__item") + " product__item--skeleton bor";

      var wrap = document.createElement("div");
      wrap.className = "product__image product__image--pmedia pt-20 d-block";
      var box = document.createElement("div");
      box.className = "pmedia pmedia--skeleton";
      wrap.appendChild(box);
      card.appendChild(wrap);

      var content = document.createElement("div");
      content.className = "product__content";
      var titleBar = document.createElement("div");
      titleBar.className = "skel-line skel-line--title";
      var priceBar = document.createElement("div");
      priceBar.className = "skel-line skel-line--price";
      content.appendChild(titleBar);
      content.appendChild(priceBar);
      card.appendChild(content);

      var cta = document.createElement("div");
      cta.className = "product__tap-cta bor-top skel-cta";
      card.appendChild(cta);

      col.appendChild(card);
      container.appendChild(col);
    }
  }

  function renderInto(container, products, opts) {
    if (!container) return;
    opts = opts || {};
    container.innerHTML = "";
    // Default: the first row loads eagerly (that is where LCP lives),
    // everything below the fold lazy-loads. Callers can override per grid.
    var eagerCount = typeof opts.eagerCount === "number" ? opts.eagerCount : 3;
    products.forEach(function (p, i) {
      var perCard = Object.assign({}, opts, { index: i, eagerCount: eagerCount });
      container.appendChild(build(p, perCard));
    });
  }

  return { build: build, renderInto: renderInto, renderSkeleton: renderSkeleton };
})();
