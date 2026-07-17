(function () {
    var params = new URLSearchParams(window.location.search);
    var messageEl = document.getElementById("magicLinkMessage");
    if (params.get("error") === "expired") {
        messageEl.style.display = "block";
        messageEl.style.color = "var(--a-danger)";
        messageEl.textContent = "That sign-in link expired or was already used. Request a new one below.";
    } else if (params.get("error") === "suspended") {
        messageEl.style.display = "block";
        messageEl.style.color = "var(--a-danger)";
        messageEl.textContent = "This account has been suspended.";
    }

    document.getElementById("magicLinkForm").addEventListener("submit", function (e) {
        e.preventDefault();
        var email = document.getElementById("adminEmail").value.trim();
        window.AdminAPI.requestMagicLink(email).then(function () {
            messageEl.style.display = "block";
            messageEl.style.color = "var(--a-success)";
            messageEl.textContent = "Check your email for a sign-in link.";
        }).catch(function (err) {
            messageEl.style.display = "block";
            messageEl.style.color = "var(--a-danger)";
            messageEl.textContent = err.message;
        });
    });

    var passwordMessageEl = document.getElementById("passwordLoginMessage");
    document.getElementById("passwordLoginForm").addEventListener("submit", function (e) {
        e.preventDefault();
        var email = document.getElementById("passwordEmail").value.trim();
        var password = document.getElementById("passwordLoginPassword").value;
        window.AdminAPI.loginWithPassword(email, password).then(function () {
            window.location.href = "/admin/manage/dashboard";
        }).catch(function (err) {
            passwordMessageEl.style.display = "block";
            passwordMessageEl.style.color = "var(--a-danger)";
            passwordMessageEl.textContent = err.message;
        });
    });

    window.AdminAPI.getConfig().then(function (config) {
        if (!config.devMode) return;
        document.getElementById("devToolsSection").style.display = "block";
        document.getElementById("devLoginBtn").addEventListener("click", function () {
            window.AdminAPI.devLoginAsAdmin().then(function () {
                window.location.href = "/admin/manage/dashboard";
            }).catch(function (err) {
                window.AdminUI.toast(err.message, "error");
            });
        });
    }).catch(function () {});
})();
