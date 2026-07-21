window.AdminPanels = window.AdminPanels || {};
window.AdminPanels.dashboard = {
  mount: function (root) {
    var metricGrid = root.querySelector("#metricGrid");
    var activityFeed = root.querySelector("#activityFeed");
    var promotionsWidgetGrid = root.querySelector("#promotionsWidgetGrid");

    function metricCard(label, value, sub) {
      return (
        '<div class="a-card metric-card">' +
        '<div class="metric-card__label">' + label + "</div>" +
        '<div class="metric-card__value">' + value + "</div>" +
        (sub ? '<div class="metric-card__sub">' + sub + "</div>" : "") +
        "</div>"
      );
    }

    // Show placeholders immediately, before the first byte of real data arrives.
    metricGrid.innerHTML = window.AdminUI.skeletonCards(9);
    activityFeed.innerHTML = window.AdminUI.skeletonList(5);
    if (promotionsWidgetGrid) promotionsWidgetGrid.innerHTML = window.AdminUI.skeletonCards(7);

    function revealChart(canvasId) {
      var skeleton = root.querySelector("#" + canvasId + "Skeleton");
      var canvas = root.querySelector("#" + canvasId);
      if (skeleton) skeleton.style.display = "none";
      if (canvas) {
        canvas.style.display = "block";
        canvas.classList.add("a-fade-in");
      }
    }

    function renderMetrics(m) {
      metricGrid.innerHTML =
        metricCard("Total Revenue", window.AdminUI.formatCents(m.totalRevenueCents)) +
        metricCard("Revenue Today", window.AdminUI.formatCents(m.revenueTodayCents)) +
        metricCard("Revenue This Month", window.AdminUI.formatCents(m.revenueThisMonthCents)) +
        metricCard("Total Orders", m.totalOrders) +
        metricCard("Orders Today", m.ordersToday) +
        metricCard("Active Customers", m.activeCustomers, "last 30 days") +
        metricCard("Registered Users", m.registeredUsers) +
        metricCard("Conversion Rate", (m.conversionRate * 100).toFixed(1) + "%", "paid ÷ (paid + pending + failed)") +
        metricCard("Average Order Value", window.AdminUI.formatCents(m.averageOrderValueCents));
      metricGrid.classList.add("a-fade-in");
    }

    function renderPromotionsWidget(p) {
      if (!promotionsWidgetGrid || !p) return;
      promotionsWidgetGrid.innerHTML =
        metricCard("Active Promotions", p.activePromotions) +
        metricCard("Revenue Generated", window.AdminUI.formatCents(p.revenueGeneratedCents)) +
        metricCard("Top Promotion", p.topPromotion ? p.topPromotion.code : "—", p.topPromotion ? window.AdminUI.formatCents(p.topPromotion.revenueCents) : null) +
        metricCard("Expiring Soon", p.expiringSoon, "next 7 days") +
        metricCard("Unused Promotions", p.unusedPromotions) +
        metricCard("Average Discount", window.AdminUI.formatCents(p.averageDiscountCents)) +
        metricCard("Top Influencer", p.topInfluencer ? p.topInfluencer.name : "—", p.topInfluencer ? window.AdminUI.formatCents(p.topInfluencer.commissionCents) + " commission" : null);
      promotionsWidgetGrid.classList.add("a-fade-in");
    }

    function renderActivity(items) {
      if (!items.length) {
        activityFeed.innerHTML = window.AdminUI.emptyState("fa-clock", "No recent activity yet.");
        activityFeed.classList.add("a-fade-in");
        return;
      }
      activityFeed.innerHTML = items.map(function (item) {
        return (
          '<div class="a-activity-item"><span class="a-activity-dot"></span><div>' +
          '<div class="a-activity-msg">' + window.AdminUI.escapeHtml(item.message) + "</div>" +
          '<div class="a-activity-time">' + window.AdminUI.formatDateTime(item.createdAt) + "</div>" +
          "</div></div>"
        );
      }).join("");
      activityFeed.classList.add("a-fade-in");
    }

    var chartLabelColor = getComputedStyle(document.documentElement).getPropertyValue("--a-text-muted") || "#6b7280";
    var chartGridColor = "rgba(128,128,128,.15)";
    // The brand's own monochrome scale — matching --a-primary (#1a1a1a),
    // stepped light-to-dark so adjacent series stay distinguishable in a
    // grayscale chart rather than an unrelated color-per-series palette.
    var palette = ["#1a1a1a", "#3f3b38", "#65605a", "#8b857d", "#b3ada5", "#d9d5cf"];

    function baseOptions(extra) {
      return Object.assign({
        responsive: true,
        plugins: { legend: { display: false } },
        scales: {
          x: { grid: { color: chartGridColor }, ticks: { color: chartLabelColor } },
          y: { grid: { color: chartGridColor }, ticks: { color: chartLabelColor } },
        },
      }, extra || {});
    }

    function renderCharts(charts) {
      var labels = charts.revenueOverTime.map(function (d) { return d.date.slice(5); });

      new Chart(root.querySelector("#revenueChart"), {
        type: "line",
        data: {
          labels: labels,
          datasets: [{
            label: "Revenue",
            data: charts.revenueOverTime.map(function (d) { return d.cents / 100; }),
            borderColor: palette[0],
            backgroundColor: "rgba(26,26,26,.12)",
            fill: true,
            tension: 0.35,
          }],
        },
        options: baseOptions(),
      });
      revealChart("revenueChart");

      new Chart(root.querySelector("#ordersChart"), {
        type: "bar",
        data: {
          labels: labels,
          datasets: [{ label: "Orders", data: charts.ordersOverTime.map(function (d) { return d.count; }), backgroundColor: palette[1] }],
        },
        options: baseOptions(),
      });
      revealChart("ordersChart");

      new Chart(root.querySelector("#newUsersChart"), {
        type: "line",
        data: {
          labels: labels,
          datasets: [{
            label: "New users",
            data: charts.newUsersOverTime.map(function (d) { return d.count; }),
            borderColor: palette[1],
            backgroundColor: "rgba(63,59,56,.14)",
            fill: true,
            tension: 0.35,
          }],
        },
        options: baseOptions(),
      });
      revealChart("newUsersChart");

      new Chart(root.querySelector("#topProductsChart"), {
        type: "bar",
        data: {
          labels: charts.topProducts.map(function (p) { return p.name; }),
          datasets: [{ label: "Revenue", data: charts.topProducts.map(function (p) { return p.revenueCents / 100; }), backgroundColor: palette[3] }],
        },
        options: baseOptions({ indexAxis: "y" }),
      });
      revealChart("topProductsChart");

      new Chart(root.querySelector("#paymentMethodChart"), {
        type: "doughnut",
        data: {
          labels: charts.paymentMethods.map(function (p) { return p.provider; }),
          datasets: [{ data: charts.paymentMethods.map(function (p) { return p.count; }), backgroundColor: palette }],
        },
        options: { responsive: true, plugins: { legend: { position: "bottom", labels: { color: chartLabelColor } } } },
      });
      revealChart("paymentMethodChart");
    }

    window.AdminAPI.getDashboardOverview().then(function (data) {
      renderMetrics(data.metrics);
      renderCharts(data.charts);
      renderActivity(data.recentActivity);
      renderPromotionsWidget(data.promotions);
    }).catch(function (err) {
      window.AdminUI.toast(err.message, "error");
    });

    window.AdminAPI.getConfig().then(function (config) {
      if (!config.devMode) return;
      var panel = root.querySelector("#devPanel");
      panel.style.display = "block";

      root.querySelector("#devCreateCustomerBtn").addEventListener("click", function () {
        window.AdminAPI.devCreateTestCustomer().then(function (res) {
          window.AdminUI.toast("Created test customer " + res.user.email, "success");
        }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
      });

      root.querySelector("#devSimulatePurchaseBtn").addEventListener("click", function () {
        window.AdminAPI.devSimulatePurchase().then(function () {
          window.AdminUI.toast("Simulated a purchase", "success");
        }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
      });

      root.querySelector("#devSeedBtn").addEventListener("click", function () {
        window.AdminUI.confirmDialog({
          title: "Seed demo data?",
          message: "This adds 100 customers and 250 orders on top of whatever's already in the database.",
          confirmLabel: "Seed",
        }).then(function (ok) {
          if (!ok) return;
          window.AdminAPI.devSeed().then(function (res) {
            window.AdminUI.toast("Seeded " + res.summary.customersCreated + " customers, " + res.summary.ordersCreated + " orders", "success");
            window.location.reload();
          }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
        });
      });
    }).catch(function () {});
  },
};
