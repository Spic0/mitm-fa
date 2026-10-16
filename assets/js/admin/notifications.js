// Promotion notification center — a topbar bell/dropdown, not a standalone
// admin section (see the plan's scope note: this is fundamentally a small
// transient list). Fetched only when the dropdown is opened, never polled,
// so it adds no background traffic to every admin page load.
(function () {
  var TYPE_LABELS = {
    EXPIRES_30D: "Expires in 30 days",
    EXPIRES_14D: "Expires in 14 days",
    EXPIRES_7D: "Expires in 7 days",
    EXPIRES_3D: "Expires in 3 days",
    EXPIRES_24H: "Expires in 24 hours",
    USAGE_80PCT: "Reached 80% of usage limit",
    USAGE_MAX: "Reached maximum usage",
    HIGH_SALES: "Unusually high sales",
    NEVER_USED: "Has never been used",
    EXPIRED: "Has expired",
  };

  var btn, badge, dropdown, isOpen = false;

  function render(notifications) {
    if (!notifications.length) {
      dropdown.innerHTML = window.AdminUI.emptyState("fa-bell-slash", "No notifications.");
      return;
    }
    dropdown.innerHTML = notifications.map(function (n) {
      return (
        '<div class="admin-notif-item" data-id="' + n.id + '">' +
        '<div class="admin-notif-item__title">' + window.AdminUI.escapeHtml(n.promotionName || "Promotion") + " — " + (TYPE_LABELS[n.type] || n.type) + "</div>" +
        '<div class="admin-notif-item__time">' + window.AdminUI.escapeHtml(n.promotionCode || "") + " · " + window.AdminUI.formatDateTime(n.createdAt) + "</div>" +
        '<div class="admin-notif-item__actions">' +
        '<button data-act="dismiss">Dismiss</button>' +
        '<button data-act="snooze">Snooze 24h</button>' +
        '<button data-act="done">Mark Done</button>' +
        "</div></div>"
      );
    }).join("");

    dropdown.querySelectorAll("[data-act]").forEach(function (actionBtn) {
      actionBtn.addEventListener("click", function () {
        var item = actionBtn.closest(".admin-notif-item");
        var id = item.dataset.id;
        var action = actionBtn.dataset.act;
        var promise =
          action === "dismiss" ? window.AdminAPI.dismissPromotionNotification(id) :
          action === "snooze" ? window.AdminAPI.snoozePromotionNotification(id, 24) :
          window.AdminAPI.markPromotionNotificationDone(id);
        promise.then(function () {
          item.remove();
          if (!dropdown.querySelector(".admin-notif-item")) dropdown.innerHTML = window.AdminUI.emptyState("fa-bell-slash", "No notifications.");
          updateBadge();
        }).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
      });
    });
  }

  function updateBadge() {
    window.AdminAPI.listPromotionNotifications().then(function (data) {
      if (data.count > 0) {
        badge.textContent = data.count > 99 ? "99+" : String(data.count);
        badge.classList.remove("u-hidden");
      } else {
        badge.classList.add("u-hidden");
      }
    }).catch(function () {});
  }

  function open() {
    isOpen = true;
    dropdown.classList.remove("u-hidden");
    dropdown.innerHTML = window.AdminUI.skeletonList(3);
    window.AdminAPI.listPromotionNotifications().then(function (data) {
      render(data.notifications);
      if (data.count > 0) {
        badge.textContent = data.count > 99 ? "99+" : String(data.count);
        badge.classList.remove("u-hidden");
      } else {
        badge.classList.add("u-hidden");
      }
    }).catch(function (err) {
      dropdown.innerHTML = window.AdminUI.emptyState("fa-triangle-exclamation", err.message);
    });
  }

  function close() {
    isOpen = false;
    dropdown.classList.add("u-hidden");
  }

  document.addEventListener("admin-layout-ready", function () {
    btn = document.getElementById("adminNotifBtn");
    badge = document.getElementById("adminNotifBadge");
    dropdown = document.getElementById("adminNotifDropdown");
    if (!btn) return;

    btn.addEventListener("click", function (e) {
      e.stopPropagation();
      if (isOpen) close(); else open();
    });
    document.addEventListener("click", function (e) {
      if (isOpen && !dropdown.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && isOpen) close();
    });
  });

  // A lightweight badge check on load (one call, not a poll) so the bell
  // shows an accurate count even before the admin ever opens it.
  document.addEventListener("admin-role-ready", function () {
    btn = btn || document.getElementById("adminNotifBtn");
    badge = badge || document.getElementById("adminNotifBadge");
    if (btn) updateBadge();
  });
})();
