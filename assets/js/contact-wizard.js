// Contact page partnership wizard.
//
// Four qualifying steps then a contact step, posted to POST /api/contact.
// Deliberately dependency-free (no jQuery): this is the only script the
// contact page needs beyond the shared bundle, and it runs on a page where
// first paint matters more than sharing helpers.
//
// Progressive enhancement is limited here by design — the steps are inert
// markup without JS — so the hero's mailto CTA is always present as a
// no-JS path to reach us, and the success panel repeats the address.
(function contactWizard() {
  "use strict";

  var root = document.querySelector("[data-wizard]");
  if (!root) return;

  var steps = Array.prototype.slice.call(root.querySelectorAll(".ct-step[data-step]"));
  var numbered = steps.filter(function (s) { return s.dataset.step !== "done"; });
  var doneStep = root.querySelector('[data-step="done"]');

  var backBtn = root.querySelector("[data-wizard-back]");
  var nextBtn = root.querySelector("[data-wizard-next]");
  var submitBtn = root.querySelector("[data-wizard-submit]");
  var nav = root.querySelector("[data-wizard-nav]");
  var fill = root.querySelector("[data-progress-fill]");
  var curLabel = root.querySelector("[data-step-current]");
  var totalLabel = root.querySelector("[data-step-total]");
  var formError = root.querySelector("[data-form-error]");

  var TOTAL = numbered.length;
  var index = 0;
  var answers = { role: "", goal: "", audience: "" };

  if (totalLabel) totalLabel.textContent = String(TOTAL);

  function show(i, goingBack) {
    index = i;
    steps.forEach(function (s) {
      s.classList.remove("is-active", "is-entering", "is-entering-back");
    });
    var el = numbered[i];
    el.classList.add("is-active", goingBack ? "is-entering-back" : "is-entering");

    if (fill) fill.style.width = Math.round(((i + 1) / TOTAL) * 100) + "%";
    if (curLabel) curLabel.textContent = String(i + 1);

    backBtn.hidden = i === 0;
    var last = i === TOTAL - 1;
    nextBtn.hidden = last;
    submitBtn.hidden = !last;
    hideError();

    // Focus the step heading rather than the first control: announcing the
    // question to a screen reader matters more than jumping into an input,
    // and on mobile it avoids popping the keyboard on every step change.
    var heading = el.querySelector(".ct-step__title");
    if (heading) {
      heading.setAttribute("tabindex", "-1");
      heading.focus({ preventScroll: true });
    }
  }

  function hideError() {
    if (formError) { formError.hidden = true; formError.textContent = ""; }
    root.querySelectorAll(".ct-error").forEach(function (e) { e.hidden = true; });
    root.querySelectorAll(".has-error").forEach(function (e) { e.classList.remove("has-error"); });
  }

  function showFieldError(field) {
    var msg = root.querySelector('[data-error-for="' + field + '"]');
    if (msg) msg.hidden = false;
    var input = root.querySelector('[name="' + field + '"]');
    if (input) { input.classList.add("has-error"); input.focus(); }
  }

  // ---- Option selection ----
  root.addEventListener("click", function (e) {
    var opt = e.target.closest(".ct-option");
    if (!opt || !root.contains(opt)) return;
    var field = opt.dataset.field;
    answers[field] = opt.dataset.value;

    var group = opt.parentElement;
    group.querySelectorAll(".ct-option").forEach(function (o) {
      var on = o === opt;
      o.classList.toggle("is-selected", on);
      o.setAttribute("aria-checked", String(on));
    });
    hideError();

    // Auto-advance on the three qualifying steps: the choice IS the answer,
    // so making the user then press Next is a wasted tap. The contact step
    // has real fields and is never auto-advanced. Short delay so the
    // selection is visible before the panel slides.
    if (index < TOTAL - 1) {
      window.setTimeout(function () { if (index < TOTAL - 1) show(index + 1, false); }, 220);
    }
  });

  // Arrow-key navigation within an option group, which is what
  // role="radiogroup" leads a screen-reader user to expect.
  root.addEventListener("keydown", function (e) {
    var opt = e.target.closest(".ct-option");
    if (!opt) return;
    var keys = ["ArrowDown", "ArrowRight", "ArrowUp", "ArrowLeft"];
    if (keys.indexOf(e.key) === -1) return;
    e.preventDefault();
    var group = Array.prototype.slice.call(opt.parentElement.querySelectorAll(".ct-option"));
    var at = group.indexOf(opt);
    var delta = (e.key === "ArrowDown" || e.key === "ArrowRight") ? 1 : -1;
    var next = group[(at + delta + group.length) % group.length];
    next.focus();
  });

  // ---- Navigation ----
  nextBtn.addEventListener("click", function () {
    var step = numbered[index];
    var field = step.querySelector(".ct-option") && step.querySelector(".ct-option").dataset.field;
    if (field && !answers[field]) {
      var msg = root.querySelector('[data-error-for="' + field + '"]');
      if (msg) msg.hidden = false;
      return;
    }
    if (index < TOTAL - 1) show(index + 1, false);
  });

  backBtn.addEventListener("click", function () {
    if (index > 0) show(index - 1, true);
  });

  // ---- Submit ----
  function validateContactStep() {
    var name = root.querySelector('[name="name"]').value.trim();
    var email = root.querySelector('[name="email"]').value.trim();
    if (!name) { showFieldError("name"); return null; }
    // Same permissive shape the server uses — catch typos, don't police.
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) { showFieldError("email"); return null; }
    return {
      role: answers.role,
      goal: answers.goal,
      audience: answers.audience,
      name: name,
      email: email,
      instagram: root.querySelector('[name="instagram"]').value.trim(),
      message: root.querySelector('[name="message"]').value.trim(),
    };
  }

  submitBtn.addEventListener("click", function () {
    hideError();
    var payload = validateContactStep();
    if (!payload) return;

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending…";

    fetch("/api/contact", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(function (res) {
        return res.json().catch(function () { return {}; }).then(function (data) {
          if (!res.ok) throw new Error(data.error || "Something went wrong.");
          return data;
        });
      })
      .then(function () {
        steps.forEach(function (s) { s.classList.remove("is-active", "is-entering", "is-entering-back"); });
        doneStep.classList.add("is-active", "is-entering");
        if (nav) nav.hidden = true;
        if (fill) fill.style.width = "100%";
        var label = root.querySelector(".ct-progress__label");
        if (label) label.hidden = true;
      })
      .catch(function (err) {
        submitBtn.disabled = false;
        submitBtn.textContent = "Send Message";
        if (formError) {
          formError.textContent = err.message || "Something went wrong.";
          formError.hidden = false;
        }
      });
  });

  // Hero CTA scrolls to the wizard rather than jumping, and lands with the
  // first question actually in view.
  var scrollCta = document.querySelector("[data-scroll-to-wizard]");
  if (scrollCta) {
    scrollCta.addEventListener("click", function (e) {
      e.preventDefault();
      var target = document.getElementById("contactWizard");
      if (!target) return;
      var reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    });
  }

  show(0, false);
})();
