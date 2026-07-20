// Expanded statistics side panel — opens on clicking a promotion row in
// assets/js/admin/promotions.js. Analytics (getPromotionAnalytics) and the
// audit log are only fetched here, when the drawer actually opens — never
// on the list's load(), per the "analytics queried only when opened"
// performance requirement.
window.AdminPanels = window.AdminPanels || {};
window.AdminPanels.promotionDrawer = {
  open: function (promotionId) {
    var backdrop = document.createElement("div");
    backdrop.className = "a-modal-backdrop a-drawer-backdrop";
    backdrop.innerHTML =
      '<div class="a-drawer">' +
      '<div class="a-drawer-header"><div><h5 id="drawerTitle">Loading…</h5><p class="a-modal-desc" id="drawerSubtitle" style="margin:0;"></p></div>' +
      '<button class="a-drawer-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>' +
      '<div class="a-drawer-tabs">' +
      ["general", "timeline", "products", "customers", "commission", "activity", "orders"].map(function (key, i) {
        var labels = { general: "General", timeline: "Usage & Revenue", products: "Products", customers: "Customers", commission: "Commission", activity: "Activity Log", orders: "Recent Orders" };
        return '<button class="a-drawer-tab' + (i === 0 ? " active" : "") + '" data-tab="' + key + '">' + labels[key] + "</button>";
      }).join("") +
      "</div>" +
      ["general", "timeline", "products", "customers", "commission", "activity", "orders"].map(function (key, i) {
        return '<div class="a-drawer-panel' + (i === 0 ? " active" : "") + '" data-panel="' + key + '">' + window.AdminUI.skeletonBlock(160) + "</div>";
      }).join("") +
      "</div>";
    window.AdminUI.openModal(backdrop);

    backdrop.querySelector(".a-drawer-close").addEventListener("click", function () { window.AdminUI.closeModal(backdrop); });
    backdrop.querySelectorAll(".a-drawer-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        backdrop.querySelectorAll(".a-drawer-tab").forEach(function (t) { t.classList.toggle("active", t === tab); });
        backdrop.querySelectorAll(".a-drawer-panel").forEach(function (p) { p.classList.toggle("active", p.dataset.panel === tab.dataset.tab); });
      });
    });

    function metricTile(label, value) {
      return '<div class="a-card metric-card"><div class="metric-card__label">' + label + '</div><div class="metric-card__value" style="font-size:18px;">' + value + "</div></div>";
    }

    function timelineTable(rows, valueLabel, formatValue) {
      if (!rows.length) return window.AdminUI.emptyState("fa-chart-line", "No activity yet.");
      return (
        '<div class="a-table-wrap"><table class="a-table"><thead><tr><th>Date</th><th>' + valueLabel + "</th></tr></thead><tbody>" +
        rows.map(function (r) { return "<tr><td>" + window.AdminUI.formatDate(r.date) + "</td><td>" + formatValue(r.value) + "</td></tr>"; }).join("") +
        "</tbody></table></div>"
      );
    }

    Promise.all([window.AdminAPI.getPromotion(promotionId), window.AdminAPI.getPromotionAnalytics(promotionId), window.AdminAPI.getPromotionAuditLog(promotionId)])
      .then(function (results) {
        var p = results[0].promotion;
        var stats = results[1].stats;
        var logs = results[2].logs;

        backdrop.querySelector("#drawerTitle").textContent = p.name;
        backdrop.querySelector("#drawerSubtitle").textContent = p.code + " · " + p.status + (p.influencer ? " · " + p.influencer.name : "");

        backdrop.querySelector('[data-panel="general"]').innerHTML =
          '<div class="metric-grid metric-grid-compact" style="margin-bottom:20px;">' +
          metricTile("Total Orders", stats.totalOrders) +
          metricTile("Total Revenue", window.AdminUI.formatCents(stats.totalRevenueCents)) +
          metricTile("Discount Given", window.AdminUI.formatCents(stats.discountGivenCents)) +
          metricTile("Net Revenue", window.AdminUI.formatCents(stats.netRevenueCents)) +
          metricTile("Avg Order Value", window.AdminUI.formatCents(stats.averageOrderValueCents)) +
          metricTile("Conversion Rate", (stats.conversionRate * 100).toFixed(1) + "%") +
          "</div>" +
          "<h6>General Information</h6>" +
          "<p>" + (p.description ? window.AdminUI.escapeHtml(p.description) : "<em>No description</em>") + "</p>" +
          '<div class="a-form-grid" style="font-size:13px;">' +
          "<div><strong>Discount:</strong> " + p.discountType + " (" + p.discountValue + ")</div>" +
          "<div><strong>Code Kind:</strong> " + p.codeKind + "</div>" +
          "<div><strong>Max Uses:</strong> " + (p.maxUses != null ? p.maxUses : "Unlimited") + "</div>" +
          "<div><strong>Max Uses / Customer:</strong> " + (p.maxUsesPerCustomer != null ? p.maxUsesPerCustomer : "Unlimited") + "</div>" +
          "<div><strong>Min Spend:</strong> " + (p.minSpendCents != null ? window.AdminUI.formatCents(p.minSpendCents) : "None") + "</div>" +
          "<div><strong>Expires:</strong> " + (p.expiresAt ? window.AdminUI.formatDateTime(p.expiresAt) : "Never") + "</div>" +
          "<div><strong>Stackable:</strong> " + (p.stackable ? "Yes" : "No") + "</div>" +
          "<div><strong>Auto Apply:</strong> " + (p.autoApply ? "Yes" : "No") + "</div>" +
          "</div>";

        backdrop.querySelector('[data-panel="timeline"]').innerHTML =
          "<h6>Usage Timeline</h6>" + timelineTable(stats.ordersOverTime, "Orders", function (v) { return v; }) +
          '<h6 style="margin-top:20px;">Revenue Timeline</h6>' + timelineTable(stats.revenueOverTime, "Revenue", function (v) { return window.AdminUI.formatCents(v); });

        backdrop.querySelector('[data-panel="products"]').innerHTML = stats.topProducts.length
          ? '<div class="a-table-wrap"><table class="a-table"><thead><tr><th>Product</th><th>Units Sold</th><th>Revenue</th></tr></thead><tbody>' +
            stats.topProducts.map(function (pr) { return "<tr><td>" + window.AdminUI.escapeHtml(pr.name) + "</td><td>" + pr.unitsSold + "</td><td>" + window.AdminUI.formatCents(pr.revenueCents) + "</td></tr>"; }).join("") +
            "</tbody></table></div>"
          : window.AdminUI.emptyState("fa-box", "No products purchased with this promotion yet.");

        backdrop.querySelector('[data-panel="customers"]').innerHTML =
          '<div class="metric-grid metric-grid-compact" style="margin-bottom:20px;">' +
          metricTile("New Customers", stats.newCustomers) +
          metricTile("Returning Customers", stats.returningCustomers) +
          metricTile("Average Basket", window.AdminUI.formatCents(stats.averageOrderValueCents)) +
          "</div>" +
          (stats.topCustomers.length
            ? '<div class="a-table-wrap"><table class="a-table"><thead><tr><th>Customer</th><th>Orders</th><th>Spent</th></tr></thead><tbody>' +
              stats.topCustomers.map(function (c) { return "<tr><td>" + window.AdminUI.escapeHtml(c.name || c.email) + "</td><td>" + c.orders + "</td><td>" + window.AdminUI.formatCents(c.spentCents) + "</td></tr>"; }).join("") +
              "</tbody></table></div>"
            : window.AdminUI.emptyState("fa-users", "No customers yet."));

        backdrop.querySelector('[data-panel="commission"]').innerHTML = p.influencer
          ? '<div class="metric-grid metric-grid-compact" style="margin-bottom:20px;">' +
            metricTile("Commission Earned", window.AdminUI.formatCents(stats.commissionEarnedCents)) +
            metricTile("Estimated Store Profit", window.AdminUI.formatCents(stats.estimatedProfitCents)) +
            "</div>" +
            "<p><strong>" + window.AdminUI.escapeHtml(p.influencer.name) + "</strong> (" + p.influencer.type + ")</p>"
          : "<p>" + window.AdminUI.emptyState("fa-handshake", "No influencer/affiliate attached to this promotion.") + "</p>" +
            '<div class="metric-grid metric-grid-compact"><div class="a-card metric-card"><div class="metric-card__label">Estimated Store Profit</div><div class="metric-card__value" style="font-size:18px;">' + window.AdminUI.formatCents(stats.estimatedProfitCents) + "</div></div></div>";

        backdrop.querySelector('[data-panel="activity"]').innerHTML = logs.length
          ? logs.map(function (l) {
              return '<div class="a-activity-item"><span class="a-activity-dot"></span><div><div class="a-activity-msg">' + window.AdminUI.escapeHtml(l.message) +
                (l.actorEmail ? " <span style='color:var(--a-text-muted);'>— " + window.AdminUI.escapeHtml(l.actorEmail) + "</span>" : "") + '</div><div class="a-activity-time">' +
                window.AdminUI.formatDateTime(l.createdAt) + (l.ip ? " · " + l.ip : "") + "</div></div></div>";
            }).join("")
          : window.AdminUI.emptyState("fa-list", "No activity logged yet.");

        backdrop.querySelector('[data-panel="orders"]').innerHTML = stats.recentOrders.length
          ? '<div class="a-table-wrap"><table class="a-table"><thead><tr><th>Order</th><th>Total</th><th>Status</th><th>Date</th></tr></thead><tbody>' +
            stats.recentOrders.map(function (o) { return "<tr><td>" + o.id + "</td><td>" + window.AdminUI.formatCents(o.totalCents) + "</td><td>" + o.status + "</td><td>" + window.AdminUI.formatDate(o.createdAt) + "</td></tr>"; }).join("") +
            "</tbody></table></div>"
          : window.AdminUI.emptyState("fa-receipt", "No orders yet.");
      })
      .catch(function (err) {
        backdrop.querySelector('[data-panel="general"]').innerHTML = window.AdminUI.emptyState("fa-triangle-exclamation", err.message);
      });
  },
};
