// The shop page's context engine. ONE architecture serves every browsing
// experience there is or ever will be — and every piece of the page follows
// the resolved context: banner (H1 / subtitle / breadcrumb), document title
// + meta description, the filter bar, and the product grid.
//
// Nothing here names a taxonomy. The four paths this used to hardcode
// (/goal/, /sport/, /athlete/, /creator/) are values in Taxonomy.nodeRoute
// and Taxonomy.groupRoute, which arrive with the tree from GET /api/taxonomy
// — the same columns server/src/routes/pages.js resolves the URL with and
// server/src/lib/navigation.js builds the header menu from. A category an
// admin creates tomorrow gets its listing page from this file for free,
// exactly as it gets its menu panel for free.
//
// Filtering is entirely taxonomy-ID based: each product carries
// `taxonomyNodeIds` (its ProductTaxonomy assignments, from GET /api/products)
// and the URL resolves against the live taxonomy tree to a node, then to the
// set of node ids a product must intersect to match. There is no free-text
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
  var trees = []; // every taxonomy, in nav order, exactly as the CMS has it

  var DEFAULTS = {
    heading: "All Plans & Programs",
    sub: "Training and nutrition plans from elite athletes and coaches.",
    crumb: "All Plans",
  };

  function getParams() {
    return new URLSearchParams(window.location.search);
  }

  // Context lives in the path — /<segment>/<slug>, plus /shop/<taxonomy key>
  // for a whole category — instead of a query param. search/sort/featured
  // stay query params on whichever path is current.
  function getPathContext() {
    var m = window.location.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
    if (!m) return null;
    return { segment: decodeURIComponent(m[1]), slug: decodeURIComponent(m[2]) };
  }

  // Which taxonomy owns a URL segment, and whether the segment addresses
  // branches or leaves. One lookup over one namespace, mirroring
  // resolveSegment() in server/src/routes/pages.js.
  function resolveSegment(segment) {
    for (var i = 0; i < trees.length; i++) {
      if (trees[i].nodeRoute === segment) return { tree: trees[i], kind: "item" };
      if (trees[i].groupRoute && trees[i].groupRoute === segment) return { tree: trees[i], kind: "group" };
    }
    return null;
  }

  function treeByKey(key) {
    for (var i = 0; i < trees.length; i++) if (trees[i].key === key) return trees[i];
    return null;
  }

  // The one description rule, keyed off the taxonomy's own layout rather than
  // its name. Kept identical to describeNode() in
  // server/src/routes/pages.js: the server renders this into the banner and
  // the meta description for SEO, and this file re-renders the same banner on
  // an in-page filter click. The two must never disagree.
  function describeNode(tree, node, isGroup) {
    if (tree.navLayout === "people") {
      return isGroup
        ? "Training and nutrition plans across " + node.name + "."
        : "Programs built and used by " + node.name + ".";
    }
    return "Training and nutrition plans built around " + node.name.toLowerCase() + ".";
  }

  // See labelNoun() in server/src/routes/pages.js — the noun inside a nav
  // label, so a category reads correctly inside a sentence.
  function labelNoun(label) {
    return String(label).replace(/^(shop by|browse|shop|explore|discover|all)\s+/i, "") || label;
  }

  // ---- Taxonomy tree helpers: resolve a URL slug to a node, anywhere in
  // the tree, and collect a node + all its descendant ids for "this
  // category and everything under it" matching (e.g. /sport/football must
  // also match products tagged directly to an athlete under Football). ----
  // The walk returns the node's direct PARENT alongside it: a leaf URL
  // (/athlete/marcus-reyes) carries no branch segment, so the "All <Branch>" chip
  // still needs a way to find which sport an athlete belongs to.
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
  function collectTreeIds(tree) {
    var ids = [];
    (tree.nodes || []).forEach(function (n) { ids = ids.concat(collectIds(n)); });
    return ids;
  }
  // ---- Context resolution: URL -> { type, key, label, matchIds, ... } ----
  function resolveContext(params) {
    var pathCtx = getPathContext();

    if (pathCtx) {
      // /shop/<taxonomy key> — the landing page for a whole category, and
      // where every mega-menu panel's single "View all" points.
      if (pathCtx.segment === "shop") {
        var tree = treeByKey(pathCtx.slug);
        if (tree) {
          return {
            type: "taxonomy", key: tree.key, label: tree.label, tree: tree,
            heading: tree.label,
            sub: "Every training and nutrition plan on Fitness Agency, organized by " + labelNoun(tree.label).toLowerCase() + ".",
            crumb: tree.label, title: tree.label,
            matchIds: collectTreeIds(tree),
          };
        }
      }

      var resolved = resolveSegment(pathCtx.segment);
      if (resolved) {
        var match = findNodeWithParent(resolved.tree.nodes, pathCtx.slug, null);
        var isGroup = resolved.kind === "group";
        // A leaf segment must not also resolve a branch, and vice versa —
        // the server enforces the same split, so a URL that means nothing
        // there must not quietly render something here.
        if (match && isGroup !== !!(match.node.children && match.node.children.length)) match = null;
        if (match) {
          return {
            type: isGroup ? "group" : "item",
            key: match.node.slug,
            label: match.node.name,
            tree: resolved.tree,
            node: match.node,
            parent: match.parent,
            heading: match.node.name,
            sub: describeNode(resolved.tree, match.node, isGroup),
            crumb: resolved.tree.label + " · " + match.node.name,
            title: match.node.name + " Training Plans",
            // A branch matches itself AND everything under it: /sport/football
            // has to include plans tagged directly to an athlete in Football.
            // A leaf matches only itself.
            matchIds: isGroup ? collectIds(match.node) : [match.node.id],
          };
        }
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
  // (an empty chip just leads to an empty grid, not a broken page).
  //
  // Which chips to show is decided by the SHAPE of the taxonomy, not by its
  // name: inside a branch you get its siblings' children (the athletes in
  // this sport), and inside a flat taxonomy you get its whole index. That is
  // the same rule for a category that does not exist yet. ----
  function itemHref(tree, node) {
    return "/" + encodeURIComponent(tree.nodeRoute) + "/" + encodeURIComponent(node.slug);
  }
  function groupHref(tree, node) {
    return tree.groupRoute ? "/" + encodeURIComponent(tree.groupRoute) + "/" + encodeURIComponent(node.slug) : null;
  }
  function leavesOf(nodes, out) {
    nodes.forEach(function (n) {
      if (n.children && n.children.length) leavesOf(n.children, out);
      else out.push(n);
    });
    return out;
  }

  function chipItems(ctx) {
    var all = { label: "All Plans", href: "/shop", active: ctx.type === "all" && !ctx.key };
    if (ctx.type === "all") return { label: "Browse", items: [all] };

    var tree = ctx.tree;
    if (!tree) return { label: "Browse", items: [all] };
    // The whole-category chip carries the category's own name, exactly as an
    // admin wrote it. Prefixing "All " onto a de-verbed label produced "All
    // Goal"; the label already reads as an instruction ("Shop by Goal") and
    // is the one string guaranteed to be correct.
    var top = { label: tree.label, href: tree.route, active: ctx.type === "taxonomy" };

    // Inside a branch (or a leaf that has one): the branch and its children,
    // which is the refinement a customer actually wants — "other athletes in
    // this sport", not "every athlete on the site".
    var branch = ctx.type === "group" ? ctx.node : ctx.parent;
    if (branch && groupHref(tree, branch)) {
      var items = [{
        label: "All " + branch.name,
        href: groupHref(tree, branch),
        active: ctx.type === "group",
      }];
      (branch.children || []).forEach(function (c) {
        items.push({ label: c.name, href: itemHref(tree, c), active: ctx.type === "item" && ctx.key === c.slug });
      });
      return { label: tree.label, items: items };
    }

    // Otherwise the taxonomy's own index: its leaves, alphabetical for a
    // nested tree (a creator directory), its authored order for a flat one
    // (the goals are ordered deliberately in the CMS).
    var nodes;
    if (tree.hasSubcategories) {
      nodes = leavesOf(tree.nodes, []).sort(function (a, b) { return a.name.localeCompare(b.name); });
    } else {
      nodes = tree.nodes.slice();
    }
    var chips = nodes.map(function (n) {
      return { label: n.name, href: itemHref(tree, n), active: ctx.type === "item" && ctx.key === n.slug };
    });
    return { label: tree.label, items: [top].concat(chips) };
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
    trees = (results[0].taxonomies || []).filter(Boolean);
    allProducts = results[1].products;
    renderAll();
  }).catch(function () {
    if (countEl) countEl.textContent = "Unable to load plans right now.";
  });
});
