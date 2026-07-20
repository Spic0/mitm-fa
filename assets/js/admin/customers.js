window.AdminPanels = window.AdminPanels || {};
window.AdminPanels.customers = {
  mount: function (root) {
    var tbody = root.querySelector("#customersTableBody");
    var searchInput = root.querySelector("#customerSearch");
    var searchDebounce;

    function statusBadge(status) {
      return '<span class="a-badge a-badge-' + (status === "suspended" ? "danger" : "success") + '">' + status + "</span>";
    }

    // Single source of truth for one row's markup — used by the initial
    // full load AND every local single-row sync below.
    function rowInnerHtml(c) {
      return (
        "<td>" + window.AdminUI.escapeHtml(c.name || "—") + "</td>" +
        "<td>" + window.AdminUI.escapeHtml(c.email) + "</td>" +
        "<td>" + window.AdminUI.formatDate(c.createdAt) + "</td>" +
        "<td>" + window.AdminUI.formatCents(c.lifetimeSpendCents) + "</td>" +
        "<td>" + c.orderCount + "</td>" +
        "<td>" + (c.lastLoginAt ? window.AdminUI.formatDate(c.lastLoginAt) : "Never") + "</td>" +
        "<td>" + statusBadge(c.status) + "</td>" +
        '<td><button class="a-btn a-btn-secondary a-btn-sm" data-view>View Profile</button></td>'
      );
    }

    function wireRowActions(tr, c) {
      tr.querySelector("[data-view]").addEventListener("click", function () { openProfileModal(c.id); });
    }

    function matchesFilters(c) {
      var term = searchInput.value.trim().toLowerCase();
      if (!term) return true;
      return (c.name || "").toLowerCase().indexOf(term) !== -1 || c.email.toLowerCase().indexOf(term) !== -1;
    }

    // Patches exactly one row from a fresh/optimistic customer object —
    // updates it in place, or inserts it as new — without touching any
    // other row or re-fetching the list.
    function syncRowLocally(customer, opts) {
      opts = opts || {};
      var existingTr = tbody.querySelector('[data-row-key="' + customer.id + '"]');
      if (!matchesFilters(customer)) return;

      if (existingTr) {
        existingTr.innerHTML = rowInnerHtml(customer);
        wireRowActions(existingTr, customer);
        if (opts.flash) window.AdminUI.flashRow(existingTr);
        return;
      }
      if (!tbody.querySelector("[data-row-key]")) tbody.innerHTML = ""; // was showing empty/error state
      var tr = document.createElement("tr");
      tr.dataset.rowKey = customer.id;
      tr.innerHTML = rowInnerHtml(customer);
      wireRowActions(tr, customer);
      tbody.insertBefore(tr, tbody.firstChild); // list is newest-first
      if (opts.enter !== false) window.AdminUI.animateRowsIn([tr]);
    }

    // Full reload — only for the initial mount and an actual search change.
    function load() {
      tbody.innerHTML = window.AdminUI.skeletonRows(8, 8);
      var params = {};
      if (searchInput.value.trim()) params.search = searchInput.value.trim();

      window.AdminAPI.listCustomers(params).then(function (data) {
        if (!data.customers.length) {
          tbody.innerHTML = '<tr><td colspan="8">' + window.AdminUI.emptyState("fa-users", "No customers match your search.") + "</td></tr>";
          tbody.classList.add("a-fade-in");
          return;
        }
        var frag = document.createDocumentFragment();
        data.customers.forEach(function (c) {
          var tr = document.createElement("tr");
          tr.dataset.rowKey = c.id;
          tr.innerHTML = rowInnerHtml(c);
          wireRowActions(tr, c);
          frag.appendChild(tr);
        });
        tbody.innerHTML = "";
        tbody.appendChild(frag);
        tbody.classList.add("a-fade-in");
      }).catch(function (err) {
        tbody.innerHTML = '<tr><td colspan="8">' + window.AdminUI.emptyState("fa-triangle-exclamation", err.message) + "</td></tr>";
        tbody.classList.add("a-fade-in");
      });
    }

    function openProfileModal(id) {
      window.AdminAPI.getCustomer(id).then(function (data) {
        var c = data.customer;
        var backdrop = document.createElement("div");
        backdrop.className = "a-modal-backdrop";
        backdrop.innerHTML =
          '<div class="a-modal a-modal-lg">' +
          "<h5>" + window.AdminUI.escapeHtml(c.name || c.email) + "</h5>" +
          '<p class="a-modal-desc">' + window.AdminUI.escapeHtml(c.email) + " · Joined " + window.AdminUI.formatDate(c.createdAt) + " · " + statusBadge(c.status) + "</p>" +
          '<div class="metric-grid" style="margin-bottom:20px;">' +
          '<div class="a-card metric-card"><div class="metric-card__label">Lifetime Spend</div><div class="metric-card__value">' + window.AdminUI.formatCents(c.lifetimeSpendCents) + "</div></div>" +
          '<div class="a-card metric-card"><div class="metric-card__label">Orders</div><div class="metric-card__value">' + c.orders.length + "</div></div>" +
          '<div class="a-card metric-card"><div class="metric-card__label">Last Login</div><div class="metric-card__value" style="font-size:15px;">' + (c.lastLoginAt ? window.AdminUI.formatDateTime(c.lastLoginAt) : "Never") + "</div></div>" +
          "</div>" +
          "<h6>Purchased products</h6>" +
          "<p>" + (c.purchasedProducts.length ? window.AdminUI.escapeHtml(c.purchasedProducts.join(", ")) : "None yet") + "</p>" +
          (c.notes ? "<h6>Notes</h6><p>" + window.AdminUI.escapeHtml(c.notes) + "</p>" : "") +
          "<h6>Purchase history</h6>" +
          '<div class="a-table-wrap" style="margin-bottom:20px;"><table class="a-table"><thead><tr><th>Date</th><th>Items</th><th>Provider</th><th>Total</th></tr></thead><tbody>' +
          (c.orders.length
            ? c.orders.map(function (o) {
                return "<tr><td>" + window.AdminUI.formatDate(o.createdAt) + "</td><td>" + window.AdminUI.escapeHtml(o.items.join(", ")) + "</td><td>" + o.provider + "</td><td>" + window.AdminUI.formatCents(o.totalCents) + "</td></tr>";
              }).join("")
            : '<tr><td colspan="4" style="color:var(--a-text-muted);">No orders yet.</td></tr>') +
          "</tbody></table></div>" +
          "<h6>Send an email</h6>" +
          '<form id="emailForm"><div class="a-form-row"><input name="subject" placeholder="Subject" required></div>' +
          '<div class="a-form-row"><textarea name="body" rows="3" placeholder="Message" required></textarea></div>' +
          '<button type="submit" class="a-btn a-btn-secondary a-btn-sm">Send Email</button></form>' +
          '<div class="a-modal-actions">' +
          '<button class="a-btn a-btn-secondary" id="resetLoginBtn">Reset Login</button>' +
          '<button class="a-btn ' + (c.status === "suspended" ? "a-btn-secondary" : "a-btn-secondary") + '" id="suspendBtn" style="' + (c.status === "suspended" ? "" : "color:var(--a-danger);") + '">' + (c.status === "suspended" ? "Reactivate" : "Suspend") + " Account</button>" +
          '<button class="a-btn a-btn-secondary" id="closeProfileModal">Close</button>' +
          "</div></div>";
        window.AdminUI.openModal(backdrop);

        backdrop.querySelector("#closeProfileModal").addEventListener("click", function () { window.AdminUI.closeModal(backdrop); });

        backdrop.querySelector("#emailForm").addEventListener("submit", function (e) {
          e.preventDefault();
          var form = e.target;
          window.AdminAPI.sendCustomerEmail(c.id, form.subject.value, form.body.value).then(function () {
            window.AdminUI.toast("Email sent", "success");
            form.reset();
          }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
        });

        backdrop.querySelector("#resetLoginBtn").addEventListener("click", function () {
          window.AdminUI.confirmDialog({
            title: "Reset login sessions?",
            message: "This signs the customer out everywhere. They'll need to request a new sign-in link.",
            confirmLabel: "Reset",
          }).then(function (ok) {
            if (!ok) return;
            window.AdminAPI.resetCustomerLogin(c.id).then(function () {
              window.AdminUI.toast("Login sessions reset", "success");
            }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
          });
        });

        backdrop.querySelector("#suspendBtn").addEventListener("click", function () {
          var suspending = c.status !== "suspended";
          window.AdminUI.confirmDialog({
            title: (suspending ? "Suspend" : "Reactivate") + " this account?",
            message: suspending ? "The customer will be signed out and unable to log back in until reactivated." : "The customer will be able to sign in again.",
            confirmLabel: suspending ? "Suspend" : "Reactivate",
            danger: suspending,
          }).then(function (ok) {
            if (!ok) return;
            window.AdminAPI.suspendCustomer(c.id).then(function () {
              window.AdminUI.toast(suspending ? "Account suspended" : "Account reactivated", "success");
              window.AdminUI.closeModal(backdrop);
              syncRowLocally(Object.assign({}, c, { status: suspending ? "suspended" : "active", orderCount: c.orders.length }), { flash: true });
            }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
          });
        });
      }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
    }

    function openCreateModal() {
      var backdrop = document.createElement("div");
      backdrop.className = "a-modal-backdrop";
      backdrop.innerHTML =
        '<div class="a-modal">' +
        "<h5>Add Customer</h5>" +
        '<p class="a-modal-desc">Manually create an account — for phone/offline orders, or to comp someone access.</p>' +
        '<form id="createCustomerForm">' +
        '<div class="a-form-row"><label>Name</label><input name="name" placeholder="Optional"></div>' +
        '<div class="a-form-row"><label>Email</label><input name="email" type="email" required placeholder="customer@example.com"></div>' +
        '<div class="a-form-row"><label>Status</label><select name="status"><option value="active">Active</option><option value="suspended">Suspended</option></select></div>' +
        '<div class="a-form-row"><label>Notes</label><textarea name="notes" rows="2" placeholder="Optional — visible only to admins"></textarea></div>' +
        '<div class="a-form-row"><label>Grant access to a product (optional)</label><select name="grantProductId"><option value="">None</option></select></div>' +
        '<div class="a-modal-actions"><button type="button" class="a-btn a-btn-secondary" data-act="cancel">Cancel</button>' +
        '<button type="submit" class="a-btn a-btn-primary">Create Customer</button></div>' +
        "</form></div>";
      window.AdminUI.openModal(backdrop);
      var form = backdrop.querySelector("#createCustomerForm");
      var dirty = false;
      form.addEventListener("input", function () { dirty = true; });
      form.addEventListener("change", function () { dirty = true; });
      function requestClose() {
        if (!dirty) return window.AdminUI.closeModal(backdrop);
        window.AdminUI.confirmDialog({
          title: "Discard changes?",
          message: "You've entered details for this customer that haven't been saved.",
          confirmLabel: "Discard",
          danger: true,
        }).then(function (ok) { if (ok) window.AdminUI.closeModal(backdrop); });
      }
      backdrop.querySelector('[data-act="cancel"]').addEventListener("click", requestClose);

      var productSelect = backdrop.querySelector('select[name="grantProductId"]');
      window.AdminAPI.listProducts({ status: "published" }).then(function (data) {
        productSelect.innerHTML = '<option value="">None</option>' + data.products.map(function (p) {
          return '<option value="' + p.id + '">' + window.AdminUI.escapeHtml(p.name) + "</option>";
        }).join("");
      }).catch(function () {});

      backdrop.querySelector("#createCustomerForm").addEventListener("submit", function (e) {
        e.preventDefault();
        var form = e.target;
        var submitBtn = form.querySelector('button[type="submit"]');
        submitBtn.classList.add("is-loading");
        submitBtn.disabled = true;
        var name = form.name.value.trim();
        var status = form.status.value;
        var grantProductId = form.grantProductId.value || null;
        window.AdminAPI.createCustomer({
          name: name,
          email: form.email.value.trim(),
          status: status,
          notes: form.notes.value.trim(),
          grantProductId: grantProductId,
        }).then(function (data) {
          window.AdminUI.toast("Customer " + data.customer.email + " created", "success");
          window.AdminUI.closeModal(backdrop);
          // Built optimistically from what we already know — no extra
          // fetch needed just to render the row that we ourselves just
          // asked the server to create.
          syncRowLocally({
            id: data.customer.id,
            name: name,
            email: data.customer.email,
            createdAt: new Date().toISOString(),
            lifetimeSpendCents: 0,
            orderCount: grantProductId ? 1 : 0,
            lastLoginAt: null,
            status: status,
          }, { enter: true });
        }).catch(function (err) {
          window.AdminUI.toast(err.message, "error");
          submitBtn.classList.remove("is-loading");
          submitBtn.disabled = false;
        });
      });
    }

    root.querySelector("#createCustomerBtn").addEventListener("click", openCreateModal);

    searchInput.addEventListener("input", function () {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(load, 300);
    });

    load();
  },
};
