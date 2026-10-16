// MY PROFILE — /my-profile
//
// Sectioned settings, each card saving independently. That is not only a
// layout choice: PATCH /api/account/profile is partial, so a card sends only
// the fields it renders and cannot blank the ones it does not. One giant
// form with one Save is exactly how a customer who edited their phone number
// ends up having wiped their country.
//
// Password lives in its own card and goes through /api/auth/set-password,
// which requires the CURRENT password whenever one already exists. This page
// shows that field conditionally but does not enforce anything — the server
// does, and re-implementing the rule here would be a second place to get it
// wrong.
(function () {
  "use strict";
  var A = window.AccountUI;
  var api = window.ProFitAPI;

  var PANELS = ["prLoading", "prSignedOut", "prContent"];
  var profile = null;

  var els = {};
  ["prAvatar", "prName", "prEmail", "prSince", "prPhotoBtn", "prPhotoRemove",
   "prPhotoInput", "prPhotoStatus", "prFullName", "prDisplayName", "prPhone",
   "prCountry", "prSaveDetails", "prDetailsStatus", "prEmailField",
   "prPwdIntro", "prCurrentWrap", "prCurrent", "prNew", "prConfirm",
   "prStrength", "prSavePwd", "prPwdStatus", "prSignOut"]
    .forEach(function (id) { els[id] = A.$(id); });

  function paint() {
    els.prAvatar.innerHTML = A.avatar(profile, "lg");
    els.prName.textContent = profile.displayName || profile.name || profile.greetingName || "Your account";
    els.prEmail.textContent = profile.email;
    els.prEmailField.value = profile.email;
    els.prFullName.value = profile.name || "";
    els.prDisplayName.value = profile.displayName || "";
    els.prPhone.value = profile.phone || "";
    A.fillCountries(els.prCountry, profile.country);
    A.show(els.prPhotoRemove, !!profile.avatarUrl);

    if (profile.createdAt) {
      els.prSince.textContent = "Member since " + A.formatDate(profile.createdAt);
    }

    // The copy and the required fields both depend on whether a password
    // already exists — "change" and "create" are different actions.
    A.show(els.prCurrentWrap, profile.hasPassword);
    els.prPwdIntro.textContent = profile.hasPassword
      ? "Enter your current password to choose a new one."
      : "You sign in with an email link. Add a password if you'd rather not wait for one.";
    els.prSavePwd.querySelector("span").textContent =
      profile.hasPassword ? "Update password" : "Create password";
  }

  function saveDetails() {
    A.busy(els.prSaveDetails, true);
    A.status(els.prDetailsStatus, "");
    api.updateProfile({
      name: els.prFullName.value,
      displayName: els.prDisplayName.value,
      phone: els.prPhone.value,
      country: els.prCountry.value,
    }).then(function (data) {
      profile = data.profile;
      paint();
      A.status(els.prDetailsStatus, "Saved.", "ok");
    }).catch(function (err) {
      A.status(els.prDetailsStatus, err.message || "Could not save.", "error");
    }).then(function () {
      A.busy(els.prSaveDetails, false);
    });
  }

  function savePassword() {
    var next = els.prNew.value;
    var confirm = els.prConfirm.value;
    A.status(els.prPwdStatus, "");

    if (next.length < 8) {
      A.status(els.prPwdStatus, "Password must be at least 8 characters.", "error");
      return;
    }
    if (next !== confirm) {
      A.status(els.prPwdStatus, "Those passwords don't match.", "error");
      return;
    }

    A.busy(els.prSavePwd, true);
    api.setPassword(next, els.prCurrent.value).then(function () {
      // Clear every field the moment it is accepted — leaving a plaintext
      // password sitting in a DOM node on an unlocked phone is free risk.
      els.prCurrent.value = "";
      els.prNew.value = "";
      els.prConfirm.value = "";
      els.prStrength.className = "ac-strength";
      profile.hasPassword = true;
      paint();
      A.status(els.prPwdStatus, "Password updated.", "ok");
    }).catch(function (err) {
      A.status(els.prPwdStatus, err.message || "Could not update password.", "error");
    }).then(function () {
      A.busy(els.prSavePwd, false);
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    A.wirePasswordToggles(document);

    els.prSaveDetails.addEventListener("click", saveDetails);
    els.prSavePwd.addEventListener("click", savePassword);
    els.prNew.addEventListener("input", function () {
      els.prStrength.className = "ac-strength is-" + A.strength(els.prNew.value);
    });

    // Clear a stale "Saved." as soon as anything changes again.
    [els.prFullName, els.prDisplayName, els.prPhone, els.prCountry].forEach(function (input) {
      input.addEventListener("input", function () { A.status(els.prDetailsStatus, ""); });
    });

    els.prPhotoBtn.addEventListener("click", function () { els.prPhotoInput.click(); });
    els.prPhotoInput.addEventListener("change", function () {
      var file = els.prPhotoInput.files && els.prPhotoInput.files[0];
      if (!file) return;
      A.busy(els.prPhotoBtn, true);
      A.status(els.prPhotoStatus, "Uploading…");
      api.uploadAvatar(file).then(function (data) {
        profile = data.profile;
        paint();
        A.status(els.prPhotoStatus, "Photo updated.", "ok");
      }).catch(function (err) {
        A.status(els.prPhotoStatus, err.message || "Could not upload that image.", "error");
      }).then(function () {
        A.busy(els.prPhotoBtn, false);
        els.prPhotoInput.value = "";
      });
    });

    els.prPhotoRemove.addEventListener("click", function () {
      api.removeAvatar().then(function (data) {
        profile = data.profile;
        paint();
        A.status(els.prPhotoStatus, "Photo removed.", "ok");
      }).catch(function (err) {
        A.status(els.prPhotoStatus, err.message || "Could not remove that.", "error");
      });
    });

    els.prSignOut.addEventListener("click", function () {
      api.logout().then(function () { window.location.href = "/"; });
    });

    // Session first — /api/account/profile is session-scoped and would only
    // 401 for a signed-out visitor, logging a console error for an answer
    // api.me() (already in flight for the header) has for free.
    api.me().then(function (me) {
      if (!me || !me.user) {
        A.panel(PANELS, "prSignedOut");
        return null;
      }
      return api.getProfile();
    }).then(function (data) {
      if (!data) return;
      profile = data.profile;
      paint();
      A.panel(PANELS, "prContent");
      A.reveal(A.$("prContent"));
    }).catch(function () {
      A.panel(PANELS, "prSignedOut");
    });
  });
})();
