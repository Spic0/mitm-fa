// The shop page's context engine. One architecture serves four browsing
// experiences — by goal, by sport/athlete, by creator, and the plain "all
// plans" catalog — and every piece of the page follows the resolved
// context: banner (H1 / subtitle / breadcrumb), document title + meta
// description, the filter bar, and the product grid.
//
// Filtering is entirely taxonomy-ID based: each product carries
// `taxonomyNodeIds` (its ProductTaxonomy assignments, from GET /api/products)
// and each URL param (?goal=/?sport=/?athlete=/?creator=) resolves against
// the live taxonomy tree (GET /api/taxonomy — the same data Admin ->
// Navigation and the product wizard read/write) to a node, then to the set
// of node ids a product must intersect to match. There is no more free-text
// category/tag matching — a product renamed or reorganized in the CMS is
// reflected here on the very next load, because both this page and the CMS
// read the same database tables.
//
// URLs are the single state: every filter chip is a real crawlable <a href>,
// clicks are intercepted into history.pushState + an in-place re-render, and
// popstate replays the same render path, so back/forward, deep links, and ad
// landing URLs all go through one render function.
document.addEventListener("DOMContentLoaded", function () {
  var grid = document.getElementById("shopProductGrid");
  if (!grid || !window.ProFitAPI || !window.ProductCard) return;

  var countEl = document.getElementById("shopResultsCount");
  var filterList = document.getElementById("shopCategoryFilter");
  var filterLabel = document.getElementById("shopFilterLabel");
  var sortSelect = document.getElementById("shortList");
  var searchInput = document.getElementById("shopSearchInput");
  var headingEl = document.querySelector("[data-shop-heading]");
  var subEl = document.querySelector("[data-shop-sub]");
  var crumbEl = document.querySelector("[data-shop-crumb]");

  var allProducts = [];
  var taxonomies = { goals: { nodes: [] }, athletes: { nodes: [] }, creators: { nodes: [] } };

  var DEFAULTS = {
    heading: "All Plans & Programs",
    sub: "Training and nutrition plans from elite athletes and coaches.",
    crumb: "All Plans",
  };

  function getParams() {
    return new URLSearchParams(window.location.search);
  }

  // Context now lives in the path (/goal/:slug, /sport/:slug, /athlete/:slug,
  // /creator/:slug) instead of a query param — search/sort/featured stay
  // query params on whichever of those paths (or plain /shop) is current.
  function getPathContext() {
    var m = window.location.pathname.match(/^\/(goal|sport|athlete|creator)\/([^/]+)\/?$/);
    return m ? { type: m[1], slug: decodeURIComponent(m[2]) } : null;
  }

  // ---- Taxonomy tree helpers: resolve a URL slug to a node, anywhere in
  // the tree, and collect a node + all its descendant ids for "this
  // category and everything under it" matching (e.g. /sport/football must
  // also match products tagged directly to an athlete under Football). ----
  function findNode(nodes, slug) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].slug === slug) return nodes[i];
      var found = findNode(nodes[i].children || [], slug);
      if (found) return found;
    }
    return null;
  }
  // Same walk as findNode, but also returns the node's direct parent — the
  // flat /athlete/:slug route carries no sport segment in the URL, so the
  // "All <Sport>" chip still needs a way to find which sport an athlete
  // belongs to.
  function findNodeWithParent(nodes, slug, parent) {
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].slug === slug) return { node: nodes[i], parent: parent };
      var found = findNodeWithParent(nodes[i].children || [], slug, nodes[i]);
      if (found) return found;
    }
    return null;
  }
  function collectIds(node) {
    var ids = [node.id];
    (node.children || []).forEach(function (c) { ids = ids.concat(collectIds(c)); });
    return ids;
  }
  // ---- Context resolution: URL -> { type, key, label, matchIds, ... } ----
  function resolveContext(params) {
    var pathCtx = getPathContext();

    if (pathCtx && pathCtx.type === "goal") {
      var goalNode = findNode(taxonomies.goals.nodes, pathCtx.slug);
      if (goalNode) {
        return {
          type: "goal", key: goalNode.slug, label: goalNode.name,
          heading: goalNode.name, sub: "Training and nutrition plans for " + goalNode.name.toLowerCase() + ".",
          crumb: "Shop by Goal · " + goalNode.name, title: goalNode.name + " Plans",
          matchIds: [goalNode.id],
        };
      }
    }
    if (pathCtx && pathCtx.type === "athlete") {
      var athleteMatch = findNodeWithParent(taxonomies.athletes.nodes, pathCtx.slug, null);
      if (athleteMatch) {
        return {
          type: "athlete", key: athleteMatch.node.slug, label: athleteMatch.node.name,
          sportSlug: athleteMatch.parent ? athleteMatch.parent.slug : null,
          heading: athleteMatch.node.name, sub: "Programs built and used by " + athleteMatch.node.name + ".",
          crumb: "Browse Athletes · " + athleteMatch.node.name, title: athleteMatch.node.name + " Training Plans",
          matchIds: [athleteMatch.node.id],
        };
      }
    }
    if (pathCtx && pathCtx.type === "sport") {
      var sportNode = findNode(taxonomies.athletes.nodes, pathCtx.slug);
      if (sportNode) {
        return {
          type: "sport", key: sportNode.slug, label: sportNode.name, node: sportNode,
          heading: sportNode.name + " Training", sub: "Training plans built and used by " + sportNode.name.toLowerCase() + " athletes.",
          crumb: "Sports · " + sportNode.name, title: sportNode.name + " Training Programs",
          matchIds: collectIds(sportNode),
        };
      }
    }
    if (pathCtx && pathCtx.type === "creator") {
      var creatorNode = findNode(taxonomies.creators.nodes, pathCtx.slug);
      if (creatorNode) {
        return {
          type: "creator", key: creatorNode.slug, label: creatorNode.name,
          heading: creatorNode.name, sub: "Programs built and used by " + creatorNode.name + ".",
          crumb: "Creators · " + creatorNode.name, title: creatorNode.name + " Training Plans",
          matchIds: [creatorNode.id],
        };
      }
    }
    var featured = params.get("featured") === "true";
    return {
      type: "all", key: "", label: featured ? "Bestsellers" : "All Plans",
      heading: featured ? "Bestsellers" : DEFAULTS.heading,
      sub: DEFAULTS.sub, crumb: featured ? "Bestsellers" : DEFAULTS.crumb,
      title: featured ? "Bestseller Plans" : null,
      matchIds: null, // no taxonomy constraint — every published product matches
    };
  }

  function matchesContext(p, ctx) {
    if (!ctx.matchIds) return true;
    var ids = p.taxonomyNodeIds || [];
    return ctx.matchIds.some(function (id) { return ids.indexOf(id) !== -1; });
  }

  // ---- Banner + document metadata follow the context ----
  function renderBanner(ctx) {
    if (headingEl) headingEl.textContent = ctx.heading;
    if (subEl) subEl.textContent = ctx.sub;
    if (crumbEl) crumbEl.textContent = ctx.crumb;

    var brand = (document.querySelector("[data-brand-name]") || {}).textContent || "Fitness Agency";
    if (ctx.title) document.title = ctx.title + " | " + brand;
    var meta = document.querySelector("meta[data-shop-meta]");
    if (meta && ctx.sub) meta.setAttribute("content", ctx.sub);
  }

  // ---- One filter bar, contents scoped to the context — every chip is a
  // real taxonomy node straight from the same tree Admin -> Navigation
  // manages, so a category/subcategory created or renamed there shows up
  // here immediately, whether or not a product has been tagged to it yet
  // (an empty chip just leads to an empty grid, not a broken page). ----
  function chipItems(ctx) {
    var all = { label: "All Plans", href: "/shop", active: ctx.type === "all" && !ctx.key };

    if (ctx.type === "goal" || ctx.type === "all") {
      var goalItems = taxonomies.goals.nodes.map(function (n) {
        return { label: n.name, href: "/goal/" + encodeURIComponent(n.slug), active: ctx.type === "goal" && ctx.key === n.slug };
      });
      return { label: "Training goals", items: [all].concat(goalItems) };
    }

    if (ctx.type === "sport" || ctx.type === "athlete") {
      var sportNode = ctx.type === "sport" ? ctx.node : findNode(taxonomies.athletes.nodes, ctx.sportSlug || "");
      var items = [{
        label: sportNode ? "All " + sportNode.name : "All Athletes",
        href: sportNode ? "/sport/" + encodeURIComponent(sportNode.slug) : "/shop",
        active: ctx.type === "sport",
      }];
      if (sportNode) {
        sportNode.children.forEach(function (c) {
          items.push({
            label: c.name,
            href: "/athlete/" + encodeURIComponent(c.slug),
            active: ctx.type === "athlete" && ctx.key === c.slug,
          });
        });
      }
      return { label: "Athletes", items: items };
    }

    if (ctx.type === "creator") {
      var leaves = [];
      taxonomies.creators.nodes.forEach(function (cat) {
        cat.children.forEach(function (leaf) { leaves.push(leaf); });
      });
      leaves.sort(function (a, b) { return a.name.localeCompare(b.name); });
      var creatorItems = leaves.map(function (n) {
        return { label: n.name, href: "/creator/" + encodeURIComponent(n.slug), active: ctx.key === n.slug };
      });
      return { label: "Creators", items: [all].concat(creatorItems) };
    }

    return { label: "Browse", items: [all] };
  }

  function renderFilterBar(ctx) {
    if (!filterList) return;
    var bar = chipItems(ctx);
    if (filterLabel) filterLabel.textContent = bar.label;

    filterList.innerHTML = "";
    bar.items.forEach(function (item) {
      var li = document.createElement("li");
      var a = document.createElement("a");
      a.href = item.href;
      a.textContent = item.label;
      if (item.active) {
        a.className = "active";
        a.setAttribute("aria-current", "page");
      }
      a.addEventListener("click", function (e) {
        e.preventDefault();
        history.pushState(null, "", item.href);
        if (searchInput) searchInput.value = "";
        renderAll();
      });
      li.appendChild(a);
      filterList.appendChild(li);
    });
  }

  // ---- Grid: context match first, then in-context refinements ----
  function sortProducts(products, params) {
    var sorted = products.slice();
    var mode = sortSelect && sortSelect.value !== "default" ? sortSelect.value : (params.get("sort") || "");
    if (mode === "name-asc") sorted.sort(function (a, b) { return a.name.localeCompare(b.name); });
    else if (mode === "price-asc") sorted.sort(function (a, b) { return a.priceCents - b.priceCents; });
    else if (mode === "price-desc") sorted.sort(function (a, b) { return b.priceCents - a.priceCents; });
    else if (mode === "new") sorted.sort(function (a, b) { return new Date(b.createdAt) - new Date(a.createdAt); });
    return sorted;
  }

  function renderGrid(ctx, params) {
    var featured = params.get("featured") === "true";
    var searchTerm = (searchInput ? searchInput.value : "").trim().toLowerCase();

    var filtered = allProducts.filter(function (p) {
      if (!matchesContext(p, ctx)) return false;
      if (featured && p.featured !== true) return false;
      if (searchTerm &&
        p.name.toLowerCase().indexOf(searchTerm) === -1 &&
        (p.creator || "").toLowerCase().indexOf(searchTerm) === -1) return false;
      return true;
    });

    var sorted = sortProducts(filtered, params);
    window.ProductCard.renderInto(grid, sorted, {
      showCategory: false,
      colClass: "col-xl-3 col-lg-4 col-md-6",
    });

    if (countEl) {
      countEl.textContent = sorted.length
        ? "Showing " + sorted.length + " of " + allProducts.length + " plans · " + ctx.label
        : "No " + ctx.label + " plans match your search";
    }
  }

  // ---- The one render path: URL -> context -> page ----
  function renderAll() {
    var params = getParams();
    var ctx = resolveContext(params);
    renderBanner(ctx);
    renderFilterBar(ctx);
    renderGrid(ctx, params);
  }

  if (sortSelect) sortSelect.addEventListener("change", renderAll);
  if (searchInput) {
    var initialSearch = (getParams().get("search") || "").trim();
    if (initialSearch) searchInput.value = initialSearch;
    searchInput.addEventListener("input", function () {
      var params = getParams();
      var term = searchInput.value.trim();
      if (term) params.set("search", term); else params.delete("search");
      history.replaceState(null, "", window.location.pathname + (params.toString() ? "?" + params.toString() : ""));
      renderAll();
    });
  }
  window.addEventListener("popstate", function () {
    if (searchInput) searchInput.value = (getParams().get("search") || "").trim();
    renderAll();
  });

  Promise.all([
    window.ProFitAPI.getTaxonomy().catch(function () { return { taxonomies: [] }; }),
    window.ProFitAPI.listProducts(),
  ]).then(function (results) {
    var trees = results[0].taxonomies || [];
    taxonomies = {
      goals: trees.find(function (t) { return t.key === "goals"; }) || { nodes: [] },
      athletes: trees.find(function (t) { return t.key === "athletes"; }) || { nodes: [] },
      creators: trees.find(function (t) { return t.key === "creators"; }) || { nodes: [] },
    };
    allProducts = results[1].products;
    renderAll();
  }).catch(function () {
    if (countEl) countEl.textContent = "Unable to load plans right now.";
  });
});
