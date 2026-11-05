// /partnership business offer form: shows the creator-only and brand-only
// fields for the chosen offer type, posts to /api/partnership, and reports
// partnership_* events to PostHog when it is configured (assets/js/analytics.js).
(function () {
  function track(event, props) {
    if (window.faTrack) window.faTrack.capture(event, props);
  }

  document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("partnershipForm");
    if (!form) return;
    var type = form.elements.offerType;
    var errorEl = document.getElementById("pfError");
    var submit = document.getElementById("pfSubmit");
    var done = document.getElementById("pfDone");

    track("partnership_page_viewed");

    // Hidden fields are also disabled, so they are neither validated nor sent.
    function syncFields() {
      form.querySelectorAll("[data-show-for]").forEach(function (wrap) {
        var on = wrap.getAttribute("data-show-for") === type.value;
        wrap.hidden = !on;
        wrap.querySelectorAll("select, input").forEach(function (c) { c.disabled = !on; });
      });
    }
    type.addEventListener("change", syncFields);
    syncFields();

    document.querySelectorAll("[data-cta-location]").forEach(function (a) {
      a.addEventListener("click", function () {
        var offer = a.getAttribute("data-offer");
        if (offer) { type.value = offer; syncFields(); }
        track("partnership_cta_clicked", { location: a.getAttribute("data-cta-location") });
      });
    });

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      errorEl.hidden = true;
      if (!form.reportValidity()) return;

      var data = {};
      new FormData(form).forEach(function (v, k) { data[k] = v; });
      submit.disabled = true;

      window.ProFitAPI.submitPartnershipOffer(data)
        .then(function () {
          // No message body or links: only the offer facts and who sent it.
          track("partnership_offer_submitted", {
            offer_type: data.offerType,
            audience_range: data.audience || null,
            country: data.country,
            $set: { email: data.email, name: data.name },
          });
          form.hidden = true;
          done.hidden = false;
          done.focus();
        })
        .catch(function (err) {
          errorEl.textContent = (err && err.message) || "Something went wrong. Please email info@fitness.agency.";
          errorEl.hidden = false;
          submit.disabled = false;
        });
    });
  });
})();
