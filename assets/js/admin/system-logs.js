window.AdminPanels = window.AdminPanels || {};
window.AdminPanels["system-logs"] = {
  mount: function (root) {
    var tbody = root.querySelector("#logsTableBody");
    var pagination = root.querySelector("#logsPagination");
    var searchInput = root.querySelector("#logSearch");
    var categoryFilter = root.querySelector("#categoryFilter");
    var state = { page: 1, pageSize: 25, search: "" };
    var searchDebounce;
    var categoriesPopulated = false;

    var CATEGORY_COLORS = {
      auth: "success",
      payment: "danger",
      order: "success",
      product: "neutral",
      user: "success",
      admin: "warning",
      dev: "warning",
    };

    function categoryBadge(category) {
      return '<span class="a-badge a-badge-' + (CATEGORY_COLORS[category] || "neutral") + '">' + category + "</span>";
    }

    function populateCategories(categories) {
      if (categoriesPopulated) return;
      categoriesPopulated = true;
      categories.forEach(function (c) {
        var opt = document.createElement("option");
        opt.value = c;
        opt.textContent = c;
        categoryFilter.appendChild(opt);
      });
    }

    function load() {
      tbody.innerHTML = window.AdminUI.skeletonRows(4, 10);
      var params = { page: state.page, pageSize: state.pageSize, search: state.search, category: categoryFilter.value };
      Object.keys(params).forEach(function (k) { if (!params[k]) delete params[k]; });

      window.AdminAPI.listSystemLogs(params).then(function (data) {
        populateCategories(data.categories);

        if (!logs.length) {
          tbody.innerHTML = '<tr><td colspan="4">' + window.AdminUI.emptyState("fa-list", "No log entries match your filters.") + "</td></tr>";
          tbody.classList.add("a-fade-in");
          pagination.innerHTML = "";
          return;
        }
        tbody.innerHTML = logs.map(function (l) {
          return (
            "<tr>" +
            "<td>" + categoryBadge(l.category) + "</td>" +
            "<td>" + window.AdminUI.escapeHtml(l.message) + "</td>" +
            "<td>" + (l.actorEmail ? window.AdminUI.escapeHtml(l.actorEmail) : "—") + "</td>" +
            "<td>" + window.AdminUI.formatDateTime(l.createdAt) + "</td>" +
            "</tr>"
          );
        }).join("");
        tbody.classList.add("a-fade-in");

        var totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));
        pagination.innerHTML =
          '<button class="a-btn a-btn-secondary a-btn-sm" id="prevPage" ' + (state.page <= 1 ? "disabled" : "") + '>Prev</button>' +
          "<span>Page " + data.page + " of " + totalPages + " (" + data.total + " entries)</span>" +
          '<button class="a-btn a-btn-secondary a-btn-sm" id="nextPage" ' + (state.page >= totalPages ? "disabled" : "") + ">Next</button>";
        var prevBtn = pagination.querySelector("#prevPage");
        var nextBtn = pagination.querySelector("#nextPage");
        if (prevBtn) prevBtn.addEventListener("click", function () { state.page--; load(); });
        if (nextBtn) nextBtn.addEventListener("click", function () { state.page++; load(); });
      }).catch(function (err) {
        tbody.innerHTML = '<tr><td colspan="4">' + window.AdminUI.emptyState("fa-triangle-exclamation", err.message) + "</td></tr>";
        tbody.classList.add("a-fade-in");
      });
    }

    searchInput.addEventListener("input", function () {
      clearTimeout(searchDebounce);
      searchDebounce = setTimeout(function () {
        state.search = searchInput.value.trim();
        state.page = 1;
        load();
      }, 300);
    });
    categoryFilter.addEventListener("change", function () { state.page = 1; load(); });

    load();
  },
};
