// Password unlock for a protected private presentation.
//
// Loaded only by the server-rendered gate screen (renderGateScreen in
// server/src/routes/presentation.js), never by the deck itself. On success
// the server sets the unlock cookie and this reloads the same URL, so the
// deck arrives through the normal gated GET rather than being assembled
// client-side — there is no path where deck content reaches the browser
// without the server having authorised it.
(function () {
  "use strict";

  var form = document.getElementById("presUnlockForm");
  if (!form) return;

  var input = document.getElementById("presPassword");
  var errorEl = document.getElementById("presUnlockError");
  var submit = form.querySelector('button[type="submit"]');
  var card = form.closest(".pres-gate__card");
  var slug = form.dataset.slug || "";

  function showError(message) {
    if (errorEl) {
      errorEl.textContent = message;
      errorEl.className = "pres-gate__error";
    }
    if (card) {
      // Remove + reflow + re-add so the shake replays on a second wrong
      // attempt (a class already present doesn't retrigger its animation).
      card.classList.remove("is-shake");
      void card.offsetWidth;
      card.classList.add("is-shake");
    }
    if (input) {
      input.select();
      input.focus();
    }
  }

  if (input) {
    input.addEventListener("input", function () {
      if (errorEl) errorEl.className = "pres-gate__error u-hidden";
    });
  }

  form.addEventListener("submit", function (e) {
    e.preventDefault();

    var password = input ? input.value : "";
    if (!password) {
      showError("Please enter the access password.");
      return;
    }

    submit.classList.add("is-busy");
    submit.disabled = true;

    fetch("/api/presentation/" + encodeURIComponent(slug) + "/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ password: password }),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || "That password is incorrect.");
          return data;
        });
      })
      .then(function () {
        // Replace, not assign: the locked view should not sit in history
        // behind the deck, where Back would land on a screen that now
        // immediately redirects forward again.
        window.location.replace(window.location.pathname);
      })
      .catch(function (err) {
        submit.classList.remove("is-busy");
        submit.disabled = false;
        showError(err.message || "That password is incorrect.");
      });
  });
})();
