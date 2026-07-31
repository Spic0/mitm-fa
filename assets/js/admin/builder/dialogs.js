// Every dialog and settings panel the Product Builder opens.
//
// Split out of ui.js because these are all the same shape — take a workspace,
// collect a few choices, call one core operation, re-render — and none of them
// need to know anything about the outline/canvas/inspector rendering. ui.js
// stays the workspace; this stays the commands.
//
// The design rule shared by all of them: a dialog must never be the *only* way
// to do something, and must never be needed to do something once. Dialogs here
// exist to fan one action out across many targets (this week into five weeks,
// this replacement across the whole product) — the single-item version of each
// is always a click in the inspector or the context menu.
window.AdminBuilderDialogs = (function () {
  var Core = window.AdminBuilderCore;
  function esc(s) { return window.AdminUI.escapeHtml(s == null ? "" : String(s)); }
  function toast(m, t) { window.AdminUI.toast(m, t || "success"); }

  // The accept= list for anything that takes program/gallery media. Kept in
  // one place because it has to stay in step with MEDIA_MIME / GALLERY_MIME in
  // server/src/routes/admin/products.js — a type accepted here but not there
  // is a file the user can pick and then watch fail.
  var MEDIA_ACCEPT =
    "image/png,image/jpeg,image/webp,image/gif,image/svg+xml,video/mp4,video/quicktime,video/webm,.mov";

  // Progress panel shown in place of whatever the upload replaced. The bar is
  // driven by real XHR upload events, not a timer — see AdminAPI.formRequest.
  function uploadProgressMarkup(fileName, status) {
    return (
      '<div class="fab-upload-progress">' +
      '<p class="fab-upload-name">' + esc(fileName) + "</p>" +
      '<div class="fab-progress-track"><div class="fab-progress-bar" style="width:0%"></div></div>' +
      '<p class="fab-hint fab-progress-pct">' + esc(status || "Uploading…") + "</p>" +
      "</div>"
    );
  }

  // ---------------------------------------------------------------------------
  // Dialog shell
  // ---------------------------------------------------------------------------
  // Reuses AdminUI.openModal so the builder's dialogs inherit the admin panel's
  // backdrop, escape handling and body-scroll lock rather than growing a
  // second, subtly different modal system.
  function dialog(opts) {
    var backdrop = document.createElement("div");
    backdrop.className = "a-modal-backdrop fab-dialog-backdrop";
    backdrop.innerHTML =
      '<div class="a-modal fab-dialog' + (opts.wide ? " fab-dialog-wide" : "") + '">' +
      "<h5>" + esc(opts.title) + "</h5>" +
      (opts.desc ? '<p class="a-modal-desc">' + esc(opts.desc) + "</p>" : "") +
      '<div class="fab-dialog-body">' + opts.body + "</div>" +
      '<div class="a-modal-actions fab-dialog-actions">' +
      '<button type="button" class="a-btn a-btn-secondary" data-act="cancel">' + esc(opts.cancelLabel || "Cancel") + "</button>" +
      (opts.confirmLabel
        ? '<button type="button" class="a-btn a-btn-primary" data-act="confirm">' + esc(opts.confirmLabel) + "</button>"
        : "") +
      "</div></div>";

    function close() { window.AdminUI.closeModal(backdrop); }
    window.AdminUI.openModal(backdrop, close);
    backdrop.querySelector('[data-act="cancel"]').addEventListener("click", close);
    var confirmBtn = backdrop.querySelector('[data-act="confirm"]');
    if (confirmBtn && opts.onConfirm) {
      confirmBtn.addEventListener("click", function () {
        // Returning false from onConfirm keeps the dialog open, which is how
        // validation failures are reported without a second dialog.
        if (opts.onConfirm(backdrop, close) !== false) close();
      });
    }
    if (opts.onMount) opts.onMount(backdrop, close);
    return { el: backdrop, close: close };
  }

  // A reusable list of every week with a checkbox — the shared control behind
  // "duplicate into weeks" and "copy days into weeks".
  function weekPickerHtml(doc, excludeId) {
    if (!doc.training.weeks.length) return '<p class="fab-dialog-empty">There are no other weeks yet. Generate some first.</p>';
    return (
      '<div class="fab-picker-tools">' +
      '<button type="button" class="fab-btn fab-btn-sm" data-pick="all">Select all</button>' +
      '<button type="button" class="fab-btn fab-btn-sm" data-pick="none">Clear</button>' +
      "</div>" +
      '<div class="fab-picker">' +
      doc.training.weeks.map(function (w, i) {
        if (w.id === excludeId) return "";
        var counts = Core.countsFor(w, "week");
        return (
          '<label class="fab-picker-item">' +
          '<input type="checkbox" value="' + esc(w.id) + '">' +
          "<span>" + esc(w.title || "Week " + (i + 1)) + "</span>" +
          '<span class="fab-picker-meta">' + counts.days + " days" + (counts.days ? " · will be replaced" : "") + "</span>" +
          "</label>"
        );
      }).join("") +
      "</div>"
    );
  }

  function wireWeekPicker(backdrop) {
    var all = backdrop.querySelector('[data-pick="all"]');
    var none = backdrop.querySelector('[data-pick="none"]');
    function setAll(v) {
      backdrop.querySelectorAll(".fab-picker input[type=checkbox]").forEach(function (cb) { cb.checked = v; });
    }
    if (all) all.addEventListener("click", function () { setAll(true); });
    if (none) none.addEventListener("click", function () { setAll(false); });
  }

  function checkedValues(backdrop) {
    return Array.prototype.slice.call(backdrop.querySelectorAll(".fab-picker input[type=checkbox]:checked"))
      .map(function (cb) { return cb.value; });
  }

  // ---------------------------------------------------------------------------
  // Week generator
  // ---------------------------------------------------------------------------
  // "Create 12 weeks" as one action, optionally with all seven days already in
  // place — the single biggest click saving in the whole builder, since the
  // alternative is 12 + 84 manual insertions.
  function generateWeeks(ws, refresh) {
    var doc = ws.store.doc;
    dialog({
      title: "Generate weeks",
      desc: "Create the program skeleton in one action. You can rename and reorder everything afterwards.",
      body:
        '<div class="fab-field"><label>How many weeks?</label>' +
        '<div class="fab-chiprow">' +
        [4, 6, 8, 12, 16].map(function (n) {
          return '<button type="button" class="fab-chip" data-count="' + n + '">' + n + "</button>";
        }).join("") +
        '<input type="number" min="1" max="52" value="12" id="weekCount" class="fab-input fab-input-num"></div></div>' +
        '<div class="fab-field"><label class="fab-check"><input type="checkbox" id="withDays" checked> Fill each week with Monday–Sunday</label></div>' +
        '<div class="fab-field"><label>Or clone an existing week</label>' +
        '<select id="fromWeek" class="fab-input"><option value="">— start from empty days —</option>' +
        doc.training.weeks.map(function (w, i) {
          return '<option value="' + esc(w.id) + '">' + esc(w.title || "Week " + (i + 1)) + "</option>";
        }).join("") +
        "</select>" +
        '<p class="fab-hint">Cloning copies that week\'s days, exercises, meals and media into every generated week.</p></div>',
      confirmLabel: "Generate",
      onMount: function (backdrop) {
        backdrop.querySelectorAll("[data-count]").forEach(function (chip) {
          chip.addEventListener("click", function () {
            backdrop.querySelector("#weekCount").value = chip.dataset.count;
            backdrop.querySelectorAll("[data-count]").forEach(function (c) { c.classList.toggle("is-active", c === chip); });
          });
        });
      },
      onConfirm: function (backdrop) {
        var count = parseInt(backdrop.querySelector("#weekCount").value, 10);
        if (!count || count < 1 || count > 52) { toast("Pick between 1 and 52 weeks", "error"); return false; }
        var fromWeekId = backdrop.querySelector("#fromWeek").value || null;
        var res = Core.ops.generateWeeks(ws.store, count, {
          withDays: backdrop.querySelector("#withDays").checked,
          fromWeekId: fromWeekId,
        });
        refresh();
        toast("Generated " + res.count + " weeks");
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Fan-out: one week into many
  // ---------------------------------------------------------------------------
  function duplicateWeekInto(ws, weekId, refresh) {
    var doc = ws.store.doc;
    var src = Core.locate(doc, weekId);
    if (!src || src.kind !== "week") return;

    dialog({
      title: "Duplicate " + (src.node.title || "this week"),
      desc: "Pick every week this should be copied into. All of them are done in one action, and one Ctrl+Z undoes the lot.",
      body:
        weekPickerHtml(doc, weekId) +
        '<div class="fab-field"><label>What happens to days already in the target week?</label>' +
        '<label class="fab-check"><input type="radio" name="mode" value="replace" checked> Replace them</label>' +
        '<label class="fab-check"><input type="radio" name="mode" value="append"> Keep them and add after</label></div>' +
        '<div class="fab-field"><button type="button" class="fab-btn fab-btn-sm" id="alsoNew"><i class="fa-solid fa-plus"></i> Create new weeks instead…</button>' +
        '<p class="fab-hint">Nothing to copy into yet? Generate more weeks first.</p></div>',
      confirmLabel: "Duplicate",
      onMount: function (backdrop, close) {
        wireWeekPicker(backdrop);
        backdrop.querySelector("#alsoNew").addEventListener("click", function () {
          close();
          generateWeeks(ws, refresh);
        });
      },
      onConfirm: function (backdrop) {
        var targets = checkedValues(backdrop);
        if (!targets.length) { toast("Pick at least one week", "error"); return false; }
        var mode = backdrop.querySelector('input[name="mode"]:checked').value;
        var res = Core.ops.applyWeekTo(ws.store, weekId, targets, mode);
        refresh();
        toast("Copied into " + res.count + " week" + (res.count === 1 ? "" : "s"));
      },
    });
  }

  // "Select Monday, Wednesday, Friday → copy into weeks 3-6."
  function copyDaysInto(ws, dayIds, refresh) {
    var doc = ws.store.doc;
    var days = dayIds.map(function (id) { return Core.locate(doc, id); }).filter(function (f) { return f && f.kind === "day"; });
    if (!days.length) return toast("Select one or more days first", "warning");

    dialog({
      title: "Copy " + days.length + " day" + (days.length === 1 ? "" : "s") + " into other weeks",
      desc: days.map(function (d) { return d.node.title || "Untitled"; }).join(", "),
      body:
        weekPickerHtml(doc, null) +
        '<div class="fab-field"><label>How should they land?</label>' +
        '<label class="fab-check"><input type="radio" name="mode" value="append" checked> Add to the end of each week</label>' +
        '<label class="fab-check"><input type="radio" name="mode" value="replace"> Replace the week\'s days entirely</label></div>',
      confirmLabel: "Copy",
      onMount: wireWeekPicker,
      onConfirm: function (backdrop) {
        var targets = checkedValues(backdrop);
        if (!targets.length) { toast("Pick at least one week", "error"); return false; }
        var mode = backdrop.querySelector('input[name="mode"]:checked').value;
        var res = Core.ops.applyDaysTo(ws.store, dayIds, targets, mode);
        refresh();
        toast("Copied into " + res.count + " week" + (res.count === 1 ? "" : "s"));
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Smart replace
  // ---------------------------------------------------------------------------
  // Live match count as you type, so the admin can see "48 matches" before
  // committing a change that touches the whole product.
  function smartReplace(ws, refresh) {
    var scopeIds = ws.selection.slice();
    var d = dialog({
      title: "Smart replace",
      desc: "Swap a name everywhere it appears — Bench Press → Incline Bench, Chicken → Turkey.",
      wide: true,
      body:
        '<div class="fab-grid2">' +
        '<div class="fab-field"><label>Find</label><input class="fab-input" id="findInput" placeholder="Bench Press"></div>' +
        '<div class="fab-field"><label>Replace with</label><input class="fab-input" id="replaceInput" placeholder="Incline Bench"></div>' +
        "</div>" +
        '<div class="fab-field fab-inline-checks">' +
        '<label class="fab-check"><input type="checkbox" id="caseSensitive"> Match case</label>' +
        '<label class="fab-check"><input type="checkbox" id="wholeWord"> Whole words only</label>' +
        (scopeIds.length
          ? '<label class="fab-check"><input type="checkbox" id="scoped" checked> Only in the ' + scopeIds.length + " selected item" + (scopeIds.length === 1 ? "" : "s") + "</label>"
          : "") +
        "</div>" +
        '<div class="fab-replace-preview" id="preview"><p class="fab-hint">Type something to find to see what would change.</p></div>',
      confirmLabel: "Replace all",
      onMount: function (backdrop) {
        var findInput = backdrop.querySelector("#findInput");
        var preview = backdrop.querySelector("#preview");
        function opts() {
          var scoped = backdrop.querySelector("#scoped");
          return {
            caseSensitive: backdrop.querySelector("#caseSensitive").checked,
            wholeWord: backdrop.querySelector("#wholeWord").checked,
            scopeIds: scoped && scoped.checked ? scopeIds : null,
          };
        }
        function update() {
          var find = findInput.value;
          if (!find) { preview.innerHTML = '<p class="fab-hint">Type something to find to see what would change.</p>'; return; }
          var res = Core.ops.smartReplacePreview(ws.store, find, opts());
          if (!res.matches) { preview.innerHTML = '<p class="fab-hint">No matches.</p>'; return; }
          // Capped at 40 rows: the count is the decision-relevant number, and a
          // 500-row list would be slow to build and useless to read.
          preview.innerHTML =
            '<p class="fab-replace-count"><strong>' + res.matches + "</strong> match" + (res.matches === 1 ? "" : "es") +
            " in " + res.nodes.length + " item" + (res.nodes.length === 1 ? "" : "s") + "</p>" +
            '<ul class="fab-replace-list">' +
            res.nodes.slice(0, 40).map(function (n) {
              return "<li><span class=\"fab-replace-kind\">" + esc((Core.KINDS[n.kind] || {}).label || n.kind) + "</span>" + esc(n.label) + "</li>";
            }).join("") +
            (res.nodes.length > 40 ? '<li class="fab-more">+' + (res.nodes.length - 40) + " more</li>" : "") +
            "</ul>";
        }
        backdrop.querySelectorAll("#findInput, #caseSensitive, #wholeWord, #scoped").forEach(function (el) {
          el.addEventListener("input", update);
          el.addEventListener("change", update);
        });
        findInput.focus();
      },
      onConfirm: function (backdrop) {
        var find = backdrop.querySelector("#findInput").value;
        if (!find) { toast("Enter something to find", "error"); return false; }
        var scoped = backdrop.querySelector("#scoped");
        var res = Core.ops.smartReplace(ws.store, find, backdrop.querySelector("#replaceInput").value, {
          caseSensitive: backdrop.querySelector("#caseSensitive").checked,
          wholeWord: backdrop.querySelector("#wholeWord").checked,
          scopeIds: scoped && scoped.checked ? scopeIds : null,
        });
        refresh();
        toast("Replaced " + res.matches + " occurrence" + (res.matches === 1 ? "" : "s") + " — Ctrl+Z to undo");
      },
    });
    return d;
  }

  // ---------------------------------------------------------------------------
  // Bulk text
  // ---------------------------------------------------------------------------
  function bulkText(ws, ids, field, title, done) {
    dialog({
      title: title,
      desc: "This will be set on all " + ids.length + " selected item" + (ids.length === 1 ? "" : "s") + ", replacing whatever is there now.",
      body: '<div class="fab-field"><textarea class="fab-input" id="bulkValue" rows="5" placeholder="Leave empty to clear"></textarea></div>',
      confirmLabel: "Apply to all",
      onMount: function (backdrop) { backdrop.querySelector("#bulkValue").focus(); },
      onConfirm: function (backdrop) {
        var res = Core.ops.bulkSet(ws.store, ids, field, backdrop.querySelector("#bulkValue").value);
        if (done) done();
        toast("Updated " + res.count + " item" + (res.count === 1 ? "" : "s"));
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Templates
  // ---------------------------------------------------------------------------
  function saveAsTemplate(ws, nodeId, kind) {
    var f = Core.locate(ws.store.doc, nodeId);
    if (!f) return;
    dialog({
      title: "Save this " + kind + " as a template",
      desc: "Reusable across every product — Push Day, Recovery Day, Competition Week.",
      body:
        '<div class="fab-field"><label>Template name</label><input class="fab-input" id="tplName" value="' + esc(Core.nodeLabel(f.node, kind)) + '"></div>' +
        '<div class="fab-field"><label>Category (optional)</label><input class="fab-input" id="tplCat" placeholder="e.g. Push / Pull / Legs"></div>',
      confirmLabel: "Save template",
      onMount: function (backdrop) { backdrop.querySelector("#tplName").select(); },
      onConfirm: function (backdrop) {
        var name = backdrop.querySelector("#tplName").value.trim();
        if (!name) { toast("Give it a name", "error"); return false; }
        window.AdminAPI.createBuilderTemplate({
          name: name,
          category: backdrop.querySelector("#tplCat").value.trim(),
          kind: kind,
          node: f.node,
        }).then(function (data) {
          ws.templates.unshift(data.template);
          toast('Saved "' + data.template.name + '" as a template');
        }).catch(function (err) { toast(err.message, "error"); });
      },
    });
  }

  // The library itself. `opts.insertInto` is a day id when opened from a day's
  // "Insert template" button, which makes the primary action insert-here
  // instead of the generic append-to-selected-week.
  function templateLibrary(ws, refresh, opts) {
    opts = opts || {};
    var d = dialog({
      title: "Template library",
      desc: "Insert a saved day or week in one click.",
      wide: true,
      body: '<div class="fab-field"><input class="fab-input" id="tplSearch" placeholder="Search templates…"></div><div id="tplList"><p class="fab-hint">Loading…</p></div>',
      cancelLabel: "Close",
      onMount: function (backdrop, close) {
        var list = backdrop.querySelector("#tplList");
        var search = backdrop.querySelector("#tplSearch");

        function render(templates) {
          var term = search.value.trim().toLowerCase();
          var shown = templates.filter(function (t) {
            return !term || t.name.toLowerCase().indexOf(term) !== -1 || (t.category || "").toLowerCase().indexOf(term) !== -1;
          });
          if (!shown.length) {
            list.innerHTML = '<p class="fab-dialog-empty">No templates yet. Open any day or week and choose “Save as template”.</p>';
            return;
          }
          list.innerHTML = '<div class="fab-tpl-grid">' + shown.map(function (t) {
            var counts = t.kind === "week"
              ? (t.node.days || []).length + " days"
              : (t.node.exercises || []).length + " exercises";
            return (
              '<div class="fab-tpl-card">' +
              '<div class="fab-tpl-kind"><i class="fa-solid ' + (t.kind === "week" ? "fa-calendar-week" : "fa-calendar-day") + '"></i> ' + esc(t.kind) + "</div>" +
              '<div class="fab-tpl-name">' + esc(t.name) + "</div>" +
              '<div class="fab-tpl-meta">' + esc(t.category || "Uncategorised") + " · " + counts + "</div>" +
              '<div class="fab-tpl-actions">' +
              '<button type="button" class="fab-btn fab-btn-sm fab-btn-primary" data-insert="' + esc(t.id) + '">Insert</button>' +
              '<button type="button" class="fab-btn fab-btn-sm fab-btn-danger" data-del-tpl="' + esc(t.id) + '"><i class="fa-solid fa-trash"></i></button>' +
              "</div></div>"
            );
          }).join("") + "</div>";

          list.querySelectorAll("[data-insert]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var t = templates.find(function (x) { return x.id === btn.dataset.insert; });
              if (!t) return;
              insertTemplate(ws, t, opts.insertInto);
              refresh();
              close();
            });
          });
          list.querySelectorAll("[data-del-tpl]").forEach(function (btn) {
            btn.addEventListener("click", function () {
              var id = btn.dataset.delTpl;
              window.AdminAPI.deleteBuilderTemplate(id).then(function () {
                ws.templates = ws.templates.filter(function (t) { return t.id !== id; });
                render(ws.templates);
                toast("Template deleted");
              }).catch(function (err) { toast(err.message, "error"); });
            });
          });
        }

        search.addEventListener("input", function () { render(ws.templates); });
        // Always refetch: templates are shared across every admin session, so a
        // cached list from workspace boot can be stale by the time it's opened.
        window.AdminAPI.listBuilderTemplates().then(function (data) {
          ws.templates = data.templates || [];
          render(ws.templates);
        }).catch(function (err) {
          list.innerHTML = '<p class="fab-dialog-empty">' + esc(err.message) + "</p>";
        });
      },
    });
    return d;
  }

  // Insert regenerates every id in the stored subtree, so inserting the same
  // template five times produces five independent days rather than five
  // aliases of one.
  function insertTemplate(ws, template, insertIntoDayId) {
    ws.store.commit("insert-template", function (doc) {
      var copy = Core.cloneNode(template.node, template.kind);
      if (template.kind === "week") {
        doc.training.weeks.push(copy);
        return;
      }
      // A day template: drop it into the week that owns the current focus, or
      // the last week if nothing is focused.
      var anchor = insertIntoDayId ? Core.locate(doc, insertIntoDayId) : (ws.focusId ? Core.locate(doc, ws.focusId) : null);
      var week = null;
      var at = null;
      if (anchor && anchor.kind === "day") { week = anchor.parent; at = anchor.index + 1; }
      else if (anchor && anchor.kind === "week") { week = anchor.node; }
      if (!week) week = doc.training.weeks[doc.training.weeks.length - 1];
      if (!week) {
        week = Core.newWeek({ title: "Week 1" });
        doc.training.weeks.push(week);
      }
      if (at == null) at = week.days.length;
      week.days.splice(at, 0, copy);
    });
    toast('Inserted "' + template.name + '"');
  }

  // ---------------------------------------------------------------------------
  // Media library
  // ---------------------------------------------------------------------------
  // `onPick` is null when opened for browsing, in which case the tiles are
  // just a catalogue.
  function mediaLibrary(ws, onPick) {
    dialog({
      title: "Media library",
      desc: onPick
        ? "Everything already uploaded across every product — pick one instead of uploading it again."
        : "Everything already uploaded across every product.",
      wide: true,
      body:
        '<div class="fab-media-tools">' +
        '<input class="fab-input" id="mediaSearch" placeholder="Search by file, product…">' +
        '<select class="fab-input fab-input-sm" id="mediaType">' +
        '<option value="">All types</option><option value="image">Images</option><option value="video">Videos</option><option value="file">Files</option>' +
        "</select>" +
        '<label class="fab-btn fab-btn-sm fab-upload"><i class="fa-solid fa-upload"></i> Upload new' +
        '<input type="file" hidden id="mediaUpload" accept="' + MEDIA_ACCEPT + '"></label>' +
        "</div>" +
        '<div id="mediaGrid"><p class="fab-hint">Loading…</p></div>',
      cancelLabel: "Close",
      onMount: function (backdrop, close) {
        var grid = backdrop.querySelector("#mediaGrid");
        var search = backdrop.querySelector("#mediaSearch");
        var typeSel = backdrop.querySelector("#mediaType");
        var debounce;

        function load() {
          grid.innerHTML = '<p class="fab-hint">Loading…</p>';
          window.AdminAPI.listMediaLibrary({ search: search.value.trim(), type: typeSel.value }).then(function (data) {
            if (!data.media.length) {
              grid.innerHTML = '<p class="fab-dialog-empty">Nothing matches. Upload a file to start the library.</p>';
              return;
            }
            grid.innerHTML =
              '<div class="fab-media-grid">' + data.media.map(function (m, i) {
                var thumb = m.type === "video"
                  ? '<video src="' + esc(m.url) + '" muted playsinline preload="metadata"></video>'
                  : m.type === "file"
                    ? '<span class="fab-media-file"><i class="fa-solid fa-file"></i></span>'
                    : '<img src="' + esc(m.url) + '" alt="" loading="lazy">';
                return (
                  '<button type="button" class="fab-media-tile" data-index="' + i + '"' + (m.type === "file" ? " disabled" : "") + '>' +
                  '<span class="fab-media-thumb">' + thumb + "</span>" +
                  '<span class="fab-media-name">' + esc(m.title || m.fileName || "") + "</span>" +
                  '<span class="fab-media-src">' + esc(m.productName || m.source) + "</span>" +
                  "</button>"
                );
              }).join("") + "</div>" +
              (data.total > data.media.length ? '<p class="fab-hint">Showing ' + data.media.length + " of " + data.total + " — narrow the search to see the rest.</p>" : "");

            if (!onPick) return;
            grid.querySelectorAll("[data-index]").forEach(function (tile) {
              tile.addEventListener("click", function () {
                onPick(data.media[parseInt(tile.dataset.index, 10)]);
                close();
              });
            });
          }).catch(function (err) {
            grid.innerHTML = '<p class="fab-dialog-empty">' + esc(err.message) + "</p>";
          });
        }

        search.addEventListener("input", function () { clearTimeout(debounce); debounce = setTimeout(load, 250); });
        typeSel.addEventListener("change", load);

        backdrop.querySelector("#mediaUpload").addEventListener("change", function (e) {
          var file = e.target.files[0];
          if (!file) return;
          e.target.value = "";

          // Compress first (large stills only — see upload-compress.js for what
          // it refuses to touch), then upload the result. The progress bar is
          // driven by real bytes-sent from XHR, so it reflects the compressed
          // size, which is what is actually being transferred.
          grid.innerHTML = uploadProgressMarkup(file.name, "Preparing…");
          window.AdminUpload.maybeCompressImage(file).then(function (toSend) {
            var note = window.AdminUpload.compressionNote(toSend);
            grid.innerHTML = uploadProgressMarkup(file.name, note || "Uploading…");
            var bar = grid.querySelector(".fab-progress-bar");
            var label = grid.querySelector(".fab-progress-pct");

            var fd = new FormData();
            fd.append("media", toSend);

            return window.AdminAPI.uploadProductMedia(ws.product.id, fd, function (pct, loaded, total) {
              if (!bar) return;
              if (pct === null) {
                // Length wasn't computable — show motion, not a fake number.
                bar.classList.add("is-indeterminate");
                if (label) label.textContent = "Uploading…";
                return;
              }
              bar.style.width = pct + "%";
              if (label) {
                label.textContent =
                  pct + "%" +
                  (total ? " · " + window.AdminUpload.formatBytes(loaded) + " of " + window.AdminUpload.formatBytes(total) : "") +
                  // Past 100% sent, the server is still verifying, optimizing
                  // and writing the file. Saying "Uploading 100%" for several
                  // seconds reads as a hang.
                  (pct === 100 ? " · processing…" : "");
              }
            });
          }).then(function (data) {
            toast("Uploaded");
            if (onPick) {
              // Already in this product's own directory, so no reuse-copy needed.
              onPick({ source: "gallery", url: data.url, type: data.mediaType, fileName: data.fileName });
              close();
              return;
            }
            load();
          }).catch(function (err) {
            toast(err.message, "error");
            load();
          });
        });

        load();
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Clone product
  // ---------------------------------------------------------------------------
  function cloneProduct(ws) {
    dialog({
      title: "Clone this product",
      desc: "Copies everything — content, FAQs, bonus files, gallery and every exercise demo — into a new draft. Orders, revenue and progress data are not copied.",
      body:
        '<div class="fab-field"><label>Name for the clone</label>' +
        '<input class="fab-input" id="cloneName" value="' + esc(ws.product.name + " — Version 2") + '"></div>' +
        '<div class="fab-chiprow">' +
        ["Women's Edition", "Advanced", "Beginner", "Coach Edition", "Version 2"].map(function (s) {
          return '<button type="button" class="fab-chip" data-suffix="' + esc(s) + '">' + esc(s) + "</button>";
        }).join("") +
        "</div>" +
        '<p class="fab-hint">The clone is always created as a draft, never featured, with its own slug.</p>',
      confirmLabel: "Create clone",
      onMount: function (backdrop) {
        var base = ws.product.name;
        backdrop.querySelectorAll("[data-suffix]").forEach(function (chip) {
          chip.addEventListener("click", function () {
            backdrop.querySelector("#cloneName").value = base + " — " + chip.dataset.suffix;
          });
        });
      },
      onConfirm: function (backdrop) {
        var name = backdrop.querySelector("#cloneName").value.trim();
        if (!name) { toast("Give the clone a name", "error"); return false; }
        toast("Cloning — this copies media, so give it a moment…");
        // Flush first: the clone is built from what the server has, so an
        // unsaved in-progress edit would silently not make it into the copy.
        ws.store.flush().then(function () {
          return window.AdminAPI.duplicateProduct(ws.product.id, name);
        }).then(function (data) {
          toast('Created "' + data.product.name + '"');
        }).catch(function (err) { toast(err.message, "error"); });
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Publish flow
  // ---------------------------------------------------------------------------
  function publish(ws, refresh) {
    var p = ws.product;
    var states = [
      { value: "draft", label: "Draft", hint: "Only visible here in Admin." },
      { value: "private", label: "Private", hint: "Finished, but unlisted — not in the store or search." },
      { value: "scheduled", label: "Scheduled", hint: "Goes live automatically at the time you pick." },
      { value: "published", label: "Published", hint: "Live in the store and sellable." },
      { value: "archived", label: "Archived", hint: "Withdrawn from sale, kept for the record." },
    ];
    // Presentation products are a separate concept (showcase-only, never
    // sellable) and are not part of this ladder — offering it here would let a
    // routine publish silently pull a deck's product out of its deck.
    dialog({
      title: "Publish settings",
      desc: "Where this program stands right now.",
      body:
        '<div class="fab-states">' +
        states.map(function (s) {
          return (
            '<label class="fab-state' + (p.status === s.value ? " is-active" : "") + '">' +
            '<input type="radio" name="pubstate" value="' + s.value + '"' + (p.status === s.value ? " checked" : "") + ">" +
            "<span class=\"fab-state-label\">" + esc(s.label) + "</span>" +
            "<span class=\"fab-state-hint\">" + esc(s.hint) + "</span>" +
            "</label>"
          );
        }).join("") +
        "</div>" +
        '<div class="fab-field" id="scheduleRow"' + (p.status === "scheduled" ? "" : " hidden") + ">" +
        "<label>Go live at</label>" +
        '<input type="datetime-local" class="fab-input" id="publishAt" value="' + esc(toLocalInput(p.publishAt)) + '">' +
        '<p class="fab-hint">Uses this browser\'s timezone. The server checks every minute.</p></div>',
      confirmLabel: "Save",
      onMount: function (backdrop) {
        backdrop.querySelectorAll('input[name="pubstate"]').forEach(function (radio) {
          radio.addEventListener("change", function () {
            backdrop.querySelector("#scheduleRow").hidden = radio.value !== "scheduled";
            backdrop.querySelectorAll(".fab-state").forEach(function (el) {
              el.classList.toggle("is-active", el.querySelector("input").checked);
            });
          });
        });
      },
      onConfirm: function (backdrop) {
        var status = backdrop.querySelector('input[name="pubstate"]:checked').value;
        var fd = new FormData();
        fd.append("status", status);
        if (status === "scheduled") {
          var at = backdrop.querySelector("#publishAt").value;
          if (!at) { toast("Pick a date and time", "error"); return false; }
          var when = new Date(at);
          if (when.getTime() <= Date.now()) { toast("Pick a time in the future", "error"); return false; }
          fd.append("publishAt", when.toISOString());
        } else {
          fd.append("publishAt", "");
        }
        ws.store.flush().then(function () {
          return window.AdminAPI.updateProduct(ws.product.id, fd);
        }).then(function (data) {
          ws.product = data.product;
          refresh();
          toast(status === "published" ? "Published — it's live" : "Saved as " + status);
        }).catch(function (err) { toast(err.message, "error"); });
      },
    });
  }

  // <input type="datetime-local"> wants local wall-clock with no zone, which is
  // not what toISOString gives — hence the manual assembly.
  function toLocalInput(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    function pad(n) { return String(n).padStart(2, "0"); }
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  // ---------------------------------------------------------------------------
  // Shortcuts
  // ---------------------------------------------------------------------------
  function shortcuts() {
    var rows = [
      ["Ctrl / ⌘ + C", "Copy selection"],
      ["Ctrl / ⌘ + X", "Cut selection"],
      ["Ctrl / ⌘ + V", "Paste"],
      ["Ctrl / ⌘ + D", "Duplicate selection"],
      ["Ctrl / ⌘ + Z", "Undo"],
      ["Ctrl / ⌘ + Shift + Z", "Redo"],
      ["Ctrl / ⌘ + S", "Save now"],
      ["Ctrl / ⌘ + F", "Smart replace"],
      ["Ctrl / ⌘ + A", "Select all siblings"],
      ["Delete", "Delete selection"],
      ["↑ / ↓", "Move through weeks and days"],
      ["Shift + ↑ / ↓", "Extend selection"],
      ["Shift + click", "Select a range"],
      ["Ctrl / ⌘ + click", "Add to selection"],
      ["← / →", "Collapse / expand a week"],
      ["Enter", "Open the selected week or day"],
      ["Esc", "Clear selection, then close"],
      ["?", "This list"],
    ];
    dialog({
      title: "Keyboard shortcuts",
      wide: true,
      body: '<div class="fab-shortcuts">' + rows.map(function (r) {
        return '<div class="fab-shortcut"><kbd>' + esc(r[0]) + "</kbd><span>" + esc(r[1]) + "</span></div>";
      }).join("") + "</div>",
      cancelLabel: "Close",
    });
  }

  // ---------------------------------------------------------------------------
  // Settings panels
  // ---------------------------------------------------------------------------
  // The old wizard's non-content steps, moved into the workspace as tabs. These
  // are per-product one-time forms — they were never the bottleneck — so they
  // keep the same fields and the same endpoints, and only lose the linear
  // step-by-step framing.
  function renderSettingsPanel(ws, canvasEl, refresh) {
    var panels = window.AdminProductBuilder.SETTINGS_PANELS;
    if (!ws.settingsPanel) ws.settingsPanel = "basics";

    canvasEl.innerHTML =
      '<div class="fab-settings">' +
      '<nav class="fab-settings-nav">' +
      panels.map(function (p) {
        return '<button type="button" class="fab-settings-tab' + (ws.settingsPanel === p.key ? " is-active" : "") + '" data-panel="' + p.key + '">' +
          '<i class="fa-solid ' + p.icon + '"></i> ' + esc(p.label) + "</button>";
      }).join("") +
      "</nav>" +
      '<div class="fab-settings-body" data-settings-body></div>' +
      "</div>";

    canvasEl.querySelectorAll("[data-panel]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        ws.settingsPanel = btn.dataset.panel;
        renderSettingsPanel(ws, canvasEl, refresh);
      });
    });

    var body = canvasEl.querySelector("[data-settings-body]");
    if (ws.settingsPanel === "basics") return renderBasics(ws, body, refresh);
    if (ws.settingsPanel === "pricing") return renderPricing(ws, body, refresh);
    if (ws.settingsPanel === "gallery") return renderGallery(ws, body);
    if (ws.settingsPanel === "faq") return renderFaq(ws, body, refresh);
    if (ws.settingsPanel === "seo") return renderSeo(ws, body, refresh);
  }

  // Saves on blur rather than behind a Save button, so the settings tabs match
  // the autosave behaviour of the content editor instead of being the one place
  // that can silently lose work.
  function autoSaveField(ws, el, build, refresh) {
    var initial = el.value;
    el.addEventListener("blur", function () {
      if (el.value === initial) return;
      initial = el.value;
      var fd = build(el.value);
      window.AdminAPI.updateProduct(ws.product.id, fd).then(function (data) {
        ws.product = data.product;
        if (refresh) refresh();
      }).catch(function (err) { toast(err.message, "error"); });
    });
  }

  function renderBasics(ws, host, refresh) {
    var p = ws.product;
    host.innerHTML =
      "<h5>Basics</h5>" +
      '<div class="fab-field"><label>Program title</label><input class="fab-input" id="fName" value="' + esc(p.name) + '"></div>' +
      '<div class="fab-field"><label>Slug</label><input class="fab-input" id="fSlug" value="' + esc(p.slug) + '"><p class="fab-hint">Lowercase letters, numbers and hyphens.</p></div>' +
      '<div class="fab-field"><label>Creator / athlete</label><input class="fab-input" id="fCreator" value="' + esc(p.creator) + '"></div>' +
      '<div class="fab-field"><label>Short description</label><textarea class="fab-input" rows="3" id="fDesc">' + esc(p.description) + "</textarea></div>" +
      '<div class="fab-grid2">' +
      '<div class="fab-field"><label>Duration (weeks)</label><input class="fab-input" type="number" min="1" id="fWeeks" value="' + esc(p.durationWeeks) + '"></div>' +
      '<div class="fab-field"><label>Difficulty</label><select class="fab-input" id="fDiff">' +
      ["", "beginner", "intermediate", "advanced"].map(function (d) {
        return '<option value="' + d + '"' + (p.difficulty === d ? " selected" : "") + ">" + (d ? d.charAt(0).toUpperCase() + d.slice(1) : "Not set") + "</option>";
      }).join("") + "</select></div></div>" +
      '<div class="fab-field"><label>Program overview</label><textarea class="fab-input" rows="5" id="fOverview">' + esc(p.overview) + "</textarea>" +
      '<p class="fab-hint">The long-form intro at the top of the customer\'s program page.</p></div>' +
      '<div class="fab-grid2">' +
      '<div class="fab-field"><label>Cover image</label><input type="file" id="fCover" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml">' + (p.imageUrl ? '<p class="fab-hint">Leave empty to keep the current one.</p>' : "") + "</div>" +
      '<div class="fab-field"><label>Thumbnail</label><input type="file" id="fThumb" accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml">' + (p.thumbnailUrl ? '<p class="fab-hint">Leave empty to keep the current one.</p>' : "") + "</div>" +
      "</div>";

    autoSaveField(ws, host.querySelector("#fName"), function (v) { var fd = new FormData(); fd.append("name", v); return fd; }, refresh);
    autoSaveField(ws, host.querySelector("#fSlug"), function (v) { var fd = new FormData(); fd.append("slug", v); return fd; });
    autoSaveField(ws, host.querySelector("#fCreator"), function (v) { var fd = new FormData(); fd.append("creator", v); return fd; });
    autoSaveField(ws, host.querySelector("#fDesc"), function (v) { var fd = new FormData(); fd.append("description", v); return fd; });
    autoSaveField(ws, host.querySelector("#fWeeks"), function (v) { var fd = new FormData(); fd.append("durationWeeks", v); return fd; }, refresh);
    autoSaveField(ws, host.querySelector("#fDiff"), function (v) { var fd = new FormData(); fd.append("difficulty", v); return fd; });

    // Overview lives on the content endpoint, not the product PUT.
    var ov = host.querySelector("#fOverview");
    var ovInitial = ov.value;
    ov.addEventListener("blur", function () {
      if (ov.value === ovInitial) return;
      ovInitial = ov.value;
      window.AdminAPI.updateProductContent(ws.product.id, { overview: ov.value })
        .then(function (data) { ws.product = data.product; })
        .catch(function (err) { toast(err.message, "error"); });
    });

    [["#fCover", "coverImage"], ["#fThumb", "thumbnail"]].forEach(function (pair) {
      host.querySelector(pair[0]).addEventListener("change", function (e) {
        var file = e.target.files[0];
        if (!file) return;
        window.AdminUpload.maybeCompressImage(file).then(function (toSend) {
          var fd = new FormData();
          fd.append(pair[1], toSend);
          return window.AdminAPI.updateProduct(ws.product.id, fd);
        }).then(function (data) {
          ws.product = data.product;
          toast("Image updated");
          // The upload always succeeds and always renders correctly — the
          // media container guarantees that. These notices only explain HOW an
          // unusual image will be shown (letterboxed on a blurred backdrop, or
          // kept small rather than upscaled) so the result isn't a surprise.
          (data.mediaNotices || []).forEach(function (n) {
            toast(n.message, n.level === "warning" ? "warning" : "info");
          });
        }).catch(function (err) { toast(err.message, "error"); });
      });
    });
  }

  function renderPricing(ws, host, refresh) {
    var p = ws.product;
    host.innerHTML =
      "<h5>Pricing &amp; publish</h5>" +
      '<div class="fab-grid2">' +
      '<div class="fab-field"><label>Price (USD)</label><input class="fab-input" type="number" step="0.01" min="0" id="fPrice" value="' + (p.priceCents != null ? (p.priceCents / 100).toFixed(2) : "") + '"></div>' +
      '<div class="fab-field"><label>Featured on storefront</label><select class="fab-input" id="fFeat">' +
      '<option value="false"' + (!p.featured ? " selected" : "") + ">No</option>" +
      '<option value="true"' + (p.featured ? " selected" : "") + ">Yes</option></select></div>" +
      "</div>" +
      '<div class="fab-field"><label>Current state</label>' +
      '<p class="fab-statusline"><span class="fab-status fab-status-' + esc(p.status) + '">' + esc(p.status) + "</span>" +
      (p.publishAt ? " — goes live " + esc(window.AdminUI.formatDateTime(p.publishAt)) : "") + "</p>" +
      '<button type="button" class="fab-btn fab-btn-primary" id="openPublish">Change publish state…</button></div>' +
      '<div class="fab-field"><label>Danger zone</label>' +
      '<button type="button" class="fab-btn" id="doClone"><i class="fa-solid fa-clone"></i> Clone this product</button></div>';

    autoSaveField(ws, host.querySelector("#fPrice"), function (v) {
      var fd = new FormData();
      fd.append("priceCents", Math.round((parseFloat(v) || 0) * 100));
      return fd;
    });
    autoSaveField(ws, host.querySelector("#fFeat"), function (v) { var fd = new FormData(); fd.append("featured", v); return fd; });
    host.querySelector("#openPublish").addEventListener("click", function () { publish(ws, refresh); });
    host.querySelector("#doClone").addEventListener("click", function () { cloneProduct(ws); });
  }

  function renderGallery(ws, host) {
    host.innerHTML =
      "<h5>Product gallery</h5>" +
      '<p class="fab-hint">The carousel at the top of the sales page — shown to shoppers before they buy. Drag to reorder; the first item is what they see first.</p>' +
      '<div class="fab-field"><input type="file" id="galFile" multiple accept="' + MEDIA_ACCEPT + '">' +
      '<button type="button" class="fab-btn fab-btn-sm" id="galLibrary" style="margin-top:8px;"><i class="fa-solid fa-photo-film"></i> Add from media library</button></div>' +
      '<div id="galStatus" class="fab-hint"></div><div id="galList"></div>';

    var listHost = host.querySelector("#galList");
    var statusHost = host.querySelector("#galStatus");
    var items = [];

    function setStatus(m, err) {
      statusHost.textContent = m || "";
      statusHost.style.color = err ? "var(--a-danger)" : "";
    }

    function render() {
      if (!items.length) {
        listHost.innerHTML = '<p class="fab-dialog-empty">No gallery media yet — the product page falls back to the cover image.</p>';
        return;
      }
      listHost.innerHTML = '<ul class="fab-gallery">' + items.map(function (m, i) {
        var prev = m.type === "video"
          ? '<video src="' + esc(m.url) + '" muted playsinline preload="metadata"></video>'
          : '<img src="' + esc(m.url) + '" alt="">';
        return '<li class="fab-gallery-item" draggable="true" data-index="' + i + '">' +
          '<span class="fab-card-grip"><i class="fa-solid fa-grip-vertical"></i></span>' +
          '<span class="fab-gallery-thumb">' + prev + "</span>" +
          "<span>" + (i === 0 ? "First slide" : "Slide " + (i + 1)) + "</span>" +
          '<button type="button" class="fab-btn fab-btn-sm fab-btn-danger" data-rm="' + esc(m.id) + '"><i class="fa-solid fa-trash"></i></button>' +
          "</li>";
      }).join("") + "</ul>";
      bind();
    }

    function bind() {
      listHost.querySelectorAll("[data-rm]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var id = btn.dataset.rm;
          btn.disabled = true;
          window.AdminAPI.deleteProductGallery(ws.product.id, id).then(function () {
            items = items.filter(function (m) { return m.id !== id; });
            render();
          }).catch(function (err) { btn.disabled = false; setStatus(err.message, true); });
        });
      });
      var from = null;
      listHost.querySelectorAll(".fab-gallery-item").forEach(function (row) {
        row.addEventListener("dragstart", function () { from = parseInt(row.dataset.index, 10); row.classList.add("is-dragging"); });
        row.addEventListener("dragend", function () { row.classList.remove("is-dragging"); });
        row.addEventListener("dragover", function (e) { e.preventDefault(); });
        row.addEventListener("drop", function (e) {
          e.preventDefault();
          var to = parseInt(row.dataset.index, 10);
          if (from == null || from === to) return;
          items.splice(to, 0, items.splice(from, 1)[0]);
          from = null;
          render();
          setStatus("Saving order…");
          window.AdminAPI.reorderProductGallery(ws.product.id, items.map(function (m) { return m.id; }))
            .then(function () { setStatus(""); })
            .catch(function (err) { setStatus(err.message, true); });
        });
      });
    }

    window.AdminAPI.listProductGallery(ws.product.id).then(function (data) {
      items = data.media || [];
      render();
    }).catch(function () { listHost.innerHTML = '<p class="fab-dialog-empty">Could not load the gallery.</p>'; });

    host.querySelector("#galFile").addEventListener("change", function (e) {
      var files = Array.prototype.slice.call(e.target.files || []);
      e.target.value = "";
      // One at a time, matching the old wizard: each response carries the row
      // the server actually created, and a mid-batch failure leaves the earlier
      // successes saved rather than rolling everything back.
      var total = files.length;
      (function next() {
        if (!files.length) { setStatus(""); return; }
        var file = files.shift();
        var position = total > 1 ? " (" + (total - files.length) + " of " + total + ")" : "";
        setStatus("Preparing " + file.name + "…" + position);

        window.AdminUpload.maybeCompressImage(file).then(function (toSend) {
          var fd = new FormData();
          fd.append("media", toSend);
          return window.AdminAPI.uploadProductGallery(ws.product.id, fd, function (pct) {
            setStatus(
              pct === null
                ? "Uploading " + file.name + "…" + position
                : "Uploading " + file.name + " — " + pct + "%" + (pct === 100 ? " · processing…" : "") + position
            );
          });
        }).then(function (data) {
          items.push(data.media);
          render();
          next();
        }).catch(function (err) { setStatus(err.message, true); });
      })();
    });

    host.querySelector("#galLibrary").addEventListener("click", function () {
      mediaLibrary(ws, function (picked) {
        if (!picked.url) return toast("That item can't be used as a gallery slide", "warning");
        setStatus("Adding…");
        window.AdminAPI.reuseGalleryMedia(ws.product.id, picked.url).then(function (data) {
          items.push(data.media);
          setStatus("");
          render();
        }).catch(function (err) { setStatus(err.message, true); });
      });
    });
  }

  function renderFaq(ws, host, refresh) {
    var p = ws.product;
    host.innerHTML =
      "<h5>FAQ &amp; bonus</h5>" +
      '<div id="faqList">' + (p.faqs || []).map(function (f) {
        return '<div class="fab-faq" data-faq="' + esc(f.id) + '">' +
          '<input class="fab-input faq-q" value="' + esc(f.question) + '" placeholder="Question">' +
          '<textarea class="fab-input faq-a" rows="2" placeholder="Answer">' + esc(f.answer) + "</textarea>" +
          '<div class="fab-faq-actions">' +
          '<button type="button" class="fab-btn fab-btn-sm" data-save-faq><i class="fa-solid fa-check"></i> Save</button>' +
          '<button type="button" class="fab-btn fab-btn-sm fab-btn-danger" data-del-faq><i class="fa-solid fa-trash"></i></button>' +
          "</div></div>";
      }).join("") + "</div>" +
      '<div class="fab-faq fab-faq-new">' +
      '<input class="fab-input" id="newQ" placeholder="New question">' +
      '<textarea class="fab-input" id="newA" rows="2" placeholder="Answer"></textarea>' +
      '<button type="button" class="fab-btn fab-btn-sm fab-btn-primary" id="addFaq"><i class="fa-solid fa-plus"></i> Add FAQ</button></div>' +
      '<h6 class="fab-subhead">Bonus resources</h6>' +
      '<div id="resList">' + (p.resources || []).map(function (r) {
        return '<div class="fab-resource"><strong>' + esc(r.title) + "</strong>" +
          '<span class="fab-hint">' + (r.type === "link" ? esc(r.url) : "File") + "</span>" +
          '<button type="button" class="fab-btn fab-btn-sm fab-btn-danger" data-del-res="' + esc(r.id) + '"><i class="fa-solid fa-trash"></i></button></div>';
      }).join("") + "</div>" +
      '<div class="fab-faq fab-faq-new">' +
      '<input class="fab-input" id="resTitle" placeholder="Resource title">' +
      '<div class="fab-grid2">' +
      '<select class="fab-input" id="resType"><option value="file">File</option><option value="link">Link</option></select>' +
      '<input class="fab-input" id="resDesc" placeholder="Description (optional)"></div>' +
      '<input type="file" id="resFile"><input class="fab-input" id="resUrl" placeholder="https://…" hidden>' +
      '<button type="button" class="fab-btn fab-btn-sm fab-btn-primary" id="addRes"><i class="fa-solid fa-plus"></i> Add resource</button></div>' +
      '<div class="fab-field"><label>Bonus notes</label><textarea class="fab-input" rows="3" id="bonusNotes">' + esc(p.bonusNotes) + "</textarea></div>";

    function reload() {
      return window.AdminAPI.getProduct(ws.product.id).then(function (data) {
        ws.product = data.product;
        renderFaq(ws, host, refresh);
      });
    }

    host.querySelector("#addFaq").addEventListener("click", function () {
      var q = host.querySelector("#newQ").value.trim();
      var a = host.querySelector("#newA").value.trim();
      if (!q || !a) return toast("Question and answer are both required", "error");
      window.AdminAPI.createProductFaq(ws.product.id, { question: q, answer: a }).then(reload).catch(function (e) { toast(e.message, "error"); });
    });
    host.querySelectorAll("[data-save-faq]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest("[data-faq]");
        window.AdminAPI.updateProductFaq(ws.product.id, row.dataset.faq, {
          question: row.querySelector(".faq-q").value.trim(),
          answer: row.querySelector(".faq-a").value.trim(),
        }).then(function () { toast("FAQ saved"); }).catch(function (e) { toast(e.message, "error"); });
      });
    });
    host.querySelectorAll("[data-del-faq]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var row = btn.closest("[data-faq]");
        window.AdminAPI.deleteProductFaq(ws.product.id, row.dataset.faq).then(reload).catch(function (e) { toast(e.message, "error"); });
      });
    });
    host.querySelectorAll("[data-del-res]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        window.AdminAPI.deleteProductResource(ws.product.id, btn.dataset.delRes).then(reload).catch(function (e) { toast(e.message, "error"); });
      });
    });
    host.querySelector("#resType").addEventListener("change", function (e) {
      var isLink = e.target.value === "link";
      host.querySelector("#resFile").hidden = isLink;
      host.querySelector("#resUrl").hidden = !isLink;
    });
    host.querySelector("#addRes").addEventListener("click", function () {
      var title = host.querySelector("#resTitle").value.trim();
      var type = host.querySelector("#resType").value;
      if (!title) return toast("Title is required", "error");
      var fd = new FormData();
      fd.append("title", title);
      fd.append("type", type);
      fd.append("description", host.querySelector("#resDesc").value.trim());
      if (type === "file") {
        var file = host.querySelector("#resFile").files[0];
        if (!file) return toast("Choose a file", "error");
        fd.append("resourceFile", file);
      } else {
        var url = host.querySelector("#resUrl").value.trim();
        if (!url) return toast("Enter a URL", "error");
        fd.append("url", url);
      }
      window.AdminAPI.createProductResource(ws.product.id, fd).then(reload).catch(function (e) { toast(e.message, "error"); });
    });

    var notes = host.querySelector("#bonusNotes");
    var initial = notes.value;
    notes.addEventListener("blur", function () {
      if (notes.value === initial) return;
      initial = notes.value;
      window.AdminAPI.updateProductContent(ws.product.id, { bonusNotes: notes.value })
        .then(function (data) { ws.product = data.product; })
        .catch(function (e) { toast(e.message, "error"); });
    });
  }

  function renderSeo(ws, host) {
    var tags = (ws.product.seoTags || []).slice();
    host.innerHTML =
      "<h5>SEO &amp; tags</h5>" +
      '<p class="fab-hint">Freeform keywords for search relevance and structured data — never shown as navigation or filters.</p>' +
      '<div class="fab-field"><div class="fab-tagwrap"><span id="tagChips"></span>' +
      '<input class="fab-input" id="tagInput" placeholder="Type a tag and press Enter…"></div></div>';

    function renderChips() {
      host.querySelector("#tagChips").innerHTML = tags.length
        ? tags.map(function (t, i) {
            return '<span class="fab-tag">' + esc(t) + '<button type="button" data-rm-tag="' + i + '">&times;</button></span>';
          }).join("")
        : '<span class="fab-hint">No tags yet.</span>';
      host.querySelectorAll("[data-rm-tag]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          tags.splice(parseInt(btn.dataset.rmTag, 10), 1);
          renderChips();
          persist();
        });
      });
    }
    function persist() {
      window.AdminAPI.updateProductContent(ws.product.id, { seoTags: tags })
        .then(function (data) { ws.product = data.product; })
        .catch(function (e) { toast(e.message, "error"); });
    }
    renderChips();
    host.querySelector("#tagInput").addEventListener("keydown", function (e) {
      if (e.key !== "Enter" && e.key !== ",") return;
      e.preventDefault();
      var v = e.target.value.trim().replace(/,$/, "");
      if (v && tags.indexOf(v) === -1) { tags.push(v); persist(); }
      e.target.value = "";
      renderChips();
    });
  }

  return {
    generateWeeks: generateWeeks,
    duplicateWeekInto: duplicateWeekInto,
    copyDaysInto: copyDaysInto,
    smartReplace: smartReplace,
    bulkText: bulkText,
    saveAsTemplate: saveAsTemplate,
    templateLibrary: templateLibrary,
    mediaLibrary: mediaLibrary,
    cloneProduct: cloneProduct,
    publish: publish,
    shortcuts: shortcuts,
    renderSettingsPanel: renderSettingsPanel,
  };
})();
