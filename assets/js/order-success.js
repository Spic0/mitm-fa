// ORDER CONFIRMATION — /order/success?order=<id>
//
// This page NEVER decides anything about payment state itself. It reads the
// order back from the server by id, and the server only has an order at all
// because a verified provider event (Stripe webhook / PayPal capture, or the
// signature-checked finalize call) created one. A query parameter saying
// "payment=success" is not, and must not become, an input here.
//
// The redesign changed the presentation and nothing about that rule: the
// same endpoint, the same three outcomes (paid / revoked / not-yet), the
// same refusal to declare a payment failed from the client.
(function () {
  "use strict";
  var A = window.AccountUI;
  var api = window.ProFitAPI;
  var cart = window.ProFitCart;

  var PANELS = ["osLoading", "osProblem", "osSuccess", "osRevoked"];
  var PROVIDER = { stripe: "Card", paypal: "PayPal", manual: "Manual", dev: "Test" };

  // The hero product — the one thing on this page that should look valuable.
  function hero(item) {
    var meta = [item.creator, item.difficulty].filter(Boolean).join(" · ");
    return (
      A.cover(item.imageUrl, item.name, "(min-width: 576px) 132px, 92px", true).replace(
        'class="ac-cover"', 'class="ac-cover ac-conf__cover"'
      ) +
      '<div class="ac-conf__meta">' +
      '<h2 class="ac-conf__name">' + A.esc(item.name) + "</h2>" +
      (meta ? '<p class="ac-conf__by">' + A.esc(meta) + "</p>" : "") +
      '<div class="ac-conf__tags">' +
      '<span class="ac-pill ac-pill--ok"><i class="fa-solid fa-check" aria-hidden="true"></i> <span>Full access</span></span>' +
      '<span class="ac-pill"><span>' + A.esc(A.money(item.priceCents)) + "</span></span>" +
      "</div></div>"
    );
  }

  function renderOrder(order, user) {
    var items = order.items || [];

    if (items.length) {
      A.$("osHero").innerHTML = hero(items[0]);
    } else {
      A.show(A.$("osHero"), false);
    }

    // Anything beyond the first item is listed compactly underneath — the
    // hero treatment is for one product, and repeating it four times makes
    // none of them feel important.
    if (items.length > 1) {
      var list = A.$("osItems");
      list.innerHTML = items.slice(1).map(function (item) {
        return (
          '<li class="ac-conf__item">' +
          A.cover(item.imageUrl, "", "52px", false) +
          '<span class="ac-conf__item-name">' + A.esc(item.name) + "</span>" +
          '<span class="ac-conf__item-price">' + A.money(item.priceCents) + "</span>" +
          "</li>"
        );
      }).join("");
      A.show(list, true);
      A.$("osSub").textContent = items.length + " programs are ready in your library.";
    }

    A.$("osOrderId").textContent = "#" + String(order.id).slice(-8).toUpperCase();
    A.$("osOrderDate").textContent = A.formatDate(order.createdAt);
    A.$("osOrderProvider").textContent = PROVIDER[order.provider] || order.provider;
    A.$("osTotal").textContent = A.money(order.totalCents);

    if (order.discountCents > 0) {
      A.show(A.$("osDiscountRow"), true);
      A.$("osDiscount").textContent = "−" + A.money(order.discountCents);
    }

    A.$("osEmail").textContent = (user && user.email) || "your email address";

    // A single-product order goes straight to that program — one fewer tap
    // between paying and training.
    if (items.length === 1 && items[0].slug) {
      A.$("osPrimary").href = "/my-library/" + encodeURIComponent(items[0].slug);
      A.$("osPrimaryText").textContent = "Open my program";
    } else {
      A.$("osPrimary").href = "/my-library";
      A.$("osPrimaryText").textContent = "Open my library";
      A.show(A.$("osSecondary"), false);
    }

    // No session: the order exists (they got here with its id) but the
    // browser is not signed in, so the honest next step is the email link,
    // not a button into a library that will ask them to sign in.
    if (!user) {
      A.show(A.$("osClaimNote"), true);
      A.$("osClaimText").textContent =
        "We've emailed you a link to set up your account and open your program. " +
        "It signs you in. No password needed the first time.";
    }
  }

  document.addEventListener("DOMContentLoaded", function () {
    var orderId = new URLSearchParams(window.location.search).get("order");
    if (!orderId) {
      A.panel(PANELS, "osProblem");
      return;
    }

    // Session first, order second — deliberately serial.
    //
    // The order endpoint is scoped to the session user, so with no session
    // the request can only 401. Asking anyway would put a red error in the
    // console of every buyer who lands here before claiming their account,
    // for an answer we already had. It costs nothing: api.me() is already
    // in flight from the header's own auth check and get() shares the one
    // promise per path, so this resolves without a second round trip.
    api.me().catch(function () { return null; }).then(function (me) {
      var user = me && me.user;
      if (!user) {
        // The purchase is real — they got here with its id — but nothing
        // about it can be shown to someone we cannot identify. The email
        // link is the honest next step.
        A.show(A.$("osClaimNote"), true);
        A.$("osClaimText").textContent =
          "We've emailed you a link to set up your account and open your program. " +
          "It signs you in. No password needed the first time.";
        A.$("osProblemDetail").textContent =
          "Check your email for your receipt and sign-in link, or sign in with the address you used at checkout.";
        A.panel(PANELS, "osProblem");
        return null;
      }
      return api.getOrder(orderId).then(function (data) { return { order: data.order, user: user }; });
    }).then(function (r) {
      if (!r) return;
      var order = r.order;
      var me = { user: r.user };

      if (order.status === "refunded" || order.status === "cancelled") {
        A.panel(PANELS, "osRevoked");
        return;
      }
      if (order.status !== "paid") {
        // pending/failed: the provider event hasn't landed yet, or didn't
        // confirm. Either way the "still confirming" panel is the honest
        // answer — this page has no standing to declare a payment failed.
        A.panel(PANELS, "osProblem");
        return;
      }

      renderOrder(order, me && me.user);
      A.panel(PANELS, "osSuccess");
      A.reveal(A.$("osSuccess"));

      // The purchase completed, so whatever was in the cart (or the buy-now
      // slot) has been bought. Cleared here rather than at redirect time so
      // a buyer who never reaches this page keeps their cart — if
      // fulfillment did go wrong, an emptied cart would make retrying
      // harder, not easier.
      if (cart) {
        cart.clearBuyNow();
        cart.saveCart([]);
      }
    }).catch(function (err) {
      // A 404 here is the signed-out case as much as the missing-order case:
      // the endpoint scopes by session user, so a buyer whose session cookie
      // didn't survive the payment redirect sees exactly this.
      var detail = A.$("osProblemDetail");
      if (detail && err && /sign in|unauthor|not authenticated/i.test(err.message || "")) {
        detail.textContent =
          "Please sign in with the email you used at checkout to see this order. " +
          "Your receipt email also contains a direct sign-in link.";
      }
      A.panel(PANELS, "osProblem");
    });
  });
})();
