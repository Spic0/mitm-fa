window.AdminPanels = window.AdminPanels || {};
window.AdminPanels.orders = {
  mount: function (root) {
    var tbody = root.querySelector("#ordersTableBody");
    var pagination = root.querySelector("#ordersPagination");
    var searchInput = root.querySelector("#orderSearch");
    var statusFilter = root.querySelector("#statusFilter");
    var providerFilter = root.querySelector("#providerFilter");
    var sortFilter = root.querySelector("#sortFilter");

    var state = { page: 1, pageSize: 20, search: "" };
    var searchDebounce;

    function statusBadge(status) {
      var map = { paid: "success", pending: "warning", failed: "danger", refunded: "neutral" };
      return '<span class="a-badge a-badge-' + (map[status] || "neutral") + '">' + status + "</span>";
    }
    function deliveryBadge(status) {
      var map = { delivered: "success", resent: "neutral", pending: "warning", failed: "danger" };
      return '<span class="a-badge a-badge-' + (map[status] || "neutral") + '">' + status + "</span>";
    }

    // Single source of truth for one row's markup — used by the initial
    // full load AND the local single-row patch after Resend Email.
    function rowInnerHtml(o) {
      return (
        '<td><code style="font-size:12px;">' + o.id.slice(0, 10) + "…</code></td>" +
        "<td>" + window.AdminUI.escapeHtml(o.customerName || "—") + "</td>" +
        "<td>" + window.AdminUI.escapeHtml(o.customerEmail) + "</td>" +
        "<td>" + window.AdminUI.escapeHtml(o.products.join(", ")) + "</td>" +
        "<td>" + window.AdminUI.formatCents(o.amountCents) + "</td>" +
        "<td>" + o.provider + "</td>" +
        "<td>" + statusBadge(o.status) + "</td>" +
        "<td>" + deliveryBadge(o.deliveryStatus) + "</td>" +
        "<td>" + window.AdminUI.formatDate(o.createdAt) + "</td>" +
        '<td><button class="a-btn a-btn-secondary a-btn-sm" data-view>View</button></td>'
      );
    }

    function wireRowActions(tr, o) {
      tr.querySelector("[data-view]").addEventListener("click", function () { openOrderModal(o.id); });
    }

    // Patches exactly one row (e.g. after Resend Email flips its delivery
    // badge) without touching the rest of the table or re-fetching the
    // page. If that order isn't on the currently visible page there's
    // nothing to patch — that's fine, no reload needed either way.
    function syncRowLocally(order, opts) {
      opts = opts || {};
      var tr = tbody.querySelector('[data-row-key="' + order.id + '"]');
      if (!tr) return;
      tr.innerHTML = rowInnerHtml(order);
      wireRowActions(tr, order);
      if (opts.flash) window.AdminUI.flashRow(tr);
    }

    // Full reload — mount, search, filters, sort, and pagination all
    // legitimately mean "fetch a different dataset", unlike a single
    // order's delivery status changing.
    function load() {
      tbody.innerHTML = window.AdminUI.skeletonRows(10, 8);
      var sort = sortFilter.value.split("-");
      var params = {
        page: state.page,
        pageSize: state.pageSize,
        search: state.search,
        status: statusFilter.value,
        provider: providerFilter.value,
        sortBy: sort[0],
        sortDir: sort[1],
      };
      Object.keys(params).forEach(function (k) { if (!params[k]) delete params[k]; });

      window.AdminAPI.listOrders(params).then(function (data) {
        if (!data.orders.length) {
          tbody.innerHTML = '<tr><td colspan="10">' + window.AdminUI.emptyState("fa-receipt", "No orders match your filters.") + "</td></tr>";
          tbody.classList.add("a-fade-in");
          pagination.innerHTML = "";
          return;
        }
        var frag = document.createDocumentFragment();
        data.orders.forEach(function (o) {
          var tr = document.createElement("tr");
          tr.dataset.rowKey = o.id;
          tr.innerHTML = rowInnerHtml(o);
          wireRowActions(tr, o);
          frag.appendChild(tr);
        });
        tbody.innerHTML = "";
        tbody.appendChild(frag);
        tbody.classList.add("a-fade-in");

        var totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
        pagination.innerHTML =
          '<button class="a-btn a-btn-secondary a-btn-sm" id="prevPage" ' + (state.page <= 1 ? "disabled" : "") + '>Prev</button>' +
          "<span>Page " + data.page + " of " + totalPages + " (" + data.total + " orders)</span>" +
          '<button class="a-btn a-btn-secondary a-btn-sm" id="nextPage" ' + (state.page >= totalPages ? "disabled" : "") + ">Next</button>";

        var prevBtn = pagination.querySelector("#prevPage");
        var nextBtn = pagination.querySelector("#nextPage");
        if (prevBtn) prevBtn.addEventListener("click", function () { state.page--; load(); });
        if (nextBtn) nextBtn.addEventListener("click", function () { state.page++; load(); });
      }).catch(function (err) {
        tbody.innerHTML = '<tr><td colspan="10">' + window.AdminUI.emptyState("fa-triangle-exclamation", err.message) + "</td></tr>";
        tbody.classList.add("a-fade-in");
      });
    }

    function openOrderModal(id) {
      window.AdminAPI.getOrder(id).then(function (data) {
        var order = data.order;
        var backdrop = document.createElement("div");
        backdrop.className = "a-modal-backdrop";
        backdrop.innerHTML =
          '<div class="a-modal a-modal-lg">' +
          "<h5>Order " + order.id + "</h5>" +
          '<p class="a-modal-desc">' + window.AdminUI.escapeHtml(order.customerEmail) + " · " + window.AdminUI.formatDateTime(order.createdAt) + "</p>" +
          '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;">' + statusBadge(order.status) + deliveryBadge(order.deliveryStatus) + "</div>" +
          "<h6>Items</h6><ul>" +
          order.items.map(function (i) { return "<li>" + window.AdminUI.escapeHtml(i.name) + " — " + window.AdminUI.formatCents(i.priceCents) + "</li>"; }).join("") +
          "</ul>" +
          '<div style="display:flex;gap:10px;flex-wrap:wrap;margin:16px 0;">' +
          '<button class="a-btn a-btn-secondary a-btn-sm" id="resendEmailBtn"><i class="fa-solid fa-paper-plane"></i> Resend Download Email</button>' +
          (order.status === "refunded"
            ? '<button class="a-btn a-btn-secondary a-btn-sm" disabled><i class="fa-solid fa-rotate-left"></i> Already Refunded</button>'
            : '<button class="a-btn a-btn-secondary a-btn-sm" id="refundBtn"><i class="fa-solid fa-rotate-left"></i> Mark Refunded</button>') +
          "</div>" +
          "<h6>Internal notes</h6>" +
          '<div id="notesList" style="margin-bottom:12px;">' +
          (order.notes.length
            ? order.notes.map(function (n) {
                return '<div style="font-size:13px;padding:8px 0;border-bottom:1px solid var(--a-border);"><strong>' + window.AdminUI.escapeHtml(n.authorEmail) + "</strong> — " + window.AdminUI.escapeHtml(n.body) + '<div style="color:var(--a-text-muted);font-size:11px;">' + window.AdminUI.formatDateTime(n.createdAt) + "</div></div>";
              }).join("")
            : '<p style="color:var(--a-text-muted);font-size:13px;">No notes yet.</p>') +
          "</div>" +
          '<div class="a-form-row"><textarea id="newNoteBody" rows="2" placeholder="Add an internal note…"></textarea></div>' +
          '<button class="a-btn a-btn-secondary a-btn-sm" id="addNoteBtn">Add Note</button>' +
          '<div class="a-modal-actions"><button class="a-btn a-btn-secondary" id="closeOrderModal">Close</button></div>' +
          "</div>";
        window.AdminUI.openModal(backdrop);

        backdrop.querySelector("#closeOrderModal").addEventListener("click", function () { window.AdminUI.closeModal(backdrop); });

        backdrop.querySelector("#resendEmailBtn").addEventListener("click", function () {
          window.AdminAPI.resendOrderEmail(order.id).then(function () {
            window.AdminUI.toast("Download email resent", "success");
            window.AdminUI.closeModal(backdrop);
            syncRowLocally({
              id: order.id,
              customerName: order.customerName,
              customerEmail: order.customerEmail,
              products: order.items.map(function (i) { return i.name; }),
              amountCents: order.totalCents,
              provider: order.provider,
              status: order.status,
              deliveryStatus: "resent",
              createdAt: order.createdAt,
            }, { flash: true });
          }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
        });

        var refundBtn = backdrop.querySelector("#refundBtn");
        if (refundBtn) {
          refundBtn.addEventListener("click", function () {
            window.AdminUI.confirmDialog({
              title: "Mark this order refunded?",
              message: "This immediately revokes the customer's access to everything in this order — the gated program view, exercise media, and bonus downloads all check this before serving anything.",
              confirmLabel: "Mark Refunded",
              danger: true,
            }).then(function (ok) {
              if (!ok) return;
              window.AdminAPI.refundOrder(order.id).then(function () {
                window.AdminUI.toast("Order marked refunded — access revoked", "success");
                window.AdminUI.closeModal(backdrop);
                syncRowLocally({
                  id: order.id,
                  customerName: order.customerName,
                  customerEmail: order.customerEmail,
                  products: order.items.map(function (i) { return i.name; }),
                  amountCents: order.totalCents,
                  provider: order.provider,
                  status: "refunded",
                  deliveryStatus: order.deliveryStatus,
                  createdAt: order.createdAt,
                }, { flash: true });
              }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
            });
          });
        }

        backdrop.querySelector("#addNoteBtn").addEventListener("click", function () {
          var body = backdrop.querySelector("#newNoteBody").value.trim();
          if (!body) return;
          window.AdminAPI.addOrderNote(order.id, body).then(function () {
            window.AdminUI.toast("Note added", "success");
            window.AdminUI.closeModal(backdrop);
            openOrderModal(order.id);
          }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
        });
      }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
    }

    searchInput.addEventListener("input", function () {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function () {
        state.search = searchInput.value.trim();
        state.page = 1;
        load();
      }, 300);
    });
    [statusFilter, providerFilter, sortFilter].forEach(function (el) {
      el.addEventListener("change", function () { state.page = 1; load(); });
    });

    load();
  },
};
