// Builds the persistent sidebar + topbar once for the whole SPA shell
// (admin/manage.html), runs the admin auth check, and wires the logout
// button. Navigation between sections is router.js's job — this file only
// owns the chrome and exposes AdminLayout.setActive() so the router can
// update the active nav item / breadcrumb without rebuilding the sidebar.

(function () {
  // `roles` gates sidebar *visibility* only — the server-side route
  // middleware is the real boundary (requireAdmin per-section in
  // server/src/routes/admin/index.js; requirePromotionView/Manage inside
  // promotions.js itself). Defaulting to admin-only here just keeps a
  // manager from seeing links to sections they'd get a 403 from.
  var NAV_ITEMS = [
    { key: "dashboard", label: "Dashboard", href: "/admin/manage/dashboard", icon: "fa-gauge-high", roles: ["admin"] },
    { key: "orders", label: "Orders", href: "/admin/manage/orders", icon: "fa-receipt", roles: ["admin"] },
    { key: "products", label: "Products", href: "/admin/manage/products", icon: "fa-box", roles: ["admin"] },
    { key: "navigation", label: "Navigation", href: "/admin/manage/navigation", icon: "fa-sitemap", roles: ["admin"] },
    { key: "promotions", label: "Promotions", href: "/admin/manage/promotions", icon: "fa-tag", roles: ["admin", "manager"] },
    { key: "customers", label: "Customers", href: "/admin/manage/customers", icon: "fa-users", roles: ["admin"] },
    { key: "partners", label: "Partner Profiles", href: "/admin/manage/partners", icon: "fa-id-badge", roles: ["admin"] },
    { key: "presentations", label: "Private Presentations", href: "/admin/manage/presentations", icon: "fa-lock", roles: ["admin"] },
    { key: "analytics", label: "Analytics", href: "/admin/manage/analytics", icon: "fa-chart-line", roles: ["admin"] },
    { key: "email-logs", label: "Email Logs", href: "/admin/manage/email-logs", icon: "fa-envelope", roles: ["admin"] },
    { key: "payment-logs", label: "Payment Logs", href: "/admin/manage/payment-logs", icon: "fa-credit-card", roles: ["admin"] },
    { key: "system-logs", label: "System Logs", href: "/admin/manage/system-logs", icon: "fa-list", roles: ["admin"] },
    { key: "settings", label: "Settings", href: "/admin/manage/settings", icon: "fa-gear", roles: ["admin"] },
  ];
  var SOON_ITEMS = [
    { label: "Admin Accounts", icon: "fa-user-shield" },
  ];
  var currentUserRole = null;

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
      '<div class="admin-sidebar__brand"><img src="/assets/images/logo/fa-logo.svg" alt="Fitness Agency" width="200" height="112" data-brand-logo></div>' +
      '<ul class="admin-nav">' + nav + "</ul>" +
      '<div class="admin-nav-section">Coming soon</div>' +
      '<ul class="admin-nav">' + soon + "</ul>"
    );
  }

  function buildTopbar() {
    return (
      '<button class="admin-icon-btn admin-menu-btn" id="adminMenuBtn" aria-label="Open menu"><i class="fa-solid fa-bars"></i></button>' +
      '<div class="admin-breadcrumb">Admin / <strong id="adminBreadcrumbTitle">Dashboard</strong></div>' +
      '<div class="admin-topbar__actions">' +
      '<div class="admin-search"><i class="fa-regular fa-magnifying-glass"></i><input type="text" placeholder="Search…" disabled></div>' +
      '<div class="admin-notif" id="adminNotifWrap">' +
      '<button class="admin-icon-btn" id="adminNotifBtn" aria-label="Notifications"><i class="fa-regular fa-bell"></i><span class="admin-notif__badge u-hidden" id="adminNotifBadge">0</span></button>' +
      '<div class="admin-notif__dropdown u-hidden" id="adminNotifDropdown"></div>' +
      "</div>" +
      '<div class="admin-user"><div class="admin-user__avatar" id="adminUserAvatar">A</div><span id="adminUserEmail"></span></div>' +
      '<button class="admin-icon-btn" id="adminLogoutBtn" aria-label="Sign out"><i class="fa-regular fa-arrow-right-from-bracket"></i></button>' +
      "</div>"
    );
  }

  // Called once the user's role is known (me() resolves after the sidebar's
  // already been built with every item, so first paint isn't blocked on it).
  function filterSidebarForRole(role) {
    document.querySelectorAll(".admin-nav a[data-section]").forEach(function (a) {
      var item = NAV_ITEMS.filter(function (i) { return i.key === a.dataset.section; })[0];
      var li = a.closest("li");
      if (item && li) li.style.display = item.roles.indexOf(role) === -1 ? "none" : "";
    });
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

    // Mobile nav: sidebar is off-canvas below 900px (see admin.css) — this is
    // the only way to open it there. A tap on the overlay, a nav link, or
    // Escape all close it again; none of that applies above the breakpoint,
    // where the sidebar is always visible and this is inert.
    var menuBtn = document.getElementById("adminMenuBtn");
    var overlay = document.getElementById("adminSidebarOverlay");
    function closeMobileNav() {
      sidebar.classList.remove("open");
      overlay.classList.remove("visible");
    }
    function openMobileNav() {
      sidebar.classList.add("open");
      overlay.classList.add("visible");
    }
    if (menuBtn) {
      menuBtn.addEventListener("click", function () {
        if (sidebar.classList.contains("open")) closeMobileNav(); else openMobileNav();
      });
    }
    if (overlay) overlay.addEventListener("click", closeMobileNav);
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeMobileNav(); });
    sidebar.addEventListener("click", function (e) {
      if (e.target.closest("a[data-section]")) closeMobileNav();
    });

    window.AdminAPI.me().then(function (data) {
      if (!data.user || (data.user.role !== "admin" && data.user.role !== "manager")) {
        window.location.href = "/admin/login.html";
        return;
      }
      var emailEl = document.getElementById("adminUserEmail");
      var avatarEl = document.getElementById("adminUserAvatar");
      if (emailEl) emailEl.textContent = data.user.email;
      if (avatarEl) avatarEl.textContent = data.user.email.charAt(0).toUpperCase();
      currentUserRole = data.user.role;
      filterSidebarForRole(data.user.role);
      document.dispatchEvent(new CustomEvent("admin-role-ready", { detail: { role: data.user.role } }));
    }).catch(function () {
      window.location.href = "login.html";
    });

    document.dispatchEvent(new CustomEvent("admin-layout-ready"));
  });

  window.AdminLayout = {
    setActive: setActive,
    getCurrentUserRole: function () { return currentUserRole; },
  };
})();
