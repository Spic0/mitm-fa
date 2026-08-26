// Admin "Navigation" section — CRUD for the taxonomy trees that drive both
// storefront navigation and product categorization. Every mutation reloads
// the full tree from the server rather than patching local state — the trees
// are small, and this keeps ordering/nesting always provably correct.
//
// Two levels, deliberately distinct:
//   CATEGORY  a whole top-level item in the site header ("Browse Athletes").
//             Create, rename, reorder, show/hide, choose how its menu panel
//             presents, delete. This level did not exist before — the three
//             seeded categories were the only ones there could ever be.
//   ITEM      a node inside a category (a goal, a sport, an athlete).
//
// Nothing here writes a key, a route or a URL segment. Those are derived
// server-side from the name (see routes/admin/taxonomy.js) because they are
// live public URLs, not content.
window.AdminPanels = window.AdminPanels || {};
window.AdminPanels.navigation = (function () {
  var container = null;
  var taxonomies = [];

  function esc(s) { return window.AdminUI.escapeHtml(s); }

  function mount(root) {
    container = root.querySelector("#taxonomyList");
    load();
  }

  function load() {
    container.innerHTML = window.AdminUI.skeletonBlock(80) + window.AdminUI.skeletonBlock(160) + window.AdminUI.skeletonBlock(160);
    window.AdminAPI.getTaxonomy().then(function (data) {
      taxonomies = data.taxonomies;
      render();
    }).catch(function () {
      container.innerHTML = window.AdminUI.emptyState("fa-triangle-exclamation", "Failed to load navigation.");
    });
  }

  function render() {
    container.innerHTML =
      taxonomies.map(renderTaxonomyCard).join("") +
      '<button type="button" class="a-btn a-btn-primary a-btn-sm u-w-auto" id="taxAddCategory">' +
      '<i class="fa-solid fa-plus"></i> New category</button>';
  }

  // How this category's menu panel is laid out. "Automatic" is the honest
  // default and covers most cases from the tree's own shape; "People" is the
  // one thing structure cannot tell you.
  var LAYOUTS = [
    ["auto", "Automatic"],
    ["list", "List of links"],
    ["groups", "Grouped columns"],
    ["people", "People, with photos"],
  ];

  function layoutSelect(tax) {
    return (
      '<select class="tax-select" data-layout="' + tax.id + '" aria-label="Menu layout for ' + esc(tax.label) + '">' +
      LAYOUTS.map(function (opt) {
        return '<option value="' + opt[0] + '"' + (tax.navLayout === opt[0] ? " selected" : "") + ">" + opt[1] + "</option>";
      }).join("") +
      "</select>"
    );
  }

  function renderTaxonomyCard(tax) {
    var hidden = tax.showInNav === false;
    return (
      '<div class="a-card a-card-pad tax-card' + (hidden ? " tax-card--hidden" : "") + '" style="margin-bottom:20px;">' +
      '<div class="d-flex justify-content-between align-items-center flex-wrap gap-2" style="margin-bottom:16px;">' +
      "<div>" +
      '<h6 style="margin:0;"><span class="tax-node__name" data-rename-tax="' + tax.id + '" title="Click to rename">' + esc(tax.label) + "</span>" +
      (hidden ? ' <span class="tax-badge">Hidden from menu</span>' : "") +
      "</h6>" +
      '<span class="tax-route">' + esc(tax.route) + " · items at /" + esc(tax.nodeRoute) + "/…" +
      (tax.groupRoute ? " · groups at /" + esc(tax.groupRoute) + "/…" : "") +
      "</span></div>" +
      '<div class="tax-card__actions">' +
      layoutSelect(tax) +
      '<button type="button" class="tax-icon-btn" data-move-tax="' + tax.id + ':-1" aria-label="Move category up"><i class="fa-solid fa-arrow-up"></i></button>' +
      '<button type="button" class="tax-icon-btn" data-move-tax="' + tax.id + ':1" aria-label="Move category down"><i class="fa-solid fa-arrow-down"></i></button>' +
      '<button type="button" class="tax-icon-btn" data-toggle-nav="' + tax.id + '" aria-pressed="' + (!hidden) + '" aria-label="' + (hidden ? "Show in menu" : "Hide from menu") + '" title="' + (hidden ? "Show in menu" : "Hide from menu") + '">' +
      '<i class="fa-solid ' + (hidden ? "fa-eye-slash" : "fa-eye") + '"></i></button>' +
      '<button type="button" class="tax-icon-btn tax-icon-btn--danger" data-delete-tax="' + tax.id + '"' +
      (tax.nodes.length ? ' disabled title="Delete the items inside it first"' : "") +
      ' aria-label="Delete category"><i class="fa-solid fa-trash"></i></button>' +
      '<button type="button" class="a-btn a-btn-secondary a-btn-sm u-w-auto" data-add-root="' + tax.id + '"><i class="fa-solid fa-plus"></i> Add item</button>' +
      "</div></div>" +
      '<ul class="tax-tree" data-parent-list="' + tax.id + ':">' +
      (tax.nodes.length ? tax.nodes.map(function (n) { return renderNode(n, tax.id); }).join("") : "") +
      "</ul>" +
      (tax.nodes.length ? "" : '<p class="tax-empty">No items yet — add the first one above.</p>') +
      "</div>"
    );
  }

  function renderNode(node, taxonomyId) {
    var canDelete = node.children.length === 0;
    return (
      '<li class="tax-node" data-node-id="' + node.id + '">' +
      '<div class="tax-node__row">' +
      '<span class="tax-node__name" data-rename="' + node.id + '" title="Click to rename">' + esc(node.name) + "</span>" +
      (node.productCount ? '<span class="tax-badge">' + node.productCount + " product" + (node.productCount === 1 ? "" : "s") + "</span>" : "") +
      '<span class="tax-node__actions">' +
      '<button type="button" class="tax-icon-btn" data-move="' + node.id + ':-1" aria-label="Move up"><i class="fa-solid fa-arrow-up"></i></button>' +
      '<button type="button" class="tax-icon-btn" data-move="' + node.id + ':1" aria-label="Move down"><i class="fa-solid fa-arrow-down"></i></button>' +
      '<button type="button" class="tax-icon-btn" data-add-child="' + node.id + '" aria-label="Add sub-item"><i class="fa-solid fa-plus"></i></button>' +
      '<button type="button" class="tax-icon-btn tax-icon-btn--danger" data-delete="' + node.id + '"' +
      (canDelete ? "" : ' disabled title="Delete sub-items first"') +
      ' aria-label="Delete"><i class="fa-solid fa-trash"></i></button>' +
      "</span>" +
      "</div>" +
      '<ul class="tax-tree tax-tree--nested" data-parent-list="' + taxonomyId + ":" + node.id + '">' +
      node.children.map(function (c) { return renderNode(c, taxonomyId); }).join("") +
      "</ul>" +
      "</li>"
    );
  }

  // ---- Lookup helpers over the in-memory tree ----

  function findNodeAndSiblings(nodeId) {
    var result = null;
    function walk(list) {
      list.forEach(function (n) {
        if (result) return;
        if (n.id === nodeId) { result = { node: n, siblings: list }; return; }
        walk(n.children);
      });
    }
    taxonomies.forEach(function (t) { walk(t.nodes); });
    return result;
  }

  // ---- Mutations ----

  function addNode(taxonomyId, parentId, name) {
    if (!name || !name.trim()) return;
    window.AdminAPI.createTaxonomyNode(taxonomyId, { name: name.trim(), parentId: parentId || null })
      .then(load)
      .catch(function (err) { window.AdminUI.toast(err.message, "error"); });
  }

  function renameNode(nodeId, name) {
    if (!name || !name.trim()) { render(); return; }
    window.AdminAPI.updateTaxonomyNode(nodeId, { name: name.trim() })
      .then(load)
      .catch(function (err) { window.AdminUI.toast(err.message, "error"); render(); });
  }

  function moveNode(nodeId, direction) {
    var found = findNodeAndSiblings(nodeId);
    if (!found) return;
    var idx = found.siblings.indexOf(found.node);
    var swapIdx = idx + direction;
    if (swapIdx < 0 || swapIdx >= found.siblings.length) return;
    var a = found.node, b = found.siblings[swapIdx];
    Promise.all([
      window.AdminAPI.updateTaxonomyNode(a.id, { order: b.order }),
      window.AdminAPI.updateTaxonomyNode(b.id, { order: a.order }),
    ]).then(load).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
  }

  function deleteNode(nodeId) {
    var found = findNodeAndSiblings(nodeId);
    var label = found ? found.node.name : "this item";
    var count = found ? found.node.productCount : 0;
    var message = count > 0
      ? count + " product" + (count === 1 ? " is" : "s are") + " currently tagged with this item and will lose that tag. This can't be undone."
      : "This can't be undone.";
    window.AdminUI.confirmDialog({
      title: "Delete \"" + label + "\"?",
      message: message,
      confirmLabel: "Delete",
      danger: true,
    }).then(function (ok) {
      if (!ok) return;
      window.AdminAPI.deleteTaxonomyNode(nodeId)
        .then(function () { window.AdminUI.toast("Deleted", "success"); load(); })
        .catch(function (err) { window.AdminUI.toast(err.message, "error"); });
    });
  }

  // ---- Category-level mutations ----

  function updateTaxonomy(taxonomyId, body) {
    window.AdminAPI.updateTaxonomy(taxonomyId, body)
      .then(load)
      .catch(function (err) { window.AdminUI.toast(err.message, "error"); load(); });
  }

  function moveTaxonomy(taxonomyId, direction) {
    var idx = taxonomies.findIndex(function (t) { return t.id === taxonomyId; });
    var swapIdx = idx + direction;
    if (idx < 0 || swapIdx < 0 || swapIdx >= taxonomies.length) return;
    var a = taxonomies[idx], b = taxonomies[swapIdx];
    Promise.all([
      window.AdminAPI.updateTaxonomy(a.id, { order: b.order }),
      window.AdminAPI.updateTaxonomy(b.id, { order: a.order }),
    ]).then(load).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
  }

  function deleteTaxonomy(taxonomyId) {
    var tax = taxonomies.find(function (t) { return t.id === taxonomyId; });
    window.AdminUI.confirmDialog({
      title: 'Delete "' + (tax ? tax.label : "this category") + '"?',
      message: "It will disappear from the site header and its /shop URL will stop working. This can't be undone.",
      confirmLabel: "Delete",
      danger: true,
    }).then(function (ok) {
      if (!ok) return;
      window.AdminAPI.deleteTaxonomy(taxonomyId)
        .then(function () { window.AdminUI.toast("Category deleted", "success"); load(); })
        .catch(function (err) { window.AdminUI.toast(err.message, "error"); });
    });
  }

  // A new category needs one decision beyond its name — whether its items
  // are grouped (Football -> Ronaldo) or a flat list — because that is what
  // the item editor below has to offer, and it cannot be inferred from an
  // empty tree.
  function beginAddCategory(btn) {
    var wrap = document.createElement("div");
    wrap.className = "a-card a-card-pad tax-card tax-add-category";
    wrap.innerHTML =
      '<div class="tax-node__row">' +
      '<input type="text" class="tax-inline-input" placeholder="Category name, e.g. Equipment">' +
      '<label class="tax-checkbox"><input type="checkbox" data-nested> Items have sub-items</label>' +
      '<button type="button" class="a-btn a-btn-primary a-btn-sm u-w-auto" data-confirm-cat>Create</button>' +
      '<button type="button" class="a-btn a-btn-secondary a-btn-sm u-w-auto" data-cancel-cat>Cancel</button>' +
      "</div>";
    btn.replaceWith(wrap);
    var input = wrap.querySelector("input[type=text]");
    input.focus();

    function confirm() {
      var name = input.value.trim();
      if (!name) { render(); return; }
      window.AdminAPI.createTaxonomy({ label: name, hasSubcategories: wrap.querySelector("[data-nested]").checked })
        .then(function () { window.AdminUI.toast("Category created", "success"); load(); })
        .catch(function (err) { window.AdminUI.toast(err.message, "error"); render(); });
    }
    wrap.querySelector("[data-confirm-cat]").addEventListener("click", confirm);
    wrap.querySelector("[data-cancel-cat]").addEventListener("click", render);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); confirm(); }
      if (e.key === "Escape") { e.preventDefault(); render(); }
    });
  }

  // ---- Inline forms (rename / add) ----

  function beginRename(nameEl, nodeId, isTaxonomy) {
    var current = nameEl.textContent;
    var input = document.createElement("input");
    input.type = "text";
    input.className = "tax-inline-input";
    input.value = current;
    nameEl.replaceWith(input);
    input.focus();
    input.select();

    function commit() {
      if (isTaxonomy) {
        if (!input.value.trim()) { render(); return; }
        updateTaxonomy(nodeId, { label: input.value.trim() });
      } else {
        renameNode(nodeId, input.value);
      }
    }
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); input.blur(); }
      if (e.key === "Escape") { e.preventDefault(); render(); }
    });
    input.addEventListener("blur", commit, { once: true });
  }

  function beginAdd(ulEl, taxonomyId, parentId) {
    var li = document.createElement("li");
    li.className = "tax-node tax-add-row";
    li.innerHTML =
      '<div class="tax-node__row">' +
      '<input type="text" class="tax-inline-input" placeholder="Name…">' +
      '<button type="button" class="a-btn a-btn-primary a-btn-sm" style="width:auto;" data-confirm-add>Add</button>' +
      '<button type="button" class="a-btn a-btn-secondary a-btn-sm" style="width:auto;" data-cancel-add>Cancel</button>' +
      "</div>";
    ulEl.appendChild(li);
    var input = li.querySelector("input");
    input.focus();

    function confirm() { addNode(taxonomyId, parentId, input.value); }
    li.querySelector("[data-confirm-add]").addEventListener("click", confirm);
    li.querySelector("[data-cancel-add]").addEventListener("click", function () { li.remove(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); confirm(); }
      if (e.key === "Escape") { e.preventDefault(); li.remove(); }
    });
  }

  function taxonomyIdForNode(nodeId) {
    for (var i = 0; i < taxonomies.length; i++) {
      var t = taxonomies[i];
      var idx = t.nodes.some(function walk(n) { return n.id === nodeId || n.children.some(walk); });
      if (idx) return t.id;
    }
    return null;
  }

  container = null;
  document.addEventListener("change", function (e) {
    if (!container || !container.contains(e.target)) return;
    var layoutSel = e.target.closest("[data-layout]");
    if (layoutSel) updateTaxonomy(layoutSel.getAttribute("data-layout"), { navLayout: layoutSel.value });
  });

  document.addEventListener("click", function (e) {
    if (!container || !container.contains(e.target)) return;

    var addRootBtn = e.target.closest("[data-add-root]");
    if (addRootBtn) {
      var taxId = addRootBtn.getAttribute("data-add-root");
      var ul = container.querySelector('.tax-tree[data-parent-list="' + taxId + ':"]');
      beginAdd(ul, taxId, null);
      return;
    }

    var addChildBtn = e.target.closest("[data-add-child]");
    if (addChildBtn) {
      var parentId = addChildBtn.getAttribute("data-add-child");
      var taxonomyId = taxonomyIdForNode(parentId);
      var childUl = container.querySelector('.tax-tree[data-parent-list="' + taxonomyId + ":" + parentId + '"]');
      if (childUl) beginAdd(childUl, taxonomyId, parentId);
      return;
    }

    if (e.target.closest("#taxAddCategory")) { beginAddCategory(e.target.closest("#taxAddCategory")); return; }

    var renameTaxEl = e.target.closest("[data-rename-tax]");
    if (renameTaxEl) { beginRename(renameTaxEl, renameTaxEl.getAttribute("data-rename-tax"), true); return; }

    var moveTaxBtn = e.target.closest("[data-move-tax]");
    if (moveTaxBtn) {
      var taxParts = moveTaxBtn.getAttribute("data-move-tax").split(":");
      moveTaxonomy(taxParts[0], parseInt(taxParts[1], 10));
      return;
    }

    var toggleNavBtn = e.target.closest("[data-toggle-nav]");
    if (toggleNavBtn) {
      var tid = toggleNavBtn.getAttribute("data-toggle-nav");
      var t = taxonomies.find(function (x) { return x.id === tid; });
      updateTaxonomy(tid, { showInNav: !(t && t.showInNav !== false) });
      return;
    }

    var deleteTaxBtn = e.target.closest("[data-delete-tax]");
    if (deleteTaxBtn && !deleteTaxBtn.disabled) { deleteTaxonomy(deleteTaxBtn.getAttribute("data-delete-tax")); return; }

    var renameEl = e.target.closest("[data-rename]");
    if (renameEl) { beginRename(renameEl, renameEl.getAttribute("data-rename")); return; }

    var moveBtn = e.target.closest("[data-move]");
    if (moveBtn) {
      var parts = moveBtn.getAttribute("data-move").split(":");
      moveNode(parts[0], parseInt(parts[1], 10));
      return;
    }

    var deleteBtn = e.target.closest("[data-delete]");
    if (deleteBtn && !deleteBtn.disabled) { deleteNode(deleteBtn.getAttribute("data-delete")); return; }
  });

  return { mount: mount };
})();
