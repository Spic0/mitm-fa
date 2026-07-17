// Thin fetch wrapper for the ProFit API, plus header auth-state wiring shared
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

  function get(path) {
    return request(path, { method: "GET" });
  }
  function post(path, body) {
    return request(path, { method: "POST", body: JSON.stringify(body || {}) });
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
    createStripeIntent: function (items, email) { return post("/checkout/stripe/create-intent", { items: items, email: email }); },
    updateStripeIntent: function (paymentIntentId, items) { return post("/checkout/stripe/update-intent", { paymentIntentId: paymentIntentId, items: items }); },
    finalizeStripe: function (paymentIntentId) { return post("/checkout/stripe/finalize", { paymentIntentId: paymentIntentId }); },
    createPaypalOrder: function (items, email) { return post("/checkout/paypal/create-order", { items: items, email: email }); },
    capturePaypalOrder: function (orderId) { return post("/checkout/paypal/capture-order", { orderId: orderId }); },
    getLibrary: function () { return get("/library"); },
    getOrders: function () { return get("/library/orders"); },
    getProgram: function (productIdOrSlug) { return get("/library/program/" + encodeURIComponent(productIdOrSlug)); },
  };
})();

// Header "My Account" -> "My Library" / "Sign In" state, run on every page.
document.addEventListener("DOMContentLoaded", function () {
  var link = document.getElementById("headerAccountLink");
  var text = document.getElementById("headerAccountText");
  if (!link || !text) return;

  window.ProFitAPI.me().then(function (data) {
    if (data.user) {
      link.href = "my-library.html";
      text.textContent = "My Library";
    }
  }).catch(function () {
    // Not logged in or API unreachable — leave the default "Sign In" state.
  });
});
