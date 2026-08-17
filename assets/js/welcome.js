// SETUP WIZARD — /welcome
//
// SECURITY NOTE, because this is the claim flow and it is easy to get wrong:
// this page handles NO token. By the time it renders, routes/auth.js has
// already consumed the single-use magic-link token (consumeMagicLinkToken
// marks usedAt, so it cannot be replayed), issued the session cookie and
// REDIRECTED — which is what strips the token from the address bar before
// any UI appears. So the wizard is an ordinary authenticated page: it reads
// the session like every other customer page, and every write it makes goes
// through the same /api/account and /api/auth endpoints My Profile uses,
// with the same server-side checks. There is nothing here to replay, leak or
// expire, because there is nothing here but a session.
//
// If the session is missing (link opened twice, cookie blocked), every
// endpoint returns 401 and the page sends the customer to /login rather than
// pretending to work.
(function () {
  "use strict";
  var A = window.AccountUI;
  var api = window.ProFitAPI;

  var TOTAL = 5;
  var step = 1;
  var profile = null;

  var els = {};
  ["wzSteps", "wzCount", "wzNext", "wzNextText", "wzBack", "wzSkip", "wzName",
   "wzOwned", "wzPwd", "wzPwd2", "wzPwdError", "wzPwdOk", "wzStrength", "wzReq",
   "wzFullName", "wzEmail", "wzPhone", "wzCountry", "wzDetailsError",
   "wzAvatar", "wzPhotoBtn", "wzPhotoRemove", "wzPhotoInput", "wzDisplayName",
   "wzProfileError"].forEach(function (id) { els[id] = A.$(id); });

  // ---- step machinery -------------------------------------------------
  var NEXT_LABEL = {
    1: "Get started",
    2: "Create password",
    3: "Save and continue",
    4: "Finish setup",
    5: "Enter my library",
  };

  function paintStep() {
    document.querySelectorAll(".ac-wz__panel").forEach(function (p) {
      p.classList.toggle("is-active", parseInt(p.dataset.step, 10) === step);
    });
    var segs = els.wzSteps.querySelectorAll(".ac-wz__seg");
    segs.forEach(function (seg, i) {
      seg.classList.toggle("is-done", i + 1 < step);
      seg.classList.toggle("is-current", i + 1 === step);
    });
    els.wzSteps.setAttribute("aria-valuenow", String(step));
    els.wzCount.textContent = "Step " + step + " of " + TOTAL;
    els.wzNextText.textContent = NEXT_LABEL[step];

    // Back is available from 2, but NOT from 5: the password is already set
    // and the details already saved by then, so "back" would offer to redo
    // something that is done.
    A.show(els.wzBack, step > 1 && step < 5);
    A.show(els.wzSkip, step === 4);

    // Moving between steps must put the customer at the top of the new one —
    // on a phone, step 3 is taller than the viewport and would otherwise
    // open scrolled to wherever step 2 was left.
    window.scrollTo({ top: 0, behavior: "smooth" });

    if (step === 2) setTimeout(function () { els.wzPwd.focus(); }, 260);
  }

  function go(next) {
    step = Math.max(1, Math.min(TOTAL, next));
    paintStep();
  }

  // ---- step 2: password ----------------------------------------------
  function checkPassword() {
    var a = els.wzPwd.value;
    var b = els.wzPwd2.value;

    var len = a.length >= 8;
    var mix = /[A-Za-z]/.test(a) && /[^A-Za-z]/.test(a);
    els.wzReq.querySelector('[data-req="len"]').classList.toggle("is-met", len);
    els.wzReq.querySelector('[data-req="mix"]').classList.toggle("is-met", mix);
    els.wzReq.querySelectorAll("li").forEach(function (li) {
      var icon = li.querySelector("i");
      if (icon) icon.className = li.classList.contains("is-met")
        ? "fa-solid fa-circle-check" : "fa-regular fa-circle";
    });

    var s = A.strength(a);
    els.wzStrength.className = "ac-strength is-" + s;

    var match = !!b && a === b;
    A.show(els.wzPwdOk, match);
    A.show(els.wzPwdError, !!b && !match);
    if (!!b && !match) els.wzPwdError.textContent = "Those passwords don't match.";

    return len && match;
  }

  function submitPassword() {
    if (!checkPassword()) {
      if (els.wzPwd.value.length < 8) {
        A.show(els.wzPwdError, true);
        els.wzPwdError.textContent = "Password must be at least 8 characters.";
      }
      return Promise.reject(new Error("invalid"));
    }
    // The account has no password at this point, so the server does not ask
    // for a current one — the SESSION is the proof. That rule lives in
    // /api/auth/set-password and is not restated here.
    return api.setPassword(els.wzPwd.value).then(function () {
      // Never keep the plaintext around once it has been accepted.
      els.wzPwd.value = "";
      els.wzPwd2.value = "";
      checkPassword();
    });
  }

  // ---- step 3: details -------------------------------------------------
  function submitDetails() {
    A.show(els.wzDetailsError, false);
    return api.updateProfile({
      name: els.wzFullName.value,
      phone: els.wzPhone.value,
      country: els.wzCountry.value,
    }).then(function (data) {
      profile = data.profile;
    }).catch(function (err) {
      A.show(els.wzDetailsError, true);
      els.wzDetailsError.textContent = err.message || "Could not save those details.";
      throw err;
    });
  }

  // ---- step 4: optional profile ---------------------------------------
  // The photo is uploaded the moment it is chosen (there is no "save" on
  // this step — it is optional and skippable), so this always paints from
  // the server's copy of the profile rather than a local preview.
  function paintAvatar() {
    els.wzAvatar.innerHTML = A.avatar(profile, "lg");
    A.show(els.wzPhotoRemove, !!(profile && profile.avatarUrl));
  }

  function submitProfile() {
    A.show(els.wzProfileError, false);
    var name = els.wzDisplayName.value.trim();
    // Nothing typed is a valid outcome for an optional step — the photo, if
    // there was one, is already saved.
    if (!name) return Promise.resolve();
    return api.updateProfile({ displayName: name }).then(function (data) {
      profile = data.profile;
    }).catch(function (err) {
      A.show(els.wzProfileError, true);
      els.wzProfileError.textContent = err.message || "Could not save that.";
      throw err;
    });
  }

  // ---- advance ---------------------------------------------------------
  function advance() {
    if (step === TOTAL) {
      window.location.href = "/my-library";
      return;
    }
    var work =
      step === 2 ? submitPassword() :
      step === 3 ? submitDetails() :
      step === 4 ? submitProfile() :
      Promise.resolve();

    A.busy(els.wzNext, true);
    work.then(function () {
      A.busy(els.wzNext, false);
      go(step + 1);
    }).catch(function (err) {
      A.busy(els.wzNext, false);
      // A 401 here means the session went away mid-setup. Sending them to
      // login is the only honest option — the wizard cannot re-authenticate
      // anyone, by design.
      if (err && /not authenticated|sign in/i.test(err.message || "")) {
        window.location.href = "/login";
      }
    });
  }

  // ---- boot ------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", function () {
    A.wirePasswordToggles(document);

    els.wzNext.addEventListener("click", advance);
    els.wzBack.addEventListener("click", function () { go(step - 1); });
    els.wzSkip.addEventListener("click", function () { go(step + 1); });

    els.wzPwd.addEventListener("input", checkPassword);
    els.wzPwd2.addEventListener("input", checkPassword);

    // Enter submits the step rather than doing nothing — these are inputs
    // outside a <form> (deliberately: a form here would offer the browser a
    // full-page submit that would lose the step state).
    document.querySelectorAll(".ac-input").forEach(function (input) {
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter") { e.preventDefault(); advance(); }
      });
    });

    els.wzPhotoBtn.addEventListener("click", function () { els.wzPhotoInput.click(); });
    els.wzPhotoInput.addEventListener("change", function () {
      var file = els.wzPhotoInput.files && els.wzPhotoInput.files[0];
      if (!file) return;
      A.busy(els.wzPhotoBtn, true);
      api.uploadAvatar(file).then(function (data) {
        profile = data.profile;
        paintAvatar();
      }).catch(function (err) {
        A.show(els.wzProfileError, true);
        els.wzProfileError.textContent = err.message || "Could not upload that image.";
      }).then(function () {
        A.busy(els.wzPhotoBtn, false);
        els.wzPhotoInput.value = "";
      });
    });
    els.wzPhotoRemove.addEventListener("click", function () {
      api.removeAvatar().then(function (data) {
        profile = data.profile;
        paintAvatar();
      }).catch(function () {});
    });

    // Prefill from what checkout already collected — the brief is explicit
    // that nothing already provided should be asked for twice.
    Promise.all([
      api.getProfile(),
      api.getLibrary().catch(function () { return { library: [] }; }),
    ]).then(function (r) {
      profile = r[0].profile;
      var library = (r[1] && r[1].library) || [];

      els.wzName.textContent = profile.greetingName ? ", " + profile.greetingName : "";
      els.wzFullName.value = profile.name || "";
      els.wzEmail.value = profile.email || "";
      els.wzPhone.value = profile.phone || "";
      els.wzDisplayName.value = profile.displayName || "";
      A.fillCountries(els.wzCountry, profile.country);
      paintAvatar();

      // What they actually bought, named — "your program is ready" is more
      // convincing when it says which one.
      if (library.length) {
        els.wzOwned.innerHTML =
          '<span class="ac-eyebrow">Ready for you</span>' +
          library.slice(0, 3).map(function (e) {
            return (
              '<div class="ac-conf__item">' +
              A.cover(e.product.imageUrl, "", "52px", false) +
              '<span class="ac-conf__item-name">' + A.esc(e.product.name) + "</span>" +
              '<span class="ac-pill ac-pill--ok"><i class="fa-solid fa-check" aria-hidden="true"></i> <span>Ready</span></span>' +
              "</div>"
            );
          }).join("");
      } else {
        A.show(els.wzOwned, false);
      }

      paintStep();
    }).catch(function () {
      window.location.href = "/login";
    });
  });
})();
