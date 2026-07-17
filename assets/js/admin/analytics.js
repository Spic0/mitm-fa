window.AdminPanels = window.AdminPanels || {};
window.AdminPanels.analytics = {
  mount: function (root) {
    var metricGrid = root.querySelector("#metricGrid");
    var productsTableBody = root.querySelector("#productsTableBody");
    var salesChartTitle = root.querySelector("#salesChartTitle");
    var rangeSelect = root.querySelector("#rangeSelect");
    var chart = null;

    function revealChart(canvasId) {
      var skeleton = root.querySelector("#" + canvasId + "Skeleton");
      var canvas = root.querySelector("#" + canvasId);
      if (skeleton) skeleton.style.display = "none";
      if (canvas) {
        canvas.style.display = "block";
        canvas.classList.add("a-fade-in");
      }
    }

    function metricCard(label, value, sub) {
      return (
        '<div class="a-card metric-card">' +
        '<div class="metric-card__label">' + label + "</div>" +
        '<div class="metric-card__value">' + value + "</div>" +
        (sub ? '<div class="metric-card__sub">' + sub + "</div>" : "") +
        "</div>"
      );
    }

    function renderMetrics(m) {
      metricGrid.innerHTML =
        metricCard("Revenue", window.AdminUI.formatCents(m.revenueCents)) +
        metricCard("Orders", m.orders) +
        metricCard("Customers", m.customers) +
        metricCard("Returning Customers", m.returningCustomers) +
        metricCard("Checkout Conversion", (m.checkoutConversionRate * 100).toFixed(1) + "%") +
        metricCard("Payment Success Rate", (m.paymentSuccessRate * 100).toFixed(1) + "%") +
        metricCard("Refund Rate", (m.refundRate * 100).toFixed(1) + "%");
      metricGrid.classList.add("a-fade-in");
    }

    function renderProducts(products) {
      if (!products.length) {
        productsTableBody.innerHTML = '<tr><td colspan="3">' + window.AdminUI.emptyState("fa-box-open", "No sales in this range yet.") + "</td></tr>";
        productsTableBody.classList.add("a-fade-in");
        return;
      }
      productsTableBody.innerHTML = products.map(function (p) {
        return "<tr><td>" + window.AdminUI.escapeHtml(p.name) + "</td><td>" + p.unitsSold + "</td><td>" + window.AdminUI.formatCents(p.revenueCents) + "</td></tr>";
      }).join("");
      productsTableBody.classList.add("a-fade-in");
    }

    function labelFor(date, unit) {
      if (unit === "day") return date.slice(5);
      if (unit === "week") return date.split("-W")[1] ? "W" + date.split("-W")[1] : date;
      return date;
    }

    function renderChart(series, unit) {
      var unitLabel = unit === "day" ? "day" : unit === "week" ? "week" : "month";
      salesChartTitle.textContent = "Sales over time (by " + unitLabel + ")";
      var labels = series.map(function (d) { return labelFor(d.date, unit); });
      var data = series.map(function (d) { return d.cents / 100; });

      if (chart) chart.destroy();
      chart = new Chart(root.querySelector("#salesChart"), {
        type: "line",
        data: {
          labels: labels,
          datasets: [{
            label: "Revenue",
            data: data,
            borderColor: "#1a1a1a",
            backgroundColor: "rgba(26,26,26,.1)",
            fill: true,
            tension: 0.3,
          }],
        },
        options: {
          responsive: true,
          plugins: { legend: { display: false } },
          scales: {
            x: { grid: { color: "rgba(15,23,42,.06)" }, ticks: { color: "#94a3b8" } },
            y: { grid: { color: "rgba(15,23,42,.06)" }, ticks: { color: "#94a3b8" } },
          },
        },
      });
      revealChart("salesChart");
    }

    function load() {
      metricGrid.innerHTML = window.AdminUI.skeletonCards(7);
      productsTableBody.innerHTML = window.AdminUI.skeletonRows(3, 6);
      root.querySelector("#salesChartSkeleton").style.display = "block";
      root.querySelector("#salesChart").style.display = "none";

      window.AdminAPI.getAnalytics(rangeSelect.value).then(function (data) {
        renderMetrics(data.metrics);
        renderChart(data.salesSeries, data.bucketUnit);
        renderProducts(data.products);
      }).catch(function (err) {
        window.AdminUI.toast(err.message, "error");
      });
    }

    rangeSelect.addEventListener("change", load);
    load();
  },
};
