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
      var fd = new FormData();
      fd.append("logo", e.target.logo.files[0]);
      window.AdminAPI.uploadLogo(fd).then(function (res) {
        logoPreview.src = "/" + res.logoUrl;
        logoPreview.style.display = "block";
        window.AdminUI.toast("Logo updated", "success");
      }).catch(function (err) {
        window.AdminUI.toast(err.message, "error");
      });
    });

    load();
  },
};
