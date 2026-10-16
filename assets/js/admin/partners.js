// Admin "Partner Profiles" section — the list, and the actions that operate
// on a whole profile (publish, unpublish, archive, delete, preview, copy
// link). Creating and editing the profile's CONTENT is the wizard's job
// (assets/js/admin/partner-wizard.js).
//
// Built entirely from the admin's existing components — a-card, a-table,
// a-badge, a-btn/a-btn-secondary/a-btn-sm row actions, a-toolbar, and
// AdminUI's toast/confirmDialog/skeletonRows/emptyState/animateRowsIn — and
// follows presentations.js's row conventions exactly (data-action attributes,
// small secondary buttons in an .a-row-actions cell). Nothing here adds a
// control pattern the admin doesn't already have.
window.AdminPanels = window.AdminPanels || {};
window.AdminPanels.partners = (function () {
  var COLUMNS = 7;

  var tbody = null;
  var rows = [];
  var filters = { search: "", status: "" };
  var searchTimer = null;

  function esc(s) { return window.AdminUI.escapeHtml(s); }

  // The URL an admin actually copies and sends to the partner. Built from the
  // browser's own origin rather than a configured base, so a profile opened
  // in a staging dashboard yields a staging link — handing someone a
  // production URL from a staging screen is a mistake worth making
  // structurally impossible. (Same reasoning as presentations.js.)
  function publicUrl(slug) {
    return window.location.origin + "/partners/" + slug;
  }

  function statusBadge(status) {
    var map = {
      published: { cls: "a-badge-success", label: "Published" },
      draft: { cls: "a-badge-neutral", label: "Draft" },
      archived: { cls: "a-badge-warning", label: "Archived" },
    };
    var entry = map[status] || map.draft;
    return '<span class="a-badge ' + entry.cls + '">' + entry.label + "</span>";
  }

  function renderRow(p) {
    var path = "/partners/" + p.slug;
    var isPublished = p.status === "published";

    return (
      '<tr data-id="' + esc(p.id) + '">' +
      "<td>" +
      '<div class="pres-admin-title">' + esc(p.displayName) + "</div>" +
      '<div class="pres-admin-sub">' + (p.handle ? "@" + esc(p.handle) : esc(p.partnerType)) + "</div>" +
      "</td>" +
      "<td>" + statusBadge(p.status) + "</td>" +
      // A real anchor so open-in-new-tab and copy-link work. An unpublished
      // profile still links here: an admin IS allowed to view it (the public
      // gets a 404), and that is exactly the preview path.
      '<td><a class="partner-admin-url" href="' + esc(path) + '" target="_blank" rel="noopener">' + esc(path) + "</a></td>" +
      "<td>" + p.productCount + "</td>" +
      "<td>" + p.linkCount + "</td>" +
      "<td>" + window.AdminUI.formatDate(p.updatedAt) + "</td>" +
      '<td class="a-row-actions">' +
      '<button class="a-btn a-btn-secondary a-btn-sm" data-action="copy" title="Copy profile URL"><i class="fa-solid fa-link"></i></button> ' +
      '<button class="a-btn a-btn-secondary a-btn-sm" data-action="preview" title="Preview profile"><i class="fa-solid fa-arrow-up-right-from-square"></i></button> ' +
      '<button class="a-btn a-btn-secondary a-btn-sm" data-action="edit" title="Edit profile"><i class="fa-solid fa-pen"></i></button> ' +
      (isPublished
        ? '<button class="a-btn a-btn-secondary a-btn-sm" data-action="unpublish" title="Unpublish"><i class="fa-solid fa-eye-slash"></i></button> '
        : '<button class="a-btn a-btn-secondary a-btn-sm" data-action="publish" title="Publish"><i class="fa-solid fa-cloud-arrow-up"></i></button> ') +
      (p.status === "archived"
        ? ""
        : '<button class="a-btn a-btn-secondary a-btn-sm" data-action="archive" title="Archive"><i class="fa-solid fa-box-archive"></i></button> ') +
      '<button class="a-btn a-btn-secondary a-btn-sm" data-action="delete" title="Delete"><i class="fa-solid fa-trash"></i></button>' +
      "</td></tr>"
    );
  }

  function render() {
    if (!rows.length) {
      tbody.innerHTML =
        '<tr><td colspan="' + COLUMNS + '">' +
        window.AdminUI.emptyState(
          "fa-id-badge",
          filters.search || filters.status
            ? "No partner profiles match those filters."
            : "No partner profiles yet — create the first one to give a partner a single shareable link."
        ) +
        "</td></tr>";
      return;
    }
    tbody.innerHTML = rows.map(renderRow).join("");
    window.AdminUI.animateRowsIn(Array.prototype.slice.call(tbody.querySelectorAll("tr")));
  }

  function load() {
    tbody.innerHTML = window.AdminUI.skeletonRows(COLUMNS, 5);
    var params = {};
    if (filters.search) params.search = filters.search;
    if (filters.status) params.status = filters.status;
    return window.AdminAPI.listPartners(params)
      .then(function (data) {
        rows = window.AdminAPI.rows(data, "partners");
        render();
      })
      .catch(function (err) {
        tbody.innerHTML =
          '<tr><td colspan="' + COLUMNS + '">' +
          window.AdminUI.emptyState("fa-triangle-exclamation", err.message || "Failed to load partner profiles.") +
          "</td></tr>";
      });
  }

  function findRow(id) {
    return rows.filter(function (r) { return r.id === id; })[0];
  }

  function copyUrl(slug) {
    var url = publicUrl(slug);
    // navigator.clipboard is unavailable on insecure origins and in some
    // locked-down browsers. Copying the link is the single most common thing
    // an admin does on this screen, so it falls back to a selectable prompt
    // rather than failing silently.
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(url).then(
        function () { window.AdminUI.toast("Profile URL copied", "success"); },
        function () { window.prompt("Copy this profile URL:", url); }
      );
    } else {
      window.prompt("Copy this profile URL:", url);
    }
  }

  // One handler for every status verb — they differ only in the API call, the
  // confirmation copy and the toast.
  var STATUS_ACTIONS = {
    publish: {
      call: function (id) { return window.AdminAPI.publishPartner(id); },
      confirm: null,
      done: function (p) { return "Published — live at " + publicUrl(p.slug); },
    },
    unpublish: {
      call: function (id) { return window.AdminAPI.unpublishPartner(id); },
      confirm: {
        title: "Unpublish this profile?",
        message: "The public URL starts returning 404 immediately. Links and product selection are kept, so you can publish it again at any time.",
        confirmLabel: "Unpublish",
      },
      done: function () { return "Profile unpublished"; },
    },
    archive: {
      call: function (id) { return window.AdminAPI.archivePartner(id); },
      confirm: {
        title: "Archive this profile?",
        message: "It comes off the public site but keeps its links and product curation. You can publish it again later.",
        confirmLabel: "Archive",
      },
      done: function () { return "Profile archived"; },
    },
  };

  function statusAction(partner, action) {
    var config = STATUS_ACTIONS[action];
    if (!config) return;
    var gate = config.confirm ? window.AdminUI.confirmDialog(config.confirm) : Promise.resolve(true);
    gate.then(function (ok) {
      if (!ok) return;
      config.call(partner.id)
        .then(function () {
          window.AdminUI.toast(config.done(partner), "success");
          return load();
        })
        .catch(function (err) {
          window.AdminUI.toast(err.message || "Action failed", "error");
        });
    });
  }

  function onTableClick(e) {
    var btn = e.target.closest("[data-action]");
    if (!btn) return;
    var tr = btn.closest("tr");
    if (!tr) return;
    var partner = findRow(tr.dataset.id);
    if (!partner) return;
    var action = btn.dataset.action;

    if (action === "edit") {
      window.AdminPartnerWizard.open(partner.id, function () { load(); });
      return;
    }
    if (action === "preview") {
      // Deliberately the SAME URL the public uses. An admin session renders a
      // draft with a preview banner and robots:noindex, so there is no second
      // preview route or shareable token to keep in step with the real page.
      window.open(publicUrl(partner.slug), "_blank", "noopener");
      return;
    }
    if (action === "copy") {
      copyUrl(partner.slug);
      return;
    }
    if (action === "delete") {
      window.AdminUI.confirmDialog({
        title: "Delete " + partner.displayName + "?",
        message:
          "This permanently removes the profile, its custom links and its product selection. The products themselves are not affected. Archive it instead if you only want it off the public site.",
        confirmLabel: "Delete",
        danger: true,
      }).then(function (ok) {
        if (!ok) return;
        window.AdminAPI.deletePartner(partner.id)
          .then(function () {
            window.AdminUI.toast("Profile deleted", "success");
            return load();
          })
          .catch(function (err) {
            window.AdminUI.toast(err.message || "Could not delete", "error");
          });
      });
      return;
    }
    statusAction(partner, action);
  }

  function mount(root) {
    tbody = root.querySelector("#partnersTableBody");

    root.querySelector("#createPartnerBtn").addEventListener("click", function () {
      window.AdminPartnerWizard.open(null, function () { load(); });
    });

    var search = root.querySelector("#partnerSearch");
    search.addEventListener("input", function () {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(function () {
        filters.search = search.value.trim();
        load();
      }, 250);
    });

    var statusFilter = root.querySelector("#partnerStatusFilter");
    statusFilter.addEventListener("change", function () {
      filters.status = statusFilter.value;
      load();
    });

    tbody.addEventListener("click", onTableClick);
    load();
  }

  return { mount: mount };
})();
