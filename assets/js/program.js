// Renders the gated "open program" view: the structured content a customer
// gets after purchasing, instead of a downloaded file. Access is enforced
// server-side (GET /api/library/program/:id 403s if not entitled) — this
// script just reflects that outcome in the UI.
(function () {
  function escapeHtml(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function setMeta(id, value, iconLabel) {
    var el = document.getElementById(id);
    if (!value) return;
    el.style.display = "inline-block";
    el.querySelector("span").textContent = iconLabel ? iconLabel(value) : value;
  }

  // Exercise demo media (GIF / short video) uploaded via the admin wizard.
  // Served through the gated /api/library/media endpoint, so the <img>/<video>
  // request rides the same session cookie as the page itself. The wrapper
  // reserves a square via CSS aspect-ratio so lazy media never shifts layout.
  function mediaHtml(ex) {
    if (!ex.mediaUrl) return "";
    var url = escapeHtml(ex.mediaUrl);
    var inner = ex.mediaType === "video"
      ? '<video src="' + url + '" muted loop playsinline autoplay preload="metadata"></video>'
      : '<img src="' + url + '" alt="' + escapeHtml(ex.name || "Exercise") + ' demonstration" loading="lazy" decoding="async">';
    return '<div class="program-exercise-media">' + inner + "</div>";
  }

  function renderTraining(content) {
    var notesEl = document.getElementById("trainingNotes");
    var weeksEl = document.getElementById("trainingWeeks");
    var emptyEl = document.getElementById("trainingEmpty");
    var weeks = (content && content.weeks) || [];

    notesEl.textContent = (content && content.notes) || "";
    if (!weeks.length) {
      emptyEl.style.display = "block";
      return;
    }
    // Weeks are native <details> accordions (first week open): a 12-week
    // program on a phone is a short scannable list, not a wall of text.
    weeksEl.innerHTML = weeks.map(function (week, wi) {
      var days = (week.days || []).map(function (day) {
        var exercises = (day.exercises || []).map(function (ex) {
          var prescription = [ex.sets, ex.reps].filter(Boolean).join(" × ");
          return (
            '<div class="program-exercise">' + mediaHtml(ex) +
            '<div class="program-exercise-info">' +
            "<strong>" + escapeHtml(ex.name || "Exercise") + "</strong>" +
            (prescription ? '<span class="program-exercise-reps">' + escapeHtml(prescription) + "</span>" : "") +
            (ex.notes ? '<p class="program-exercise-notes">' + escapeHtml(ex.notes) + "</p>" : "") +
            (ex.substitutions ? '<p class="program-exercise-notes">Substitutions: ' + escapeHtml(ex.substitutions) + "</p>" : "") +
            "</div></div>"
          );
        }).join("");
        return (
          '<div class="program-day"><h5 class="mb-10">' + escapeHtml(day.title || "Day") + "</h5>" +
          (day.notes ? "<p>" + escapeHtml(day.notes) + "</p>" : "") +
          exercises +
          "</div>"
        );
      }).join("");
      var dayCount = (week.days || []).length;
      return (
        '<details class="program-week"' + (wi === 0 ? " open" : "") + ">" +
        "<summary><span>" + escapeHtml(week.title || "Week " + (wi + 1)) + "</span>" +
        '<span class="program-week-meta">' + dayCount + (dayCount === 1 ? " day" : " days") +
        ' <i class="fa-regular fa-angle-down" aria-hidden="true"></i></span></summary>' +
        '<div class="program-week-body">' + days + "</div></details>"
      );
    }).join("");
  }

  function renderNutrition(content) {
    var notesEl = document.getElementById("nutritionNotes");
    var mealsEl = document.getElementById("nutritionMeals");
    var emptyEl = document.getElementById("nutritionEmpty");
    var meals = (content && content.meals) || [];

    notesEl.textContent = (content && content.notes) || "";
    if (!meals.length) {
      emptyEl.style.display = "block";
      return;
    }
    mealsEl.innerHTML = meals.map(function (meal) {
      return (
        '<div class="program-week"><h4 class="mb-10">' + escapeHtml(meal.name || "Meal") + "</h4>" +
        (meal.macros ? "<p><strong>Macros:</strong> " + escapeHtml(meal.macros) + "</p>" : "") +
        (meal.ingredients ? "<p><strong>Ingredients:</strong> " + escapeHtml(meal.ingredients) + "</p>" : "") +
        (meal.notes ? "<p>" + escapeHtml(meal.notes) + "</p>" : "") +
        "</div>"
      );
    }).join("");
  }

  function renderFaqs(faqs) {
    var listEl = document.getElementById("faqList");
    var emptyEl = document.getElementById("faqEmpty");
    if (!faqs || !faqs.length) {
      emptyEl.style.display = "block";
      return;
    }
    listEl.innerHTML = faqs.map(function (faq) {
      return '<div class="program-week"><h5 class="mb-10">' + escapeHtml(faq.question) + "</h5><p>" + escapeHtml(faq.answer) + "</p></div>";
    }).join("");
  }

  function renderResources(resources, bonusNotes) {
    document.getElementById("bonusNotes").textContent = bonusNotes || "";
    var listEl = document.getElementById("resourceList");
    var emptyEl = document.getElementById("bonusEmpty");
    if (!resources || !resources.length) {
      emptyEl.style.display = "block";
      return;
    }
    listEl.innerHTML = resources.map(function (r) {
      return (
        '<div class="resource-item"><div><strong>' + escapeHtml(r.title) + "</strong>" +
        (r.description ? '<div class="pv-res__desc">' + escapeHtml(r.description) + "</div>" : "") +
        '</div><a class="btn-two" href="' + escapeHtml(r.url) + '" target="_blank" rel="noopener"><span>' + (r.type === "link" ? "Open" : "Download") + "</span></a></div>"
      );
    }).join("");
  }

  function wireTabs() {
    var tabs = document.querySelectorAll("#programTabs [data-tab]");
    tabs.forEach(function (tab) {
      tab.addEventListener("click", function () {
        tabs.forEach(function (t) { t.classList.remove("active"); });
        document.querySelectorAll(".program-panel").forEach(function (p) { p.classList.remove("active"); });
        tab.classList.add("active");
        document.getElementById("panel-" + tab.dataset.tab).classList.add("active");
      });
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    var productId = decodeURIComponent(window.location.pathname.replace(/^\/my-library\//, "").split(/[/?#]/)[0] || "");
    if (!productId) {
      window.location.href = "/my-library";
      return;
    }

    window.ProFitAPI.getProgram(productId).then(function (data) {
      var p = data.product;

      // Customer Preview Mode: the server lets admins open any program
      // (including drafts) without a purchase and flags it — show a bar so
      // it's unmistakable this is the QA view, not a granted entitlement.
      if (data.preview) {
        var bar = document.createElement("div");
        bar.className = "program-preview-bar";
        var statusNote = data.productStatus && data.productStatus !== "published"
          ? " · status: " + escapeHtml(data.productStatus) + " (not purchasable yet)"
          : "";
        bar.innerHTML =
          '<span><i class="fa-regular fa-eye" aria-hidden="true"></i> <strong>Customer Preview</strong>' +
          " — exactly what buyers see" + statusNote + "</span>" +
          '<a href="/admin/manage/products">Back to admin</a>';
        document.body.appendChild(bar);
        document.body.classList.add("has-preview-bar");
      }

      document.getElementById("programContent").style.display = "block";
      document.getElementById("programBannerTitle").textContent = p.name;
      document.getElementById("programTitle").textContent = p.name;
      if (p.imageUrl) document.getElementById("programImage").src = p.imageUrl;

      setMeta("programCreator", p.creator);
      setMeta("programCategory", p.category);
      setMeta("programDifficulty", p.difficulty);
      setMeta("programDuration", p.durationWeeks, function (v) { return v + "-week program"; });

      document.getElementById("programOverview").textContent = p.overview || "No overview provided yet.";
      renderTraining(p.trainingContent);
      renderNutrition(p.nutritionContent);
      renderFaqs(p.faqs);
      renderResources(p.resources, p.bonusNotes);
      wireTabs();

      // Fullscreen handbook viewer. Handed the same payload the tabs were
      // built from, so the two can never show different content.
      var openBtn = document.getElementById("openHandbook");
      if (openBtn && window.ProgramViewer) {
        openBtn.addEventListener("click", function () {
          window.ProgramViewer.open(data);
        });
        // Deep link: /my-library/<id>#handbook opens straight into the reader,
        // which is what the "Continue" action in the library links to.
        if (window.location.hash === "#handbook") window.ProgramViewer.open(data);
      } else if (openBtn) {
        openBtn.style.display = "none";
      }
    }).catch(function () {
      document.getElementById("programLocked").style.display = "block";
    });
  });
})();
