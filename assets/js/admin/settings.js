window.AdminPanels = window.AdminPanels || {};
window.AdminPanels.settings = {
  mount: function (root) {
    var form = root.querySelector("#settingsForm");
    var logoForm = root.querySelector("#logoForm");
    var logoPreview = root.querySelector("#logoPreview");

    // Hold the form inert until real values arrive, so nothing reads as
    // "blank" or editable-but-wrong while loading.
    Array.prototype.forEach.call(form.elements, function (el) { el.disabled = true; });

    function load() {
      window.AdminAPI.getSettings().then(function (data) {
        root.querySelector("#storeName").value = data.settings.storeName || "";
        root.querySelector("#currency").value = data.settings.currency || "USD";
        root.querySelector("#taxRate").value = data.settings.taxRate || "0";
        root.querySelector("#emailFromName").value = data.settings.emailFromName || "";
        if (data.settings.logoUrl) {
          logoPreview.src = "/" + data.settings.logoUrl;
          logoPreview.style.display = "block";
        }
        Array.prototype.forEach.call(form.elements, function (el) { el.disabled = false; });
        form.classList.add("a-fade-in");
      }).catch(function (err) {
        window.AdminUI.toast(err.message, "error");
      });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      window.AdminAPI.updateSettings({
        storeName: root.querySelector("#storeName").value,
        currency: root.querySelector("#currency").value,
        taxRate: root.querySelector("#taxRate").value,
        emailFromName: root.querySelector("#emailFromName").value,
      }).then(function () {
        window.AdminUI.toast("Settings saved", "success");
      }).catch(function (err) {
        window.AdminUI.toast(err.message, "error");
      });
    });

    logoForm.addEventListener("submit", function (e) {
      e.preventDefault();
      var picked = e.target.logo.files[0];
      if (!picked) return window.AdminUI.toast("Choose a logo file first", "warning");

      var submitBtn = logoForm.querySelector('button[type="submit"], input[type="submit"]');
      function setBusy(label) {
        if (!submitBtn) return;
        submitBtn.disabled = !!label;
        if (label) {
          if (!submitBtn.dataset.idleLabel) submitBtn.dataset.idleLabel = submitBtn.textContent;
          submitBtn.textContent = label;
        } else if (submitBtn.dataset.idleLabel) {
          submitBtn.textContent = submitBtn.dataset.idleLabel;
        }
      }

      setBusy("Preparing…");
      window.AdminUpload.maybeCompressImage(picked).then(function (toSend) {
        var fd = new FormData();
        fd.append("logo", toSend);
        return window.AdminAPI.uploadLogo(fd, function (pct) {
          setBusy(pct === null ? "Uploading…" : pct === 100 ? "Processing…" : "Uploading " + pct + "%");
        });
      }).then(function (res) {
        // Cache-bust: the logo URL is stable across replacements, so without
        // this the browser keeps showing the previous logo from cache and the
        // upload looks like it silently did nothing.
        logoPreview.src = "/" + res.logoUrl + "?t=" + Date.now();
        logoPreview.style.display = "block";
        setBusy("");
        window.AdminUI.toast("Logo updated", "success");
      }).catch(function (err) {
        setBusy("");
        window.AdminUI.toast(err.message, "error");
      });
    });

    load();
  },
};
