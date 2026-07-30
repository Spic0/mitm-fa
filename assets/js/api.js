// Thin fetch wrapper for the Fitness Agency API, plus header auth-state wiring shared
// by every page. Cookies (the session) ride along automatically same-origin.
window.ProFitAPI = (function () {
  // Read back the CSRF cookie the server sets alongside the session cookie
  // (assets/js/api.js and admin/api.js both need this, hence duplicated
  // rather than shared — the two API wrappers don't share a module).
  function readCookie(name) {
    const match = document.cookie.match("(?:^|; )" + name + "=([^;]*)");
    return match ? decodeURIComponent(match[1]) : "";
  }

  const SAFE_METHODS = { GET: true, HEAD: true };

  async function request(path, options) {
    const method = (options && options.method) || "GET";
    const headers = { "Content-Type": "application/json" };
    if (!SAFE_METHODS[method]) headers["X-CSRF-Token"] = readCookie("profit_csrf");
    const res = await fetch("/api" + path, {
      credentials: "same-origin",
      ...options,
      headers: headers,
    });
    const data = await res.json().catch(function () { return {}; });
    if (!res.ok) throw new Error(data.error || "Request failed");
    return data;
  }

  // GET responses are cached per exact path for the lifetime of the page.
  // Before this, a single homepage load fired /api/products independently
  // from 4 different scripts (hero-slideshow, home-dynamic, home-products,
  // nav-featured) and /api/taxonomy from 3 — each parsing the full
  // catalog/taxonomy JSON again. Caching the in-flight/resolved promise
  // means every caller after the first shares one network request. Safe
  // across this site's architecture (full page reloads between routes, not
  // an SPA) since the cache can never go stale within a single page view,
  // and a fresh page load always starts with an empty cache.
  const _getCache = Object.create(null);
  function get(path) {
    if (!(path in _getCache)) {
      _getCache[path] = request(path, { method: "GET" }).catch(function (err) {
        delete _getCache[path]; // don't cache a failure — let a retry go to the network
        throw err;
      });
    }
    return _getCache[path];
  }
  function post(path, body) {
    return request(path, { method: "POST", body: JSON.stringify(body || {}) });
  }
  function put(path, body) {
    return request(path, { method: "PUT", body: JSON.stringify(body || {}) });
  }

  // Shared "$X.XX" formatter — every page that renders a product price
  // (home, shop, nav mega-menu, cart, checkout, library) used to redefine
  // this same one-liner locally; it lives here once instead.
  function formatPrice(cents) {
    return "$" + (cents / 100).toFixed(2);
  }

  return {
    formatPrice: formatPrice,
    me: function () { return get("/auth/me"); },
    getConfig: function () { return get("/config"); },
    requestMagicLink: function (email) { return post("/auth/magic-link", { email: email }); },
    logout: function () { return post("/auth/logout"); },
    setPassword: function (password, currentPassword) { return post("/auth/set-password", { password: password, currentPassword: currentPassword }); },
    loginWithPassword: function (email, password) { return post("/auth/login-password", { email: email, password: password }); },
    listProducts: function () { return get("/products"); },
    listFeaturedProducts: function () { return get("/products?featured=true"); },
    getTaxonomy: function () { return get("/taxonomy"); },
    getRecommendations: function (productIds, limit) {
      var qs = "productIds=" + encodeURIComponent((productIds || []).join(","));
      if (limit) qs += "&limit=" + encodeURIComponent(limit);
      return get("/recommendations?" + qs);
    },
    getProduct: function (idOrSlug) { return get("/products/" + encodeURIComponent(idOrSlug)); },
    // `customer` is { name, email, phone, country } from the checkout form —
    // the server validates all four and persists them onto the User record,
    // so the email alone is no longer enough.
    createStripeIntent: function (items, customer, promoCode) {
      return post("/checkout/stripe/create-intent", {
        items: items,
        name: customer.name, email: customer.email,
        phone: customer.phone, country: customer.country,
        promoCode: promoCode,
      });
    },
    // `customer` is optional here: the server only re-applies the details when
    // all four validate, and leaves the existing PaymentIntent metadata alone
    // otherwise (Stripe merges metadata keys rather than replacing them).
    updateStripeIntent: function (paymentIntentId, items, promoCode, customer) {
      customer = customer || {};
      return post("/checkout/stripe/update-intent", {
        paymentIntentId: paymentIntentId,
        items: items,
        name: customer.name, email: customer.email,
        phone: customer.phone, country: customer.country,
        promoCode: promoCode,
      });
    },
    finalizeStripe: function (paymentIntentId) { return post("/checkout/stripe/finalize", { paymentIntentId: paymentIntentId }); },
    createPaypalOrder: function (items, customer, promoCode) {
      return post("/checkout/paypal/create-order", {
        items: items,
        name: customer.name, email: customer.email,
        phone: customer.phone, country: customer.country,
        promoCode: promoCode,
      });
    },
    capturePaypalOrder: function (orderId) { return post("/checkout/paypal/capture-order", { orderId: orderId }); },
    validatePromoCode: function (code, items, email) { return post("/promotions/validate", { code: code, items: items, email: email }); },
    getAutoApplyPromotion: function (items, email) {
      var qs = "items=" + encodeURIComponent(JSON.stringify(items));
      if (email) qs += "&email=" + encodeURIComponent(email);
      return get("/promotions/auto-apply?" + qs);
    },
    getLibrary: function () { return get("/library"); },
    getOrders: function () { return get("/library/orders"); },
    getProgram: function (productIdOrSlug) { return get("/library/program/" + encodeURIComponent(productIdOrSlug)); },
    // Deliberately not routed through get()'s page-lifetime cache: progress
    // is written repeatedly during a single page view, so a cached response
    // would be wrong the moment the customer ticks anything.
    saveProgramProgress: function (productIdOrSlug, progress) {
      return put("/library/program/" + encodeURIComponent(productIdOrSlug) + "/progress", progress);
    },
  };
})();

// Header + mobile nav drawer "My Account" -> "My Library" / "Sign In" state,
// run on every page. .js-account-link/.js-account-text match both the
// desktop header icon (#headerAccountLink) and the drawer's row
// (#drawerAccountLink) so one auth check drives both. .js-settings-item
// (the drawer's "Settings" row) only ever makes sense for a signed-in user,
// so it stays hidden (u-hidden, set in partials/header.html) until this
// confirms a session exists.
document.addEventListener("DOMContentLoaded", function () {
  var links = document.querySelectorAll(".js-account-link");
  var texts = document.querySelectorAll(".js-account-text");
  var settingsItems = document.querySelectorAll(".js-settings-item");
  if (!links.length && !texts.length) return;

  window.ProFitAPI.me().then(function (data) {
    if (data.user) {
      links.forEach(function (a) { a.href = "/my-library"; });
      texts.forEach(function (t) { t.textContent = "My Library"; });
      settingsItems.forEach(function (li) { li.classList.remove("u-hidden"); });
    }
  }).catch(function () {
    // Not logged in or API unreachable — leave the default "Sign In" state.
  });
});
