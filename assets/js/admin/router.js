// Client-side router for the admin SPA shell (admin/manage.html). Clones a
// section's <template id="tpl-{key}"> into #panelHost the first time it's
// visited, calls that section's AdminPanels[key].mount(container) once, and
// from then on just toggles visibility — no re-fetch, no re-render, no lost
// scroll position on revisit.
(function () {
  var SECTIONS = {
    dashboard: { title: "Dashboard", needsChartJs: true },
    orders: { title: "Orders", needsChartJs: false },
    products: { title: "Products", needsChartJs: false },
    navigation: { title: "Navigation", needsChartJs: false },
    customers: { title: "Customers", needsChartJs: false },
    promotions: { title: "Promotions", needsChartJs: false },
    partners: { title: "Partner Profiles", needsChartJs: false },
    presentations: { title: "Private Presentations", needsChartJs: false },
    analytics: { title: "Analytics", needsChartJs: true },
    "email-logs": { title: "Email Logs", needsChartJs: false },
    "payment-logs": { title: "Payment Logs", needsChartJs: false },
    "system-logs": { title: "System Logs", needsChartJs: false },
    settings: { title: "Settings", needsChartJs: false },
  };
  var DEFAULT_SECTION = "dashboard";

  var panelHost = null;
  var panels = {}; // key -> container element, created once and cached forever
  var scrollPositions = {}; // key -> last window.scrollY seen for that section
  var activeKey = null;
  var chartJsPromise = null;

  // Chart.js is only needed by Dashboard/Analytics — injected once, on first
  // need, rather than unconditionally in <head> for every section. Served
  // from this origin (assets/js/vendor/chart.umd.js) rather than a CDN so
  // the CSP doesn't need a jsdelivr exception.
  function ensureChartJs() {
    if (window.Chart) return Promise.resolve();
    if (!chartJsPromise) {
      chartJsPromise = new Promise(function (resolve, reject) {
        var s = document.createElement("script");
        s.src = "/assets/js/vendor/chart.umd.js";
        s.onload = resolve;
        s.onerror = reject;
        document.head.appendChild(s);
      });
    }
    return chartJsPromise;
  }

  function sectionFromPath(pathname) {
    var match = pathname.match(/\/admin\/manage\/?([a-z0-9-]*)/i);
    var key = match && match[1] ? match[1] : DEFAULT_SECTION;
    return SECTIONS[key] ? key : DEFAULT_SECTION;
  }

  function createPanel(key) {
    var template = document.getElementById("tpl-" + key);
    var container = document.createElement("div");
    container.className = "panel";
    container.setAttribute("data-panel", key);
    if (template) container.appendChild(template.content.cloneNode(true));
    panelHost.appendChild(container);
    return container;
  }

  function show(key, opts) {
    var container = panels[key];
    // Remove+re-add the fade class so the transition replays on every switch
    // (a class already present doesn't retrigger its CSS animation).
    container.classList.remove("a-fade-in");
    void container.offsetWidth; // force reflow
    container.classList.add("active", "a-fade-in");
    window.scrollTo(0, scrollPositions[key] || 0);
    activeKey = key;

    if (window.AdminLayout) window.AdminLayout.setActive(key, SECTIONS[key].title);
    if (opts.pushState) history.pushState({ key: key }, "", "/admin/manage/" + key);
  }

  function activateSection(key, opts) {
    opts = opts || {};
    if (!SECTIONS[key]) key = DEFAULT_SECTION;
    if (activeKey === key && panels[key]) return; // already showing this section

    if (activeKey && panels[activeKey]) {
      scrollPositions[activeKey] = window.scrollY;
      panels[activeKey].classList.remove("active");
    }

    if (panels[key]) {
      show(key, opts);
      return;
    }

    var ready = SECTIONS[key].needsChartJs ? ensureChartJs() : Promise.resolve();
    ready.then(function () {
      var container = createPanel(key);
      panels[key] = container;
      var panel = window.AdminPanels && window.AdminPanels[key];
      if (panel && typeof panel.mount === "function") panel.mount(container);
      show(key, opts);
    }).catch(function (err) {
      console.error("Failed to load admin section '" + key + "':", err);
      if (window.AdminUI) window.AdminUI.toast("Failed to load this section", "error");
    });
  }

  function wireSidebarLinks() {
    document.querySelectorAll(".admin-nav a[data-section]").forEach(function (a) {
      a.addEventListener("click", function (e) {
        e.preventDefault();
        activateSection(a.dataset.section, { pushState: true });
      });
    });
  }

  window.addEventListener("popstate", function (event) {
    var key = (event.state && event.state.key) || sectionFromPath(location.pathname);
    activateSection(key, { pushState: false });
  });

  // Boot only once layout.js has injected the sidebar/topbar (it dispatches
  // this after building them, regardless of the admin auth check's async
  // result — the server already gates the whole page via requireAdminPage,
  // this is just about DOM readiness, not auth).
  document.addEventListener("admin-layout-ready", function () {
    panelHost = document.getElementById("panelHost");
    wireSidebarLinks();
    activateSection(sectionFromPath(location.pathname), { pushState: false });
  });

  window.AdminRouter = { activateSection: activateSection };
})();
