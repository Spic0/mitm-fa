// Populates the header mega menus that need real product/taxonomy data:
//   Shop by Goal    -> "Top Picks" product cards (featured products)
//   Browse Athletes -> per-sport columns are fully server-rendered directly
//                      from the Athletes taxonomy (see server/src/index.js
//                      -> navSportColumnsHtml) — nothing to do here.
//   Browse Creators -> featured creator cards + a searchable Popular / A-Z
//                      creator directory, built from the Creators taxonomy
//                      tree's leaf nodes, not from scanning product.creator
//                      strings — a creator appears here as soon as they
//                      exist as a real, admin-managed taxonomy item,
//                      whether or not a product has been tagged to them yet.
document.addEventListener("DOMContentLoaded", function () {
  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  var topPicksEl = document.querySelector('[data-role="top-picks-cards"]');
  var featuredCreatorsEl = document.querySelector('[data-role="featured-creator-cards"]');
  var creatorListEl = document.querySelector('[data-role="creator-list"]');
  var creatorSearchEl = document.querySelector('[data-role="creator-search"]');
  var creatorHeadingEl = document.querySelector('[data-role="creator-list-heading"]');
  var creatorAzToggle = document.querySelector('[data-role="creator-az-toggle"]');
  var hasNav = topPicksEl || featuredCreatorsEl || creatorListEl;
  if (!hasNav || !window.ProFitAPI) return;

  function shopLink(params) {
    var qs = Object.keys(params).map(function (k) {
      return k + "=" + encodeURIComponent(params[k]);
    }).join("&");
    return "shop.html" + (qs ? "?" + qs : "");
  }

  function initials(name) {
    return name.split(/\s+/).filter(Boolean).slice(0, 2).map(function (w) {
      return w.charAt(0).toUpperCase();
    }).join("");
  }

  // Product card (Top Picks / Featured Creators) — image thumb + name + meta.
  function productCard(p, metaText) {
    var a = document.createElement("a");
    a.className = "mega-menu-card";
    a.href = "shop-single.html?slug=" + encodeURIComponent(p.slug);

    var img = document.createElement("img");
    img.className = "mega-menu-card__thumb";
    img.src = p.imageUrl || "";
    img.alt = "";

    var body = document.createElement("span");
    body.className = "mega-menu-card__body";

    var name = document.createElement("span");
    name.className = "mega-menu-card__name";
    name.textContent = metaText.name;

    var meta = document.createElement("span");
    meta.className = "mega-menu-card__meta";
    meta.innerHTML = metaText.meta;

    body.appendChild(name);
    body.appendChild(meta);
    a.appendChild(img);
    a.appendChild(body);
    return a;
  }

  // Person row (creators) — initials avatar + name (+ optional meta). Links
  // by the taxonomy leaf's slug, not its display name, so renaming a
  // creator in Admin never breaks this link.
  function personItem(node) {
    var li = document.createElement("li");
    var a = document.createElement("a");
    a.href = shopLink({ creator: node.slug });

    var avatar = document.createElement("span");
    avatar.className = "mega-menu__avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = initials(node.name);

    var label = document.createElement("span");
    label.className = "mega-menu__person-name";
    label.textContent = node.name;

    a.appendChild(avatar);
    a.appendChild(label);
    if (node.productCount) {
      var metaEl = document.createElement("span");
      metaEl.className = "mega-menu__person-meta";
      metaEl.textContent = node.productCount + (node.productCount === 1 ? " plan" : " plans");
      a.appendChild(metaEl);
    }
    li.appendChild(a);
    return li;
  }

  Promise.all([
    window.ProFitAPI.listProducts(),
    window.ProFitAPI.getTaxonomy(),
  ]).then(function (results) {
    var products = results[0].products || [];
    var taxonomies = results[1].taxonomies || [];
    var featured = products.filter(function (p) { return p.featured; });
    var creatorsTaxonomy = taxonomies.find(function (t) { return t.key === "creators"; });

    // ---- Shop by Goal: Top Picks ----
    if (topPicksEl && products.length) {
      topPicksEl.innerHTML = "";
      featured.slice(0, 3).forEach(function (p) {
        topPicksEl.appendChild(productCard(p, {
          name: p.name,
          meta: '<span class="mega-menu-card__price">' + window.ProFitAPI.formatPrice(p.priceCents) + "</span>",
        }));
      });
    }

    // ---- Browse Creators: featured cards (still product-driven — these
    // need a real image/price/slug, which only a product carries) ----
    if (featuredCreatorsEl && products.length) {
      featuredCreatorsEl.innerHTML = "";
      featured.slice(0, 4).forEach(function (p) {
        if (!p.creator) return;
        featuredCreatorsEl.appendChild(productCard(p, {
          name: p.creator,
          meta: escapeHtml(p.name) + " · <span class=\"mega-menu-card__price\">" + window.ProFitAPI.formatPrice(p.priceCents) + "</span>",
        }));
      });
    }

    // ---- Browse Creators: Popular / A-Z directory, from the taxonomy —
    // every creator shows up as soon as they exist in the CMS, whether or
    // not a product is tagged to them yet. ----
    if (creatorListEl && creatorsTaxonomy) {
      var allCreators = [];
      creatorsTaxonomy.nodes.forEach(function (category) {
        category.children.forEach(function (leaf) { allCreators.push(leaf); });
      });
      allCreators.sort(function (a, b) { return a.name.localeCompare(b.name); });
      var popular = allCreators.slice().sort(function (a, b) {
        return b.productCount - a.productCount || a.name.localeCompare(b.name);
      }).slice(0, 6);

      var showAll = false;

      function renderCreatorList() {
        var term = creatorSearchEl ? creatorSearchEl.value.trim().toLowerCase() : "";
        var nodes, heading;
        if (term) {
          nodes = allCreators.filter(function (n) { return n.name.toLowerCase().indexOf(term) !== -1; });
          heading = "Results";
        } else if (showAll) {
          nodes = allCreators;
          heading = "All Creators A–Z";
        } else {
          nodes = popular;
          heading = "Popular Creators";
        }

        if (creatorHeadingEl) creatorHeadingEl.textContent = heading;
        creatorListEl.innerHTML = "";
        if (!nodes.length) {
          var empty = document.createElement("li");
          empty.className = "mega-menu__empty";
          empty.textContent = "No creators found";
          creatorListEl.appendChild(empty);
          return;
        }
        nodes.forEach(function (node) { creatorListEl.appendChild(personItem(node)); });
      }

      renderCreatorList();

      if (creatorSearchEl) {
        creatorSearchEl.addEventListener("input", renderCreatorList);
        creatorSearchEl.addEventListener("keydown", function (e) {
          if (e.key !== "Enter") return;
          e.preventDefault();
          var term = creatorSearchEl.value.trim();
          if (term) window.location.href = shopLink({ search: term });
        });
      }

      if (creatorAzToggle) {
        creatorAzToggle.addEventListener("click", function () {
          showAll = !showAll;
          creatorAzToggle.setAttribute("aria-pressed", String(showAll));
          creatorAzToggle.firstChild.textContent = showAll ? "Show Popular " : "Browse All A–Z ";
          if (creatorSearchEl) creatorSearchEl.value = "";
          renderCreatorList();
        });
      }
    }
  }).catch(function () {
    // Leave the dynamic sections empty rather than showing broken cards —
    // every panel still has its static View All links.
  });
});
