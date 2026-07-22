(function () {
  var api = window.ProFitAPI;

  function escapeHtml(str) {
    return String(str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function renderLibrary(items) {
    var grid = document.getElementById("libraryGrid");
    if (items.length === 0) return; // leave the default "nothing yet" message in place

    grid.innerHTML = items.map(function (entry) {
      var img = entry.product.imageUrl || "/assets/images/product/product-image1.png";
      var purchasedDate = new Date(entry.purchasedAt).toLocaleDateString();
      var link = "/my-library/" + encodeURIComponent(entry.product.slug);
      return (
        '<div class="col-lg-4 col-md-6">' +
        '<div class="product__item bor lib-card">' +
        '<img src="' + escapeHtml(img) + '" alt="" class="lib-card__img">' +
        '<h5 class="mb-10">' + escapeHtml(entry.product.name) + "</h5>" +
        '<p class="lib-card__meta">Purchased ' + purchasedDate + "</p>" +
        '<a href="' + link + '" class="btn-two d-block text-center mt-15 stretched-link"><span>Open Program</span></a>' +
        "</div></div>"
      );
    }).join("");
  }

  function renderOrders(orders) {
    var tbody = document.getElementById("ordersTableBody");
    if (orders.length === 0) return;

    tbody.innerHTML = orders.map(function (order) {
      var itemNames = order.items.map(function (i) { return escapeHtml(i.name); }).join(", ");
      var date = new Date(order.createdAt).toLocaleDateString();
      var total = window.ProFitAPI.formatPrice(order.totalCents);
      return (
        "<tr><td>" + date + "</td><td>" + itemNames + "</td>" +
        "<td>" + escapeHtml(order.provider) + "</td><td>" + total + "</td></tr>"
      );
    }).join("");
  }

  document.addEventListener("DOMContentLoaded", function () {
    api.me().then(function (data) {
      if (!data.user) {
        document.getElementById("libraryGuard").style.display = "block";
        return;
      }

      document.getElementById("libraryContent").style.display = "block";
      document.getElementById("libraryUserEmail").textContent = data.user.email;

      api.getLibrary().then(function (res) { renderLibrary(res.library); });
      api.getOrders().then(function (res) { renderOrders(res.orders); });

      document.getElementById("logoutBtn").addEventListener("click", function () {
        api.logout().then(function () { window.location.href = "/"; });
      });

      var currentPasswordInput = document.getElementById("currentPassword");
      if (data.user.hasPassword) {
        currentPasswordInput.style.display = "";
        currentPasswordInput.setAttribute("required", "required");
        document.getElementById("setPasswordIntro").textContent = "Change your password.";
        document.getElementById("setPasswordSubmit").textContent = "Change Password";
      }

      document.getElementById("setPasswordForm").addEventListener("submit", function (e) {
        e.preventDefault();
        var password = document.getElementById("newPassword").value;
        var currentPassword = currentPasswordInput.value;
        var message = document.getElementById("setPasswordMessage");
        api.setPassword(password, currentPassword).then(function () {
          message.textContent = "Password saved.";
          message.style.color = "#059669";
          message.style.display = "block";
          currentPasswordInput.value = "";
          document.getElementById("newPassword").value = "";
        }).catch(function (err) {
          message.textContent = err.message || "Could not set password.";
          message.style.color = "#dc2626";
          message.style.display = "block";
        });
      });
    }).catch(function () {
      document.getElementById("libraryGuard").style.display = "block";
    });
  });
})();
