window.AdminPanels = window.AdminPanels || {};
window.AdminPanels.promotions = {
  mount: function (root) {
    var tbody = root.querySelector("#promotionsTableBody");
    var pagination = root.querySelector("#promotionsPagination");
    var searchInput = root.querySelector("#promotionSearch");
    var statusFilter = root.querySelector("#promotionStatusFilter");
    var kindFilter = root.querySelector("#promotionKindFilter");
    var searchDebounce;
    var state = { page: 1, pageSize: 20 };

    function isManager() {
      return window.AdminLayout && window.AdminLayout.getCurrentUserRole() === "manager";
    }

    function statusBadge(p) {
      var expired = p.expiresAt && new Date(p.expiresAt) < new Date();
      if (expired) return '<span class="a-badge a-badge-danger">expired</span>';
      var cls = p.status === "enabled" ? "success" : p.status === "paused" ? "warning" : "neutral";
      return '<span class="a-badge a-badge-' + cls + '">' + p.status + "</span>";
    }

    function discountLabel(p) {
      if (p.discountType === "PERCENTAGE") return p.discountValue + "% off";
      if (p.discountType === "FIXED_AMOUNT") return window.AdminUI.formatCents(p.discountValue) + " off";
      return "Free product";
    }

    function rowInnerHtml(p) {
      return (
        "<td><strong>" + window.AdminUI.escapeHtml(p.name) + '</strong><div class="a-subtext">' + window.AdminUI.escapeHtml(p.code) + "</div></td>" +
        "<td>" + statusBadge(p) + "</td>" +
        "<td>" + discountLabel(p) + "</td>" +
        "<td>" + p.codeKind + (p.influencer ? '<div class="a-subtext">' + window.AdminUI.escapeHtml(p.influencer.name) + "</div>" : "") + "</td>" +
        "<td>" + p.uses + (p.maxUses != null ? " / " + p.maxUses : "") + "</td>" +
        "<td>" + window.AdminUI.formatCents(p.revenueCents) + "</td>" +
        "<td>" + (p.expiresAt ? window.AdminUI.formatDate(p.expiresAt) : "No expiry") + "</td>" +
        "<td>" + (p.createdBy ? window.AdminUI.escapeHtml(p.createdBy.email) : "—") + '<div class="a-subtext">' + window.AdminUI.formatDate(p.createdAt) + "</div></td>" +
        "<td>" + (p.lastUsedAt ? window.AdminUI.formatDate(p.lastUsedAt) : "Never") + "</td>" +
        '<td class="a-row-actions"></td>'
      );
    }

    function buildActions(p) {
      var wrap = document.createElement("div");
      wrap.style.cssText = "display:flex;gap:6px;flex-wrap:wrap;";

      var pauseResume = document.createElement("button");
      pauseResume.className = "a-btn a-btn-secondary a-btn-sm";
      if (p.status === "paused") {
        pauseResume.title = "Resume";
        pauseResume.innerHTML = '<i class="fa-solid fa-play"></i>';
        pauseResume.addEventListener("click", function () { runAction(window.AdminAPI.resumePromotion(p.id), "Promotion activated"); });
      } else {
        pauseResume.title = "Pause";
        pauseResume.innerHTML = '<i class="fa-solid fa-pause"></i>';
        pauseResume.addEventListener("click", function () { runAction(window.AdminAPI.pausePromotion(p.id), "Promotion paused"); });
      }
      wrap.appendChild(pauseResume);

      if (!isManager()) {
        var editBtn = document.createElement("button");
        editBtn.className = "a-btn a-btn-secondary a-btn-sm";
        editBtn.title = "Edit";
        editBtn.innerHTML = '<i class="fa-solid fa-pen"></i>';
        editBtn.addEventListener("click", function (e) { e.stopPropagation(); openEditModal(p); });
        wrap.appendChild(editBtn);

        var cloneBtn = document.createElement("button");
        cloneBtn.className = "a-btn a-btn-secondary a-btn-sm";
        cloneBtn.title = "Clone";
        cloneBtn.innerHTML = '<i class="fa-solid fa-clone"></i>';
        cloneBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          window.AdminAPI.clonePromotion(p.id).then(function (data) {
            window.AdminUI.toast("Cloned as " + data.promotion.code, "success");
            load();
          }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
        });
        wrap.appendChild(cloneBtn);

        var deleteBtn = document.createElement("button");
        deleteBtn.className = "a-btn a-btn-secondary a-btn-sm";
        deleteBtn.title = "Delete";
        deleteBtn.style.color = "var(--a-danger)";
        deleteBtn.innerHTML = '<i class="fa-solid fa-trash"></i>';
        deleteBtn.addEventListener("click", function (e) {
          e.stopPropagation();
          window.AdminUI.confirmDialog({
            title: "Delete this promotion?",
            message: "This can't be undone. A promotion that's already been used can't be deleted — disable it instead.",
            confirmLabel: "Delete",
            danger: true,
          }).then(function (ok) {
            if (!ok) return;
            var tr = tbody.querySelector('[data-row-key="' + p.id + '"]');
            window.AdminAPI.deletePromotion(p.id).then(function () {
              window.AdminUI.toast("Promotion deleted", "success");
              window.AdminUI.animateRowRemoval(tr).then(load);
            }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
          });
        });
        wrap.appendChild(deleteBtn);
      }

      function runAction(promise, successMsg) {
        promise.then(function () {
          window.AdminUI.toast(successMsg, "success");
          load();
        }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
      }

      return wrap;
    }

    function wireRow(tr, p) {
      tr.querySelector(".a-row-actions").appendChild(buildActions(p));
      tr.style.cursor = "pointer";
      tr.addEventListener("click", function () {
        if (window.AdminPanels.promotionDrawer) window.AdminPanels.promotionDrawer.open(p.id);
      });
    }

    function load() {
      tbody.innerHTML = window.AdminUI.skeletonRows(10, 8);
      pagination.innerHTML = "";
      var params = {
        page: state.page,
        pageSize: state.pageSize,
        search: searchInput.value.trim(),
        status: statusFilter.value,
        codeKind: kindFilter.value,
      };
      Object.keys(params).forEach(function (k) { if (!params[k]) delete params[k]; });

      window.AdminAPI.listPromotions(params).then(function (data) {
        if (!data.promotions.length) {
          tbody.innerHTML = '<tr><td colspan="10">' + window.AdminUI.emptyState("fa-tag", "No promotions match your filters.") + "</td></tr>";
          tbody.classList.add("a-fade-in");
          return;
        }
        var frag = document.createDocumentFragment();
        data.promotions.forEach(function (p) {
          var tr = document.createElement("tr");
          tr.dataset.rowKey = p.id;
          tr.innerHTML = rowInnerHtml(p);
          wireRow(tr, p);
          frag.appendChild(tr);
        });
        tbody.innerHTML = "";
        tbody.appendChild(frag);
        tbody.classList.add("a-fade-in");

        var totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
        pagination.innerHTML =
          '<button class="a-btn a-btn-secondary a-btn-sm" id="promoPrevPage" ' + (state.page <= 1 ? "disabled" : "") + ">Prev</button>" +
          "<span>Page " + data.page + " of " + totalPages + " (" + data.total + " promotions)</span>" +
          '<button class="a-btn a-btn-secondary a-btn-sm" id="promoNextPage" ' + (state.page >= totalPages ? "disabled" : "") + ">Next</button>";
        var prevBtn = pagination.querySelector("#promoPrevPage");
        var nextBtn = pagination.querySelector("#promoNextPage");
        if (prevBtn) prevBtn.addEventListener("click", function () { state.page--; load(); });
        if (nextBtn) nextBtn.addEventListener("click", function () { state.page++; load(); });
      }).catch(function (err) {
        tbody.innerHTML = '<tr><td colspan="10">' + window.AdminUI.emptyState("fa-triangle-exclamation", err.message) + "</td></tr>";
        tbody.classList.add("a-fade-in");
      });
    }

    // ---- Create / edit — Setup Wizard (assets/js/admin/promotion-wizard.js) ----

    function openCreateModal() {
      window.AdminPromotionWizard.open(null, function (promotion) { if (promotion) load(); });
    }

    function openEditModal(p) {
      window.AdminPromotionWizard.open(p.id, function (promotion) { if (promotion) load(); });
    }


    root.querySelector("#createPromotionBtn").addEventListener("click", openCreateModal);
    searchInput.addEventListener("input", function () {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function () { state.page = 1; load(); }, 300);
    });
    statusFilter.addEventListener("change", function () { state.page = 1; load(); });
    kindFilter.addEventListener("change", function () { state.page = 1; load(); });

    load();
  },
};
