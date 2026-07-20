// Shared UI helpers used across every admin page: toasts, confirm dialogs,
// skeleton loading rows, and empty states.
window.AdminUI = (function () {
  function ensureToastStack() {
    var stack = document.querySelector(".a-toast-stack");
    if (!stack) {
      stack = document.createElement("div");
      stack.className = "a-toast-stack";
      document.body.appendChild(stack);
    }
    return stack;
  }

  var TOAST_ICONS = {
    success: "fa-circle-check",
    error: "fa-circle-exclamation",
    warning: "fa-triangle-exclamation",
    info: "fa-circle-info",
  };
  // Errors and warnings need more reading time (and are rarer, so lingering
  // a bit longer doesn't clutter the stack) than a routine success/info
  // confirmation, which should get out of the way sooner.
  var TOAST_DURATIONS = { success: 4500, info: 4500, warning: 6000, error: 7000 };

  function toast(message, type) {
    type = TOAST_ICONS[type] ? type : "info";
    var duration = TOAST_DURATIONS[type];
    var stack = ensureToastStack();
    var el = document.createElement("div");
    el.className = "a-toast a-toast-" + type;
    el.innerHTML =
      '<div class="a-toast__icon"><i class="fa-solid ' + TOAST_ICONS[type] + '"></i></div>' +
      '<div class="a-toast__body">' + escapeHtml(message) + "</div>" +
      '<button type="button" class="a-toast__close" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button>' +
      '<div class="a-toast__progress"></div>';
    stack.appendChild(el);
    var progressEl = el.querySelector(".a-toast__progress");
    progressEl.style.animationDuration = duration + "ms";
    void el.offsetWidth; // force layout so the entrance transition plays
    el.classList.add("a-toast-in");

    var dismissed = false;
    var remaining = duration;
    var startedAt = Date.now();
    var timer = setTimeout(dismiss, duration);

    function dismiss() {
      if (dismissed) return;
      dismissed = true;
      // Collapse height/margin/padding down to 0 (not just fade opacity) so
      // the rest of the stack visibly closes the gap instead of the other
      // toasts snapping upward the instant this one is removed from the DOM.
      var rect = el.getBoundingClientRect();
      el.style.maxHeight = rect.height + "px";
      el.classList.add("a-toast-out");
      requestAnimationFrame(function () {
        el.style.maxHeight = "0px";
        el.style.marginBottom = "0px";
        el.style.paddingTop = "0px";
        el.style.paddingBottom = "0px";
      });
      setTimeout(function () { el.remove(); }, 240);
    }
    el.querySelector(".a-toast__close").addEventListener("click", dismiss);
    // Pausing keeps the remaining time (not a flat re-guess) so hovering
    // repeatedly never makes a toast linger far longer than its variant's
    // duration, and never cuts it short either.
    el.addEventListener("mouseenter", function () {
      clearTimeout(timer);
      remaining -= Date.now() - startedAt;
      progressEl.style.animationPlayState = "paused";
    });
    el.addEventListener("mouseleave", function () {
      startedAt = Date.now();
      timer = setTimeout(dismiss, remaining);
      progressEl.style.animationPlayState = "running";
    });
  }

  // Shared open/close for every `.a-modal-backdrop` in the admin (confirm
  // dialogs here, plus the product wizard and customer modals) so entrance/
  // exit motion, backdrop fade, and ESC-to-close behave identically
  // everywhere instead of each call site inventing its own abrupt show/hide.
  // Reference-counted so a confirm dialog opened on top of the wizard (or
  // any other already-open modal) doesn't unlock the body when it closes
  // first — the lock only lifts once every open modal has closed.
  var openModalCount = 0;
  function lockBodyScroll() {
    if (openModalCount === 0) document.body.classList.add("a-modal-body-lock");
    openModalCount++;
  }
  function unlockBodyScroll() {
    openModalCount = Math.max(0, openModalCount - 1);
    if (openModalCount === 0) document.body.classList.remove("a-modal-body-lock");
  }

  function openModal(backdrop) {
    document.body.appendChild(backdrop);
    void backdrop.offsetWidth; // force layout so the transition actually plays
    backdrop.classList.add("a-modal-open");
    lockBodyScroll();

    function onKeydown(e) {
      if (e.key === "Escape") closeModal(backdrop);
    }
    document.addEventListener("keydown", onKeydown);
    backdrop._removeKeydown = function () { document.removeEventListener("keydown", onKeydown); };
    return backdrop;
  }

  function closeModal(backdrop) {
    if (!backdrop || backdrop._closing) return;
    backdrop._closing = true;
    if (backdrop._removeKeydown) backdrop._removeKeydown();
    backdrop.classList.remove("a-modal-open");
    backdrop.classList.add("a-modal-closing");
    unlockBodyScroll();
    setTimeout(function () { backdrop.remove(); }, 200);
  }

  function confirmDialog(options) {
    return new Promise(function (resolve) {
      var backdrop = document.createElement("div");
      backdrop.className = "a-modal-backdrop";
      backdrop.innerHTML =
        '<div class="a-modal">' +
        '<h5>' + escapeHtml(options.title || "Are you sure?") + "</h5>" +
        '<p class="a-modal-desc">' + escapeHtml(options.message || "") + "</p>" +
        '<div class="a-modal-actions">' +
        '<button class="a-btn a-btn-secondary" data-action="cancel">Cancel</button>' +
        '<button class="a-btn ' + (options.danger ? "a-btn-danger" : "a-btn-primary") + '" data-action="confirm" style="' + (options.danger ? "background:var(--a-danger)" : "") + '">' + escapeHtml(options.confirmLabel || "Confirm") + "</button>" +
        "</div></div>";
      openModal(backdrop);

      function close(result) {
        closeModal(backdrop);
        resolve(result);
      }
      backdrop.querySelector('[data-action="cancel"]').addEventListener("click", function () { close(false); });
      backdrop.querySelector('[data-action="confirm"]').addEventListener("click", function () { close(true); });
    });
  }

  function skeletonRows(columns, rows) {
    var out = "";
    for (var r = 0; r < rows; r++) {
      out += "<tr>";
      for (var c = 0; c < columns; c++) {
        out += '<td><div class="a-skeleton" style="width:' + (60 + Math.random() * 30) + '%"></div></td>';
      }
      out += "</tr>";
    }
    return out;
  }

  // Metric-card-shaped placeholders for dashboard/analytics grids.
  function skeletonCards(count) {
    var out = "";
    for (var i = 0; i < count; i++) {
      out +=
        '<div class="a-card metric-card">' +
        '<div class="a-skeleton" style="width:55%;height:11px;margin-bottom:14px;"></div>' +
        '<div class="a-skeleton" style="width:' + (35 + Math.random() * 20) + '%;height:22px;"></div>' +
        "</div>";
    }
    return out;
  }

  // Generic block placeholder — used for charts and other non-tabular areas
  // while their data is still loading.
  function skeletonBlock(height) {
    return '<div class="a-skeleton" style="width:100%;height:' + (height || 220) + 'px;border-radius:8px;"></div>';
  }

  // Simple label/value list placeholder (settings panels, activity feeds).
  function skeletonList(rows) {
    var out = "";
    for (var i = 0; i < rows; i++) {
      out +=
        '<div style="display:flex;justify-content:space-between;gap:16px;padding:10px 0;border-bottom:1px solid var(--a-border);">' +
        '<div class="a-skeleton" style="width:40%;"></div><div class="a-skeleton" style="width:18%;"></div>' +
        "</div>";
    }
    return out;
  }

  // Row-level enter/exit/flash for dynamic tables — called around an
  // add/delete/status-change action so that specific row visibly leaves,
  // arrives, or updates instead of the whole table silently snapping to its
  // new contents on the next load().
  function animateRowRemoval(tr) {
    return new Promise(function (resolve) {
      if (!tr) return resolve();
      tr.classList.add("a-row-exit");
      var done = false;
      function finish() { if (done) return; done = true; resolve(); }
      tr.addEventListener("transitionend", finish, { once: true });
      setTimeout(finish, 260); // safety net if transitionend never fires
    });
  }

  function animateRowsIn(rows) {
    (rows || []).forEach(function (tr) {
      if (!tr) return;
      tr.classList.add("a-row-enter");
      tr.addEventListener("animationend", function () { tr.classList.remove("a-row-enter"); }, { once: true });
    });
  }

  function flashRow(tr) {
    if (!tr) return;
    tr.classList.add("a-row-flash");
    tr.addEventListener("animationend", function () { tr.classList.remove("a-row-flash"); }, { once: true });
  }

  function emptyState(icon, message) {
    return (
      '<div class="a-empty"><i class="fa-regular ' + (icon || "fa-inbox") + '"></i><p>' + message + "</p></div>"
    );
  }

  function escapeHtml(str) {
    var div = document.createElement("div");
    div.textContent = str == null ? "" : String(str);
    return div.innerHTML;
  }

  function formatCents(cents) {
    return "$" + (cents / 100).toFixed(2);
  }

  function formatDate(value) {
    var d = new Date(value);
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function formatDateTime(value) {
    var d = new Date(value);
    return d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  }

  return {
    toast: toast,
    confirmDialog: confirmDialog,
    openModal: openModal,
    closeModal: closeModal,
    animateRowRemoval: animateRowRemoval,
    animateRowsIn: animateRowsIn,
    flashRow: flashRow,
    skeletonRows: skeletonRows,
    skeletonCards: skeletonCards,
    skeletonBlock: skeletonBlock,
    skeletonList: skeletonList,
    emptyState: emptyState,
    escapeHtml: escapeHtml,
    formatCents: formatCents,
    formatDate: formatDate,
    formatDateTime: formatDateTime,
  };
})();
