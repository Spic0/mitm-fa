// Shared helpers for the customer area (confirmation, library, profile,
// orders, setup wizard).
//
// Small on purpose. These four pages are opened on a phone, often on mobile
// data, in the minute after a payment clears — the shared layer is a handful
// of formatters and DOM helpers, not a framework. Everything below is
// deliberately dependency-free and runs before any page script.
window.AccountUI = (function () {
  "use strict";

  // ---- text ----------------------------------------------------------
  // Product names, display names and order references are all
  // user-or-admin-authored free text that ends up on a page the customer is
  // guaranteed to open, so nothing here interpolates into innerHTML without
  // going through this.
  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function money(cents) {
    var n = Math.max(0, parseInt(cents, 10) || 0);
    return "$" + (n / 100).toFixed(2);
  }

  function formatDate(iso) {
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
  }

  // "3 days ago" for recency, falling back to a date past a fortnight —
  // "47 days ago" is arithmetic the reader has to do, a date is not.
  function relativeDate(iso) {
    if (!iso) return "";
    var then = new Date(iso).getTime();
    if (isNaN(then)) return "";
    var mins = Math.round((Date.now() - then) / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return mins + " minutes ago";
    var hours = Math.round(mins / 60);
    if (hours < 24) return hours === 1 ? "1 hour ago" : hours + " hours ago";
    var days = Math.round(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 14) return days + " days ago";
    return formatDate(iso);
  }

  // ---- dom -----------------------------------------------------------
  function $(id) { return document.getElementById(id); }

  function show(el, on) {
    if (!el) return;
    el.classList.toggle("ac-hidden", !on);
  }

  // Swaps which of a set of mutually exclusive panels is visible. Used for
  // loading / ready / error / signed-out on every page, so a page never has
  // to remember to hide the other three.
  function panel(ids, active) {
    ids.forEach(function (id) { show($(id), id === active); });
  }

  // ---- motion ---------------------------------------------------------
  // Entrance reveal. One rAF so the browser paints the pre-transition state
  // first — setting .is-in synchronously after inserting the node means the
  // element is created already-final and nothing animates.
  function reveal(root) {
    var els = (root || document).querySelectorAll(".ac-reveal:not(.is-in)");
    if (!els.length) return;
    requestAnimationFrame(function () {
      requestAnimationFrame(function () {
        els.forEach(function (el) { el.classList.add("is-in"); });
      });
    });
  }

  // ---- media ----------------------------------------------------------
  // Product covers. `sizes` is not optional and is the whole point: without
  // it the browser picks the widest candidate in the srcset for every slot,
  // which on a library of eight 84px thumbnails means eight full-size
  // downloads. Each caller passes the CSS size of the box it is filling.
  //
  // Falls back to a plain <img> when the image has no derivative manifest
  // (an older upload, or an external URL), which is the same degradation
  // every other surface on this site applies.
  function cover(url, alt, sizes, eager) {
    if (!url) {
      return '<span class="ac-cover" aria-hidden="true"></span>';
    }
    var loading = eager ? "" : ' loading="lazy"';
    var priority = eager ? ' fetchpriority="high"' : "";
    return (
      '<span class="ac-cover">' +
      '<img src="' + esc(url) + '" alt="' + esc(alt || "") + '"' +
      ' sizes="' + esc(sizes || "100vw") + '"' +
      loading + priority + ' decoding="async">' +
      "</span>"
    );
  }

  // ---- progress -------------------------------------------------------
  // Renders a bar ONLY when there is a real denominator. `percent` is null
  // until the program has been opened once and reported how many trackable
  // items it has (see ProgramProgress.totalKeys) — in that state this
  // returns the honest status line instead of a 0% bar, because nothing has
  // been measured yet and drawing an empty bar would claim otherwise.
  function progress(p, opts) {
    var options = opts || {};
    if (!p) return "";
    if (p.percent == null) {
      var label = p.started ? "In progress" : "Not started";
      if (options.withOpened && p.lastOpenedAt) {
        label += " · opened " + relativeDate(p.lastOpenedAt);
      }
      return '<p class="ac-progress"><span class="ac-progress__val">' + esc(label) + "</span></p>";
    }
    return (
      '<div class="ac-progress">' +
      '<span class="ac-progress__track"><span class="ac-progress__bar" data-progress-bar style-width="' + p.percent + '"></span></span>' +
      '<span class="ac-progress__val">' + p.percent + "%</span>" +
      "</div>"
    );
  }

  // The bar's width cannot be an inline style attribute: the CSP has no
  // 'unsafe-inline' in style-src, so style="width:40%" is dropped and every
  // bar renders empty. Set as a property after insertion instead — which
  // also means the CSS width transition actually runs.
  function paintProgress(root) {
    (root || document).querySelectorAll("[data-progress-bar]").forEach(function (bar) {
      var pct = parseInt(bar.getAttribute("style-width"), 10);
      if (!isFinite(pct)) return;
      requestAnimationFrame(function () { bar.style.width = Math.max(0, Math.min(100, pct)) + "%"; });
    });
  }

  // ---- avatar ---------------------------------------------------------
  function avatar(user, size) {
    var cls = "ac-avatar" + (size === "lg" ? " ac-avatar--lg" : "");
    if (user && user.avatarUrl) {
      return (
        '<span class="' + cls + '">' +
        '<img src="' + esc(user.avatarUrl) + '" alt="" sizes="' + (size === "lg" ? "88px" : "52px") + '" decoding="async">' +
        "</span>"
      );
    }
    return '<span class="' + cls + '">' + esc((user && user.initials) || "?") + "</span>";
  }

  // ---- country select --------------------------------------------------
  // Fills a <select> from the SAME list the checkout's country picker reads
  // (assets/js/countries.js), so the profile and the checkout can never
  // disagree about which countries exist or what they are called.
  //
  // If that script has not loaded, the existing value is preserved as the
  // only option rather than the select rendering empty — saving the profile
  // must never blank a country the customer already had just because a
  // reference script failed to arrive.
  function fillCountries(select, selected) {
    if (!select) return;
    var all = window.ProFitCountries && window.ProFitCountries.all;
    var options = ['<option value="">Not set</option>'];
    if (all && all.length) {
      all.forEach(function (c) {
        options.push('<option value="' + esc(c.code) + '">' + esc(c.name) + "</option>");
      });
    } else if (selected) {
      options.push('<option value="' + esc(selected) + '">' + esc(selected) + "</option>");
    }
    select.innerHTML = options.join("");
    select.value = selected || "";
  }

  // ---- forms ----------------------------------------------------------
  // Inline status under a section's save button. Cleared on the next edit by
  // the caller, so a stale "Saved" never sits under a changed field.
  function status(el, message, kind) {
    if (!el) return;
    el.textContent = message || "";
    el.className = "ac-sect__status " + (kind === "error" ? "ac-error" : kind === "ok" ? "ac-ok" : "ac-hint");
  }

  function busy(btn, on) {
    if (!btn) return;
    btn.classList.toggle("is-busy", !!on);
    btn.disabled = !!on;
  }

  // Wires every .ac-pwd reveal toggle on the page. Switches the input type
  // and the icon, and keeps the accessible label in step.
  function wirePasswordToggles(root) {
    (root || document).querySelectorAll(".ac-pwd__toggle").forEach(function (btn) {
      if (btn.dataset.wired) return;
      btn.dataset.wired = "1";
      btn.addEventListener("click", function () {
        var input = btn.parentNode.querySelector("input");
        if (!input) return;
        var reveal = input.type === "password";
        input.type = reveal ? "text" : "password";
        btn.setAttribute("aria-label", reveal ? "Hide password" : "Show password");
        var icon = btn.querySelector("i");
        if (icon) icon.className = reveal ? "fa-regular fa-eye-slash" : "fa-regular fa-eye";
      });
    });
  }

  // Password strength, 0-3. Deliberately advisory: the server's policy is
  // length >= 8 and nothing here tightens it (see lib/password.js). This
  // only tells the customer whether what they typed is weak, which is a
  // different thing from refusing it.
  function strength(value) {
    var v = String(value || "");
    if (v.length < 8) return 0;
    var score = 1;
    if (v.length >= 12) score++;
    if (/[^A-Za-z]/.test(v) && /[A-Za-z]/.test(v)) score++;
    return Math.min(3, score);
  }

  return {
    esc: esc,
    money: money,
    formatDate: formatDate,
    relativeDate: relativeDate,
    $: $,
    show: show,
    panel: panel,
    reveal: reveal,
    cover: cover,
    progress: progress,
    paintProgress: paintProgress,
    avatar: avatar,
    status: status,
    busy: busy,
    wirePasswordToggles: wirePasswordToggles,
    strength: strength,
    fillCountries: fillCountries,
  };
})();
