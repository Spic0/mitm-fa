// Checkout "Contact & Billing": country data, international phone input, and
// real-time validation. Owns the four values the server requires (Full Name,
// Email, Phone, Country) and hands them to checkout-payments.js via
// window.ProFitCheckoutCustomer.
//
// Validation timing follows the convention that tests best on mobile: never
// show an error while the shopper is still typing a field for the first time
// (blur validates), but once a field HAS an error, re-check on every keystroke
// so the error clears the instant it's fixed rather than at the next blur.
(function () {
  var form = document.getElementById("coCustomerForm");
  var countrySel = document.getElementById("country");
  if (!form || !countrySel || !window.ProFitCountries) return;

  var C = window.ProFitCountries;
  var phoneInput = document.getElementById("phone");
  var dialBtn = document.getElementById("phoneDialBtn");
  var dialFlag = document.getElementById("phoneDialFlag");
  var dialCode = document.getElementById("phoneDialCode");

  // Set from the dial picker, or followed along from the country field while
  // the shopper hasn't explicitly chosen a different one — most people's phone
  // number belongs to the country they're buying from, but not always, so an
  // explicit choice is never overwritten.
  var dial = C.byCode.US;
  var dialPinned = false;

  // ---- Country <select> -------------------------------------------------
  // Options are built here rather than shipped in the HTML so the list can
  // never drift from the one the phone picker and the server validate against.
  (function populateCountries() {
    var frag = document.createDocumentFragment();
    C.all.forEach(function (c) {
      var opt = document.createElement("option");
      opt.value = c.code;
      opt.textContent = c.name;
      frag.appendChild(opt);
    });
    countrySel.appendChild(frag);
  })();

  // ---- Validation -------------------------------------------------------
  var EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  // Mirrors server/src/lib/customerDetails.js. Kept deliberately loose: this
  // is for feedback, the server is the authority.
  var E164_RE = /^\+[1-9]\d{7,14}$/;

  function nationalDigits() {
    return (phoneInput.value || "").replace(/[^\d]/g, "");
  }

  // The single value posted to the server.
  function fullPhone() {
    var digits = nationalDigits();
    if (!digits) return "";
    // A national number written with the domestic trunk "0" ("020 7946 0958")
    // must lose it once the +44 is prepended.
    if (digits.length > 1 && digits.charAt(0) === "0") digits = digits.replace(/^0+/, "");
    return dial.dial + digits;
  }

  var RULES = {
    name: function () {
      var v = document.getElementById("name").value.trim();
      if (!v) return "Please enter your full name";
      if (v.length < 2) return "That name looks too short";
      return "";
    },
    email: function () {
      var v = document.getElementById("email").value.trim();
      if (!v) return "Please enter your email address";
      if (!EMAIL_RE.test(v)) return "Please enter a valid email address";
      return "";
    },
    phone: function () {
      if (!nationalDigits()) return "Please enter your phone number";
      if (!E164_RE.test(fullPhone())) return "That phone number doesn't look complete";
      return "";
    },
    country: function () {
      if (!countrySel.value) return "Please select your country";
      return "";
    },
  };

  var touched = {};

  function fieldEl(key) {
    var el = key === "country" ? countrySel : document.getElementById(key);
    return el ? el.closest(".co-field") : null;
  }

  function setFieldState(key, message) {
    var wrap = fieldEl(key);
    var err = document.getElementById("err-" + key);
    if (!wrap || !err) return;
    var invalid = !!message;
    wrap.classList.toggle("co-invalid", invalid);
    // Only badge a field as valid once it's been interacted with, so the form
    // doesn't open covered in green ticks.
    wrap.classList.toggle("co-valid", !invalid && !!touched[key]);
    err.textContent = message || "";
    var input = key === "country" ? countrySel : document.getElementById(key);
    if (input) {
      input.setAttribute("aria-invalid", String(invalid));
      if (invalid) input.setAttribute("aria-describedby", "err-" + key);
      else input.removeAttribute("aria-describedby");
    }
  }

  function validateField(key) {
    var message = RULES[key]();
    setFieldState(key, touched[key] ? message : "");
    return !message;
  }

  // Validates everything, marks every field touched, and focuses the first
  // problem — on mobile the offending field is often scrolled off-screen, so
  // focusing it is what actually tells the shopper where to look.
  function validateAll() {
    var firstBad = null;
    Object.keys(RULES).forEach(function (key) {
      touched[key] = true;
      if (!validateField(key) && !firstBad) firstBad = key;
    });
    if (firstBad) {
      var input = firstBad === "country" ? countrySel : document.getElementById(firstBad);
      if (input) {
        if (input.scrollIntoView) input.scrollIntoView({ block: "center", behavior: "smooth" });
        try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
      }
    }
    return !firstBad;
  }

  Object.keys(RULES).forEach(function (key) {
    var input = key === "country" ? countrySel : document.getElementById(key);
    if (!input) return;
    input.addEventListener("blur", function () {
      touched[key] = true;
      validateField(key);
    });
    input.addEventListener("input", function () {
      if (touched[key]) validateField(key);
    });
    if (key === "country") {
      input.addEventListener("change", function () {
        touched[key] = true;
        validateField(key);
        if (!dialPinned && C.byCode[countrySel.value]) setDial(C.byCode[countrySel.value], false);
      });
    }
  });

  // ---- Phone dial-code picker -------------------------------------------
  function setDial(country, pin) {
    if (!country) return;
    dial = country;
    if (pin) dialPinned = true;
    dialFlag.textContent = country.flag;
    dialCode.textContent = country.dial;
    dialBtn.setAttribute("aria-label", "Phone country code: " + country.name + " " + country.dial);
    if (touched.phone) validateField("phone");
  }

  // Platform autofill hands back a full "+44 20 7946 0958" rather than a
  // national number. Detect that, move the dial code into the picker, and
  // leave only the national part in the field — otherwise fullPhone() would
  // produce "+44+442079460958".
  function absorbInternational() {
    var raw = (phoneInput.value || "").trim();
    if (raw.charAt(0) !== "+" && raw.slice(0, 2) !== "00") return;
    var digits = raw.replace(/^00/, "").replace(/[^\d]/g, "");
    if (!digits) return;
    // Longest dial code first: +1 must not win over +1268 (Antigua).
    var match = null;
    C.all.forEach(function (c) {
      var code = c.dial.slice(1);
      if (digits.indexOf(code) === 0 && (!match || code.length > match.dial.length - 1)) match = c;
    });
    if (!match) return;
    setDial(match, true);
    phoneInput.value = digits.slice(match.dial.length - 1);
  }

  phoneInput.addEventListener("input", absorbInternational);
  phoneInput.addEventListener("change", absorbInternational);

  // A listbox panel shared in style with the country search below.
  var dialPanel = buildPanel(dialBtn, function (country) {
    setDial(country, true);
    phoneInput.focus();
  });
  dialBtn.addEventListener("click", function () { togglePanel(dialPanel, dialBtn); });

  // ---- Searchable country panel (fine-pointer devices only) --------------
  // Touch devices keep the native <select>: the iOS wheel and the Android
  // full-screen list are better than anything reimplementable here, and they
  // carry platform autofill. A custom panel is only an improvement where the
  // native control is a cramped desktop dropdown.
  var finePointer = window.matchMedia && window.matchMedia("(hover: hover) and (pointer: fine)").matches;
  if (finePointer) {
    var countryWrap = countrySel.closest(".co-field");
    countryWrap.classList.add("co-field--searchable");
    var countryPanel = buildPanel(countrySel, function (country) {
      countrySel.value = country.code;
      touched.country = true;
      validateField("country");
      if (!dialPinned) setDial(country, false);
      // Fire change so anything else listening to the select still hears it.
      countrySel.dispatchEvent(new Event("change", { bubbles: true }));
    });
    countrySel.addEventListener("mousedown", function (e) {
      e.preventDefault();
      togglePanel(countryPanel, countrySel);
    });
    countrySel.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); togglePanel(countryPanel, countrySel); }
    });
  }

  // ---- Shared panel widget ----------------------------------------------
  function buildPanel(anchor, onPick) {
    var panel = document.createElement("div");
    panel.className = "co-cpanel";
    panel.hidden = true;
    panel.innerHTML =
      '<div class="co-cpanel__searchwrap">' +
      '<input type="text" class="co-cpanel__search" placeholder="Search countries" ' +
      'autocomplete="off" autocapitalize="off" spellcheck="false" inputmode="search">' +
      "</div>" +
      '<ul class="co-cpanel__list" role="listbox"></ul>';
    anchor.closest(".co-field").appendChild(panel);

    var search = panel.querySelector(".co-cpanel__search");
    var list = panel.querySelector(".co-cpanel__list");
    var active = -1;
    var rendered = [];

    function render(query) {
      rendered = C.search(query, 60);
      list.innerHTML = rendered
        .map(function (c, i) {
          return (
            '<li class="co-cpanel__opt" role="option" data-i="' + i + '" tabindex="-1">' +
            '<span class="co-cpanel__flag">' + c.flag + "</span>" +
            '<span class="co-cpanel__name">' + c.name + "</span>" +
            '<span class="co-cpanel__dial">' + c.dial + "</span>" +
            "</li>"
          );
        })
        .join("") || '<li class="co-cpanel__empty">No countries match that search</li>';
      active = -1;
    }

    function setActive(i) {
      var opts = list.querySelectorAll(".co-cpanel__opt");
      if (!opts.length) return;
      active = Math.max(0, Math.min(i, opts.length - 1));
      opts.forEach(function (o, n) { o.classList.toggle("is-active", n === active); });
      opts[active].scrollIntoView({ block: "nearest" });
    }

    search.addEventListener("input", function () { render(search.value); });
    search.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); setActive(active + 1); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setActive(active - 1); }
      else if (e.key === "Enter") {
        e.preventDefault();
        if (rendered[active]) { onPick(rendered[active]); closePanel(panel, anchor); }
      } else if (e.key === "Escape") { closePanel(panel, anchor); anchor.focus(); }
    });
    list.addEventListener("click", function (e) {
      var opt = e.target.closest(".co-cpanel__opt");
      if (!opt) return;
      onPick(rendered[Number(opt.dataset.i)]);
      closePanel(panel, anchor);
    });

    panel._render = render;
    panel._search = search;
    return panel;
  }

  var openPanel = null;
  var backdrop = null;

  // Below 900px the panel is a viewport-pinned sheet (see .co-cpanel in
  // style.css); above it, an anchored dropdown. The two need different
  // affordances, so the breakpoint is read once here rather than inferred
  // from pointer type — a narrow window on a laptop gets the sheet too,
  // which is what the layout around it is already doing.
  function isSheet() {
    return window.matchMedia && window.matchMedia("(max-width: 900px)").matches;
  }

  function togglePanel(panel, anchor) {
    if (openPanel === panel) return closePanel(panel, anchor);
    if (openPanel) closePanel(openPanel, openPanel._anchor);
    panel._anchor = anchor;
    panel._render("");
    panel._search.value = "";
    panel.hidden = false;
    anchor.setAttribute("aria-expanded", "true");
    openPanel = panel;

    // The panel lives inside .co-fieldgroup, which is `overflow: hidden` to
    // clip its dividers to its rounded corners — and that clipped the list
    // away entirely. The anchored dropdown needs the group to stop clipping
    // while it is open; the sheet is position:fixed and immune either way,
    // but releasing it for both keeps one code path.
    var group = anchor.closest(".co-fieldgroup");
    if (group) group.classList.add("has-cpanel-open");

    if (isSheet()) {
      backdrop = document.createElement("div");
      backdrop.className = "co-cpanel-backdrop";
      document.body.appendChild(backdrop);
      // Focusing the search box here would raise the on-screen keyboard over
      // the list the shopper just asked to see. On a sheet the list is the
      // point; searching is a deliberate second tap.
      return;
    }
    // Focus lands on the search box so typing filters immediately.
    setTimeout(function () { panel._search.focus(); }, 0);
  }

  function closePanel(panel, anchor) {
    panel.hidden = true;
    if (anchor) anchor.setAttribute("aria-expanded", "false");
    var group = anchor && anchor.closest ? anchor.closest(".co-fieldgroup") : null;
    if (group) group.classList.remove("has-cpanel-open");
    if (backdrop && backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    backdrop = null;
    if (openPanel === panel) openPanel = null;
  }

  document.addEventListener("click", function (e) {
    if (!openPanel) return;
    if (e.target.closest(".co-cpanel") || e.target === openPanel._anchor || openPanel._anchor.contains(e.target)) return;
    closePanel(openPanel, openPanel._anchor);
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape" && openPanel) closePanel(openPanel, openPanel._anchor);
  });

  // Enter anywhere in the details form should advance to payment, not reload
  // the page — there is no server-side form post here.
  form.addEventListener("submit", function (e) { e.preventDefault(); });

  setDial(C.byCode.US, false);

  window.ProFitCheckoutCustomer = {
    validate: validateAll,
    // Live per-field check with no side effects, for enabling/disabling the CTA.
    isComplete: function () {
      return Object.keys(RULES).every(function (k) { return !RULES[k](); });
    },
    getDetails: function () {
      return {
        name: document.getElementById("name").value.trim(),
        email: document.getElementById("email").value.trim().toLowerCase(),
        phone: fullPhone(),
        country: countrySel.value,
      };
    },
  };
})();
