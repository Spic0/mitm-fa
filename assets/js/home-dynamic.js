// Homepage-only dynamic sections: a slim scrolling product-title marquee
// directly under the hero, the "Shop by Athlete & Creator" card strip below
// it, and a "deal cards" product strip. All driven entirely by real backend
// data (GET /api/taxonomy, GET /api/products) — nothing here is hardcoded
// HTML, so an athlete/creator/product added, renamed, or removed in the
// admin panel shows up on the very next page load with no template changes.
document.addEventListener("DOMContentLoaded", function () {
  if (!window.ProFitAPI) return;

  var peopleTrack = document.getElementById("peopleStripTrack");
  var peopleSection = peopleTrack ? peopleTrack.closest(".people-strip-area") : null;
  var dealTrack = document.getElementById("dealCardsTrack");
  var dealSection = dealTrack ? dealTrack.closest(".deal-cards-area") : null;
  var marqueeList = document.getElementById("peopleMarqueeList");
  var marqueeWrapper = marqueeList ? marqueeList.closest(".people-marquee") : null;
  var heroPrice = document.getElementById("heroStartingPrice");
  if (!peopleTrack && !dealTrack && !marqueeList && !heroPrice) return;

  // ---- Hero "starting price": real lowest current product price, not the
  // hardcoded (and inaccurate) "$99.00" the old hero used. Left empty
  // (:empty CSS hides it) if the catalog can't be loaded rather than
  // showing a stale/fake number. ----
  function renderHeroPrice(products) {
    if (!heroPrice || !products.length) return;
    var min = products.reduce(function (m, p) { return Math.min(m, p.priceCents); }, products[0].priceCents);
    heroPrice.textContent = "Plans from " + window.ProFitAPI.formatPrice(min);
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) {
      return w.charAt(0).toUpperCase();
    }).join("");
  }

  // ---- People strip: flatten Athletes + Creators taxonomy leaves into one
  // list of real people, each linking to the same shop.html filter the
  // header mega-menu already uses for that person (server/src/index.js's
  // navSportColumnsHtml for athletes; assets/js/nav-featured.js's
  // shopLink({creator}) convention for creators). ----
  function buildPeopleList(taxonomies) {
    var people = [];
    var athletes = taxonomies.find(function (t) { return t.key === "athletes"; });
    if (athletes) {
      athletes.nodes.forEach(function (sport) {
        sport.children.forEach(function (athlete) {
          people.push({
            name: athlete.name,
            kind: "Athlete",
            productCount: athlete.productCount || 0,
            href: "/athlete/" + encodeURIComponent(athlete.slug),
          });
        });
      });
    }
    var creators = taxonomies.find(function (t) { return t.key === "creators"; });
    if (creators) {
      creators.nodes.forEach(function (category) {
        category.children.forEach(function (creator) {
          people.push({
            name: creator.name,
            kind: "Creator",
            productCount: creator.productCount || 0,
            href: "/creator/" + encodeURIComponent(creator.slug),
          });
        });
      });
    }
    // Surface people with real products first, but keep everyone — a
    // freshly-added athlete/creator with 0 products yet must still appear.
    people.sort(function (a, b) { return b.productCount - a.productCount || a.name.localeCompare(b.name); });
    return people;
  }

  function personChip(person) {
    var a = document.createElement("a");
    a.className = "people-chip";
    a.href = person.href;

    var avatar = document.createElement("span");
    avatar.className = "people-chip__avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = initials(person.name);
    a.appendChild(avatar);

    var body = document.createElement("span");
    body.className = "people-chip__body";
    var name = document.createElement("span");
    name.className = "people-chip__name";
    name.textContent = person.name;
    var kind = document.createElement("span");
    kind.className = "people-chip__kind";
    kind.textContent = person.kind;
    body.appendChild(name);
    body.appendChild(kind);
    a.appendChild(body);

    return a;
  }

  function renderPeopleStrip(taxonomies) {
    if (!peopleTrack) return;
    var people = buildPeopleList(taxonomies);
    if (!people.length) {
      if (peopleSection) peopleSection.style.display = "none";
      return;
    }
    peopleTrack.innerHTML = "";
    people.forEach(function (p) { peopleTrack.appendChild(personChip(p)); });
  }

  // ---- Product marquee: real admin-managed product titles, rendered as a
  // continuously-scrolling ticker directly under the hero — plain title
  // only (no category/creator/athlete labels or icons) so it reinforces
  // product discovery without competing visually with the hero above it.
  // The theme's marquee CSS (.marquee-inner.to-left, @keyframes
  // marqueeLeft in style.css) loops by scrolling exactly one copy-width to
  // the left, so the list is rendered twice back-to-back for a seamless
  // wrap. ----
  function marqueeItem(product) {
    var li = document.createElement("li");
    li.className = "marquee-item";

    var a = document.createElement("a");
    a.href = "/program/" + encodeURIComponent(product.slug);
    a.textContent = product.name;
    li.appendChild(a);

    return li;
  }

  function renderProductMarquee(products) {
    if (!marqueeList) return;
    if (!products.length) {
      if (marqueeWrapper) marqueeWrapper.style.display = "none";
      return;
    }
    marqueeList.innerHTML = "";
    // Twice, back-to-back, so the -100% scroll loops seamlessly.
    products.concat(products).forEach(function (p) { marqueeList.appendChild(marqueeItem(p)); });
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
    window.MediaContainer.applyResponsive(img, p, "(min-width: 768px) 320px, 82vw");
    img.alt = p.name;
    img.loading = "lazy";
    imageWrap.appendChild(img);
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
    dealTrack.innerHTML = "";
    picks.forEach(function (p) { dealTrack.appendChild(dealCard(p)); });
  }

  Promise.all([
    peopleTrack ? window.ProFitAPI.getTaxonomy() : Promise.resolve({ taxonomies: [] }),
    dealTrack || heroPrice || marqueeList ? window.ProFitAPI.listProducts() : Promise.resolve({ products: [] }),
  ]).then(function (results) {
    var taxonomies = results[0].taxonomies || [];
    var products = results[1].products || [];
    renderProductMarquee(products);
    renderPeopleStrip(taxonomies);
    renderDealCards(products);
    renderHeroPrice(products);
  }).catch(function () {
    // Real data failed to load — hide every dynamic section rather than
    // showing stale/fake placeholders.
    if (marqueeWrapper) marqueeWrapper.style.display = "none";
    if (peopleSection) peopleSection.style.display = "none";
    if (dealSection) dealSection.style.display = "none";
  });
});
