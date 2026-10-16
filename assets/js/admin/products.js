window.AdminPanels = window.AdminPanels || {};
window.AdminPanels.products = {
  mount: function (root) {
    var tbody = root.querySelector("#productsTableBody");
    var searchInput = root.querySelector("#productSearch");
    var statusFilter = root.querySelector("#statusFilter");
    var pager = root.querySelector("#productsPager");
    var pagerCount = root.querySelector("#productsPagerCount");
    var pagerPage = root.querySelector("#productsPagerPage");
    var pageSizeSelect = root.querySelector("#productsPageSize");
    var prevBtn = root.querySelector("#productsPrev");
    var nextBtn = root.querySelector("#productsNext");
    var searchDebounce;

    function statusBadge(status) {
      var map = {
        published: "success", draft: "warning", archived: "neutral", presentation: "info",
        private: "warning", scheduled: "info",
      };
      // "presentation" is spelled out, because the distinction that matters
      // about these rows is not their state but that they are not for sale
      // and never reach the store.
      var label = status === "presentation" ? "showcase only" : status;
      return '<span class="a-badge a-badge-' + (map[status] || "neutral") + '">' + label + "</span>";
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
        // A presentation product has no customer-facing library page — it is
        // never bought, so nobody ever has an entitlement to it. Its preview
        // is the showcase page a deck links to.
        (p.status === "presentation"
          ? '<a class="a-btn a-btn-secondary a-btn-sm" href="/showcase/' + encodeURIComponent(p.slug) + '" target="_blank" rel="noopener" title="Open the showcase page exactly as a presentation viewer sees it">Preview</a>'
          : '<a class="a-btn a-btn-secondary a-btn-sm" href="/my-library/' + encodeURIComponent(p.id) + '" target="_blank" rel="noopener" title="Open the program page exactly as a customer sees it">Preview</a>') +
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
        // It has dropped out of the current filter (archiving, most often).
        // Same reasoning as a delete: the page is now one short, and the row
        // that should take its place lives on the next page.
        if (existingTr) {
          total = Math.max(0, total - 1);
          var backfill = total > pageSize;
          removeRowLocally(existingTr).then(function () {
            if (backfill) load();
            else renderPager();
          });
        }
        return;
      }
      if (existingTr) {
        existingTr.innerHTML = rowInnerHtml(product);
        wireRowActions(existingTr, product);
        if (opts.flash) window.AdminUI.flashRow(existingTr);
        return;
      }
      // Newly matching but not on screen. It only sorts to the top of page 1;
      // anywhere else, refetch rather than invent a position for it.
      if (page !== 1) return load();
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
        window.AdminProductBuilder.open(p.id, function (updated) {
          if (updated) syncRowLocally(updated, { flash: true });
        });
      });
      tr.querySelector("[data-duplicate]").addEventListener("click", function () {
        // A full clone now copies gallery files and every exercise demo, so it
        // is no longer instant — say so rather than looking hung.
        window.AdminUI.toast("Cloning — copying media, one moment…", "success");
        window.AdminAPI.duplicateProduct(p.id).then(function (data) {
          window.AdminUI.toast("Product cloned", "success");
          // A clone is the newest product, so like a create it belongs at the
          // top of page 1 rather than wherever the admin happens to be.
          if (page === 1) {
            total++;
            syncRowLocally(data.product, { enter: true });
            renderPager();
          } else {
            reload();
          }
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
            total = Math.max(0, total - 1);
            // Animate the row out either way — then, if the catalogue spans
            // more than this page, refetch so the row that moved up into this
            // page's last slot actually appears. It was never fetched, so it
            // cannot be filled in locally.
            var needsBackfill = total > pageSize;
            removeRowLocally(tr).then(function () {
              if (needsBackfill) load();
              else renderPager();
            });
          }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
        });
      });
    }

    // ---- paging -----------------------------------------------------------
    // The table used to fetch the ENTIRE catalogue on every load and render
    // every row. That was survivable at 23 products and nothing else: the
    // response carried each product's trainingContent (83KB for one real
    // program here), so the page cost ~150KB to draw 23 rows and would have
    // cost tens of megabytes at a few hundred. The server now returns a list
    // shape without those blobs, and this asks for one page of it.
    //
    // `page` is 1-based because it is shown to a person; the request sends a
    // 0-based offset.
    var page = 1;
    // The pager markup is optional. Paging itself is not — the request is
    // always bounded, so a template that ships without the controls still
    // fetches one page instead of silently going back to pulling the whole
    // catalogue. Only the controls disappear.
    var DEFAULT_PAGE_SIZE = 25;
    var pageSize = (pageSizeSelect && parseInt(pageSizeSelect.value, 10)) || DEFAULT_PAGE_SIZE;
    var total = 0;
    var inflight = 0;

    function pageCount() {
      return Math.max(1, Math.ceil(total / pageSize));
    }

    function renderPager() {
      if (!pager) return;
      // Always refresh the labels, even when hiding — leaving stale text in a
      // hidden element means it flashes the previous page's numbers the moment
      // the pager becomes relevant again (clear a search that had narrowed the
      // list to one page, and it would read "Page 2 of 6" for a frame).
      var pages = pageCount();
      var first = total ? (page - 1) * pageSize + 1 : 0;
      var last = Math.min(page * pageSize, total);
      pagerCount.textContent = total ? first + "–" + last + " of " + total + " products" : "";
      pagerPage.textContent = "Page " + page + " of " + pages;
      prevBtn.disabled = page <= 1;
      nextBtn.disabled = page >= pages;
      // One page of results needs no controls at all.
      pager.classList.toggle("u-hidden", total <= pageSize);
    }

    function showMessage(icon, message) {
      tbody.innerHTML = '<tr><td colspan="7">' + window.AdminUI.emptyState(icon, message) + "</td></tr>";
      tbody.classList.add("a-fade-in");
    }

    // Full reload of the CURRENT page. Used for the initial mount, whenever a
    // filter changes, when the page changes, and after a delete (which pulls a
    // row up from the next page — the one mutation that cannot be resolved
    // locally, because the row that should replace it was never fetched).
    function load() {
      tbody.innerHTML = window.AdminUI.skeletonRows(7, Math.min(pageSize, 8));
      var params = { limit: pageSize, offset: (page - 1) * pageSize };
      if (searchInput.value.trim()) params.search = searchInput.value.trim();
      if (statusFilter.value) params.status = statusFilter.value;

      var seq = ++inflight;
      window.AdminAPI.listProducts(params).then(function (data) {
        // A slower earlier page must never paint over a newer one — the same
        // out-of-order hazard the presentation picker has, reachable here by
        // clicking Next twice quickly.
        if (seq !== inflight) return;
        var products = window.AdminAPI.rows(data, "products");
        total = typeof data.total === "number" ? data.total : products.length;

        // Deleting the last row of the last page leaves the offset past the
        // end. Step back rather than showing an empty table that claims there
        // are products.
        if (!products.length && page > 1 && total > 0) { page = Math.min(page, pageCount()); return load(); }

        if (!products.length) {
          showMessage("fa-box-open", "No products match your filters.");
          renderPager();
          return;
        }
        var frag = document.createDocumentFragment();
        products.forEach(function (p) {
          var tr = document.createElement("tr");
          tr.dataset.rowKey = p.id;
          tr.innerHTML = rowInnerHtml(p);
          wireRowActions(tr, p);
          frag.appendChild(tr);
        });
        tbody.innerHTML = "";
        tbody.appendChild(frag);
        tbody.classList.add("a-fade-in");
        renderPager();
      }).catch(function (err) {
        if (seq !== inflight) return;
        showMessage("fa-triangle-exclamation", err.message);
        if (pager) pager.classList.add("u-hidden");
      });
    }

    function goToPage(next) {
      var target = Math.min(Math.max(next, 1), pageCount());
      if (target === page) return;
      page = target;
      load();
    }

    // A filter or a page size is a different dataset, so page 1 is the only
    // sensible place to land — staying on page 7 of a result that now has two
    // pages is how a table ends up looking empty for no reason.
    function reload() {
      page = 1;
      load();
    }

    root.querySelector("#createProductBtn").addEventListener("click", function () {
      window.AdminProductBuilder.open(null, function (product) {
        if (!product) return;
        // The list is newest-first, so a new product belongs at the top of
        // page 1. Inserting it into whatever page happens to be open would put
        // it somewhere it does not sort, and it would vanish on the next load.
        if (page === 1) {
          total++;
          syncRowLocally(product, { enter: true });
          renderPager();
        } else {
          reload();
        }
      });
    });
    searchInput.addEventListener("input", function () {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(reload, 300);
    });
    statusFilter.addEventListener("change", reload);
    if (pageSizeSelect) {
      pageSizeSelect.addEventListener("change", function () {
        pageSize = parseInt(pageSizeSelect.value, 10) || DEFAULT_PAGE_SIZE;
        reload();
      });
    }
    if (prevBtn) prevBtn.addEventListener("click", function () { goToPage(page - 1); });
    if (nextBtn) nextBtn.addEventListener("click", function () { goToPage(page + 1); });

    load();
  },
};
