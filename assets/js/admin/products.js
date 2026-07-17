window.AdminPanels = window.AdminPanels || {};
window.AdminPanels.products = {
  mount: function (root) {
    var tbody = root.querySelector("#productsTableBody");
    var searchInput = root.querySelector("#productSearch");
    var statusFilter = root.querySelector("#statusFilter");
    var searchDebounce;

    function statusBadge(status) {
      var map = { published: "success", draft: "warning", archived: "neutral" };
      return '<span class="a-badge a-badge-' + (map[status] || "neutral") + '">' + status + "</span>";
    }

    // Shows only the leaf name (last segment of "Browse Athletes / Football /
    // Marcus Reyes") — the full path is a title tooltip, since the table
    // column is too narrow for the whole breadcrumb per chip.
    function taxonomyChips(p) {
      var paths = p.taxonomyPaths || [];
      if (!paths.length) return '<span style="color:var(--a-text-muted);">—</span>';
      return paths.map(function (path) {
        var segments = path.split(" / ");
        var leaf = segments[segments.length - 1];
        return '<span class="tax-badge" title="' + window.AdminUI.escapeHtml(path) + '">' + window.AdminUI.escapeHtml(leaf) + "</span>";
      }).join(" ");
    }

    // Single source of truth for one row's markup — used by the initial
    // full load AND every local single-row sync below, so a mutation never
    // has to fall back to re-rendering the whole table to stay consistent.
    function rowInnerHtml(p) {
      return (
        "<td><strong>" + window.AdminUI.escapeHtml(p.name) + '</strong><div style="color:var(--a-text-muted);font-size:12px;">' + window.AdminUI.escapeHtml(p.slug) + "</div></td>" +
        '<td><div style="display:flex;gap:4px;flex-wrap:wrap;">' + taxonomyChips(p) + "</div></td>" +
        "<td>" + window.AdminUI.formatCents(p.priceCents) + "</td>" +
        "<td>" + statusBadge(p.status) + "</td>" +
        "<td>" + (p.featured ? '<i class="fa-solid fa-star" style="color:var(--a-primary);"></i>' : "—") + "</td>" +
        "<td>" + window.AdminUI.formatDate(p.createdAt) + "</td>" +
        '<td><div style="display:flex;gap:6px;flex-wrap:wrap;">' +
        '<button class="a-btn a-btn-secondary a-btn-sm" data-edit>Edit</button>' +
        '<a class="a-btn a-btn-secondary a-btn-sm" href="/program.html?product=' + encodeURIComponent(p.id) + '" target="_blank" rel="noopener" title="Open the program page exactly as a customer sees it">Preview</a>' +
        '<button class="a-btn a-btn-secondary a-btn-sm" data-duplicate>Duplicate</button>' +
        '<button class="a-btn a-btn-secondary a-btn-sm" data-archive ' + (p.status === "archived" ? "disabled" : "") + ">Archive</button>" +
        '<button class="a-btn a-btn-secondary a-btn-sm" data-delete style="color:var(--a-danger);">Delete</button>' +
        "</div></td>"
      );
    }

    function matchesFilters(p) {
      if (statusFilter.value && p.status !== statusFilter.value) return false;
      var term = searchInput.value.trim().toLowerCase();
      if (term && p.name.toLowerCase().indexOf(term) === -1) return false;
      return true;
    }

    // Removes exactly one row: fades/slides it out, then — only once it's
    // already invisible — removes it from the DOM and glides the remaining
    // rows into their new positions (FLIP: capture old rects, remove, read
    // new rects, invert-then-release the delta as a transform). Nothing
    // else in the table, filters, or page is touched.
    function removeRowLocally(tr) {
      return window.AdminUI.animateRowRemoval(tr).then(function () {
        var siblings = Array.prototype.slice.call(tbody.children).filter(function (el) { return el !== tr; });
        var firstRects = siblings.map(function (el) { return el.getBoundingClientRect(); });
        tr.remove();

        if (!tbody.children.length) {
          tbody.innerHTML = '<tr><td colspan="7">' + window.AdminUI.emptyState("fa-box-open", "No products match your filters.") + "</td></tr>";
          tbody.classList.add("a-fade-in");
          return;
        }
        siblings.forEach(function (el, i) {
          var last = el.getBoundingClientRect();
          var dy = firstRects[i].top - last.top;
          if (Math.abs(dy) < 1) return;
          el.style.transform = "translateY(" + dy + "px)";
          el.style.transition = "none";
          requestAnimationFrame(function () {
            el.style.transition = "transform var(--a-dur) var(--a-ease)";
            el.style.transform = "";
          });
        });
      });
    }

    // Patches exactly one row from a fresh product object (whatever the
    // triggering API call just returned) — updates it in place, inserts it
    // if it's new, or removes it if it no longer matches the active
    // filters. Never touches any other row, never re-fetches the list.
    function syncRowLocally(product, opts) {
      opts = opts || {};
      var existingTr = tbody.querySelector('[data-row-key="' + product.id + '"]');

      if (!matchesFilters(product)) {
        if (existingTr) removeRowLocally(existingTr);
        return;
      }
      if (existingTr) {
        existingTr.innerHTML = rowInnerHtml(product);
        wireRowActions(existingTr, product);
        if (opts.flash) window.AdminUI.flashRow(existingTr);
        return;
      }
      if (!tbody.querySelector("[data-row-key]")) tbody.innerHTML = ""; // was showing empty/error state
      var tr = document.createElement("tr");
      tr.dataset.rowKey = product.id;
      tr.innerHTML = rowInnerHtml(product);
      wireRowActions(tr, product);
      tbody.insertBefore(tr, tbody.firstChild); // list is newest-first
      if (opts.enter !== false) window.AdminUI.animateRowsIn([tr]);
    }

    function wireRowActions(tr, p) {
      tr.querySelector("[data-edit]").addEventListener("click", function () {
        window.AdminProductWizard.open(p.id, function (updated) {
          if (updated) syncRowLocally(updated, { flash: true });
        });
      });
      tr.querySelector("[data-duplicate]").addEventListener("click", function () {
        window.AdminAPI.duplicateProduct(p.id).then(function (data) {
          window.AdminUI.toast("Product duplicated", "success");
          syncRowLocally(data.product, { enter: true });
        }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
      });
      tr.querySelector("[data-archive]").addEventListener("click", function () {
        window.AdminAPI.archiveProduct(p.id).then(function (data) {
          window.AdminUI.toast("Product archived", "success");
          syncRowLocally(data.product, { flash: true });
        }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
      });
      tr.querySelector("[data-delete]").addEventListener("click", function () {
        window.AdminUI.confirmDialog({
          title: "Delete this product?",
          message: "This can't be undone. Products with existing orders can't be deleted — archive them instead.",
          confirmLabel: "Delete",
          danger: true,
        }).then(function (ok) {
          if (!ok) return;
          window.AdminAPI.deleteProduct(p.id).then(function () {
            window.AdminUI.toast("Product deleted", "success");
            removeRowLocally(tr);
          }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
        });
      });
    }

    // Full reload — only ever used for the initial mount and when the
    // search/status filter actually changes (a genuinely different dataset,
    // not a mutation of what's already on screen).
    function load() {
      tbody.innerHTML = window.AdminUI.skeletonRows(7, 6);
      var params = {};
      if (searchInput.value.trim()) params.search = searchInput.value.trim();
      if (statusFilter.value) params.status = statusFilter.value;

      window.AdminAPI.listProducts(params).then(function (data) {
        if (!data.products.length) {
          tbody.innerHTML = '<tr><td colspan="7">' + window.AdminUI.emptyState("fa-box-open", "No products match your filters.") + "</td></tr>";
          tbody.classList.add("a-fade-in");
          return;
        }
        var frag = document.createDocumentFragment();
        data.products.forEach(function (p) {
          var tr = document.createElement("tr");
          tr.dataset.rowKey = p.id;
          tr.innerHTML = rowInnerHtml(p);
          wireRowActions(tr, p);
          frag.appendChild(tr);
        });
        tbody.innerHTML = "";
        tbody.appendChild(frag);
        tbody.classList.add("a-fade-in");
      }).catch(function (err) {
        tbody.innerHTML = '<tr><td colspan="7">' + window.AdminUI.emptyState("fa-triangle-exclamation", err.message) + "</td></tr>";
        tbody.classList.add("a-fade-in");
      });
    }

    root.querySelector("#createProductBtn").addEventListener("click", function () {
      window.AdminProductWizard.open(null, function (product) {
        if (product) syncRowLocally(product, { enter: true });
      });
    });
    searchInput.addEventListener("input", function () {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(load, 300);
    });
    statusFilter.addEventListener("change", load);

    load();
  },
};
