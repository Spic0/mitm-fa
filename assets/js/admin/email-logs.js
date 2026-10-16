window.AdminPanels = window.AdminPanels || {};
window.AdminPanels["email-logs"] = {
  mount: function (root) {
    var tbody = root.querySelector("#logsTableBody");
    var pagination = root.querySelector("#logsPagination");
    var searchInput = root.querySelector("#logSearch");
    var statusFilter = root.querySelector("#statusFilter");
    var state = { page: 1, pageSize: 25, search: "" };
    var searchDebounce;

    function statusBadge(status) {
      return '<span class="a-badge a-badge-' + (status === "sent" ? "success" : "danger") + '">' + status + "</span>";
    }

    function load() {
      tbody.innerHTML = window.AdminUI.skeletonRows(6, 8);
      var params = { page: state.page, pageSize: state.pageSize, search: state.search, status: statusFilter.value };
      Object.keys(params).forEach(function (k) { if (!params[k]) delete params[k]; });

      window.AdminAPI.listEmailLogs(params).then(function (data) {
        var logs = window.AdminAPI.rows(data, "logs");
        if (!logs.length) {
          tbody.innerHTML = '<tr><td colspan="6">' + window.AdminUI.emptyState("fa-envelope", "No emails match your filters.") + "</td></tr>";
          tbody.classList.add("a-fade-in");
          pagination.innerHTML = "";
          return;
        }
        tbody.innerHTML = logs.map(function (l, i) {
          return (
            "<tr>" +
            "<td>" + window.AdminUI.escapeHtml(l.recipient) + "</td>" +
            "<td>" + window.AdminUI.escapeHtml(l.subject) + "</td>" +
            "<td>" + statusBadge(l.status) + "</td>" +
            "<td>" + (l.openedAt ? window.AdminUI.formatDateTime(l.openedAt) : "—") + "</td>" +
            "<td>" + window.AdminUI.formatDateTime(l.sentAt) + "</td>" +
            '<td><button class="a-btn a-btn-secondary a-btn-sm" data-view="' + i + '">View Response</button></td>' +
            "</tr>"
          );
        }).join("");
        tbody.classList.add("a-fade-in");

        tbody.querySelectorAll("[data-view]").forEach(function (btn) {
          btn.addEventListener("click", function () { openResponseModal(data.logs[parseInt(btn.dataset.view, 10)]); });
        });

        var totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
        pagination.innerHTML =
          '<button class="a-btn a-btn-secondary a-btn-sm" id="prevPage" ' + (state.page <= 1 ? "disabled" : "") + '>Prev</button>' +
          "<span>Page " + data.page + " of " + totalPages + " (" + data.total + " emails)</span>" +
          '<button class="a-btn a-btn-secondary a-btn-sm" id="nextPage" ' + (state.page >= totalPages ? "disabled" : "") + ">Next</button>";
        var prevBtn = pagination.querySelector("#prevPage");
        var nextBtn = pagination.querySelector("#nextPage");
        if (prevBtn) prevBtn.addEventListener("click", function () { state.page--; load(); });
        if (nextBtn) nextBtn.addEventListener("click", function () { state.page++; load(); });
      }).catch(function (err) {
        tbody.innerHTML = '<tr><td colspan="6">' + window.AdminUI.emptyState("fa-triangle-exclamation", err.message) + "</td></tr>";
        tbody.classList.add("a-fade-in");
      });
    }

    function openResponseModal(log) {
      var pretty = log.providerResponse;
      try { pretty = JSON.stringify(JSON.parse(log.providerResponse), null, 2); } catch (e) { /* keep raw string */ }

      var backdrop = document.createElement("div");
      backdrop.className = "a-modal-backdrop";
      backdrop.innerHTML =
        '<div class="a-modal">' +
        "<h5>Provider Response</h5>" +
        '<p class="a-modal-desc">' + window.AdminUI.escapeHtml(log.recipient) + " · " + window.AdminUI.escapeHtml(log.subject) + "</p>" +
        '<pre style="background:var(--a-surface-2);border:1px solid var(--a-border);border-radius:var(--a-radius);padding:14px;font-size:12px;max-height:300px;overflow:auto;white-space:pre-wrap;">' +
        window.AdminUI.escapeHtml(pretty || "No response recorded.") +
        "</pre>" +
        '<div class="a-modal-actions"><button class="a-btn a-btn-secondary" id="closeResponseModal">Close</button></div>' +
        "</div>";
      window.AdminUI.openModal(backdrop);
      backdrop.querySelector("#closeResponseModal").addEventListener("click", function () { window.AdminUI.closeModal(backdrop); });
    }

    searchInput.addEventListener("input", function () {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function () {
        state.search = searchInput.value.trim();
        state.page = 1;
        load();
      }, 300);
    });
    statusFilter.addEventListener("change", function () { state.page = 1; load(); });

    load();
  },
};
