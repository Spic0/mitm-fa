(function () {
    var form = document.getElementById("magicLinkForm");
    var message = document.getElementById("magicLinkMessage");
    var submitBtn = document.getElementById("magicLinkSubmit");

    function showMessage(text, isError) {
        message.textContent = text;
        message.style.display = "block";
        message.style.color = isError ? "#dc2626" : "#059669";
    }

    var params = new URLSearchParams(window.location.search);
    if (params.get("error") === "expired") {
        showMessage("That sign-in link expired or was already used. Request a new one below.", true);
    }

    form.addEventListener("submit", function (e) {
        e.preventDefault();
        var email = document.getElementById("magicLinkEmail").value.trim();
        submitBtn.disabled = true;
        submitBtn.textContent = "Sending…";
        window.ProFitAPI.requestMagicLink(email).then(function (data) {
            showMessage(data.message || "Check your email for a sign-in link.", false);
            submitBtn.textContent = "Link Sent";
        }).catch(function (err) {
            showMessage(err.message || "Something went wrong. Please try again.", true);
            submitBtn.disabled = false;
            submitBtn.textContent = "Send Sign-In Link";
        });
    });
})();
