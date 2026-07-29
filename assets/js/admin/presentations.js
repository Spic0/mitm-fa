// Admin "Private Presentations" section — the list, plus a drawer that owns
// both editing and analytics for one deck.
//
// Built entirely from the admin's existing components (a-card, a-table,
// a-drawer, a-badge, a-btn, AdminUI toasts/confirm/skeletons) so this section
// renders as part of the same dashboard rather than as a new surface. The one
// thing it adds is the link row, which has no precedent anywhere else in the
// admin: everything else here already existed.
window.AdminPanels = window.AdminPanels || {};
window.AdminPanels.presentations = (function () {
  var container = null;
  var tbody = null;
  var rows = [];
  var filters = { search: "", status: "", sort: "createdAt-desc" };
  var searchTimer = null;

  function esc(s) { return window.AdminUI.escapeHtml(s); }

  // The public URL an admin actually pastes into an invite. Built from the
  // browser's own origin rather than a configured base so a deck created on
  // staging yields a staging link — copying a production URL out of a staging
  // dashboard is a mistake worth making structurally impossible.
  function publicUrl(slug) {
    return window.location.origin + "/presentation/" + slug;
  }

  function formatDuration(ms) {
    if (!ms) return "—";
    var totalSeconds = Math.round(ms / 1000);
    if (totalSeconds < 60) return totalSeconds + "s";
    var minutes = Math.floor(totalSeconds / 60);
    var seconds = totalSeconds % 60;
    if (minutes < 60) return minutes + "m " + seconds + "s";
    return Math.floor(minutes / 60) + "h " + (minutes % 60) + "m";
  }

  // "live" | "expired" | "disabled" — the server's effectiveState, which
  // already folds a passed expiry date into the answer so the table never
  // shows "Enabled" for a deck that stopped working last week.
  function stateBadge(state) {
    var map = {
      live: { cls: "a-badge-success", label: "Live" },
      expired: { cls: "a-badge-warning", label: "Expired" },
      disabled: { cls: "a-badge-neutral", label: "Disabled" },
    };
    var entry = map[state] || map.disabled;
    return '<span class="a-badge ' + entry.cls + '">' + entry.label + "</span>";
  }

  function mount(root) {
    container = root;
    tbody = root.querySelector("#presentationsTableBody");

    root.querySelector("#createPresentationBtn").addEventListener("click", function () {
      openDrawer(null);
    });

    var search = root.querySelector("#presentationSearch");
    search.addEventListener("input", function () {
      // Debounced: this refetches the list, and a keystroke-per-request would
      // put one query per character on the database.
      window.clearTimeout(searchTimer);
      searchTimer = window.setTimeout(function () {
        filters.search = search.value.trim();
        load();
      }, 250);
    });

    root.querySelector("#presentationStatusFilter").addEventListener("change", function () {
      filters.status = this.value;
      load();
    });
    root.querySelector("#presentationSortFilter").addEventListener("change", function () {
      filters.sort = this.value;
      load();
    });

    // One delegated listener on the tbody instead of per-row handlers — the
    // table is re-rendered wholesale on every load(), and per-row listeners
    // would be re-attached (and leak) each time.
    tbody.addEventListener("click", onTableClick);

    load();
  }

  function load() {
    tbody.innerHTML = window.AdminUI.skeletonRows(8, 5);
    window.AdminAPI.listPresentations(filters)
      .then(function (data) {
        rows = data.presentations || [];
        render();
      })
      .catch(function () {
        tbody.innerHTML =
          '<tr><td colspan="8">' +
          window.AdminUI.emptyState("fa-triangle-exclamation", "Failed to load presentations.") +
          "</td></tr>";
      });
  }

  function render() {
    if (!rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="8">' +
        window.AdminUI.emptyState(
          "fa-lock",
          filters.search || filters.status
            ? "No presentations match those filters."
            : "No presentations yet — create the first one to generate a private link."
        ) +
        "</td></tr>";
      return;
    }

    tbody.innerHTML = rows.map(renderRow).join("");
    window.AdminUI.animateRowsIn(Array.prototype.slice.call(tbody.querySelectorAll("tr")));
  }

  function renderRow(p) {
    var access = p.hasPassword
      ? '<span class="a-badge a-badge-neutral"><i class="fa-solid fa-key"></i> Password</span>'
      : '<span class="pres-admin-muted">Link only</span>';

    return (
      '<tr data-id="' + p.id + '">' +
      "<td>" +
      '<div class="pres-admin-title">' + esc(p.title) + "</div>" +
      (p.recipient ? '<div class="pres-admin-sub">For ' + esc(p.recipient) + "</div>" : "") +
      "</td>" +
      "<td>" + stateBadge(p.state) + "</td>" +
      "<td>" + access + "</td>" +
      "<td>" + (p.expiresAt ? window.AdminUI.formatDate(p.expiresAt) : '<span class="pres-admin-muted">Never</span>') + "</td>" +
      "<td>" + p.visits + "</td>" +
      "<td>" + p.contactSubmissions + "</td>" +
      "<td>" + window.AdminUI.formatDate(p.createdAt) + "</td>" +
      '<td class="a-row-actions">' +
      '<button class="a-btn a-btn-secondary a-btn-sm" data-action="copy" data-slug="' + esc(p.slug) + '" title="Copy private link"><i class="fa-solid fa-link"></i></button> ' +
      '<button class="a-btn a-btn-secondary a-btn-sm" data-action="open" title="Open presentation"><i class="fa-solid fa-arrow-up-right-from-square"></i></button> ' +
      '<button class="a-btn a-btn-secondary a-btn-sm" data-action="duplicate" title="Duplicate"><i class="fa-solid fa-copy"></i></button> ' +
      '<button class="a-btn a-btn-secondary a-btn-sm" data-action="edit" title="Edit &amp; analytics"><i class="fa-solid fa-pen"></i></button> ' +
      '<button class="a-btn a-btn-secondary a-btn-sm" data-action="delete" title="Delete"><i class="fa-solid fa-trash"></i></button>' +
      "</td></tr>"
    );
  }

  function findRow(id) {
    return rows.filter(function (r) { return r.id === id; })[0];
  }

  function onTableClick(e) {
    var btn = e.target.closest("button[data-action]");
    if (!btn) return;
    var tr = btn.closest("tr[data-id]");
    if (!tr) return;
    var id = tr.dataset.id;
    var row = findRow(id);
    if (!row) return;

    var action = btn.dataset.action;
    if (action === "copy") return copyLink(row);
    if (action === "open") return window.open(publicUrl(row.slug), "_blank", "noopener");
    if (action === "edit") return openDrawer(id);
    if (action === "duplicate") return duplicate(row);
    if (action === "delete") return remove(row, tr);
  }

  function copyLink(row) {
    var url = publicUrl(row.slug);
    // navigator.clipboard is unavailable on insecure origins (a plain-HTTP
    // staging box), which is exactly where an admin is most likely to be
    // testing — so there's a fallback rather than a silent no-op.
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(
        function () { window.AdminUI.toast("Private link copied to clipboard", "success"); },
        function () { promptCopy(url); }
      );
    } else {
      promptCopy(url);
    }
  }

  function promptCopy(url) {
    window.prompt("Copy this private link:", url);
  }

  function duplicate(row) {
    window.AdminAPI.duplicatePresentation(row.id)
      .then(function () {
        window.AdminUI.toast("Duplicated — the copy is disabled until you enable it", "success");
        load();
      })
      .catch(function (err) {
        window.AdminUI.toast(err.message || "Failed to duplicate", "error");
      });
  }

  function remove(row, tr) {
    window.AdminUI.confirmDialog({
      title: "Delete this presentation?",
      message:
        'Deleting "' + row.title + '" also deletes its visit history and analytics, and the private link stops working immediately. This cannot be undone.',
      confirmLabel: "Delete",
      danger: true,
    }).then(function (ok) {
      if (!ok) return;
      window.AdminAPI.deletePresentation(row.id)
        .then(function () {
          return window.AdminUI.animateRowRemoval(tr);
        })
        .then(function () {
          window.AdminUI.toast("Presentation deleted", "success");
          load();
        })
        .catch(function (err) {
          window.AdminUI.toast(err.message || "Failed to delete", "error");
        });
    });
  }

  // -------------------------------------------------------------------
  // Drawer — create, edit, and analytics for one presentation.
  //
  // Analytics is fetched only when an existing deck is opened, never on the
  // list's load(), matching how promotion-drawer.js defers the same work.
  // -------------------------------------------------------------------
  var SECTION_FIELDS = [
    { key: "who", label: "Who We Are" },
    { key: "services", label: "Everything We Handle" },
    { key: "studio", label: "Creative Studio" },
    { key: "process", label: "How It Works" },
    { key: "why", label: "Why Fitness Agency" },
    { key: "showcase", label: "Product Showcase" },
    { key: "catalogue", label: "What You Sell" },
    { key: "journey", label: "Customer Journey" },
    { key: "technology", label: "Technology" },
    { key: "philosophy", label: "Our Philosophy" },
    { key: "cta", label: "Schedule Next Meeting" },
  ];

  function fieldRow(id, label, value, hint, type) {
    return (
      '<div class="pres-form-row">' +
      '<label for="' + id + '">' + esc(label) + "</label>" +
      (type === "textarea"
        ? '<textarea id="' + id + '" rows="3">' + esc(value || "") + "</textarea>"
        : '<input type="' + (type || "text") + '" id="' + id + '" value="' + esc(value || "") + '">') +
      (hint ? '<p class="pres-form-hint">' + esc(hint) + "</p>" : "") +
      "</div>"
    );
  }

  function openDrawer(id) {
    var isNew = !id;

    var backdrop = document.createElement("div");
    backdrop.className = "a-modal-backdrop a-drawer-backdrop";
    backdrop.innerHTML =
      '<div class="a-drawer">' +
      '<div class="a-drawer-header">' +
      "<div><h5 id=\"presDrawerTitle\">" + (isNew ? "New Presentation" : "Loading…") + "</h5>" +
      '<p class="a-modal-desc u-mb-0" id="presDrawerSubtitle"></p></div>' +
      '<button class="a-drawer-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
      "</div>" +
      '<div class="a-drawer-tabs">' +
      '<button class="a-drawer-tab active" data-tab="details">Details</button>' +
      '<button class="a-drawer-tab" data-tab="content">Content</button>' +
      (isNew ? "" : '<button class="a-drawer-tab" data-tab="analytics">Analytics</button>') +
      "</div>" +
      '<div class="a-drawer-panel active" data-panel="details"></div>' +
      '<div class="a-drawer-panel" data-panel="content"></div>' +
      (isNew ? "" : '<div class="a-drawer-panel" data-panel="analytics">' + window.AdminUI.skeletonBlock(200) + "</div>") +
      "</div>";

    window.AdminUI.openModal(backdrop);
    backdrop.querySelector(".a-drawer-close").addEventListener("click", function () {
      window.AdminUI.closeModal(backdrop);
    });
    backdrop.querySelectorAll(".a-drawer-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        backdrop.querySelectorAll(".a-drawer-tab").forEach(function (t) {
          t.classList.toggle("active", t === tab);
        });
        backdrop.querySelectorAll(".a-drawer-panel").forEach(function (p) {
          p.classList.toggle("active", p.dataset.panel === tab.dataset.tab);
        });
      });
    });

    if (isNew) {
      renderForm(backdrop, null);
      return;
    }

    window.AdminAPI.getPresentation(id)
      .then(function (data) {
        renderForm(backdrop, data.presentation);
        renderAnalytics(backdrop, data.analytics);
      })
      .catch(function (err) {
        window.AdminUI.toast(err.message || "Failed to load presentation", "error");
        window.AdminUI.closeModal(backdrop);
      });
  }

  function renderForm(backdrop, p) {
    var isNew = !p;
    var content = p ? p.content : {};
    var sections = (content && content.sections) || {};

    backdrop.querySelector("#presDrawerTitle").textContent = isNew ? "New Presentation" : p.title;
    backdrop.querySelector("#presDrawerSubtitle").textContent = isNew
      ? "A private link is generated on save."
      : "Updated " + window.AdminUI.formatDateTime(p.updatedAt);

    // ---- Details tab ----
    var linkBlock = isNew
      ? '<p class="pres-form-hint u-mb-16">The private URL is generated when you save, and is unguessable by design.</p>'
      : '<div class="pres-link">' +
        '<span class="pres-link__label">Private link</span>' +
        '<code class="pres-link__url" id="presLinkUrl">' + esc(publicUrl(p.slug)) + "</code>" +
        '<div class="pres-link__actions">' +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-drawer-action="copy"><i class="fa-solid fa-link"></i> Copy</button>' +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-drawer-action="regenerate"><i class="fa-solid fa-rotate"></i> Regenerate</button>' +
        "</div></div>";

    var passwordBlock = isNew
      ? fieldRow("presPassword", "Password (optional)", "", "Leave empty for a link-only presentation.", "password")
      : '<div class="pres-form-row">' +
        '<label for="presPassword">Password</label>' +
        '<input type="password" id="presPassword" placeholder="' +
        (p.hasPassword ? "Set — type to replace" : "Not set") + '">' +
        '<p class="pres-form-hint">Leave empty to keep the current setting.</p>' +
        (p.hasPassword
          ? '<label class="pres-check"><input type="checkbox" id="presRemovePassword"> <span>Remove password protection</span></label>'
          : "") +
        "</div>";

    backdrop.querySelector('[data-panel="details"]').innerHTML =
      linkBlock +
      fieldRow("presTitle", "Title", isNew ? "" : p.title, "Internal label — never shown on the presentation.") +
      fieldRow("presRecipient", "Prepared for (optional)", isNew ? "" : p.recipient, "Shown in the hero, e.g. a company or a person's name.") +
      '<div class="pres-form-row">' +
      '<label for="presStatus">Status</label>' +
      '<select id="presStatus">' +
      '<option value="enabled"' + (isNew || p.status === "enabled" ? " selected" : "") + ">Enabled</option>" +
      '<option value="disabled"' + (!isNew && p.status === "disabled" ? " selected" : "") + ">Disabled</option>" +
      "</select>" +
      '<p class="pres-form-hint">A disabled presentation returns the site\'s normal 404 — it never reveals that the link once existed.</p>' +
      "</div>" +
      fieldRow(
        "presExpiresAt",
        "Expires (optional)",
        isNew || !p.expiresAt ? "" : new Date(p.expiresAt).toISOString().slice(0, 10),
        "After this date the link shows an expiry notice instead of the deck.",
        "date"
      ) +
      passwordBlock +
      '<div class="a-drawer-footer">' +
      '<button type="button" class="a-btn a-btn-secondary" data-drawer-action="cancel">Cancel</button>' +
      '<button type="button" class="a-btn a-btn-primary" data-drawer-action="save">' +
      (isNew ? "Create presentation" : "Save changes") +
      "</button></div>";

    // ---- Content tab ----
    backdrop.querySelector('[data-panel="content"]').innerHTML =
      '<p class="pres-form-hint u-mb-16">The ten sections are fixed brand content. These override the hero copy and the three call-to-action destinations for this presentation only.</p>' +
      fieldRow("presHeroEyebrow", "Hero eyebrow", content.heroEyebrow, "") +
      fieldRow("presHeroTitle", "Hero headline", content.heroTitle, "") +
      fieldRow("presHeroSubtitle", "Hero subheadline", content.heroSubtitle, "", "textarea") +
      fieldRow("presWelcomeNote", "Personal note (optional)", content.welcomeNote, "One line addressed to this specific viewer.", "textarea") +
      '<h6 class="pres-form-heading">Call-to-action links</h6>' +
      '<p class="pres-form-hint u-mb-16">Leave a field empty and that button scrolls to the enquiry form instead of opening a link.</p>' +
      fieldRow("presCtaPartnershipUrl", "Continue Partnership", content.ctaPartnershipUrl, "", "url") +
      fieldRow("presCtaMeetingUrl", "Schedule Meeting", content.ctaMeetingUrl, "Booking or calendar URL.", "url") +
      fieldRow("presCtaDemoUrl", "Request Demo", content.ctaDemoUrl, "", "url") +
      '<h6 class="pres-form-heading">Sections</h6>' +
      '<p class="pres-form-hint u-mb-16">Unchecked sections are removed server-side — they are never sent to the browser at all.</p>' +
      '<div class="pres-sections">' +
      SECTION_FIELDS.map(function (s) {
        var on = sections[s.key] !== false;
        return (
          '<label class="pres-check"><input type="checkbox" data-section="' + s.key + '"' +
          (on ? " checked" : "") + "> <span>" + esc(s.label) + "</span></label>"
        );
      }).join("") +
      "</div>";

    // ---- Wiring ----
    backdrop.querySelectorAll("[data-drawer-action]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var action = btn.dataset.drawerAction;
        if (action === "cancel") return window.AdminUI.closeModal(backdrop);
        if (action === "copy") return copyLink(p);
        if (action === "regenerate") return regenerate(backdrop, p);
        if (action === "save") return save(backdrop, p, btn);
      });
    });
  }

  function regenerate(backdrop, p) {
    window.AdminUI.confirmDialog({
      title: "Generate a new private link?",
      message:
        "The current link stops working immediately. Anyone you have already sent it to — including anyone mid-meeting — will get a 404 until you send them the new one.",
      confirmLabel: "Regenerate link",
      danger: true,
    }).then(function (ok) {
      if (!ok) return;
      window.AdminAPI.regeneratePresentationLink(p.id)
        .then(function (data) {
          var updated = data.presentation;
          p.slug = updated.slug;
          var urlEl = backdrop.querySelector("#presLinkUrl");
          if (urlEl) urlEl.textContent = publicUrl(updated.slug);
          window.AdminUI.toast("New private link generated", "success");
          load();
        })
        .catch(function (err) {
          window.AdminUI.toast(err.message || "Failed to regenerate link", "error");
        });
    });
  }

  function save(backdrop, p, btn) {
    var isNew = !p;
    var val = function (id) {
      var el = backdrop.querySelector("#" + id);
      return el ? el.value.trim() : "";
    };

    var title = val("presTitle");
    if (!title) {
      window.AdminUI.toast("Title is required", "error");
      var titleEl = backdrop.querySelector("#presTitle");
      if (titleEl) {
        // Switch back to the tab holding the invalid field before focusing it —
        // focusing an input inside a hidden panel scrolls nowhere and looks
        // like the save silently did nothing.
        backdrop.querySelector('.a-drawer-tab[data-tab="details"]').click();
        titleEl.focus();
      }
      return;
    }

    var sections = {};
    backdrop.querySelectorAll("[data-section]").forEach(function (cb) {
      sections[cb.dataset.section] = cb.checked;
    });

    var payload = {
      title: title,
      recipient: val("presRecipient"),
      status: val("presStatus"),
      expiresAt: val("presExpiresAt") || null,
      content: {
        heroEyebrow: val("presHeroEyebrow"),
        heroTitle: val("presHeroTitle"),
        heroSubtitle: val("presHeroSubtitle"),
        welcomeNote: val("presWelcomeNote"),
        ctaPartnershipUrl: val("presCtaPartnershipUrl"),
        ctaMeetingUrl: val("presCtaMeetingUrl"),
        ctaDemoUrl: val("presCtaDemoUrl"),
        sections: sections,
      },
    };

    var password = val("presPassword");
    if (password) payload.password = password;
    var removeCb = backdrop.querySelector("#presRemovePassword");
    if (removeCb && removeCb.checked) payload.removePassword = true;

    btn.classList.add("is-loading");
    btn.disabled = true;

    var request = isNew
      ? window.AdminAPI.createPresentation(payload)
      : window.AdminAPI.updatePresentation(p.id, payload);

    request
      .then(function (data) {
        window.AdminUI.closeModal(backdrop);
        load();
        if (isNew) {
          // A new deck is useless until its link is in hand, so the toast
          // isn't the end of the flow — the link is offered immediately.
          var created = data.presentation;
          window.AdminUI.toast("Presentation created", "success");
          copyLink(created);
        } else {
          window.AdminUI.toast("Presentation saved", "success");
        }
      })
      .catch(function (err) {
        btn.classList.remove("is-loading");
        btn.disabled = false;
        window.AdminUI.toast(err.message || "Failed to save", "error");
      });
  }

  function renderAnalytics(backdrop, stats) {
    var panel = backdrop.querySelector('[data-panel="analytics"]');
    if (!panel) return;

    function tile(label, value, sub) {
      return (
        '<div class="a-card metric-card">' +
        '<div class="metric-card__label">' + label + "</div>" +
        '<div class="metric-card__value pres-metric-value">' + value + "</div>" +
        (sub ? '<div class="pres-metric-sub">' + esc(sub) + "</div>" : "") +
        "</div>"
      );
    }

    var visitsTable = stats.recentVisits.length
      ? '<div class="a-table-wrap"><table class="a-table"><thead><tr>' +
        "<th>When</th><th>Time spent</th><th>Reached</th><th>Wizard</th>" +
        "</tr></thead><tbody>" +
        stats.recentVisits
          .map(function (v) {
            return (
              "<tr><td>" + window.AdminUI.formatDateTime(v.startedAt) + "</td>" +
              "<td>" + formatDuration(v.dwellMs) + "</td>" +
              "<td>Section " + (v.maxSectionIndex + 1) + "</td>" +
              "<td>" +
              (v.wizardCompleted
                ? '<span class="a-badge a-badge-success">Completed</span>'
                : '<span class="a-badge a-badge-neutral">Partial</span>') +
              "</td></tr>"
            );
          })
          .join("") +
        "</tbody></table></div>"
      : window.AdminUI.emptyState("fa-chart-line", "No visits recorded yet.");

    panel.innerHTML =
      '<div class="metric-grid metric-grid-compact u-mb-20">' +
      tile("Visits", stats.visits) +
      tile("Unique visitors", stats.uniqueVisitors) +
      tile("Typical time spent", formatDuration(stats.medianDwellMs), "Median across all visits") +
      tile("Wizard completed", stats.wizardCompletionPct + "%", stats.wizardCompleted + " of " + stats.visits + " visits") +
      tile("CTA clicks", stats.ctaClicks) +
      tile("Enquiries", stats.contactSubmissions) +
      "</div>" +
      (stats.failedUnlocks
        ? '<div class="a-alert a-alert--warning u-mb-16">' +
          stats.failedUnlocks +
          " failed password attempt" +
          (stats.failedUnlocks === 1 ? "" : "s") +
          " on this presentation.</div>"
        : "") +
      '<h6 class="pres-form-heading">Recent visits</h6>' +
      visitsTable;
  }

  return { mount: mount };
})();
