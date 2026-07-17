// Applies the store's configured branding (name/logo) to whatever the
// current page has marked up with data-brand-* attributes. Runs on both the
// storefront (via window.ProFitAPI, if present) and admin pages (plain
// fetch), since /api/config is a public, unauthenticated endpoint. Fails
// silently on error, leaving the page's hardcoded defaults in place.
document.addEventListener("DOMContentLoaded", function () {
  var getConfig = window.ProFitAPI
    ? function () { return window.ProFitAPI.getConfig(); }
    : window.AdminAPI
    ? function () { return window.AdminAPI.getConfig(); }
    : function () {
        return fetch("/api/config", { credentials: "same-origin" }).then(function (res) {
          return res.json();
        });
      };

  getConfig().then(function (config) {
    var storeName = config.storeName;
    var logoUrl = config.logoUrl ? "/" + config.logoUrl : "";
    if (!storeName) return;

    var titleEl = document.querySelector("title[data-brand-title]");
    if (titleEl) {
      document.title = titleEl.getAttribute("data-brand-title").replace("{brand}", storeName);
    }

    Array.prototype.forEach.call(document.querySelectorAll("img[data-brand-logo]"), function (img) {
      if (logoUrl) img.src = logoUrl;
      img.alt = storeName;
    });

    Array.prototype.forEach.call(document.querySelectorAll("[data-brand-name]"), function (el) {
      el.textContent = storeName;
    });

    if (logoUrl) {
      var favicon = document.querySelector("link[data-brand-favicon]");
      if (favicon) favicon.href = logoUrl;
    }
  }).catch(function () {
    // Config unreachable — leave the page's hardcoded defaults in place.
  });
});
