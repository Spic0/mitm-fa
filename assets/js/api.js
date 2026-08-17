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

  // Price of a PRODUCT, as shown on a card/hero/product page. Distinct from
  // formatPrice above, which is for monetary amounts generally (cart subtotal,
  // order total) where "$0.00" is the correct and expected rendering of zero.
  //
  // A product at 0 is a free plan, and "$0.00" on a storefront reads as a
  // pricing bug rather than an offer — the catalog currently has one such
  // product published and featured, so this is a live case, not a hypothetical.
  // Kept in step with formatProductPrice() in server/src/routes/pages.js, which
  // renders the same two values into the server-rendered hero and showcase.
  function formatProductPrice(cents) {
    return cents === 0 ? "Free" : formatPrice(cents);
  }

  return {
    formatPrice: formatPrice,
    formatProductPrice: formatProductPrice,
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
    // The clientSecret is required, not decorative: the server treats it as
    // proof that this browser is the one that created the PaymentIntent
    // before it mints a logged-in session. The bare intent id travels in the
    // URL on redirect-based payment methods and is not a secret.
    finalizeStripe: function (paymentIntentId, clientSecret) {
      return post("/checkout/stripe/finalize", {
        paymentIntentId: paymentIntentId,
        clientSecret: clientSecret,
      });
    },
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
    getOrder: function (orderId) { return get("/library/orders/" + encodeURIComponent(orderId)); },
    getProgram: function (productIdOrSlug) { return get("/library/program/" + encodeURIComponent(productIdOrSlug)); },
    // Deliberately not routed through get()'s page-lifetime cache: progress
    // is written repeatedly during a single page view, so a cached response
    // would be wrong the moment the customer ticks anything.
    saveProgramProgress: function (productIdOrSlug, progress) {
      return put("/library/program/" + encodeURIComponent(productIdOrSlug) + "/progress", progress);
    },

    // ---- The customer's own account (My Profile, setup wizard) ----
    getProfile: function () { return get("/account/profile"); },
    // Partial: send only the fields a card actually edits. Not cached —
    // the response is the new state and callers re-render from it.
    updateProfile: function (patch) { return request("/account/profile", { method: "PATCH", body: JSON.stringify(patch) }); },
    removeAvatar: function () { return request("/account/avatar", { method: "DELETE" }); },
    // multipart, so it bypasses request(): that helper forces a JSON
    // Content-Type, and setting one by hand on a FormData body strips the
    // boundary and the upload arrives unparseable. The CSRF header still
    // has to be sent by hand for the same reason.
    uploadAvatar: function (file) {
      var form = new FormData();
      form.append("avatar", file);
      return fetch("/api/account/avatar", {
        method: "POST",
        credentials: "same-origin",
        headers: { "X-CSRF-Token": readCookie("profit_csrf") },
        body: form,
      }).then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || "Upload failed");
          return data;
        });
      });
    },
  };
})();

// Header + mobile nav drawer "My Account" -> "My Library" / "Sign In" state,
// run on every page. .js-account-link/.js-account-text match both the
// desktop header icon (#headerAccountLink) and the drawer's row
// (#drawerAccountLink) so one auth check drives both. .js-account-only
// (My Profile / Orders / Sign Out) only ever makes sense for a signed-in
// user, so those rows stay hidden until this confirms a session exists.
document.addEventListener("DOMContentLoaded", function () {
  var links = document.querySelectorAll(".js-account-link");
  var texts = document.querySelectorAll(".js-account-text");
  // The drawer's customer rows — My Profile, Orders, Sign Out. All three are
  // meaningless to a signed-out visitor, so they ship hidden (u-hidden, set
  // in partials/header.html) and are revealed only once a session is
  // confirmed. Hiding by default rather than showing by default matters: an
  // API failure leaves a logged-out visitor with a clean menu instead of
  // three rows that bounce them to /login.
  var accountOnly = document.querySelectorAll(".js-account-only");
  var signOutBtns = document.querySelectorAll(".js-signout");
  if (!links.length && !texts.length) return;

  window.ProFitAPI.me().then(function (data) {
    if (!data.user) return;
    links.forEach(function (a) { a.href = "/my-library"; });
    // The greeting name when we have one — "Sam" reads as an account,
    // "My Library" reads as a menu item.
    var label = data.user.greetingName || "My Library";
    texts.forEach(function (t) { t.textContent = label; });
    accountOnly.forEach(function (el) { el.classList.remove("u-hidden"); });

    signOutBtns.forEach(function (btn) {
      btn.addEventListener("click", function () {
        window.ProFitAPI.logout().then(function () { window.location.href = "/"; });
      });
    });

    wireAccountMenu(label);
  }).catch(function () {
    // Not logged in or API unreachable — leave the default "Sign In" state.
  });

  // The desktop header's account slot, once a session is confirmed: the
  // "Sign In" link steps aside for a menu holding the same four rows the
  // mobile drawer already had. Those rows previously existed ONLY inside
  // .mobile-account-links, which is d-lg-none, so above 991px a signed-in
  // customer had no link to /my-profile or /orders anywhere on the site.
  //
  // Click to open, not hover — this menu contains Sign Out, and a pointer
  // crossing the corner of the header should never put that under the
  // cursor. Closes on outside click, on Escape (focus returns to the
  // button), and on any real navigation.
  function wireAccountMenu(label) {
    var wrap = document.getElementById("headerAccountWrap");
    var btn = document.getElementById("headerAccountBtn");
    var menu = document.getElementById("headerAccountMenu");
    var link = document.getElementById("headerAccountLink");
    var btnText = document.getElementById("headerAccountBtnText");
    if (!wrap || !btn || !menu || !link) return;

    btnText.textContent = label;
    link.classList.add("u-hidden");
    btn.classList.remove("u-hidden");

    function open() {
      menu.hidden = false;
      // Two frames: the panel must be laid out in its closed transform before
      // the class flips, or the browser coalesces both and there is no
      // transition at all.
      requestAnimationFrame(function () {
        requestAnimationFrame(function () { wrap.classList.add("is-open"); });
      });
      btn.setAttribute("aria-expanded", "true");
      document.addEventListener("click", onDocClick, true);
      document.addEventListener("keydown", onKeydown);
    }
    function close(returnFocus) {
      wrap.classList.remove("is-open");
      btn.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onDocClick, true);
      document.removeEventListener("keydown", onKeydown);
      window.setTimeout(function () {
        if (!wrap.classList.contains("is-open")) menu.hidden = true;
      }, 200);
      if (returnFocus) btn.focus();
    }
    function isOpen() { return wrap.classList.contains("is-open"); }
    function onDocClick(e) {
      if (!wrap.contains(e.target)) close(false);
    }
    function onKeydown(e) {
      if (e.key === "Escape" || e.key === "Esc") {
        e.stopPropagation();
        close(true);
      }
    }

    btn.addEventListener("click", function (e) {
      e.preventDefault();
      e.stopPropagation();
      if (isOpen()) close(false); else open();
    });
    // A chosen row navigates; leaving the panel open behind it flashes on
    // pages that restore from bfcache.
    menu.querySelectorAll("a").forEach(function (a) {
      a.addEventListener("click", function () { close(false); });
    });
  }
});
