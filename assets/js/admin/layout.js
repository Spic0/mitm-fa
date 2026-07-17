// Builds the persistent sidebar + topbar once for the whole SPA shell
// (admin/manage.html), runs the admin auth check, and wires the logout
// button. Navigation between sections is router.js's job — this file only
// owns the chrome and exposes AdminLayout.setActive() so the router can
// update the active nav item / breadcrumb without rebuilding the sidebar.

(function () {
  var NAV_ITEMS = [
    { key: "dashboard", label: "Dashboard", href: "/admin/manage/dashboard", icon: "fa-gauge-high" },
    { key: "orders", label: "Orders", href: "/admin/manage/orders", icon: "fa-receipt" },
    { key: "products", label: "Products", href: "/admin/manage/products", icon: "fa-box" },
    { key: "navigation", label: "Navigation", href: "/admin/manage/navigation", icon: "fa-sitemap" },
    { key: "customers", label: "Customers", href: "/admin/manage/customers", icon: "fa-users" },
    { key: "analytics", label: "Analytics", href: "/admin/manage/analytics", icon: "fa-chart-line" },
    { key: "email-logs", label: "Email Logs", href: "/admin/manage/email-logs", icon: "fa-envelope" },
    { key: "payment-logs", label: "Payment Logs", href: "/admin/manage/payment-logs", icon: "fa-credit-card" },
    { key: "system-logs", label: "System Logs", href: "/admin/manage/system-logs", icon: "fa-list" },
    { key: "settings", label: "Settings", href: "/admin/manage/settings", icon: "fa-gear" },
  ];
  var SOON_ITEMS = [
    { label: "Admin Accounts", icon: "fa-user-shield" },
  ];

  function buildSidebar() {
    var nav = NAV_ITEMS.map(function (item) {
      // Real hrefs so right-click/open-in-new-tab/copy-link/no-JS all still
      // work (the server serves the same shell for any /admin/manage/* path)
      // — router.js intercepts the click to navigate without a reload.
      return '<li><a href="' + item.href + '" data-section="' + item.key + '"><i class="fa-solid ' + item.icon + '"></i> ' + item.label + "</a></li>";
    }).join("");

    var soon = SOON_ITEMS.map(function (item) {
      return '<li><a class="disabled" href="#"><i class="fa-solid ' + item.icon + '"></i> ' + item.label + '<span class="soon">Soon</span></a></li>';
    }).join("");

    return (
      '<div class="admin-sidebar__brand"><img src="/assets/images/logo/logo.svg" alt="ProFit" data-brand-logo></div>' +
      '<ul class="admin-nav">' + nav + "</ul>" +
      '<div class="admin-nav-section">Coming soon</div>' +
      '<ul class="admin-nav">' + soon + "</ul>"
    );
  }

  function buildTopbar() {
    return (
      '<div class="admin-breadcrumb">Admin / <strong id="adminBreadcrumbTitle">Dashboard</strong></div>' +
      '<div class="admin-topbar__actions">' +
      '<div class="admin-search"><i class="fa-regular fa-magnifying-glass"></i><input type="text" placeholder="Search…" disabled></div>' +
      '<div class="admin-user"><div class="admin-user__avatar" id="adminUserAvatar">A</div><span id="adminUserEmail"></span></div>' +
      '<button class="admin-icon-btn" id="adminLogoutBtn" aria-label="Sign out"><i class="fa-regular fa-arrow-right-from-bracket"></i></button>' +
      "</div>"
    );
  }

  // Called by router.js after every section switch — toggles the active nav
  // link and updates the breadcrumb, without touching anything else.
  function setActive(key, title) {
    document.querySelectorAll(".admin-nav a[data-section]").forEach(function (a) {
      a.classList.toggle("active", a.dataset.section === key);
    });
    var titleEl = document.getElementById("adminBreadcrumbTitle");
    if (titleEl) titleEl.textContent = title;
  }

  document.addEventListener("DOMContentLoaded", function () {
    var sidebar = document.getElementById("adminSidebar");
    var topbar = document.getElementById("adminTopbar");
    if (sidebar) sidebar.innerHTML = buildSidebar();
    if (topbar) topbar.innerHTML = buildTopbar();

    var logoutBtn = document.getElementById("adminLogoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", function () {
        window.AdminAPI.logout().finally(function () {
          window.location.href = "/admin/login.html";
        });
      });
    }

    window.AdminAPI.me().then(function (data) {
      if (!data.user || data.user.role !== "admin") {
        window.location.href = "/admin/login.html";
        return;
      }
      var emailEl = document.getElementById("adminUserEmail");
      var avatarEl = document.getElementById("adminUserAvatar");
      if (emailEl) emailEl.textContent = data.user.email;
      if (avatarEl) avatarEl.textContent = data.user.email.charAt(0).toUpperCase();
    }).catch(function () {
      window.location.href = "login.html";
    });

    document.dispatchEvent(new CustomEvent("admin-layout-ready"));
  });

  window.AdminLayout = { setActive: setActive };
})();
