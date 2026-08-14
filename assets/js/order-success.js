// Post-purchase confirmation for /order/success?order=<id>.
//
// This page NEVER decides anything about payment state itself. It reads the
// order back from the server by id, and the server only has an order at all
// because a verified provider event (Stripe webhook / PayPal capture, or the
// signature-checked finalize call) created one. A query parameter saying
// "payment=success" is not, and must not become, an input here.
(function () {
  var root = document.getElementById("osSuccess");
  if (!root) return;

  var api = window.ProFitAPI;
  var cart = window.ProFitCart;

  function show(id) {
    ["osLoading", "osProblem", "osSuccess", "osRevoked"].forEach(function (panel) {
      var el = document.getElementById(panel);
      if (el) el.classList.toggle("u-hidden", panel !== id);
    });
  }

  function money(cents) {
    return "$" + (Math.max(0, cents | 0) / 100).toFixed(2);
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  var PROVIDER_LABELS = { stripe: "Card", paypal: "PayPal", manual: "Manual", dev: "Test" };

  function renderItems(items) {
    var list = document.getElementById("osItems");
    list.innerHTML = "";
    items.forEach(function (item) {
      var li = document.createElement("li");
      li.className = "os-item";

      var img = document.createElement("img");
      img.className = "os-item__img";
      img.src = item.imageUrl || "/assets/images/placeholder.jpg";
      img.alt = "";
      img.loading = "lazy";
      img.decoding = "async";

      var name = document.createElement("span");
      name.className = "os-item__name";
      name.textContent = item.name;

      var price = document.createElement("span");
      price.className = "os-item__price";
      price.textContent = money(item.priceCents);

      // textContent throughout rather than innerHTML with interpolation:
      // product names are admin-authored free text and end up on a page the
      // buyer is guaranteed to open.
      li.appendChild(img);
      li.appendChild(name);
      li.appendChild(price);
      list.appendChild(li);
    });
  }

  function renderOrder(order, email) {
    document.getElementById("osOrderId").textContent = order.id;
    document.getElementById("osOrderDate").textContent = formatDate(order.createdAt);
    document.getElementById("osOrderProvider").textContent =
      PROVIDER_LABELS[order.provider] || order.provider;
    document.getElementById("osTotal").textContent = money(order.totalCents);

    if (order.discountCents > 0) {
      document.getElementById("osDiscountRow").classList.remove("u-hidden");
      document.getElementById("osDiscount").textContent = "−" + money(order.discountCents);
    }

    renderItems(order.items || []);

    var emailEl = document.getElementById("osEmail");
    if (emailEl) emailEl.textContent = email || "your email address";

    // A single-product order goes straight to that program rather than to the
    // library index — one fewer tap between paying and training.
    if ((order.items || []).length === 1 && order.items[0].slug) {
      var btn = document.getElementById("osLibraryBtn");
      var btnText = document.getElementById("osLibraryBtnText");
      btn.href = "/my-library/" + encodeURIComponent(order.items[0].slug);
      // The label lives in an inner <span> that .btn-one styles (and gives
      // `color: inherit`, so it survives the global span colour rule).
      // Replacing the anchor's own textContent would delete that span.
      if (btnText) btnText.textContent = "Start " + order.items[0].name;
    }
  }

  document.addEventListener("DOMContentLoaded", async function () {
    var orderId = new URLSearchParams(window.location.search).get("order");
    if (!orderId) {
      show("osProblem");
      return;
    }

    try {
      var data = await api.getOrder(orderId);
      var order = data.order;

      if (order.status === "refunded" || order.status === "cancelled") {
        show("osRevoked");
        return;
      }
      if (order.status !== "paid") {
        // pending/failed: the provider event hasn't landed yet, or didn't
        // confirm. Either way the "still confirming" panel is the honest
        // answer — this page has no standing to declare a payment failed.
        show("osProblem");
        return;
      }

      var me = null;
      try {
        me = await api.me();
      } catch (err) {
        me = null;
      }

      renderOrder(order, me && me.user ? me.user.email : null);
      show("osSuccess");

      // The purchase completed, so whatever was in the cart (or the
      // buy-now slot) has been bought. Cleared here rather than at redirect
      // time so a buyer who never reaches this page keeps their cart —
      // if fulfillment did go wrong, an emptied cart would make retrying
      // harder, not easier.
      if (cart) {
        cart.clearBuyNow();
        cart.saveCart([]);
      }
    } catch (err) {
      // A 404 here is the signed-out case as much as the missing-order case:
      // the endpoint scopes by session user, so a buyer whose session cookie
      // didn't survive the payment redirect sees exactly this.
      var detail = document.getElementById("osProblemDetail");
      if (detail && err && /sign in|unauthor/i.test(err.message || "")) {
        detail.textContent =
          "Please sign in with the email you used at checkout to see this order. " +
          "Your receipt email also contains a direct sign-in link.";
      }
      show("osProblem");
    }
  });
})();
