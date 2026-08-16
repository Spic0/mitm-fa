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
  var currentPaymentIntentId = null;
  // Held for the finalize call, which requires it as proof this browser owns
  // the PaymentIntent before the server will mint a session. On a redirect
  // return the intent is recreated from the URL, where Stripe puts both
  // values itself.
  var currentClientSecret = null;

  // Contact & Billing is owned by checkout-customer-form.js, which validates
  // all four fields and composes the E.164 phone number. Falling back to a
  // bare email read keeps this file working if that module ever fails to load
  // rather than breaking checkout outright.
  var customerForm = window.ProFitCheckoutCustomer;

  function currentCustomer() {
    if (customerForm) return customerForm.getDetails();
    var el = document.getElementById("email");
    return { name: "", email: el ? el.value.trim().toLowerCase() : "", phone: "", country: "" };
  }

  function currentEmail() {
    return currentCustomer().email;
  }

  // True only when every required field passes; used to decide whether it's
  // worth asking the server for a PaymentIntent yet.
  function customerReady() {
    return customerForm ? customerForm.isComplete() : EMAIL_RE.test(currentEmail());
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
    // The element ships with the `u-hidden` class. An inline display:block does
    // currently beat it (`.u-hidden` carries no !important), but that's a
    // coincidence of the stylesheet, not a contract — one `!important` added to
    // that utility class would silently make every payment error invisible.
    // Toggle the class as well so visibility doesn't depend on that.
    el.classList.toggle("u-hidden", !friendly);
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

  // The cart is deliberately NOT cleared here — the success page clears it
  // once it has confirmed the order actually exists server-side. Clearing on
  // the way out would empty the cart of a buyer whose fulfillment went wrong,
  // making a retry harder at exactly the worst moment.
  function goToConfirmation(result) {
    window.location.href =
      (result && result.redirect) ||
      (result && result.orderId ? "/order/success?order=" + encodeURIComponent(result.orderId) : "/my-library");
  }

  // The sticky bottom bar is the ONE checkout CTA at every viewport width —
  // the in-page button that used to sit in the order summary was deleted, not
  // hidden, so there is a single element and a single code path rather than
  // one button mirroring another's state.
  function setPlaceOrderBusy(busy, label) {
    var btn = document.getElementById("coStickyCta");
    var text = document.getElementById("coStickyCtaText");
    if (!btn || !text) return;
    // `disabled` keeps the existing dimming; `is-busy` additionally swaps the
    // lock icon for a spinner and sets pointer-events:none, which is the real
    // double-submit guard — a second tap while a PaymentIntent is in flight
    // would otherwise create a second one.
    btn.classList.toggle("disabled", busy);
    btn.classList.toggle("is-busy", busy);
    btn.disabled = !!busy;
    btn.setAttribute("aria-busy", String(!!busy));
    text.textContent = label || "Secure Checkout";
  }

  async function finalizeStripePayment(paymentIntentId, clientSecret) {
    setPlaceOrderBusy(true, "Finalizing your order…");
    try {
      var result = await api.finalizeStripe(paymentIntentId, clientSecret);
      goToConfirmation(result);
    } catch (err) {
      // The payment itself has already succeeded at this point — only the
      // session/redirect step failed. The webhook will still fulfill the
      // order, so the copy must not imply the money didn't move.
      showError(
        err.message ||
          "Your payment went through, but we couldn't open your library automatically. Check your email for a sign-in link."
      );
      setPlaceOrderBusy(false);
      checkoutInFlight = false;
    }
  }

  // Resolved once on load, BEFORE any form validity is known. The old code
  // only reached the publishable-key check after all four contact fields
  // validated, so a store with no key showed an empty payment panel and no
  // explanation — the shopper had to fill in the whole form to discover that
  // card payment was never available.
  var stripeConfigured = null; // null = not yet known

  async function resolvePaymentAvailability() {
    var config;
    try {
      config = await api.getConfig();
    } catch (err) {
      setPaymentState("failed");
      return {};
    }
    stripeConfigured = !!config.stripePublishableKey;
    markUnconfiguredMethods(config);
    setPaymentState(stripeConfigured ? (customerReady() ? "pending" : "pending") : "unavailable");
    return config;
  }

  // PayPal's button is rendered by the SDK inside its own cross-origin iframe,
  // so its appearance can't be changed from here and there is no "disabled"
  // to set on it. The container carries the state instead: dimmed, with a line
  // saying what is missing, so the button reads as not-yet-ready before it is
  // tapped rather than after.
  //
  // It stays CLICKABLE on purpose. `pointer-events: none` would make a tap do
  // nothing at all, which is the worse failure — the shopper gets no reason.
  // A tap now runs the onClick gate, which rejects before the SDK opens its
  // window and marks the offending fields inline.
  function syncPaypalReadiness() {
    var box = document.querySelector(".co-pp-box");
    if (!box) return;
    box.classList.toggle("is-awaiting-details", !customerReady());
  }

  // Re-evaluates the placeholder after the shopper edits their details, so the
  // "fill in your details" prompt clears the moment it stops being true.
  function refreshPaymentState() {
    syncPaypalReadiness();
    if (paymentElementMounted) return setPaymentState("ready");
    if (stripeConfigured === false) return setPaymentState("unavailable");
    if (stripeConfigured === null) return setPaymentState("checking");
    setPaymentState("pending");
  }

  // The mount is triggered by blur AND change, on four fields, and it only
  // flips `paymentElementMounted` after two awaits — so every caller that
  // arrives in the meantime passes the guard. Measured on production: four
  // POSTs to /create-intent for a single checkout, four PaymentIntents on the
  // live account, and four Payment Elements mounted into the same node, of
  // which the shopper sees the last. Holding the in-flight promise makes the
  // extra callers await the first attempt instead of starting their own.
  var stripeInitPromise = null;

  // The latch is released once the attempt settles UNLESS it actually mounted:
  // a run that bailed early (details still incomplete, cart empty) or failed
  // must be retryable, and a run that succeeded must never be repeated. Doing
  // it here — rather than at each `return` inside the attempt — is what keeps
  // it correct: the early returns run synchronously, before this function has
  // even assigned the promise, so clearing it in there would be undone by the
  // assignment below.
  function initStripeElement() {
    if (stripeInitPromise) return stripeInitPromise;
    stripeInitPromise = doInitStripeElement().then(
      function (v) { if (!paymentElementMounted) stripeInitPromise = null; return v; },
      function (err) { stripeInitPromise = null; throw err; }
    );
    return stripeInitPromise;
  }

  // Stripe.js is loaded `async` (see the tag in checkout.html for why), so the
  // `Stripe` global is not guaranteed to exist by the time a shopper has
  // finished the four contact fields. Bare `Stripe(...)` would throw a
  // ReferenceError into the catch below and show "Could not start checkout" for
  // what is only a slow script. Poll instead, and give up rather than hang: if
  // js.stripe.com is blocked outright (a shield, an extension, a corporate
  // proxy) card payment genuinely is unavailable, and saying so is the correct
  // outcome — PayPal is unaffected either way.
  var STRIPE_WAIT_MS = 10000;
  function waitForStripe() {
    if (typeof Stripe !== "undefined") return Promise.resolve(true);
    return new Promise(function (resolve) {
      var deadline = Date.now() + STRIPE_WAIT_MS;
      (function poll() {
        if (typeof Stripe !== "undefined") return resolve(true);
        if (Date.now() > deadline) return resolve(false);
        setTimeout(poll, 100);
      })();
    });
  }

  async function doInitStripeElement() {
    var items = checkoutItemsPayload();
    if (paymentElementMounted || items.length === 0) return;
    if (stripeConfigured === false) { setPaymentState("unavailable"); return; }
    if (!customerReady()) { refreshPaymentState(); return; }

    try {
      var config = await api.getConfig();
      if (!config.stripePublishableKey) {
        stripeConfigured = false;
        setPaymentState("unavailable");
        return;
      }
      if (!(await waitForStripe())) {
        // Card only. markUnconfiguredMethods() would take PayPal down with it,
        // and PayPal has nothing to do with js.stripe.com being unreachable.
        stripeConfigured = false;
        setMethodEnabled("card", false);
        setPaymentState("unavailable");
        return;
      }
      stripe = Stripe(config.stripePublishableKey);
      var intent = await api.createStripeIntent(items, currentCustomer(), cart.appliedPromoCode);
      currentPaymentIntentId = intent.id;
      currentClientSecret = intent.clientSecret;
      elements = stripe.elements({ clientSecret: intent.clientSecret });
      var paymentElement = elements.create("payment");
      paymentElement.mount("#stripe-payment-element");
      paymentElementMounted = true;
      // Real card fields are now on screen — the placeholder stands down.
      setPaymentState("ready");
    } catch (err) {
      setPaymentState("failed");
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
      await api.updateStripeIntent(currentPaymentIntentId, checkoutItemsPayload(), cart.appliedPromoCode, currentCustomer());
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
  // The live carousel instance, kept so a re-render (the cart changed, so the
  // picks changed) tears the old one down instead of leaking a Swiper bound to
  // detached nodes — this function re-runs on every profit:cart-changed.
  var recosSwiper = null;

  function destroyRecosSwiper() {
    if (recosSwiper && typeof recosSwiper.destroy === "function") {
      try { recosSwiper.destroy(true, true); } catch (e) { /* already gone */ }
    }
    recosSwiper = null;
  }

  function recoCardHtml(p, cls) {
    var img = p.imageUrl || "/assets/images/placeholder.jpg";
    var price = (p.priceCents / 100).toFixed(2);
    return (
      '<article class="' + cls + '" role="listitem">' +
      '<div class="co-reco__media"><img src="' + escapeAttr(img) + '" alt="" loading="lazy" decoding="async"></div>' +
      '<div class="co-reco__body">' +
      '<span class="co-reco__name">' + escapeAttr(p.name) + "</span>" +
      '<span class="co-reco__price">$' + price + "</span>" +
      "</div>" +
      '<button type="button" class="co-reco__add" data-add-to-cart' +
      ' aria-label="Add ' + escapeAttr(p.name) + ' to your order"' +
      ' data-id="' + escapeAttr(p.id) + '" data-name="' + escapeAttr(p.name) + '"' +
      ' data-price="' + price + '" data-img="' + escapeAttr(img) + '">' +
      '<i class="fa-solid fa-plus" aria-hidden="true"></i><span>Add</span></button>' +
      "</article>"
    );
  }

  // Swiper 8 is already bundled and loaded sitewide on this page, so the
  // looping carousel costs no new dependency. Loop mode is what makes the
  // swipe continuous: Swiper keeps cloned slides either side of the real ones
  // and silently repositions at the seam, so a thumb can keep flicking in one
  // direction forever instead of hitting a dead end after six cards.
  //
  // The clones are why the "Add" buttons must stay delegated: script.js binds
  // [data-add-to-cart] at the document, so a tap on a cloned card adds through
  // exactly the same path as a tap on an original.
  // "Swipe →" is a promise the section has to keep. When every pick already
  // fits on screen Swiper locks itself and there is nothing to swipe to, so
  // the hint stands down rather than inviting a gesture that does nothing.
  function syncSwipeHint(root, locked) {
    var wrap = root.querySelector(".co-recos");
    if (wrap) wrap.classList.toggle("co-recos--static", !!locked);
  }

  function initRecosCarousel(root, count) {
    var el = root.querySelector(".co-recos__swiper");
    if (!el || typeof window.Swiper !== "function") return false;
    try {
      recosSwiper = new window.Swiper(el, {
        slidesPerView: "auto",
        spaceBetween: 12,
        // Below three cards there is nothing to loop through — Swiper would be
        // cloning one card next to itself, which reads as a bug rather than a
        // carousel.
        loop: count >= 3,
        loopedSlides: count,
        loopAdditionalSlides: count,
        grabCursor: true,
        watchSlidesProgress: true,
        // Free-mode momentum is what keeps it feeling native rather than
        // stepped: a flick coasts across several cards and can be caught
        // mid-flight, the same as the platform's own scrolling.
        freeMode: { enabled: true, momentum: true, momentumRatio: 0.85, momentumVelocityRatio: 0.85 },
        // An infinite track has no ends, so the rubber-band resistance that
        // exists to signal one is just drag.
        resistanceRatio: 0,
        speed: 420,
        a11y: { enabled: false },
        on: {
          // Fires on init and on any resize that changes whether the track
          // overflows — e.g. a phone turned landscape.
          lock: function () { syncSwipeHint(root, true); },
          unlock: function () { syncSwipeHint(root, false); },
        },
      });
      syncSwipeHint(root, recosSwiper.isLocked);
      // Loop clones are the same six products over again. Left as-is a screen
      // reader walks the list three times, and tabbing through the section
      // hits eighteen "Add" buttons for six products. The clones are decorative
      // — the originals carry the semantics.
      el.querySelectorAll(".swiper-slide-duplicate").forEach(function (clone) {
        clone.setAttribute("aria-hidden", "true");
        // aria-hidden over a focusable control is itself a violation, so the
        // clone's button leaves the tab order with it.
        clone.querySelectorAll("button").forEach(function (btn) { btn.tabIndex = -1; });
      });
      return true;
    } catch (e) {
      // A failed init must not cost the shopper the section; the caller falls
      // back to the native scroll track.
      recosSwiper = null;
      return false;
    }
  }

  async function renderRecommendations() {
    var container = document.getElementById("checkoutRecommended");
    if (!container || !api) return;
    destroyRecosSwiper();
    var items = cart.getCheckoutItems();
    if (!items.length) { container.innerHTML = ""; return; }

    try {
      // 6 rather than 3: the carousel scrolls, so more picks cost no vertical
      // space and give the swipe somewhere to go.
      var data = await api.getRecommendations(items.map(function (i) { return i.id; }), 6);
      var products = data.products || [];
      if (!products.length) { container.innerHTML = ""; return; }

      var head =
        '<div class="co-recos">' +
        '<div class="co-recos__head">' +
        '<p class="co-recos__ttl">You may also like</p>' +
        '<span class="co-recos__hint" aria-hidden="true">Swipe <i class="fa-solid fa-arrow-right-long"></i></span>' +
        "</div>";

      var swiperHtml = head + '<div class="swiper co-recos__swiper"><div class="swiper-wrapper" role="list">';
      products.forEach(function (p) { swiperHtml += recoCardHtml(p, "swiper-slide co-reco"); });
      swiperHtml += "</div></div></div>";

      container.innerHTML = swiperHtml;
      if (initRecosCarousel(container, products.length)) return;

      // Fallback for the case where the bundle didn't load: a native
      // scroll-snap track. Not looping, but still a real horizontal swipe with
      // the platform's own momentum — never a static grid of cards.
      var trackHtml = head + '<div class="co-recos__track" role="list">';
      products.forEach(function (p) { trackHtml += recoCardHtml(p, "co-reco"); });
      trackHtml += "</div></div>";
      container.innerHTML = trackHtml;
      var track = container.querySelector(".co-recos__track");
      if (track) syncSwipeHint(container, track.scrollWidth <= track.clientWidth + 4);
    } catch (err) {
      destroyRecosSwiper();
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

    // Delegates to the form module, which marks every field, shows the inline
    // errors and focuses the first bad one — far more actionable on mobile
    // than one generic message below the fold.
    if (customerForm && !customerForm.validate()) return;
    if (!customerForm && !EMAIL_RE.test(currentEmail())) {
      showError("Please fill in your name, phone, and a valid email above.");
      return;
    }
    // Card payment simply isn't available on this store — say so, rather than
    // returning silently and leaving a tapped button with no explanation.
    if (stripeConfigured === false) {
      showError("Card payment isn't available right now. Please try another method or contact support.");
      return;
    }
    if (!paymentElementMounted) {
      await initStripeElement();
      if (!paymentElementMounted) {
        // initStripeElement already set the panel's state; surface a matching
        // line next to the button the shopper actually pressed.
        showError(
          stripeConfigured === false
            ? "Card payment isn't available right now. Please try another method or contact support."
            : "We couldn't load the card form. Please refresh and try again."
        );
        return;
      }
      showError("Enter your card details, then tap Secure Checkout again.");
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
      await finalizeStripePayment(result.paymentIntent.id, currentClientSecret);
    } catch (err) {
      showError(err.message || "Payment failed. Please try again.");
      setPlaceOrderBusy(false);
      checkoutInFlight = false;
    }
  }

  // A payment method that isn't configured is DISABLED, not deleted. Removing
  // it left the card panel showing nothing but a row of brand logos whenever
  // STRIPE_PUBLISHABLE_KEY was absent, which is indistinguishable from a
  // broken shop. A visibly unavailable method at least tells the shopper the
  // method exists and that the problem isn't them.
  //
  // The Google Pay and Apple Pay tabs stay deleted: Stripe's Payment Element
  // surfaces both inside the card panel on supported devices, so a separate
  // tab for them could only ever have been decorative.
  function markUnconfiguredMethods(config) {
    setMethodEnabled("paypal", !!config.paypalClientId);
    setMethodEnabled("card", !!config.stripePublishableKey);
    syncAcceptedBadges(config);

    // If the active tab is the unavailable one but another method works,
    // switch to the working one rather than stranding the shopper on a dead
    // panel they have to figure out for themselves.
    var active = document.querySelector(".pay-tab.active");
    if (active && active.classList.contains("is-unavailable")) {
      var usable = document.querySelector(".pay-tab:not(.is-unavailable)");
      if (usable) usable.click();
    }
  }

  // The "accepted payment methods" badge row is reassurance copy, not a
  // control — but it is still a claim about what this store takes, and a
  // VISA/PayPal/Apple Pay row on a checkout that can't process any of them is
  // a promise the page can't keep. The badges are driven off the same config
  // the tabs are, so the two can't disagree.
  //
  // Card-network and wallet badges all ride on Stripe: if there's no
  // publishable key, none of them are real. Apple Pay and Google Pay
  // additionally depend on the shopper's device and on dashboard-side
  // configuration that the browser can't see from here, so they're shown
  // whenever Stripe is live and left to the Payment Element to surface or
  // not — an accepted-methods list is allowed to be slightly broader than
  // what one particular device offers, in a way a BUTTON would not be.
  var BADGE_REQUIREMENTS = {
    visa: "stripe", mc: "stripe", amex: "stripe",
    applepay: "stripe", gpay: "stripe",
    paypal: "paypal",
  };

  function syncAcceptedBadges(config) {
    var available = {
      stripe: !!config.stripePublishableKey,
      paypal: !!config.paypalClientId,
    };
    document.querySelectorAll(".card-brand").forEach(function (badge) {
      var brand = null;
      Object.keys(BADGE_REQUIREMENTS).forEach(function (key) {
        if (badge.classList.contains(key)) brand = key;
      });
      if (!brand) return;
      var ok = available[BADGE_REQUIREMENTS[brand]];
      badge.classList.toggle("u-hidden", !ok);
    });
  }

  function setMethodEnabled(method, enabled) {
    var tab = document.querySelector('.pay-tab[data-method="' + method + '"]');
    if (!tab) return;
    tab.classList.toggle("is-unavailable", !enabled);
    tab.setAttribute("aria-disabled", String(!enabled));
    if (!enabled && !tab.querySelector(".pay-tab__badge")) {
      var badge = document.createElement("span");
      badge.className = "pay-tab__badge";
      badge.textContent = "Unavailable";
      tab.appendChild(badge);
    }
  }

  // The card panel's single source of truth for "what should the shopper see
  // here right now". Called on load, after config resolves, whenever the
  // contact details change, and on mount success/failure — so the panel is
  // never empty and never stale.
  var PAY_STATES = {
    checking: {
      icon: "fa-credit-card",
      title: "Card payment",
      desc: "Checking available payment methods…",
    },
    pending: {
      icon: "fa-lock",
      title: "Card payment",
      desc: "Fill in your details above and the secure card fields will appear here.",
    },
    unavailable: {
      icon: "fa-circle-exclamation",
      title: "Card payment temporarily unavailable",
      desc: "Card payments aren't set up on this store yet. Nothing has been charged — please try another method or contact support.",
    },
    failed: {
      icon: "fa-circle-exclamation",
      title: "Couldn't load card payment",
      desc: "Please refresh the page and try again. You have not been charged.",
    },
  };

  function setPaymentState(state) {
    var box = document.getElementById("coPayState");
    if (!box) return;
    // "ready" means the Payment Element itself is mounted and visible, so the
    // placeholder stands down entirely rather than sitting above real fields.
    if (state === "ready") {
      box.setAttribute("data-state", "ready");
      return;
    }
    var copy = PAY_STATES[state] || PAY_STATES.checking;
    box.setAttribute("data-state", state);
    var icon = box.querySelector(".co-paystate__icon i");
    if (icon) icon.className = "fa-solid " + copy.icon;
    var title = document.getElementById("coPayStateTitle");
    var desc = document.getElementById("coPayStateDesc");
    if (title) title.textContent = copy.title;
    if (desc) desc.textContent = copy.desc;
  }

  // Availability (both methods) is resolved by resolvePaymentAvailability()
  // during init; this only loads the PayPal SDK when there's a client id.
  async function initPaypalButtons() {
    var config = await resolvePaymentAvailability();
    if (!config.paypalClientId) return;

    var script = document.createElement("script");
    script.src = "https://www.paypal.com/sdk/js?client-id=" + encodeURIComponent(config.paypalClientId) + "&currency=USD";
    // The SDK reads this off its own tag and stamps it onto every <style> and
    // <script> it injects into this document. Without it `style-src 'self'`
    // blocks the lot: the button's iframes lose `position: absolute` and stack
    // in normal flow, and the overlay that says "we opened a PayPal window,
    // click to continue" loses `position: fixed; z-index: 2147483647` and
    // becomes an invisible 158px block in the page — which is the difference
    // between a shopper who can get back to a popup their browser left behind
    // and one who is looking at what seems to be a dead window.
    var nonceMeta = document.querySelector('meta[name="csp-nonce"]');
    if (nonceMeta && nonceMeta.content) script.setAttribute("data-csp-nonce", nonceMeta.content);
    script.onload = function () {
      if (!window.paypal) return;

      // Same four required fields as the card path — PayPal supplies its own
      // email, but the order still needs a name, phone and country.
      function detailsOk() {
        if (customerForm) return customerForm.validate();
        if (!EMAIL_RE.test(currentEmail())) {
          showError("Please enter a valid email above before paying with PayPal.");
          return false;
        }
        return true;
      }

      window.paypal.Buttons({
        // THE popup gate. PayPal opens its window synchronously inside the
        // click — it has to, or the browser blocks it as un-gestured — and
        // then navigates it once createOrder resolves. So rejecting in
        // createOrder is already too late: the window is open, it never gets
        // a URL, and the shopper is looking at about:blank with no way back.
        // That was the reported bug, reproduced exactly: a target created at
        // about:blank and zero calls to /api/checkout/paypal/create-order.
        // onClick runs BEFORE the window is opened, and actions.reject()
        // stops it being opened at all, leaving the inline field errors as
        // the only thing that happens.
        onClick: function (data, actions) {
          if (!detailsOk()) {
            showError("Please complete your details above before paying with PayPal.");
            return actions.reject();
          }
          showError("");
          return actions.resolve();
        },
        createOrder: function () {
          // Still checked here: onClick is the gate, but createOrder is what
          // actually spends money, so it does not take the gate's word for it.
          // Rejects with copy a buyer can act on, not an internal marker:
          // this message reaches onError, which prints it verbatim, and
          // "incomplete details" was being shown on the live checkout.
          if (!detailsOk()) {
            return Promise.reject(new Error("Please complete your details above before paying with PayPal."));
          }
          return api.createPaypalOrder(checkoutItemsPayload(), currentCustomer(), cart.appliedPromoCode).then(function (data) {
            return data.orderId;
          });
        },
        onApprove: function (data) {
          setPlaceOrderBusy(true, "Finalizing your order…");
          return api.capturePaypalOrder(data.orderID).then(function (result) {
            goToConfirmation(result);
          }).catch(function (err) {
            // The money may well have moved — the capture call is what
            // failed to come back, and the webhook still fulfills. Say so
            // rather than inviting a second payment.
            setPlaceOrderBusy(false);
            showError(
              (err && err.message) ||
                "Your payment went through, but we couldn't open your library automatically. Check your email for a sign-in link."
            );
          });
        },
        // Closing PayPal's window is a normal thing to do and must leave the
        // checkout exactly as it was, not stuck behind a spinner.
        onCancel: function () {
          setPlaceOrderBusy(false);
          showError("");
        },
        onError: function (err) {
          setPlaceOrderBusy(false);
          showError((err && err.message) || "PayPal checkout failed. Please try again.");
        },
      }).render("#paypal-button-container");
    };
    document.body.appendChild(script);
  }

  function wireTabVisibility() {
    var stickyBar = document.getElementById("coStickyBar");
    document.querySelectorAll(".pay-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        // PayPal renders its own branded button inside its panel, so the
        // sticky bar stands down for that method rather than giving it two
        // competing calls to action.
        var isCard = tab.dataset.method === "card";
        if (stickyBar) stickyBar.classList.toggle("co-stickybar--suppressed", !isCard);
      });
    });
    document.querySelectorAll(".co-switch-to-card").forEach(function (btn) {
      btn.addEventListener("click", function () {
        document.querySelector('.pay-tab[data-method="card"]').click();
      });
    });
  }

  // Stripe puts BOTH the intent id and its client secret on the return URL
  // for redirect-based methods (3D Secure, bank redirects), which is where
  // the finalize proof comes from on this path. `redirect_status` is Stripe's
  // own word and is only used to decide whether it's worth calling finalize
  // at all — the server re-retrieves the PaymentIntent and checks its real
  // status regardless, so a hand-edited "succeeded" in the URL buys nothing.
  async function handleStripeRedirectReturn() {
    var params = new URLSearchParams(window.location.search);
    var paymentIntentId = params.get("payment_intent");
    var clientSecret = params.get("payment_intent_client_secret");
    var redirectStatus = params.get("redirect_status");
    if (paymentIntentId && clientSecret && redirectStatus === "succeeded") {
      await finalizeStripePayment(paymentIntentId, clientSecret);
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

    // Mount the Payment Element as soon as all four details are valid, rather
    // than off the email field alone — the intent now carries name, phone and
    // country, so creating it earlier than that would post an incomplete
    // record. Re-checked on blur of any field and on country change, since
    // those are the last events before a shopper reaches for the CTA.
    var detailsForm = document.getElementById("coCustomerForm");
    if (detailsForm) {
      // Keeps the card panel's placeholder honest while the shopper types:
      // "fill in your details" has to stop being shown the moment it stops
      // being the reason the fields aren't there.
      detailsForm.addEventListener("input", refreshPaymentState);
      detailsForm.addEventListener("blur", function () {
        syncPaypalReadiness();
        if (!paymentElementMounted && customerReady()) initStripeElement();
      }, true);
      detailsForm.addEventListener("change", function () {
        syncPaypalReadiness();
        if (!paymentElementMounted && customerReady()) initStripeElement();
      });
    }
    // The page opens with an empty form, so the PayPal panel must start in the
    // awaiting state rather than looking ready until the first keystroke.
    syncPaypalReadiness();

    document.getElementById("coStickyCta").addEventListener("click", handlePlaceOrder);

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

// ---------------------------------------------------------------------------
// Sticky purchase bar — the single checkout CTA
// ---------------------------------------------------------------------------
// #coStickyCta IS the place-order button; the click handler is bound to it
// directly in the DOMContentLoaded block above. It used to be a second
// trigger that forwarded taps to an in-page button and mirrored that button's
// busy state through a MutationObserver — that button has been deleted, so
// both the forwarding and the mirroring are gone with it. This block now only
// keeps the displayed total in sync and hides the bar when there's nothing to
// buy.
(function stickyPurchaseBar() {
  var bar = document.getElementById("coStickyBar");
  var totalEl = document.getElementById("coStickyTotal");
  var source = document.getElementById("coTotal");
  if (!bar || !totalEl || !source) return;

  function itemCount() {
    try {
      var c = window.ProFitCart ? window.ProFitCart.getCheckoutItems() : [];
      return c.reduce(function (n, i) { return n + (i.qty || 1); }, 0);
    } catch (e) { return 0; }
  }

  function sync() {
    totalEl.textContent = source.textContent;
    // An empty cart has nothing to buy; showing a $0.00 purchase bar over an
    // empty-cart message would be nonsense.
    bar.classList.toggle("u-hidden", itemCount() === 0);
  }

  // The summary total is rendered asynchronously after the product lookup
  // resolves, so observe it rather than reading once at load.
  if (window.MutationObserver) {
    new MutationObserver(sync).observe(source, { childList: true, characterData: true, subtree: true });
  }
  document.addEventListener("profit:cart-changed", function () { setTimeout(sync, 0); });
  sync();
})();
