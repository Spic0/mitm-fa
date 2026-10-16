// Shared chrome for every step-by-step admin Setup Wizard (Product, Promotion,
// and any future one). Everything about *navigating* a wizard — the step
// rail, the progress readout, the standard footer (Close/Back/Skip/Save
// Draft/Next), autosave-on-leaving-a-step, the "Saved just now" indicator,
// and the leave-confirmation flow — lives here exactly once, so the wizards
// can't quietly drift into two different interfaces. Each wizard still owns
// its own fields, validation, and API calls; it only hands the shell a
// small config describing how to render/save/status-check the step that's
// currently on screen.
//
// Free navigation is the load-bearing idea: the sidebar (or mobile stepper)
// is clickable on ANY step at ANY time, with no linear gate. Clicking a step
// (or hitting Skip) best-effort autosaves whatever's on screen and always
// moves — a save failure there surfaces as a toast but never blocks the
// jump. Back/Next are the one place navigation still waits on the save
// actually succeeding, since those are the guided path, not the escape
// hatch — a real (non-validation) failure keeps you on the step rather than
// silently losing what you typed.
window.AdminWizardShell = (function () {
  function esc(s) { return window.AdminUI.escapeHtml(s); }

  // config:
  //   steps: [{ key, label }]
  //   loadingText: string
  //   getStatus(key) -> "complete" | "missing" | "not-started"
  //     (position-independent — the shell layers "current" on top for
  //     whichever step is active)
  //   renderBody(key, index): called every time the active step changes;
  //     must paint `shell.bodyEl` and, for a normal step, call
  //     `shell.standardFooter({ save })`; a terminal step (Preview/Review)
  //     may instead write `shell.footerEl` directly and must still call
  //     `shell.setSaveHandler(fn)` (a no-op is fine if it has nothing to
  //     autosave).
  //   discardDraft(): optional — called when the admin picks "Discard
  //     Changes" from the leave dialog (e.g. delete a just-opened empty
  //     draft record).
  //   getResult(): current record to hand back to the caller on close.
  //   onClose(result): called once, after the modal has fully closed.
  function build(config) {
    var state = { stepIndex: 0, dirty: false, lastSavedAt: null, savedLabelTimer: null };
    var currentSaveFn = function () { return Promise.resolve(); };

    var backdrop = document.createElement("div");
    backdrop.className = "a-modal-backdrop";
    backdrop.innerHTML =
      '<div class="a-modal a-wizard">' +
      '<button type="button" class="a-wizard-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
      '<div class="a-wizard-rail">' +
      '<div class="a-wizard-progress">' +
      '<div class="a-wizard-progress-row"><span class="a-wizard-progress-step"></span><span class="a-wizard-progress-pct"></span></div>' +
      '<div class="a-wizard-progress-bar"><div class="a-wizard-progress-fill"></div></div>' +
      '<div class="a-wizard-saved-label">&nbsp;</div>' +
      "</div>" +
      '<div class="a-wizard-steps"></div>' +
      "</div>" +
      '<div class="a-wizard-main">' +
      '<div class="a-wizard-body"><div class="a-wizard-step-content a-wizard-loading">' + esc(config.loadingText || "Loading…") + "</div></div>" +
      '<div class="a-wizard-footer"></div>' +
      "</div></div>";

    var stepsEl = backdrop.querySelector(".a-wizard-steps");
    var progressStepEl = backdrop.querySelector(".a-wizard-progress-step");
    var progressPctEl = backdrop.querySelector(".a-wizard-progress-pct");
    var progressFillEl = backdrop.querySelector(".a-wizard-progress-fill");
    var savedLabelEl = backdrop.querySelector(".a-wizard-saved-label");
    var bodyEl = backdrop.querySelector(".a-wizard-body");
    var footerEl = backdrop.querySelector(".a-wizard-footer");

    // Any input/change anywhere in the body marks the active step dirty.
    // renderBody() calls resetDirty() each time it paints a new step, so
    // this reflects only unsaved edits on the step currently on screen.
    bodyEl.addEventListener("input", function () { state.dirty = true; });
    bodyEl.addEventListener("change", function () { state.dirty = true; });

    window.AdminUI.openModal(backdrop, requestClose);
    backdrop.querySelector(".a-wizard-close").addEventListener("click", requestClose);

    function close(result) {
      if (state.savedLabelTimer) clearInterval(state.savedLabelTimer);
      window.AdminUI.closeModal(backdrop);
      if (config.onClose) config.onClose(result);
    }

    function requestClose() {
      if (!state.dirty) return close(config.getResult());
      window.AdminUI.leaveDialog({
        title: "You have unfinished changes.",
        message: "Continue editing, save what you have as a draft and exit, or discard everything entered since your last save.",
      }).then(function (choice) {
        if (choice === "continue") return;
        if (choice === "discard") {
          Promise.resolve(config.discardDraft ? config.discardDraft() : null).then(function () { close(null); });
          return;
        }
        if (choice === "save") {
          currentSaveFn().then(function () {
            markSaved();
            close(config.getResult());
          }).catch(function (err) {
            window.AdminUI.toast(err.message || "Could not save draft", "error");
          });
        }
      });
    }

    function markSaved() {
      state.dirty = false;
      state.lastSavedAt = Date.now();
      updateSavedLabel();
      if (!state.savedLabelTimer) state.savedLabelTimer = setInterval(updateSavedLabel, 15000);
    }

    function updateSavedLabel() {
      if (!state.lastSavedAt) { savedLabelEl.innerHTML = "&nbsp;"; return; }
      var secs = Math.round((Date.now() - state.lastSavedAt) / 1000);
      var text = secs < 20 ? "Saved just now" : secs < 60 ? "Saved " + secs + "s ago" : "Saved " + Math.round(secs / 60) + "m ago";
      savedLabelEl.innerHTML = '<i class="fa-solid fa-check"></i> ' + text;
    }

    function resetDirty() { state.dirty = false; }
    // For selections that don't fire a native input/change event on the
    // body (e.g. clicking a card), so the dirty tracker still notices.
    function markDirty() { state.dirty = true; }

    function setSaveHandler(fn) { currentSaveFn = fn; }

    function renderProgress() {
      var total = config.steps.length;
      var pct = Math.round(((state.stepIndex + 1) / total) * 100);
      progressStepEl.textContent = "Step " + (state.stepIndex + 1) + " of " + total;
      progressPctEl.textContent = pct + "% Complete";
      progressFillEl.style.width = pct + "%";
    }

    function renderSteps() {
      stepsEl.innerHTML = config.steps.map(function (s, i) {
        var raw = config.getStatus(s.key); // "complete" | "missing" | "not-started"
        var status = raw === "complete" ? "complete" : raw === "missing" ? "missing" : (i === state.stepIndex ? "current" : "not-started");
        var iconWeight = status === "not-started" ? "fa-regular" : "fa-solid";
        var icon = status === "complete" ? "fa-circle-check" : status === "missing" ? "fa-triangle-exclamation" : "fa-circle";
        var srLabel = status === "complete" ? "Completed" : status === "missing" ? "Missing required information" : status === "current" ? "Current step" : "Not started";
        var cls = "a-wizard-step a-wizard-step-" + status + (i === state.stepIndex ? " active" : "");
        return (
          '<div class="' + cls + '" data-step="' + i + '" title="' + srLabel + '">' +
          '<span class="a-wizard-step-icon"><i class="' + iconWeight + " " + icon + '"></i></span>' +
          esc(s.label) +
          "</div>"
        );
      }).join("");
      stepsEl.querySelectorAll("[data-step]").forEach(function (el) {
        el.addEventListener("click", function () {
          var idx = parseInt(el.dataset.step, 10);
          if (idx !== state.stepIndex) goFree(idx);
        });
      });
      renderProgress();
    }

    // Used by the sidebar/mobile stepper and Skip — true free navigation:
    // always moves, even if the best-effort autosave underneath it fails.
    function goFree(idx) {
      var fn = currentSaveFn;
      return Promise.resolve().then(fn).then(markSaved).catch(function (err) {
        window.AdminUI.toast(err.message || "Could not save", "error");
      }).then(function () { start(idx); });
    }

    // Used by Back/Next — the guided path. A genuine save failure keeps the
    // admin on the current step instead of silently losing what they typed;
    // a step merely being incomplete is never treated as a failure.
    function goGuided(idx, opts) {
      opts = opts || {};
      var key = config.steps[state.stepIndex].key;
      var fn = currentSaveFn;
      return Promise.resolve().then(fn).then(function () {
        markSaved();
        if (opts.warnIfMissing && config.getStatus(key) === "missing") {
          window.AdminUI.toast("This step still has missing fields — you can finish it anytime before publishing.", "warning");
        }
        start(idx);
      }).catch(function (err) {
        window.AdminUI.toast(err.message || "Could not save", "error");
      });
    }

    function withLoading(btn, fn) {
      var siblings = footerEl.querySelectorAll(".a-btn");
      btn.classList.add("is-loading");
      siblings.forEach(function (b) { b.disabled = true; });
      return fn().then(function (v) {
        siblings.forEach(function (b) { b.disabled = false; b.classList.remove("is-loading"); });
        return v;
      }, function (err) {
        siblings.forEach(function (b) { b.disabled = false; b.classList.remove("is-loading"); });
        throw err;
      });
    }

    // Standard footer for every non-terminal step: Close / Back / Skip /
    // Save Draft / Next — identical order and placement in both wizards.
    // opts: { save: fn, showBack: bool (default stepIndex>0), nextLabel }
    function standardFooter(opts) {
      setSaveHandler(opts.save);
      var showBack = opts.showBack != null ? opts.showBack : state.stepIndex > 0;
      footerEl.innerHTML =
        '<div class="a-wizard-actions">' +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-act="cancel">Close</button>' +
        '<div class="a-wizard-actions-right">' +
        (showBack ? '<button type="button" class="a-btn a-btn-secondary" data-act="back">Back</button>' : "") +
        '<button type="button" class="a-btn a-btn-secondary" data-act="skip">Skip</button>' +
        '<button type="button" class="a-btn a-btn-secondary" data-act="save-draft">Save Draft</button>' +
        '<button type="button" class="a-btn a-btn-primary" data-act="next">' + esc(opts.nextLabel || "Next") + "</button>" +
        "</div></div>";

      footerEl.querySelector('[data-act="cancel"]').addEventListener("click", requestClose);
      var backBtn = footerEl.querySelector('[data-act="back"]');
      if (backBtn) backBtn.addEventListener("click", function () {
        withLoading(backBtn, function () { return goGuided(state.stepIndex - 1, { warnIfMissing: false }); });
      });
      var skipBtn = footerEl.querySelector('[data-act="skip"]');
      skipBtn.addEventListener("click", function () {
        withLoading(skipBtn, function () { return goFree(state.stepIndex + 1); });
      });
      footerEl.querySelector('[data-act="save-draft"]').addEventListener("click", function (e) {
        var btn = e.currentTarget;
        withLoading(btn, function () {
          return currentSaveFn().then(function () {
            markSaved();
            window.AdminUI.toast("Draft saved", "success");
            renderSteps();
          }).catch(function (err) {
            window.AdminUI.toast(err.message || "Could not save", "error");
          });
        });
      });
      var nextBtn = footerEl.querySelector('[data-act="next"]');
      nextBtn.addEventListener("click", function () {
        withLoading(nextBtn, function () { return goGuided(state.stepIndex + 1, { warnIfMissing: true }); });
      });
    }

    function start(idx) {
      state.stepIndex = idx;
      resetDirty();
      renderSteps();
      config.renderBody(config.steps[idx].key, idx);
    }

    return {
      backdrop: backdrop,
      bodyEl: bodyEl,
      footerEl: footerEl,
      start: start,
      refreshSteps: renderSteps,
      standardFooter: standardFooter,
      setSaveHandler: setSaveHandler,
      resetDirty: resetDirty,
      markDirty: markDirty,
      markSaved: markSaved,
      requestClose: requestClose,
      close: close,
      getStepIndex: function () { return state.stepIndex; },
    };
  }

  return { build: build };
})();
