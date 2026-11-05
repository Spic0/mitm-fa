// Demo mode (?demo=1), injected first in <head> by server/src/lib/demo-mode.js
// on every page the /partnership demo viewer frames. The page stays the real
// page; this only takes selling away from it:
//   * buy, add-to-cart and checkout controls read "Demo: checkout disabled"
//     and do nothing (a capture listener runs before script.js's handlers);
//   * /api/checkout and the payment providers are refused before the network,
//     so no Stripe or PayPal session can be created;
//   * same-origin links and GET forms keep ?demo=1, so the visitor never
//     clicks their way out of demo mode inside the frame.
// The server refuses checkout for ?demo=1 and for any framed load as well.
(function () {
  var LABEL = "Demo: checkout disabled";
  var BUY = ".product__cart, .product__buy-now, [data-add-to-cart], .cart-btn-checkout";
  var RELABEL = ".product__cart, .product__buy-now, .cart-btn-checkout";
  var BLOCKED_HOSTS = /(^|\.)(stripe\.com|paypal\.com)$/;

  function parse(u) {
    try { return new URL(u, location.href); } catch (e) { return null; }
  }
  function isCheckout(url) {
    return url.origin === location.origin && /^\/(api\/)?checkout(\/|\.|$)/.test(url.pathname);
  }
  function blocked(u) {
    var url = parse(u);
    return !!url && (isCheckout(url) || BLOCKED_HOSTS.test(url.hostname));
  }
  function withDemo(url) {
    if (url.origin !== location.origin || url.searchParams.get("demo") === "1") return false;
    // Files (PDFs, images) and API calls are not pages: leave them alone.
    if (/^\/api\//.test(url.pathname) || /\.(?!html$)[a-z0-9]+$/i.test(url.pathname)) return false;
    url.searchParams.set("demo", "1");
    return true;
  }

  // ---- Network: nothing that starts a payment leaves the page.
  var origFetch = window.fetch;
  if (origFetch) {
    window.fetch = function (input) {
      var u = typeof input === "string" ? input : (input && input.url) || String(input);
      if (blocked(u)) {
        return Promise.resolve(new Response(JSON.stringify({ error: LABEL }), { status: 403, headers: { "Content-Type": "application/json" } }));
      }
      return origFetch.apply(this, arguments);
    };
  }
  var xOpen = XMLHttpRequest.prototype.open;
  var xSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, u) {
    this.faDemoBlocked = blocked(String(u));
    return xOpen.apply(this, arguments);
  };
  XMLHttpRequest.prototype.send = function () {
    if (!this.faDemoBlocked) return xSend.apply(this, arguments);
    var xhr = this;
    setTimeout(function () { xhr.dispatchEvent(new Event("error")); }, 0);
  };

  // ---- Feedback.
  var toast = null;
  var toastTimer = 0;
  function say() {
    if (!toast) {
      toast = document.createElement("div");
      toast.className = "fa-demo-toast";
      toast.setAttribute("role", "status");
      document.body.appendChild(toast);
    }
    toast.textContent = LABEL;
    toast.classList.add("is-on");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { toast.classList.remove("is-on"); }, 2200);
  }

  // ---- Clicks: capture phase on window, ahead of every jQuery handler.
  window.addEventListener("click", function (e) {
    var t = e.target && e.target.closest ? e.target : null;
    if (!t) return;
    var buy = t.closest(BUY);
    var a = t.closest("a[href]");
    var url = a ? parse(a.getAttribute("href")) : null;
    if (buy || (url && blocked(url.href))) {
      e.preventDefault();
      e.stopImmediatePropagation();
      say();
      return;
    }
    if (url && withDemo(url)) a.setAttribute("href", url.pathname + url.search + url.hash);
  }, true);

  window.addEventListener("submit", function (e) {
    var form = e.target;
    var url = parse(form.getAttribute("action") || location.href);
    if (url && blocked(url.href)) {
      e.preventDefault();
      e.stopImmediatePropagation();
      say();
      return;
    }
    if ((form.method || "get").toLowerCase() === "get" && url && url.origin === location.origin && !form.querySelector('input[name="demo"]')) {
      var input = document.createElement("input");
      input.type = "hidden";
      input.name = "demo";
      input.value = "1";
      form.appendChild(input);
    }
  }, true);

  // ---- Labels: buy controls say what they do here. Cards render after a
  // fetch, so a MutationObserver catches the late ones.
  function relabel(root) {
    if (!root.querySelectorAll) return;
    Array.prototype.forEach.call(root.querySelectorAll(BUY), function (el) {
      if (el.hasAttribute("data-demo-off")) return;
      el.setAttribute("data-demo-off", "");
      el.setAttribute("aria-disabled", "true");
      if (el.matches(RELABEL)) el.textContent = LABEL;
    });
  }

  // ---- #buy: the "Checkout preview" tab opens on the purchase block, its
  // title and price at the top (under the 68px fixed header), the buy control ringed.
  function spotBuy() {
    if (location.hash !== "#buy") return;
    var btn = document.getElementById("productAddToCart");
    var top = document.getElementById("productCategoryLink") || document.getElementById("productTitle") || btn;
    if (!btn || !top) return;
    btn.classList.add("fa-demo-spot");
    window.scrollTo(0, Math.max(0, top.getBoundingClientRect().top + window.scrollY - 88));
  }

  document.addEventListener("DOMContentLoaded", function () {
    relabel(document);
    new MutationObserver(function (records) {
      records.forEach(function (r) {
        Array.prototype.forEach.call(r.addedNodes, function (n) { if (n.nodeType === 1) relabel(n.parentNode || n); });
      });
    }).observe(document.body, { childList: true, subtree: true });
    spotBuy();
  });
  // Images and the product fetch move the block after DOMContentLoaded.
  window.addEventListener("load", function () { setTimeout(spotBuy, 150); });
})();
