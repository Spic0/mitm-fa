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

  // Maps whatever came back — a Stripe decline code, a fetch rejection, a
  // timeout — onto something a buyer can act on. Stripe's own card messages
  // are already customer-facing and are passed through unchanged; everything
  // else (network stacks, 5xx bodies, "Failed to fetch") is replaced, because
  // a raw technical string at the payment step reads as "this shop is
  // broken" and loses the sale.
  var FRIENDLY = [
    [/card_declined|declined/i, "Your card was declined. Try another card or payment method."],
    [/expired_card|expired/i, "That card has expired. Please use a different card."],
    [/incorrect_cvc|cvc/i, "The security code didn't match. Please check it and try again."],
    [/insufficient_funds/i, "That card was declined for insufficient funds."],
    [/incorrect_number|invalid_number/i, "That card number doesn't look right. Please check it."],
    [/processing_error/i, "Your bank couldn't process that just now. Please try again in a moment."],
    [/timeout|timed out|ETIMEDOUT/i, "That took longer than expected. Check your connection and try again — you have not been charged twice."],
    [/failed to fetch|networkerror|network request failed|net::/i, "We couldn't reach the payment service. Check your connection and try again."],
    [/rate|too many/i, "Too many attempts. Please wait a moment and try again."],
  ];

  function friendlyMessage(raw) {
    var msg = String(raw == null ? "" : raw);
    if (!msg) return "Something went wrong. Please try again.";
    for (var i = 0; i < FRIENDLY.length; i++) {
      if (FRIENDLY[i][0].test(msg)) return FRIENDLY[i][1];
    }
    // Anything that looks like a stack trace, JSON, a status code or an
    // internal identifier never reaches the buyer.
    if (/[{}<>]|\bat \w+\.|https?:\/\/|^\d{3}\b|Error:/i.test(msg)) {
      return "We couldn't complete that payment. Please try again, or use a different payment method.";
    }
    return msg;
  }

  function showError(message) {
    var el = document.getElementById("stripe-payment-message");
    if (!el) return;
    var friendly = message ? friendlyMessage(message) : "";
    el.textContent = friendly;
    el.style.display = friendly ? "block" : "none";
    if (friendly) {
      el.setAttribute("role", "alert");
      // The message sits above a fixed bottom CTA on mobile; without this it
      // can be announced but never seen.
      if (el.scrollIntoView) el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
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
    // `disabled` keeps the existing dimming; `is-busy` additionally swaps the
    // lock icon for a spinner and sets pointer-events:none, which is the real
    // double-submit guard — a second tap while a PaymentIntent is in flight
    // would otherwise create a second one.
    btn.classList.toggle("disabled", busy);
    btn.classList.toggle("is-busy", busy);
    btn.setAttribute("aria-busy", String(!!busy));
    text.textContent = label || "Secure Checkout";
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

  // Any payment method that isn't actually configured is removed from the UI
  // rather than left as a tab that silently does nothing. The Google Pay and
  // Apple Pay tabs were deleted outright — Stripe's Payment Element surfaces
  // both inside the card panel on supported devices, so a separate tab for
  // them could only ever have been decorative.
  function hideUnconfiguredMethods(config) {
    if (!config.paypalClientId) {
      var tab = document.querySelector('.pay-tab[data-method="paypal"]');
      var panel = document.getElementById("panel-paypal");
      if (tab) tab.remove();
      if (panel) panel.remove();
    }
    // With a single method left there is nothing to switch between, so the
    // tab strip is noise.
    var tabs = document.querySelectorAll(".pay-tab");
    var strip = document.querySelector(".co-pay-tabs");
    if (strip && tabs.length < 2) strip.classList.add("u-hidden");
    if (tabs.length === 1) tabs[0].classList.add("active");
  }

  async function initPaypalButtons() {
    var config = await api.getConfig();
    hideUnconfiguredMethods(config);
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

// ---------------------------------------------------------------------------
// Mobile order-summary disclosure
// ---------------------------------------------------------------------------
// Progressive enhancement: without JS the body carries no .is-open class, so
// the CSS leaves it collapsed on mobile — which would hide the order. The
// toggle therefore opens it on first paint if the viewport is mobile and JS
// is running, and the summary stays fully visible on desktop regardless.
(function checkoutSummaryDisclosure() {
  var toggle = document.getElementById("coSummaryToggle");
  var body = document.getElementById("coSummaryBody");
  if (!toggle || !body) return;

  function setOpen(open) {
    body.classList.toggle("is-open", open);
    toggle.setAttribute("aria-expanded", String(open));
  }

  toggle.addEventListener("click", function () {
    setOpen(!body.classList.contains("is-open"));
  });

  // Mirror the grand total into the collapsed header so the number is on the
  // first screen whether or not the list is expanded. Driven off the same
  // cart-changed event the order summary itself listens for, so the two can
  // never disagree.
  var mirror = document.getElementById("coToggleTotal");
  var source = document.getElementById("coTotal");
  function syncTotal() {
    if (mirror && source) mirror.textContent = source.textContent;
  }
  document.addEventListener("profit:cart-changed", function () { setTimeout(syncTotal, 0); });
  // The summary renders asynchronously after the product lookup resolves, so
  // observe it rather than reading once at load.
  if (source && window.MutationObserver) {
    new MutationObserver(syncTotal).observe(source, { childList: true, characterData: true, subtree: true });
  }
  syncTotal();

  // Start collapsed on mobile (total visible, list one tap away), open on
  // desktop where there is room for both.
  setOpen(window.matchMedia("(min-width: 901px)").matches);
})();
