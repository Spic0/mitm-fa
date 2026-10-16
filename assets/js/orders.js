// MY ORDERS — /orders
//
// Rows that expand in place rather than a page per order. An order here is
// six lines of text and a list of what it contained; a navigation, a second
// route and a back button for that is more chrome than content, and on a
// phone it is a page load to read one number.
//
// The list endpoint already returns each order's items, so expanding a row
// costs no request. Nothing about the payment instrument is shown — the
// provider's name is as far as this goes, because a customer needs to know
// "you paid with PayPal", not anything that identifies the card.
(function () {
  "use strict";
  var A = window.AccountUI;
  var api = window.ProFitAPI;

  var PANELS = ["orLoading", "orSignedOut", "orContent"];
  var PROVIDER = { stripe: "Card", paypal: "PayPal", manual: "Manual", dev: "Test" };

  var STATUS_LABEL = {
    paid: "Paid",
    refunded: "Refunded",
    cancelled: "Cancelled",
    pending: "Pending",
    failed: "Failed",
  };

  function row(order, index) {
    var items = order.items || [];
    var when = A.formatDate(order.createdAt);
    // The customer-facing reference. Short, and the same id support will ask
    // for — not a second numbering scheme invented for display.
    var ref = "#" + String(order.id).slice(-8).toUpperCase();

    var lines = items.map(function (item) {
      var name = A.esc(item.name);
      // Only link items the customer can actually open. An item whose
      // product was since removed still belongs on the receipt, but as text.
      return (
        '<div class="ac-conf__item">' +
        A.cover(item.imageUrl, "", "52px", false) +
        (item.slug
          ? '<a class="ac-conf__item-name" href="/my-library/' + encodeURIComponent(item.slug) + '">' + name + "</a>"
          : '<span class="ac-conf__item-name">' + name + "</span>") +
        '<span class="ac-conf__item-price">' + A.money(item.priceCents) + "</span>" +
        "</div>"
      );
    }).join("");

    var status = STATUS_LABEL[order.status] || order.status;

    return (
      '<article class="ac-order" data-order="' + A.esc(order.id) + '">' +
      '<button type="button" class="ac-order__head" aria-expanded="false" aria-controls="orPanel' + index + '">' +
      "<span>" +
      '<span class="ac-order__ref">' + A.esc(ref) + "</span>" +
      '<span class="ac-order__when">' + A.esc(when) + " · " + A.esc(items.length + (items.length === 1 ? " item" : " items")) + "</span>" +
      "</span>" +
      '<span class="ac-order__right">' +
      '<span class="ac-order__total">' + A.money(order.totalCents) + "</span>" +
      '<i class="fa-regular fa-angle-down ac-order__chev" aria-hidden="true"></i>' +
      "</span></button>" +
      '<div class="ac-order__panel ac-hidden" id="orPanel' + index + '">' +
      lines +
      '<div class="ac-sum">' +
      '<div class="ac-sum__row"><span class="ac-sum__k">Payment</span><span class="ac-sum__v">' + A.esc(PROVIDER[order.provider] || order.provider) + "</span></div>" +
      '<div class="ac-sum__row"><span class="ac-sum__k">Status</span><span class="ac-sum__v">' + A.esc(status) + "</span></div>" +
      (order.discountCents > 0
        ? '<div class="ac-sum__row"><span class="ac-sum__k">Discount</span><span class="ac-sum__v">−' + A.money(order.discountCents) + "</span></div>"
        : "") +
      '<div class="ac-sum__row ac-sum__row--total"><span class="ac-sum__k">Total</span><span class="ac-sum__v">' + A.money(order.totalCents) + "</span></div>" +
      "</div></div></article>"
    );
  }

  document.addEventListener("DOMContentLoaded", function () {
    // Session first, for the same reason as My Library and My Profile: a
    // signed-out visitor must not generate a 401 to learn something
    // api.me() already knows.
    api.me().then(function (me) {
      if (!me || !me.user) {
        A.panel(PANELS, "orSignedOut");
        return null;
      }
      return api.getOrders();
    }).then(function (data) {
      if (!data) return;
      var orders = (data && data.orders) || [];
      A.panel(PANELS, "orContent");

      if (!orders.length) {
        A.show(A.$("orEmpty"), true);
        A.reveal(A.$("orContent"));
        return;
      }

      A.$("orList").innerHTML = orders.map(row).join("");

      // One delegated listener rather than one per row.
      A.$("orList").addEventListener("click", function (e) {
        var head = e.target.closest(".ac-order__head");
        if (!head) return;
        var card = head.closest(".ac-order");
        var panel = card.querySelector(".ac-order__panel");
        var open = card.classList.toggle("is-open");
        head.setAttribute("aria-expanded", open ? "true" : "false");
        A.show(panel, open);
      });

      A.reveal(A.$("orContent"));
    }).catch(function () {
      A.panel(PANELS, "orSignedOut");
    });
  });
})();
