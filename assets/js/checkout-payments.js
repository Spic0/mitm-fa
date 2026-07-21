// Real payment wiring for checkout.html: Stripe Payment Element (card + auto
// Apple Pay / Google Pay) and PayPal Buttons. Runs only on the checkout page.
(function () {
  if (!document.getElementById("checkoutOrderList")) return;

  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  var api = window.ProFitAPI;
  var cart = window.ProFitCart;

  var stripe = null;
  var elements = null;
  var paymentElementMounted = false;
  var emailLocked = false;
  var currentPaymentIntentId = null;

  function currentEmail() {
    var el = document.getElementById("email");
    return el ? el.value.trim().toLowerCase() : "";
  }

  function escapeAttr(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
  }

  function showError(message) {
    var el = document.getElementById("stripe-payment-message");
    if (!el) return;
    el.textContent = message;
    el.style.display = message ? "block" : "none";
  }

  function checkoutItemsPayload() {
    return cart.getCheckoutItems().map(function (item) {
      return { productId: item.id, qty: item.qty || 1 };
    });
  }

  function clearCartOrBuyNow() {
    cart.clearBuyNow();
    cart.saveCart([]);
  }

  function goToLibrary() {
    clearCartOrBuyNow();
    window.location.href = "/my-library";
  }

  function setPlaceOrderBusy(busy, label) {
    var btn = document.getElementById("placeOrderBtn");
    var text = document.getElementById("placeOrderBtnText");
    if (!btn || !text) return;
    btn.classList.toggle("disabled", busy);
    text.textContent = label || "Checkout Securely";
  }

  async function finalizeStripePayment(paymentIntentId) {
    setPlaceOrderBusy(true, "Finalizing your order…");
    try {
      await api.finalizeStripe(paymentIntentId);
      goToLibrary();
    } catch (err) {
      showError(err.message || "We couldn't finalize your order. Please contact support.");
      setPlaceOrderBusy(false);
      checkoutInFlight = false;
    }
  }

  async function initStripeElement() {
    var items = checkoutItemsPayload();
    var email = currentEmail();
    if (paymentElementMounted || items.length === 0 || !EMAIL_RE.test(email)) return;

    try {
      var config = await api.getConfig();
      if (!config.stripePublishableKey) {
        showError("Payments are not configured yet.");
        return;
      }
      stripe = Stripe(config.stripePublishableKey);
      var intent = await api.createStripeIntent(items, email, cart.appliedPromoCode);
      currentPaymentIntentId = intent.id;
      elements = stripe.elements({ clientSecret: intent.clientSecret });
      var paymentElement = elements.create("payment");
      paymentElement.mount("#stripe-payment-element");
      paymentElementMounted = true;
      emailLocked = true;
      var emailInput = document.getElementById("email");
      if (emailInput) emailInput.readOnly = true;
    } catch (err) {
      showError(err.message || "Could not start checkout. Please try again.");
    }
  }

  // Keeps the already-created PaymentIntent in sync with the cart — e.g.
  // after a checkout-page recommendation is added. Server-side this updates
  // both the charge amount and the item list used at fulfillment; client-side
  // `elements.fetchUpdates()` refreshes whatever Stripe's Payment Element is
  // displaying (e.g. an Amount line for certain wallets) to match, without
  // remounting anything the shopper is already looking at.
  async function syncPaymentIntentIfNeeded() {
    if (!paymentElementMounted || !currentPaymentIntentId) return;
    try {
      await api.updateStripeIntent(currentPaymentIntentId, checkoutItemsPayload(), cart.appliedPromoCode);
      if (elements && typeof elements.fetchUpdates === "function") {
        await elements.fetchUpdates();
      }
    } catch (err) {
      showError(err.message || "Could not update your order total — please refresh and try again.");
    }
  }

  // "Add a little extra" — 2-3 rule-based picks (server/src/lib/
  // recommendations.js) rendered as small cards; each "+ Add" button is a
  // plain [data-add-to-cart] element, the same reusable add-to-cart hook
  // used sitewide (script.js), so adding one goes through the exact same
  // cart-mutation path as everywhere else — no bespoke logic here beyond
  // rendering the cards and re-fetching after the cart changes.
  async function renderRecommendations() {
    var container = document.getElementById("checkoutRecommended");
    if (!container || !api) return;
    var items = cart.getCheckoutItems();
    if (!items.length) { container.innerHTML = ""; return; }

    try {
      var data = await api.getRecommendations(items.map(function (i) { return i.id; }), 3);
      var products = data.products || [];
      if (!products.length) { container.innerHTML = ""; return; }

      var html = '<p class="co-recommend__ttl">Add a little extra</p><div class="co-recommend__row">';
      products.forEach(function (p) {
        var img = p.imageUrl || "/assets/images/placeholder.jpg";
        var price = (p.priceCents / 100).toFixed(2);
        html +=
          '<div class="co-recommend__item">' +
          '<img src="' + escapeAttr(img) + '" alt="">' +
          '<span class="co-recommend__name">' + escapeAttr(p.name) + '</span>' +
          '<span class="co-recommend__price">$' + price + '</span>' +
          '<button type="button" class="co-recommend__add" data-add-to-cart' +
          ' data-id="' + escapeAttr(p.id) + '" data-name="' + escapeAttr(p.name) + '"' +
          ' data-price="' + price + '" data-img="' + escapeAttr(img) + '">' +
          '<i class="fa-solid fa-plus"></i> Add</button>' +
          '</div>';
      });
      html += "</div>";
      container.innerHTML = html;
    } catch (err) {
      container.innerHTML = "";
    }
  }

  // Belt-and-suspenders alongside the CSS `.disabled { pointer-events: none }`
  // guard on the button itself (setPlaceOrderBusy): that one depends on the
  // DOM mutation landing before a second click is hit-tested, which holds up
  // for a real human double-click but not for a second, programmatic
  // invocation of this same handler (e.g. a stray duplicate listener) —
  // checked synchronously, before any `await`, so it can't be raced.
  var checkoutInFlight = false;

  async function handlePlaceOrder(e) {
    e.preventDefault();
    if (checkoutInFlight) return;
    showError("");

    var activeMethod = document.querySelector(".pay-tab.active");
    activeMethod = activeMethod ? activeMethod.dataset.method : "card";
    if (activeMethod !== "card") return; // PayPal has its own button; gpay/applepay just point back to Card

    var name = (document.getElementById("name") || {}).value || "";
    var phone = (document.getElementById("phone") || {}).value || "";
    var email = currentEmail();
    if (!name.trim() || !phone.trim() || !EMAIL_RE.test(email)) {
      showError("Please fill in your name, phone, and a valid email above.");
      return;
    }
    if (!paymentElementMounted) {
      await initStripeElement();
      if (!paymentElementMounted) return;
      showError("Enter your card details, then click Place Order again.");
      return;
    }

    checkoutInFlight = true;
    setPlaceOrderBusy(true, "Processing…");
    try {
      var result = await stripe.confirmPayment({
        elements: elements,
        confirmParams: { return_url: window.location.origin + "/checkout" },
        redirect: "if_required",
      });
      if (result.error) {
        showError(result.error.message);
        setPlaceOrderBusy(false);
        checkoutInFlight = false;
        return;
      }
      await finalizeStripePayment(result.paymentIntent.id);
    } catch (err) {
      showError(err.message || "Payment failed. Please try again.");
      setPlaceOrderBusy(false);
      checkoutInFlight = false;
    }
  }

  async function initPaypalButtons() {
    var config = await api.getConfig();
    if (!config.paypalClientId) return;

    var script = document.createElement("script");
    script.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(config.paypalClientId) + "&currency=USD";
    script.onload = function () {
      if (!window.paypal) return;
      window.paypal.Buttons({
        createOrder: function () {
          var email = currentEmail();
          if (!EMAIL_RE.test(email)) {
            showError("Please enter a valid email above before paying with PayPal.");
            return Promise.reject(new Error("invalid email"));
          }
          return api.createPaypalOrder(checkoutItemsPayload(), email, cart.appliedPromoCode).then(function (data) {
            return data.orderId;
          });
        },
        onApprove: function (data) {
          return api.capturePaypalOrder(data.orderID).then(function () {
            goToLibrary();
          });
        },
        onError: function (err) {
          showError((err && err.message) || "PayPal checkout failed. Please try again.");
        },
      }).render("#paypal-button-container");
    };
    document.body.appendChild(script);
  }

  function wireTabVisibility() {
    var placeOrderBtn = document.getElementById("placeOrderBtn");
    document.querySelectorAll(".pay-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        if (placeOrderBtn) placeOrderBtn.style.display = tab.dataset.method === "card" ? "" : "none";
      });
    });
    document.querySelectorAll(".co-switch-to-card").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelector('.pay-tab[data-method="card"]').click();
      });
    });
  }

  async function handleStripeRedirectReturn() {
    var params = new URLSearchParams(window.location.search);
    var paymentIntentId = params.get("payment_intent");
    var redirectStatus = params.get("redirect_status");
    if (paymentIntentId && redirectStatus === "succeeded") {
      await finalizeStripePayment(paymentIntentId);
      return true;
    }
    return false;
  }

  document.addEventListener("DOMContentLoaded", async function () {
    var handledRedirect = await handleStripeRedirectReturn();
    if (handledRedirect) return;

    if (cart.getCheckoutItems().length === 0) {
      window.location.href = "/shop";
      return;
    }

    wireTabVisibility();
    initPaypalButtons();
    renderRecommendations();

    var emailInput = document.getElementById("email");
    if (emailInput) {
      emailInput.addEventListener("blur", function () {
        if (!emailLocked) initStripeElement();
      });
    }

    document.getElementById("placeOrderBtn").addEventListener("click", handlePlaceOrder);

    // Adding a recommendation (or any other cart change) refreshes both the
    // "you might also like" picks (so an added item stops recommending
    // itself) and, if a PaymentIntent already exists, its charged amount.
    document.addEventListener("profit:cart-changed", function () {
      renderRecommendations();
      syncPaymentIntentIfNeeded();
    });
  });
})();
