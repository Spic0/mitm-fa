// The Product Builder workspace — a full-screen content editor that replaces
// the old nine-step Setup Wizard modal for everything to do with program
// content.
//
// The old wizard's cost model was the problem: every exercise on every day was
// a fresh set of clicks through a modal, so a 12-week program was a few hundred
// repetitions of the same actions. Three structural decisions fix that, and
// everything else here follows from them:
//
//   1. ONE PERSISTENT WORKSPACE, NOT STEPS. Weeks and days live in a
//      permanently visible outline. Navigating between them is a click, not a
//      wizard transition, so bulk work (copy this week into five others) has
//      somewhere to happen at all.
//   2. EVERY NODE IS THE SAME KIND OF THING. core.js gives weeks, days,
//      exercises, meals and blocks one id/locate/move/clone contract, so
//      copy, paste, duplicate, drag, multi-select and delete are implemented
//      once and work everywhere rather than being re-specified per content type.
//   3. THE CANVAS IS DAY-SCOPED. Only the selected day's items are in the DOM.
//      That is what keeps 12 weeks / 84 days / 500+ exercises smooth without a
//      virtualization layer: the outline holds at most ~96 lightweight rows and
//      the canvas holds one day's worth of cards, regardless of program size.
//      (The one place a big list can still appear — the smart-replace match
//      list — is capped and windowed in dialogs.js.)
window.AdminProductBuilder = (function () {
  var Core = window.AdminBuilderCore;
  function esc(s) { return window.AdminUI.escapeHtml(s == null ? "" : String(s)); }

  var SETTINGS_PANELS = [
    { key: "basics", label: "Basics", icon: "fa-circle-info" },
    { key: "pricing", label: "Pricing & Publish", icon: "fa-tag" },
    { key: "gallery", label: "Gallery", icon: "fa-images" },
    { key: "faq", label: "FAQ & Bonus", icon: "fa-comments" },
    { key: "seo", label: "SEO & Tags", icon: "fa-hashtag" },
  ];

  function open(productId, onDone) {
    var ws = {
      productId: productId,
      product: null,
      store: null,
      taxonomies: [],
      templates: [],
      // Which day/week the canvas is showing.
      focusId: null,
      focusKind: null,
      // Multi-select. `anchorId` is the pivot for shift-click range selection.
      selection: [],
      anchorId: null,
      expanded: {},
      view: "content", // "content" | "nutrition" | "settings"
      settingsPanel: "basics",
      root: null,
      unsubscribe: null,
      closing: false,
    };

    // ---------------------------------------------------------------------
    // Shell
    // ---------------------------------------------------------------------
    var root = document.createElement("div");
    root.className = "fa-builder";
    root.innerHTML =
      '<div class="fab-topbar">' +
      '<button type="button" class="fab-icon-btn" data-act="close" title="Close builder (Esc)"><i class="fa-solid fa-arrow-left"></i></button>' +
      '<div class="fab-title"><span class="fab-title-name">Loading…</span><span class="fab-title-meta"></span></div>' +
      '<div class="fab-tabs">' +
      '<button type="button" class="fab-tab is-active" data-view="content"><i class="fa-solid fa-dumbbell"></i> Training</button>' +
      '<button type="button" class="fab-tab" data-view="nutrition"><i class="fa-solid fa-utensils"></i> Nutrition</button>' +
      '<button type="button" class="fab-tab" data-view="settings"><i class="fa-solid fa-sliders"></i> Settings</button>' +
      "</div>" +
      '<div class="fab-topbar-right">' +
      '<button type="button" class="fab-icon-btn" data-act="undo" title="Undo (Ctrl+Z)" disabled><i class="fa-solid fa-rotate-left"></i></button>' +
      '<button type="button" class="fab-icon-btn" data-act="redo" title="Redo (Ctrl+Shift+Z)" disabled><i class="fa-solid fa-rotate-right"></i></button>' +
      '<button type="button" class="fab-icon-btn" data-act="shortcuts" title="Keyboard shortcuts (?)"><i class="fa-solid fa-keyboard"></i></button>' +
      '<span class="fab-save" data-save-status></span>' +
      '<button type="button" class="fab-btn fab-btn-ghost" data-act="preview"><i class="fa-regular fa-eye"></i> Preview</button>' +
      '<button type="button" class="fab-btn fab-btn-primary" data-act="publish">Publish…</button>' +
      "</div>" +
      "</div>" +
      '<div class="fab-body">' +
      '<aside class="fab-outline" data-outline></aside>' +
      '<main class="fab-canvas" data-canvas></main>' +
      '<aside class="fab-inspector" data-inspector></aside>' +
      "</div>" +
      '<div class="fab-selectionbar" data-selectionbar hidden></div>' +
      '<div class="fab-loading" data-loading><i class="fa-solid fa-circle-notch fa-spin"></i> Opening builder…</div>';

    ws.root = root;
    document.body.appendChild(root);
    document.body.classList.add("fab-open");

    var outlineEl = root.querySelector("[data-outline]");
    var canvasEl = root.querySelector("[data-canvas]");
    var inspectorEl = root.querySelector("[data-inspector]");
    var selectionBarEl = root.querySelector("[data-selectionbar]");
    var saveEl = root.querySelector("[data-save-status]");
    var loadingEl = root.querySelector("[data-loading]");

    // ---------------------------------------------------------------------
    // Selection
    // ---------------------------------------------------------------------
    // Multi-select is kind-homogeneous: selecting a day then shift-clicking an
    // exercise would produce a selection with no coherent bulk action, so a
    // click on a different kind starts a new selection instead of extending.
    function selectionKind() {
      if (!ws.selection.length) return null;
      var f = ws.store.locate(ws.selection[0]);
      return f ? f.kind : null;
    }

    function setSelection(ids, anchorId) {
      ws.selection = ids.slice();
      ws.anchorId = anchorId != null ? anchorId : (ids.length ? ids[ids.length - 1] : null);
      renderSelectionBar();
      renderInspector();
      paintSelectionClasses();
    }

    function toggleSelection(id) {
      var i = ws.selection.indexOf(id);
      if (i === -1) ws.selection.push(id); else ws.selection.splice(i, 1);
      setSelection(ws.selection, id);
    }

    // Shift-click: select everything between the anchor and the clicked node,
    // within their shared list. Falls back to a plain select when they aren't
    // siblings, which is the only reading of "range" that means anything.
    function extendSelection(id) {
      var a = ws.anchorId && ws.store.locate(ws.anchorId);
      var b = ws.store.locate(id);
      if (!a || !b || a.list !== b.list) return setSelection([id], id);
      var from = Math.min(a.index, b.index);
      var to = Math.max(a.index, b.index);
      var ids = a.list.slice(from, to + 1).map(function (n) { return n.id; });
      setSelection(ids, ws.anchorId);
    }

    function paintSelectionClasses() {
      var set = {};
      ws.selection.forEach(function (id) { set[id] = true; });
      root.querySelectorAll("[data-node-id]").forEach(function (el) {
        el.classList.toggle("is-selected", !!set[el.dataset.nodeId]);
        el.classList.toggle("is-focused", el.dataset.nodeId === ws.focusId);
      });
    }

    // Handles the click semantics every list UI is expected to have, so the
    // outline and the canvas cards behave identically.
    function handleNodeClick(e, id) {
      if (e.shiftKey) { e.preventDefault(); extendSelection(id); return; }
      if (e.metaKey || e.ctrlKey) { e.preventDefault(); toggleSelection(id); return; }
      setSelection([id], id);
    }

    // ---------------------------------------------------------------------
    // Focus (what the canvas shows)
    // ---------------------------------------------------------------------
    function focusNode(id) {
      var f = ws.store.locate(id);
      if (!f) return;
      if (f.kind === "week") {
        ws.expanded[id] = true;
        ws.focusId = id;
        ws.focusKind = "week";
      } else if (f.kind === "day") {
        ws.expanded[f.parent.id] = true;
        ws.focusId = id;
        ws.focusKind = "day";
      } else {
        return; // leaf nodes are edited in place; they never take over the canvas
      }
      renderOutline();
      renderCanvas();
    }

    // ---------------------------------------------------------------------
    // Outline
    // ---------------------------------------------------------------------
    function renderOutline() {
      var doc = ws.store.doc;
      var stats = Core.docStats(doc);

      var html =
        '<div class="fab-outline-head">' +
        '<div class="fab-outline-title">Program</div>' +
        '<div class="fab-outline-stats">' + stats.weeks + " weeks · " + stats.days + " days · " + stats.exercises + " exercises</div>" +
        "</div>" +
        '<div class="fab-outline-actions">' +
        '<button type="button" class="fab-btn fab-btn-sm" data-act="add-week"><i class="fa-solid fa-plus"></i> Week</button>' +
        '<button type="button" class="fab-btn fab-btn-sm" data-act="generate-weeks"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate</button>' +
        '<button type="button" class="fab-btn fab-btn-sm" data-act="templates"><i class="fa-solid fa-layer-group"></i> Templates</button>' +
        "</div>" +
        '<div class="fab-tree" data-tree>';

      if (!doc.training.weeks.length) {
        html +=
          '<div class="fab-empty">' +
          '<i class="fa-solid fa-calendar-days"></i>' +
          "<p>No weeks yet.</p>" +
          '<button type="button" class="fab-btn fab-btn-primary fab-btn-sm" data-act="generate-weeks">Generate weeks</button>' +
          "</div>";
      }

      doc.training.weeks.forEach(function (week, wi) {
        var open = ws.expanded[week.id] !== false && (ws.expanded[week.id] || wi === 0);
        var counts = Core.countsFor(week, "week");
        html +=
          '<div class="fab-tree-week' + (week.hidden ? " is-hidden" : "") + '">' +
          '<div class="fab-row fab-row-week" data-node-id="' + esc(week.id) + '" data-kind="week" draggable="true" tabindex="0">' +
          '<button type="button" class="fab-row-twisty" data-toggle-week="' + esc(week.id) + '" aria-label="Expand"><i class="fa-solid fa-chevron-' + (open ? "down" : "right") + '"></i></button>' +
          '<span class="fab-row-label">' + esc(week.title || "Week " + (wi + 1)) + "</span>" +
          '<span class="fab-row-count">' + counts.days + "d</span>" +
          (week.hidden ? '<i class="fa-solid fa-eye-slash fab-row-flag" title="Hidden"></i>' : "") +
          '<button type="button" class="fab-row-menu" data-menu-for="' + esc(week.id) + '" aria-label="Actions"><i class="fa-solid fa-ellipsis"></i></button>' +
          "</div>";

        if (open) {
          html += '<div class="fab-tree-days" data-days-of="' + esc(week.id) + '">';
          week.days.forEach(function (day, di) {
            var dc = Core.countsFor(day, "day");
            html +=
              '<div class="fab-row fab-row-day' + (day.hidden ? " is-hidden" : "") + '" data-node-id="' + esc(day.id) + '" data-kind="day" draggable="true" tabindex="0">' +
              '<span class="fab-row-dot"></span>' +
              '<span class="fab-row-label">' + esc(day.title || "Day " + (di + 1)) + "</span>" +
              '<span class="fab-row-count">' + (dc.exercises + dc.meals + dc.blocks) + "</span>" +
              (day.hidden ? '<i class="fa-solid fa-eye-slash fab-row-flag" title="Hidden"></i>' : "") +
              '<button type="button" class="fab-row-menu" data-menu-for="' + esc(day.id) + '" aria-label="Actions"><i class="fa-solid fa-ellipsis"></i></button>' +
              "</div>";
          });
          html +=
            '<button type="button" class="fab-row-add" data-add-day="' + esc(week.id) + '"><i class="fa-solid fa-plus"></i> Day</button>' +
            (week.days.length ? "" : '<button type="button" class="fab-row-add" data-fill-week="' + esc(week.id) + '"><i class="fa-solid fa-calendar-week"></i> Fill Mon–Sun</button>') +
            "</div>";
        }
        html += "</div>";
      });

      html += "</div>";
      outlineEl.innerHTML = html;
      wireOutline();
      paintSelectionClasses();
    }

    function wireOutline() {
      outlineEl.querySelectorAll("[data-toggle-week]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var id = btn.dataset.toggleWeek;
          var currentlyOpen = btn.querySelector(".fa-chevron-down") != null;
          ws.expanded[id] = !currentlyOpen;
          renderOutline();
        });
      });
      outlineEl.querySelectorAll("[data-node-id]").forEach(function (row) {
        row.addEventListener("click", function (e) {
          if (e.target.closest("[data-row-menu], .fab-row-menu, .fab-row-twisty")) return;
          handleNodeClick(e, row.dataset.nodeId);
          if (!e.shiftKey && !e.metaKey && !e.ctrlKey) focusNode(row.dataset.nodeId);
        });
        row.addEventListener("contextmenu", function (e) {
          e.preventDefault();
          if (ws.selection.indexOf(row.dataset.nodeId) === -1) setSelection([row.dataset.nodeId], row.dataset.nodeId);
          openContextMenu(e.clientX, e.clientY, row.dataset.nodeId);
        });
      });
      outlineEl.querySelectorAll("[data-menu-for]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var id = btn.dataset.menuFor;
          if (ws.selection.indexOf(id) === -1) setSelection([id], id);
          var r = btn.getBoundingClientRect();
          openContextMenu(r.left, r.bottom + 4, id);
        });
      });
      outlineEl.querySelectorAll("[data-add-day]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var weekId = btn.dataset.addDay;
          var created;
          ws.store.commit("add-day", function (doc) {
            var w = Core.locate(doc, weekId);
            if (!w) return;
            created = Core.newDay({ title: "Day " + (w.node.days.length + 1) });
            w.node.days.push(created);
          });
          if (created) { setSelection([created.id], created.id); focusNode(created.id); }
        });
      });
      outlineEl.querySelectorAll("[data-fill-week]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var res = Core.ops.generateDays(ws.store, btn.dataset.fillWeek, Core.WEEKDAYS);
          toast("Added " + res.count + " days");
        });
      });
      var addWeek = outlineEl.querySelector('[data-act="add-week"]');
      if (addWeek) addWeek.addEventListener("click", function () {
        var res = Core.ops.generateWeeks(ws.store, 1, { withDays: false });
        if (res.ids[0]) focusNode(res.ids[0]);
      });
      outlineEl.querySelectorAll('[data-act="generate-weeks"]').forEach(function (b) {
        b.addEventListener("click", function () { window.AdminBuilderDialogs.generateWeeks(ws, refreshAll); });
      });
      var tpl = outlineEl.querySelector('[data-act="templates"]');
      if (tpl) tpl.addEventListener("click", function () { window.AdminBuilderDialogs.templateLibrary(ws, refreshAll); });

      enableDragDrop(outlineEl);
    }

    // ---------------------------------------------------------------------
    // Canvas
    // ---------------------------------------------------------------------
    function renderCanvas() {
      if (ws.view === "settings") {
        window.AdminBuilderDialogs.renderSettingsPanel(ws, canvasEl, refreshAll);
        return;
      }
      if (ws.view === "nutrition") { renderNutritionCanvas(); return; }

      var f = ws.focusId ? ws.store.locate(ws.focusId) : null;
      if (!f) {
        canvasEl.innerHTML =
          '<div class="fab-canvas-empty">' +
          '<i class="fa-solid fa-hand-pointer"></i>' +
          "<h4>Pick a day to start building</h4>" +
          "<p>Or generate a full program skeleton in one action — 12 weeks, seven days each, ready to fill in.</p>" +
          '<button type="button" class="fab-btn fab-btn-primary" data-act="generate-weeks"><i class="fa-solid fa-wand-magic-sparkles"></i> Generate weeks</button>' +
          "</div>";
        canvasEl.querySelector('[data-act="generate-weeks"]').addEventListener("click", function () {
          window.AdminBuilderDialogs.generateWeeks(ws, refreshAll);
        });
        return;
      }
      if (f.kind === "week") renderWeekCanvas(f);
      else renderDayCanvas(f);
    }

    // Week view is a read-scannable overview plus the week-level bulk actions —
    // it is where "duplicate this week into weeks 2-6" lives, because that is
    // the moment the admin is looking at a finished week.
    function renderWeekCanvas(f) {
      var week = f.node;
      var counts = Core.countsFor(week, "week");
      canvasEl.innerHTML =
        '<div class="fab-canvas-head">' +
        '<input class="fab-canvas-title" data-field="title" data-node="' + esc(week.id) + '" value="' + esc(week.title) + '" placeholder="Week title">' +
        '<div class="fab-canvas-sub">' + counts.days + " days · " + counts.exercises + " exercises</div>" +
        '<div class="fab-canvas-actions">' +
        '<button type="button" class="fab-btn fab-btn-sm" data-act="dup-week"><i class="fa-solid fa-copy"></i> Duplicate into weeks…</button>' +
        '<button type="button" class="fab-btn fab-btn-sm" data-act="save-week-template"><i class="fa-solid fa-bookmark"></i> Save as template</button>' +
        '<button type="button" class="fab-btn fab-btn-sm" data-act="fill-days"><i class="fa-solid fa-calendar-week"></i> Generate days</button>' +
        "</div></div>" +
        '<div class="fab-weekgrid">' +
        week.days.map(function (day, i) {
          var dc = Core.countsFor(day, "day");
          return (
            '<div class="fab-daycard' + (day.hidden ? " is-hidden" : "") + '" data-node-id="' + esc(day.id) + '" data-kind="day" draggable="true">' +
            '<div class="fab-daycard-head"><span class="fab-daycard-title">' + esc(day.title || "Day " + (i + 1)) + "</span>" +
            '<button type="button" class="fab-row-menu" data-menu-for="' + esc(day.id) + '"><i class="fa-solid fa-ellipsis"></i></button></div>' +
            '<div class="fab-daycard-meta">' + dc.exercises + " ex · " + dc.meals + " meals · " + dc.blocks + " blocks</div>" +
            '<ul class="fab-daycard-list">' +
            day.exercises.slice(0, 5).map(function (x) { return "<li>" + esc(x.name || "Untitled") + "</li>"; }).join("") +
            (day.exercises.length > 5 ? '<li class="fab-more">+' + (day.exercises.length - 5) + " more</li>" : "") +
            "</ul></div>"
          );
        }).join("") +
        '<button type="button" class="fab-daycard fab-daycard-add" data-act="add-day"><i class="fa-solid fa-plus"></i> Add day</button>' +
        "</div>";

      wireCanvasCommon();
      canvasEl.querySelector('[data-act="dup-week"]').addEventListener("click", function () {
        window.AdminBuilderDialogs.duplicateWeekInto(ws, week.id, refreshAll);
      });
      canvasEl.querySelector('[data-act="save-week-template"]').addEventListener("click", function () {
        window.AdminBuilderDialogs.saveAsTemplate(ws, week.id, "week");
      });
      canvasEl.querySelector('[data-act="fill-days"]').addEventListener("click", function () {
        var res = Core.ops.generateDays(ws.store, week.id, Core.WEEKDAYS);
        toast("Added " + res.count + " days");
      });
      canvasEl.querySelector('[data-act="add-day"]').addEventListener("click", function () {
        var created;
        ws.store.commit("add-day", function (doc) {
          var w = Core.locate(doc, week.id);
          created = Core.newDay({ title: "Day " + (w.node.days.length + 1) });
          w.node.days.push(created);
        });
        if (created) focusNode(created.id);
      });
      canvasEl.querySelectorAll(".fab-daycard[data-node-id]").forEach(function (card) {
        card.addEventListener("click", function (e) {
          if (e.target.closest(".fab-row-menu")) return;
          if (e.shiftKey || e.metaKey || e.ctrlKey) { handleNodeClick(e, card.dataset.nodeId); return; }
          focusNode(card.dataset.nodeId);
          setSelection([card.dataset.nodeId], card.dataset.nodeId);
        });
      });
      enableDragDrop(canvasEl);
    }

    // The day editor: the screen an admin actually spends their time on, so it
    // is dense on purpose. Cards are one row tall until expanded, every field
    // is inline (no modal to open), and the quick-add bar inserts a new item
    // and focuses it in a single click.
    function renderDayCanvas(f) {
      var day = f.node;
      var week = f.parent;

      canvasEl.innerHTML =
        '<div class="fab-canvas-head">' +
        '<div class="fab-breadcrumb">' + esc(week.title || "Week") + "</div>" +
        '<input class="fab-canvas-title" data-field="title" data-node="' + esc(day.id) + '" value="' + esc(day.title) + '" placeholder="Day title — e.g. Push Day">' +
        '<textarea class="fab-canvas-notes" data-field="notes" data-node="' + esc(day.id) + '" rows="2" placeholder="Coach notes for this day…">' + esc(day.notes) + "</textarea>" +
        '<div class="fab-canvas-actions">' +
        '<button type="button" class="fab-btn fab-btn-sm" data-act="dup-day"><i class="fa-solid fa-copy"></i> Duplicate day</button>' +
        '<button type="button" class="fab-btn fab-btn-sm" data-act="copy-day-into"><i class="fa-solid fa-arrow-right-arrow-left"></i> Copy into weeks…</button>' +
        '<button type="button" class="fab-btn fab-btn-sm" data-act="save-day-template"><i class="fa-solid fa-bookmark"></i> Save as template</button>' +
        '<button type="button" class="fab-btn fab-btn-sm" data-act="insert-template"><i class="fa-solid fa-layer-group"></i> Insert template</button>' +
        '<button type="button" class="fab-btn fab-btn-sm" data-act="toggle-hidden">' +
        (day.hidden ? '<i class="fa-solid fa-eye"></i> Show day' : '<i class="fa-solid fa-eye-slash"></i> Hide day') + "</button>" +
        "</div></div>" +
        '<div class="fab-sections">' +
        sectionHtml("Exercises", "exercises", day.exercises, exerciseCardHtml) +
        sectionHtml("Meals", "meals", day.meals, mealCardHtml) +
        sectionHtml("Attachments & notes", "blocks", day.blocks, blockCardHtml) +
        "</div>" +
        quickAddHtml();

      wireCanvasCommon();
      wireDayCanvas(day);
      enableDragDrop(canvasEl);
    }

    function sectionHtml(label, key, items, cardFn) {
      return (
        '<section class="fab-section" data-section="' + key + '">' +
        '<header class="fab-section-head"><h6>' + esc(label) + '</h6><span class="fab-section-count">' + items.length + "</span></header>" +
        '<div class="fab-cards" data-list="' + key + '">' +
        (items.length ? items.map(cardFn).join("") : '<div class="fab-section-empty">Nothing here yet.</div>') +
        "</div></section>"
      );
    }

    function cardShell(node, kind, icon, bodyHtml, expandedHtml) {
      return (
        '<div class="fab-card" data-node-id="' + esc(node.id) + '" data-kind="' + kind + '" draggable="true">' +
        '<div class="fab-card-main">' +
        '<span class="fab-card-grip" aria-hidden="true"><i class="fa-solid fa-grip-vertical"></i></span>' +
        '<span class="fab-card-icon"><i class="fa-solid ' + icon + '"></i></span>' +
        bodyHtml +
        '<button type="button" class="fab-card-expand" data-expand aria-label="More fields"><i class="fa-solid fa-chevron-down"></i></button>' +
        '<button type="button" class="fab-row-menu" data-menu-for="' + esc(node.id) + '" aria-label="Actions"><i class="fa-solid fa-ellipsis"></i></button>' +
        "</div>" +
        '<div class="fab-card-more" hidden>' + expandedHtml + "</div>" +
        "</div>"
      );
    }

    function fieldInput(node, field, placeholder, cls) {
      return (
        '<input class="' + (cls || "fab-input") + '" data-field="' + field + '" data-node="' + esc(node.id) + '"' +
        ' value="' + esc(node[field]) + '" placeholder="' + esc(placeholder) + '">'
      );
    }

    function fieldArea(node, field, placeholder) {
      return (
        '<label class="fab-minifield"><span>' + esc(placeholder) + "</span>" +
        '<textarea class="fab-input" rows="2" data-field="' + field + '" data-node="' + esc(node.id) + '">' + esc(node[field]) + "</textarea></label>"
      );
    }

    function exerciseCardHtml(ex) {
      var media = ex.mediaUrl
        ? '<span class="fab-media-chip" data-media-for="' + esc(ex.id) + '" title="Change demo media">' +
          (ex.mediaType === "video"
            ? '<video src="' + esc(ex.mediaUrl) + '" muted playsinline preload="metadata"></video>'
            : '<img src="' + esc(ex.mediaUrl) + '" alt="">') +
          "</span>"
        : '<button type="button" class="fab-media-add" data-media-for="' + esc(ex.id) + '" title="Add demo GIF or video"><i class="fa-solid fa-photo-film"></i></button>';
      return cardShell(
        ex, "exercise", "fa-dumbbell",
        fieldInput(ex, "name", "Exercise name", "fab-input fab-input-grow") +
        fieldInput(ex, "reps", "3x10", "fab-input fab-input-reps") +
        media,
        fieldArea(ex, "notes", "Coach notes") + fieldArea(ex, "substitutions", "Substitutions")
      );
    }

    function mealCardHtml(m) {
      return cardShell(
        m, "daymeal", "fa-utensils",
        fieldInput(m, "name", "Meal name", "fab-input fab-input-grow") +
        fieldInput(m, "macros", "40P / 50C / 15F", "fab-input fab-input-macros"),
        fieldArea(m, "ingredients", "Ingredients") + fieldArea(m, "notes", "Notes")
      );
    }

    function blockCardHtml(b) {
      var spec = Core.BLOCK_TYPES[b.type] || Core.BLOCK_TYPES.note;
      var extra = b.type === "note"
        ? fieldArea(b, "body", "Note body")
        : '<label class="fab-minifield"><span>URL / file</span>' +
          '<div class="fab-inline-row">' +
          '<input class="fab-input" data-field="url" data-node="' + esc(b.id) + '" value="' + esc(b.url) + '" placeholder="https://… or pick from library">' +
          '<button type="button" class="fab-btn fab-btn-sm" data-media-for="' + esc(b.id) + '"><i class="fa-solid fa-photo-film"></i> Library</button>' +
          "</div></label>" + fieldArea(b, "body", "Caption");
      return cardShell(
        b, "block", spec.icon,
        fieldInput(b, "title", spec.label + " title", "fab-input fab-input-grow") +
        '<span class="fab-card-tag">' + esc(spec.label) + "</span>",
        extra
      );
    }

    function quickAddHtml() {
      // Quick Add is a bar of one-click inserts, not a menu of modals: each
      // button appends an empty item and focuses its first field, so adding
      // eight exercises is eight clicks and eight names typed, with no dialog
      // in between.
      var buttons = [
        ["exercise", "fa-dumbbell", "Exercise"],
        ["daymeal", "fa-utensils", "Meal"],
        ["block:video", "fa-video", "Video"],
        ["block:image", "fa-image", "Image"],
        ["block:pdf", "fa-file-pdf", "PDF"],
        ["block:note", "fa-note-sticky", "Note"],
        ["block:gallery", "fa-images", "Gallery"],
      ];
      return (
        '<div class="fab-quickadd">' +
        '<span class="fab-quickadd-label">Quick add</span>' +
        buttons.map(function (b) {
          return '<button type="button" class="fab-quickadd-btn" data-quickadd="' + b[0] + '"><i class="fa-solid ' + b[1] + '"></i>' + b[2] + "</button>";
        }).join("") +
        "</div>"
      );
    }

    function wireDayCanvas(day) {
      canvasEl.querySelector('[data-act="dup-day"]').addEventListener("click", function () {
        var res = Core.ops.duplicate(ws.store, [day.id]);
        if (res.ids[0]) { focusNode(res.ids[0]); toast("Day duplicated"); }
      });
      canvasEl.querySelector('[data-act="copy-day-into"]').addEventListener("click", function () {
        window.AdminBuilderDialogs.copyDaysInto(ws, ws.selection.length > 1 ? ws.selection : [day.id], refreshAll);
      });
      canvasEl.querySelector('[data-act="save-day-template"]').addEventListener("click", function () {
        window.AdminBuilderDialogs.saveAsTemplate(ws, day.id, "day");
      });
      canvasEl.querySelector('[data-act="insert-template"]').addEventListener("click", function () {
        window.AdminBuilderDialogs.templateLibrary(ws, refreshAll, { insertInto: day.id });
      });
      canvasEl.querySelector('[data-act="toggle-hidden"]').addEventListener("click", function () {
        Core.ops.bulkSet(ws.store, [day.id], "hidden", !day.hidden);
        renderCanvas();
      });

      canvasEl.querySelectorAll("[data-quickadd]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var spec = btn.dataset.quickadd.split(":");
          var kind = spec[0];
          var created;
          ws.store.commit("quick-add", function (doc) {
            var d = Core.locate(doc, day.id);
            if (!d) return;
            if (kind === "exercise") { created = Core.newExercise(); d.node.exercises.push(created); }
            else if (kind === "daymeal") { created = Core.newMeal(); d.node.meals.push(created); }
            else { created = Core.newBlock(spec[1]); d.node.blocks.push(created); }
          });
          renderCanvas();
          if (created) {
            var el = canvasEl.querySelector('[data-node-id="' + created.id + '"] .fab-input');
            if (el) el.focus();
          }
        });
      });

      canvasEl.querySelectorAll("[data-expand]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var card = btn.closest(".fab-card");
          var more = card.querySelector(".fab-card-more");
          more.hidden = !more.hidden;
          card.classList.toggle("is-expanded", !more.hidden);
        });
      });

      canvasEl.querySelectorAll("[data-media-for]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          window.AdminBuilderDialogs.mediaLibrary(ws, function (picked) {
            applyMediaTo(btn.dataset.mediaFor, picked);
          });
        });
      });
    }

    // Applies a library pick to one node. Program media picked from another
    // product is copied server-side first — see the reuse endpoint's comment;
    // sharing the URL would 403 for customers of this product.
    function applyMediaTo(nodeId, picked) {
      function write(url, mediaType) {
        ws.store.commit("set-media", function (doc) {
          var f = Core.locate(doc, nodeId);
          if (!f) return;
          f.node.mediaUrl = url;
          f.node.mediaType = mediaType;
          if (f.kind === "block") f.node.url = url;
        });
        renderCanvas();
      }
      if (picked.source === "program") {
        window.AdminAPI.reuseProductMedia(ws.product.id, {
          sourceProductId: picked.productId,
          fileName: picked.fileName,
        }).then(function (data) {
          write(data.url, data.mediaType);
          toast(data.copied ? "Media copied into this program" : "Media attached");
        }).catch(function (err) { toast(err.message, "error"); });
        return;
      }
      // A gallery file from ANOTHER product is public, so its URL would load
      // fine — right up until that product's slide is deleted, which unlinks
      // the file and silently breaks this exercise. Copy it in instead, without
      // adding a slide to this product's carousel.
      if (picked.source === "gallery" && picked.productId && picked.productId !== ws.product.id) {
        window.AdminAPI.reuseGalleryMedia(ws.product.id, picked.url, { asSlide: false }).then(function (data) {
          write(data.url, data.mediaType);
          toast("Media copied into this program");
        }).catch(function (err) { toast(err.message, "error"); });
        return;
      }

      write(picked.url, picked.type === "video" ? "video" : "image");
      toast("Media attached");
    }

    // Nutrition keeps the legacy product-wide meal list (which is what the
    // customer page's Nutrition tab reads) alongside the per-day meals edited
    // in the day canvas — both exist, and this panel owns the former.
    function renderNutritionCanvas() {
      var nc = ws.store.doc.nutrition;
      canvasEl.innerHTML =
        '<div class="fab-canvas-head">' +
        "<h4>Nutrition</h4>" +
        '<p class="fab-canvas-sub">These meals show on the program\'s Nutrition tab. Day-specific meals live on each day in the Training tab.</p>' +
        '<textarea class="fab-canvas-notes" data-field="notes" data-node="__nutrition" rows="3" placeholder="Calorie/macro guidance, restrictions, general notes">' + esc(nc.notes) + "</textarea>" +
        "</div>" +
        '<div class="fab-sections"><section class="fab-section">' +
        '<header class="fab-section-head"><h6>Meals</h6><span class="fab-section-count">' + nc.meals.length + "</span></header>" +
        '<div class="fab-cards" data-list="meals">' +
        (nc.meals.length ? nc.meals.map(mealCardHtml).join("") : '<div class="fab-section-empty">No meals yet.</div>') +
        "</div></section></div>" +
        '<div class="fab-quickadd"><span class="fab-quickadd-label">Quick add</span>' +
        '<button type="button" class="fab-quickadd-btn" data-add-global-meal><i class="fa-solid fa-utensils"></i>Meal</button></div>';

      wireCanvasCommon();
      canvasEl.querySelector("[data-add-global-meal]").addEventListener("click", function () {
        var created;
        ws.store.commit("add-meal", function (doc) {
          created = Core.newMeal();
          doc.nutrition.meals.push(created);
        });
        renderCanvas();
        var el = canvasEl.querySelector('[data-node-id="' + created.id + '"] .fab-input');
        if (el) el.focus();
      });
      canvasEl.querySelectorAll("[data-expand]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var card = btn.closest(".fab-card");
          var more = card.querySelector(".fab-card-more");
          more.hidden = !more.hidden;
        });
      });
      enableDragDrop(canvasEl);
    }

    // Field editing, card selection and row menus behave the same on every
    // canvas, so they're bound in one place rather than per view.
    function wireCanvasCommon() {
      canvasEl.querySelectorAll("[data-field][data-node]").forEach(function (el) {
        el.addEventListener("input", function () {
          var nodeId = el.dataset.node;
          var field = el.dataset.field;
          var value = el.value;
          // Coalesced by node+field so a typed sentence collapses into one undo
          // step, and reason "field" so the subscriber refreshes only the
          // outline label — re-rendering the canvas here would eat the caret.
          ws.store.commit("field", function (doc) {
            if (nodeId === "__nutrition") { doc.nutrition[field] = value; return; }
            var f = Core.locate(doc, nodeId);
            if (f) f.node[field] = value;
          }, "field:" + nodeId + ":" + field);
        });
      });
      canvasEl.querySelectorAll(".fab-card[data-node-id]").forEach(function (card) {
        card.addEventListener("click", function (e) {
          if (e.target.closest("input, textarea, button, .fab-media-chip")) return;
          handleNodeClick(e, card.dataset.nodeId);
        });
        card.addEventListener("contextmenu", function (e) {
          e.preventDefault();
          if (ws.selection.indexOf(card.dataset.nodeId) === -1) setSelection([card.dataset.nodeId], card.dataset.nodeId);
          openContextMenu(e.clientX, e.clientY, card.dataset.nodeId);
        });
      });
      canvasEl.querySelectorAll("[data-menu-for]").forEach(function (btn) {
        btn.addEventListener("click", function (e) {
          e.stopPropagation();
          var id = btn.dataset.menuFor;
          if (ws.selection.indexOf(id) === -1) setSelection([id], id);
          var r = btn.getBoundingClientRect();
          openContextMenu(r.left, r.bottom + 4, id);
        });
      });
      paintSelectionClasses();
    }

    // ---------------------------------------------------------------------
    // Inspector
    // ---------------------------------------------------------------------
    function renderInspector() {
      var n = ws.selection.length;
      if (!n) {
        var stats = Core.docStats(ws.store.doc);
        inspectorEl.innerHTML =
          '<div class="fab-inspector-head">Program</div>' +
          '<div class="fab-stat-grid">' +
          statTile("Weeks", stats.weeks) + statTile("Days", stats.days) +
          statTile("Exercises", stats.exercises) + statTile("Meals", stats.meals + stats.blocks) +
          "</div>" +
          '<div class="fab-inspector-section"><h6>Program-wide</h6>' +
          '<button type="button" class="fab-btn fab-btn-block" data-act="smart-replace"><i class="fa-solid fa-right-left"></i> Smart replace…</button>' +
          '<button type="button" class="fab-btn fab-btn-block" data-act="clone-product"><i class="fa-solid fa-clone"></i> Clone this product…</button>' +
          '<button type="button" class="fab-btn fab-btn-block" data-act="media-library"><i class="fa-solid fa-photo-film"></i> Media library</button>' +
          "</div>" +
          '<div class="fab-inspector-section"><h6>Training notes</h6>' +
          '<textarea class="fab-input" rows="5" data-field="notes" data-node="__training" placeholder="General training guidance shown above the weekly breakdown">' + esc(ws.store.doc.training.notes) + "</textarea>" +
          "</div>";
        wireInspector();
        return;
      }

      var kind = selectionKind();
      var label = Core.KINDS[kind] ? Core.KINDS[kind].label : "Item";
      inspectorEl.innerHTML =
        '<div class="fab-inspector-head">' + n + " " + esc(label) + (n === 1 ? "" : "s") + " selected</div>" +
        '<div class="fab-inspector-section"><h6>Actions</h6>' +
        '<button type="button" class="fab-btn fab-btn-block" data-op="duplicate"><i class="fa-solid fa-copy"></i> Duplicate <kbd>Ctrl D</kbd></button>' +
        '<button type="button" class="fab-btn fab-btn-block" data-op="copy"><i class="fa-solid fa-clipboard"></i> Copy <kbd>Ctrl C</kbd></button>' +
        '<button type="button" class="fab-btn fab-btn-block" data-op="cut"><i class="fa-solid fa-scissors"></i> Cut <kbd>Ctrl X</kbd></button>' +
        '<button type="button" class="fab-btn fab-btn-block" data-op="paste"><i class="fa-solid fa-paste"></i> Paste <kbd>Ctrl V</kbd></button>' +
        (kind === "week" || kind === "day"
          ? '<button type="button" class="fab-btn fab-btn-block" data-op="toggle-hidden"><i class="fa-solid fa-eye-slash"></i> Hide / show</button>'
          : "") +
        '<button type="button" class="fab-btn fab-btn-block fab-btn-danger" data-op="delete"><i class="fa-solid fa-trash"></i> Delete <kbd>Del</kbd></button>' +
        "</div>" +
        (kind === "day"
          ? '<div class="fab-inspector-section"><h6>Bulk edit</h6>' +
            '<button type="button" class="fab-btn fab-btn-block" data-op="bulk-notes"><i class="fa-solid fa-pen"></i> Replace coach notes…</button>' +
            '<button type="button" class="fab-btn fab-btn-block" data-op="copy-into"><i class="fa-solid fa-arrow-right-arrow-left"></i> Copy into weeks…</button>' +
            '<button type="button" class="fab-btn fab-btn-block" data-op="save-template"><i class="fa-solid fa-bookmark"></i> Save as template…</button>' +
            "</div>"
          : "") +
        (kind === "week"
          ? '<div class="fab-inspector-section"><h6>Bulk edit</h6>' +
            '<button type="button" class="fab-btn fab-btn-block" data-op="apply-week"><i class="fa-solid fa-copy"></i> Duplicate into weeks…</button>' +
            '<button type="button" class="fab-btn fab-btn-block" data-op="save-template"><i class="fa-solid fa-bookmark"></i> Save as template…</button>' +
            "</div>"
          : "") +
        (kind === "exercise" || kind === "block"
          ? '<div class="fab-inspector-section"><h6>Bulk edit</h6>' +
            '<button type="button" class="fab-btn fab-btn-block" data-op="bulk-media"><i class="fa-solid fa-photo-film"></i> Replace media on all…</button>' +
            '<button type="button" class="fab-btn fab-btn-block" data-op="bulk-notes"><i class="fa-solid fa-pen"></i> Replace notes on all…</button>' +
            "</div>"
          : "") +
        '<div class="fab-inspector-section"><h6>Selection</h6><ul class="fab-sel-list">' +
        ws.selection.slice(0, 12).map(function (id) {
          var f = ws.store.locate(id);
          return f ? "<li>" + esc(Core.nodeLabel(f.node, f.kind)) + "</li>" : "";
        }).join("") +
        (ws.selection.length > 12 ? '<li class="fab-more">+' + (ws.selection.length - 12) + " more</li>" : "") +
        "</ul></div>";
      wireInspector();
    }

    function statTile(label, value) {
      return '<div class="fab-stat"><span class="fab-stat-value">' + value + '</span><span class="fab-stat-label">' + esc(label) + "</span></div>";
    }

    function wireInspector() {
      inspectorEl.querySelectorAll("[data-op]").forEach(function (btn) {
        btn.addEventListener("click", function () { runOp(btn.dataset.op); });
      });
      var sr = inspectorEl.querySelector('[data-act="smart-replace"]');
      if (sr) sr.addEventListener("click", function () { window.AdminBuilderDialogs.smartReplace(ws, refreshAll); });
      var cp = inspectorEl.querySelector('[data-act="clone-product"]');
      if (cp) cp.addEventListener("click", function () { window.AdminBuilderDialogs.cloneProduct(ws); });
      var ml = inspectorEl.querySelector('[data-act="media-library"]');
      if (ml) ml.addEventListener("click", function () { window.AdminBuilderDialogs.mediaLibrary(ws, null); });
      var notes = inspectorEl.querySelector('[data-node="__training"]');
      if (notes) notes.addEventListener("input", function () {
        var v = notes.value;
        ws.store.commit("field", function (doc) { doc.training.notes = v; }, "field:__training:notes");
      });
    }

    // ---------------------------------------------------------------------
    // Selection bar + operations
    // ---------------------------------------------------------------------
    function renderSelectionBar() {
      if (ws.selection.length < 2) { selectionBarEl.hidden = true; return; }
      var kind = selectionKind();
      var label = Core.KINDS[kind] ? Core.KINDS[kind].label.toLowerCase() + "s" : "items";
      selectionBarEl.hidden = false;
      selectionBarEl.innerHTML =
        '<span class="fab-selcount">' + ws.selection.length + " " + esc(label) + " selected</span>" +
        '<button type="button" class="fab-btn fab-btn-sm" data-op="duplicate"><i class="fa-solid fa-copy"></i> Duplicate</button>' +
        '<button type="button" class="fab-btn fab-btn-sm" data-op="copy"><i class="fa-solid fa-clipboard"></i> Copy</button>' +
        (kind === "day" ? '<button type="button" class="fab-btn fab-btn-sm" data-op="copy-into"><i class="fa-solid fa-arrow-right-arrow-left"></i> Copy into weeks…</button>' : "") +
        (kind === "week" || kind === "day" ? '<button type="button" class="fab-btn fab-btn-sm" data-op="toggle-hidden"><i class="fa-solid fa-eye-slash"></i> Hide / show</button>' : "") +
        (kind === "exercise" || kind === "block" ? '<button type="button" class="fab-btn fab-btn-sm" data-op="bulk-media"><i class="fa-solid fa-photo-film"></i> Replace media</button>' : "") +
        '<button type="button" class="fab-btn fab-btn-sm fab-btn-danger" data-op="delete"><i class="fa-solid fa-trash"></i> Delete</button>' +
        '<button type="button" class="fab-btn fab-btn-sm" data-op="clear">Clear</button>';
      selectionBarEl.querySelectorAll("[data-op]").forEach(function (btn) {
        btn.addEventListener("click", function () { runOp(btn.dataset.op); });
      });
    }

    // Single dispatch point for every operation, so the context menu, the
    // inspector, the selection bar and the keyboard all go through identical
    // code paths and can never drift apart in behaviour.
    function runOp(op, arg) {
      var sel = ws.selection.slice();
      if (op === "clear") return setSelection([]);

      if (op === "copy") {
        var c = Core.ops.copy(ws.store, sel);
        return toast(c ? "Copied " + c.count + " " + c.kind + (c.count === 1 ? "" : "s") : "Nothing to copy");
      }
      if (op === "cut") {
        var x = Core.ops.cut(ws.store, sel);
        setSelection([]);
        refreshAll();
        return toast(x ? "Cut " + x.count + " item" + (x.count === 1 ? "" : "s") : "Nothing to cut");
      }
      if (op === "paste") {
        var p = Core.ops.paste(ws.store, ws.anchorId || ws.focusId);
        refreshAll();
        if (!p) return toast("Clipboard is empty, or there's nowhere to paste that here", "warning");
        setSelection(p.ids, p.ids[p.ids.length - 1]);
        return toast("Pasted " + p.count + " " + p.kind + (p.count === 1 ? "" : "s"));
      }
      if (op === "duplicate") {
        if (!sel.length) return;
        var d = Core.ops.duplicate(ws.store, sel);
        refreshAll();
        setSelection(d.ids, d.ids[d.ids.length - 1]);
        return toast("Duplicated " + d.count + " item" + (d.count === 1 ? "" : "s"));
      }
      if (op === "delete") {
        if (!sel.length) return;
        var kindLabel = (Core.KINDS[selectionKind()] || {}).label || "item";
        // Weeks and days can hold a lot of work, so those confirm; leaf items
        // delete straight away since Ctrl+Z is right there.
        var heavy = selectionKind() === "week" || selectionKind() === "day";
        var doDelete = function () {
          var r = Core.ops.remove(ws.store, sel);
          setSelection([]);
          if (sel.indexOf(ws.focusId) !== -1) { ws.focusId = null; ws.focusKind = null; }
          refreshAll();
          toast("Deleted " + r.count + " item" + (r.count === 1 ? "" : "s") + " — Ctrl+Z to undo");
        };
        if (!heavy) return doDelete();
        return window.AdminUI.confirmDialog({
          title: "Delete " + sel.length + " " + kindLabel.toLowerCase() + (sel.length === 1 ? "" : "s") + "?",
          message: "Everything inside will go too. You can undo this with Ctrl+Z until you close the builder.",
          confirmLabel: "Delete",
          danger: true,
        }).then(function (ok) { if (ok) doDelete(); });
      }
      if (op === "toggle-hidden") {
        if (!sel.length) return;
        var first = ws.store.locate(sel[0]);
        var next = !(first && first.node.hidden);
        Core.ops.bulkSet(ws.store, sel, "hidden", next);
        refreshAll();
        return toast(next ? "Hidden" : "Visible again");
      }
      if (op === "copy-into") return window.AdminBuilderDialogs.copyDaysInto(ws, sel, refreshAll);
      if (op === "apply-week") return window.AdminBuilderDialogs.duplicateWeekInto(ws, sel[0], refreshAll);
      if (op === "save-template") {
        var f = ws.store.locate(sel[0]);
        if (f) return window.AdminBuilderDialogs.saveAsTemplate(ws, sel[0], f.kind);
        return;
      }
      if (op === "bulk-media") {
        return window.AdminBuilderDialogs.mediaLibrary(ws, function (picked) {
          bulkApplyMedia(sel, picked);
        });
      }
      if (op === "bulk-notes") {
        return window.AdminBuilderDialogs.bulkText(ws, sel, "notes", "Replace coach notes", function () {
          refreshAll();
        });
      }
      if (op === "focus") return focusNode(arg);
    }

    function bulkApplyMedia(ids, picked) {
      function write(url, mediaType) {
        var r = Core.ops.bulkSetMedia(ws.store, ids, url, mediaType);
        refreshAll();
        toast("Media set on " + r.count + " item" + (r.count === 1 ? "" : "s"));
      }
      if (picked.source === "program") {
        window.AdminAPI.reuseProductMedia(ws.product.id, {
          sourceProductId: picked.productId,
          fileName: picked.fileName,
        }).then(function (data) { write(data.url, data.mediaType); })
          .catch(function (err) { toast(err.message, "error"); });
        return;
      }
      write(picked.url, picked.type === "video" ? "video" : "image");
    }

    // ---------------------------------------------------------------------
    // Context menu
    // ---------------------------------------------------------------------
    var menuEl = null;
    function closeContextMenu() {
      if (menuEl) { menuEl.remove(); menuEl = null; }
    }

    function openContextMenu(x, y, nodeId) {
      closeContextMenu();
      var f = ws.store.locate(nodeId);
      if (!f) return;
      var kind = f.kind;
      var multi = ws.selection.length > 1;

      var items = [
        { op: "copy", icon: "fa-clipboard", label: "Copy", kbd: "Ctrl C" },
        { op: "cut", icon: "fa-scissors", label: "Cut", kbd: "Ctrl X" },
        { op: "paste", icon: "fa-paste", label: "Paste", kbd: "Ctrl V" },
        { op: "duplicate", icon: "fa-copy", label: "Duplicate", kbd: "Ctrl D" },
      ];
      if (kind === "week") {
        items.push({ sep: true });
        items.push({ op: "apply-week", icon: "fa-copy", label: "Duplicate into weeks…" });
        items.push({ op: "save-template", icon: "fa-bookmark", label: "Save week as template…" });
      }
      if (kind === "day") {
        items.push({ sep: true });
        items.push({ op: "copy-into", icon: "fa-arrow-right-arrow-left", label: multi ? "Copy days into weeks…" : "Copy day into weeks…" });
        items.push({ op: "save-template", icon: "fa-bookmark", label: "Save day as template…" });
      }
      if (kind === "exercise" || kind === "block") {
        items.push({ sep: true });
        items.push({ op: "bulk-media", icon: "fa-photo-film", label: multi ? "Replace media on all…" : "Set media…" });
      }
      if (kind === "week" || kind === "day") {
        items.push({ op: "toggle-hidden", icon: "fa-eye-slash", label: f.node.hidden ? "Show" : "Hide" });
      }
      items.push({ sep: true });
      items.push({ op: "delete", icon: "fa-trash", label: "Delete", kbd: "Del", danger: true });

      menuEl = document.createElement("div");
      menuEl.className = "fab-menu";
      menuEl.innerHTML = items.map(function (it) {
        if (it.sep) return '<div class="fab-menu-sep"></div>';
        return (
          '<button type="button" class="fab-menu-item' + (it.danger ? " is-danger" : "") + '" data-op="' + it.op + '">' +
          '<i class="fa-solid ' + it.icon + '"></i><span>' + esc(it.label) + "</span>" +
          (it.kbd ? "<kbd>" + esc(it.kbd) + "</kbd>" : "") +
          "</button>"
        );
      }).join("");
      document.body.appendChild(menuEl);

      // Keep the menu on screen when opened near the right/bottom edge.
      var rect = menuEl.getBoundingClientRect();
      menuEl.style.left = Math.min(x, window.innerWidth - rect.width - 8) + "px";
      menuEl.style.top = Math.min(y, window.innerHeight - rect.height - 8) + "px";

      menuEl.querySelectorAll("[data-op]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var op = btn.dataset.op;
          closeContextMenu();
          runOp(op);
        });
      });
    }
    document.addEventListener("click", function (e) {
      if (menuEl && !menuEl.contains(e.target)) closeContextMenu();
    });

    // ---------------------------------------------------------------------
    // Drag and drop
    // ---------------------------------------------------------------------
    // HTML5 DnD, matching the pattern already used by the wizard's gallery
    // reorder. Drop targets are computed from the row under the pointer: the
    // upper half of a row means "before it", the lower half "after it", and a
    // week row accepts days as "append to this week" — which is what makes
    // dragging a day from week 1 into week 4 work with no extra affordance.
    var dragState = null;

    function enableDragDrop(scope) {
      scope.querySelectorAll('[draggable="true"][data-node-id]').forEach(function (el) {
        el.addEventListener("dragstart", function (e) {
          var id = el.dataset.nodeId;
          // Dragging a member of the current selection drags the whole
          // selection; dragging anything else starts a fresh single drag.
          var ids = ws.selection.indexOf(id) !== -1 ? ws.selection.slice() : [id];
          dragState = { ids: ids, kind: el.dataset.kind };
          el.classList.add("is-dragging");
          try { e.dataTransfer.setData("text/plain", id); } catch (err) { /* Safari */ }
          e.dataTransfer.effectAllowed = "move";
        });
        el.addEventListener("dragend", function () {
          el.classList.remove("is-dragging");
          clearDropMarkers();
          dragState = null;
        });
        el.addEventListener("dragover", function (e) {
          if (!dragState) return;
          var target = dropTargetFor(el, e);
          if (!target) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          clearDropMarkers();
          el.classList.add(target.append ? "is-drop-into" : (target.before ? "is-drop-before" : "is-drop-after"));
          dragState.target = target;
        });
        el.addEventListener("dragleave", function () { el.classList.remove("is-drop-before", "is-drop-after", "is-drop-into"); });
        el.addEventListener("drop", function (e) {
          if (!dragState || !dragState.target) return;
          e.preventDefault();
          e.stopPropagation();
          var t = dragState.target;
          var res = Core.ops.move(ws.store, dragState.ids, t.parentId, t.index);
          clearDropMarkers();
          dragState = null;
          if (res.count) { refreshAll(); toast("Moved " + res.count + " item" + (res.count === 1 ? "" : "s")); }
        });

        function dropTargetFor(rowEl, evt) {
          var draggedKind = dragState.kind;
          var overId = rowEl.dataset.nodeId;
          var overKind = rowEl.dataset.kind;
          if (dragState.ids.indexOf(overId) !== -1) return null;

          var over = ws.store.locate(overId);
          if (!over) return null;

          // Same kind — reorder relative to the hovered row.
          if (overKind === draggedKind) {
            var rect = rowEl.getBoundingClientRect();
            var before = (evt.clientY - rect.top) < rect.height / 2;
            var parentId = over.parent ? over.parent.id : null;
            return { parentId: parentId, index: before ? over.index : over.index + 1, before: before };
          }
          // A day dropped on a week appends to that week.
          if (draggedKind === "day" && overKind === "week") {
            return { parentId: overId, index: over.node.days.length, append: true };
          }
          // A leaf dropped on a day appends to that day's matching list.
          if ((draggedKind === "exercise" || draggedKind === "daymeal" || draggedKind === "block") && overKind === "day") {
            var key = draggedKind === "exercise" ? "exercises" : draggedKind === "daymeal" ? "meals" : "blocks";
            return { parentId: overId, index: over.node[key].length, append: true };
          }
          return null;
        }
      });
    }

    function clearDropMarkers() {
      root.querySelectorAll(".is-drop-before, .is-drop-after, .is-drop-into").forEach(function (el) {
        el.classList.remove("is-drop-before", "is-drop-after", "is-drop-into");
      });
    }

    // ---------------------------------------------------------------------
    // Keyboard
    // ---------------------------------------------------------------------
    // Bound on the workspace root, and every handler bails out when focus is
    // in a text field — otherwise Ctrl+C in the middle of typing an exercise
    // name would copy the whole card instead of the selected text.
    function isTyping(e) {
      var t = e.target;
      return t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
    }

    function onKeydown(e) {
      var mod = e.metaKey || e.ctrlKey;

      // These shortcuts are bound in the capture phase (so they beat the
      // browser's own Ctrl+D/Ctrl+S), which means they also run before the
      // modal layer's Escape handler. While a dialog is open the workspace
      // must keep its hands off the keyboard entirely: otherwise Escape to
      // dismiss "Smart replace" would fall through to requestClose and shut
      // the whole builder, and Ctrl+D would duplicate nodes behind the dialog.
      if (document.querySelector(".a-modal-backdrop")) return;

      if (e.key === "Escape") {
        if (menuEl) { closeContextMenu(); return; }
        if (ws.selection.length) { setSelection([]); return; }
        requestClose();
        return;
      }

      if (mod && (e.key === "z" || e.key === "Z")) {
        // Undo/redo work even while typing — that's the one exception, since
        // it's what you reach for immediately after a mistyped bulk edit.
        e.preventDefault();
        var ok = e.shiftKey ? ws.store.redo() : ws.store.undo();
        if (ok) { refreshAll(); toast(e.shiftKey ? "Redo" : "Undo"); }
        else toast(e.shiftKey ? "Nothing to redo" : "Nothing to undo", "warning");
        return;
      }
      if (mod && (e.key === "y" || e.key === "Y")) {
        e.preventDefault();
        if (ws.store.redo()) { refreshAll(); toast("Redo"); }
        return;
      }
      if (mod && (e.key === "s" || e.key === "S")) {
        e.preventDefault();
        ws.store.save().then(function () { toast("Saved"); }).catch(function (err) { toast(err.message, "error"); });
        return;
      }
      if (mod && (e.key === "f" || e.key === "F")) {
        e.preventDefault();
        window.AdminBuilderDialogs.smartReplace(ws, refreshAll);
        return;
      }

      if (isTyping(e)) return;

      if (mod && (e.key === "c" || e.key === "C")) { e.preventDefault(); return runOp("copy"); }
      if (mod && (e.key === "x" || e.key === "X")) { e.preventDefault(); return runOp("cut"); }
      if (mod && (e.key === "v" || e.key === "V")) { e.preventDefault(); return runOp("paste"); }
      if (mod && (e.key === "d" || e.key === "D")) { e.preventDefault(); return runOp("duplicate"); }
      if (mod && (e.key === "a" || e.key === "A")) { e.preventDefault(); return selectAllSiblings(); }
      if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); return runOp("delete"); }
      if (e.key === "?") { e.preventDefault(); return window.AdminBuilderDialogs.shortcuts(); }

      if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); return moveSelection(e.key === "ArrowDown" ? 1 : -1, e.shiftKey); }
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        var f = ws.selection.length && ws.store.locate(ws.selection[0]);
        if (f && f.kind === "week") {
          e.preventDefault();
          ws.expanded[f.node.id] = e.key === "ArrowRight";
          renderOutline();
        }
        return;
      }
      if (e.key === "Enter" && ws.selection.length === 1) { e.preventDefault(); focusNode(ws.selection[0]); }
    }

    // Arrow navigation walks the outline in visual order — weeks, and the days
    // of expanded weeks — so it matches what the admin can actually see.
    function visibleRowIds() {
      var ids = [];
      ws.store.doc.training.weeks.forEach(function (week, wi) {
        ids.push(week.id);
        var open = ws.expanded[week.id] !== false && (ws.expanded[week.id] || wi === 0);
        if (open) week.days.forEach(function (d) { ids.push(d.id); });
      });
      return ids;
    }

    function moveSelection(delta, extend) {
      var ids = visibleRowIds();
      if (!ids.length) return;
      var current = ws.selection.length ? ws.selection[ws.selection.length - 1] : null;
      var i = current ? ids.indexOf(current) : -1;
      var next = ids[Math.max(0, Math.min(ids.length - 1, i + delta))];
      if (!next) return;
      if (extend) extendSelection(next); else setSelection([next], next);
      focusNode(next);
      var el = outlineEl.querySelector('[data-node-id="' + next + '"]');
      if (el) el.scrollIntoView({ block: "nearest" });
    }

    function selectAllSiblings() {
      if (!ws.selection.length) {
        setSelection(ws.store.doc.training.weeks.map(function (w) { return w.id; }));
        return;
      }
      var f = ws.store.locate(ws.selection[0]);
      if (!f) return;
      setSelection(f.list.map(function (n) { return n.id; }));
    }

    // ---------------------------------------------------------------------
    // Save status / topbar
    // ---------------------------------------------------------------------
    function renderSaveStatus() {
      var s = ws.store.state;
      var map = {
        saved: '<i class="fa-solid fa-check"></i> Saved',
        dirty: '<i class="fa-regular fa-clock"></i> Unsaved changes',
        saving: '<i class="fa-solid fa-circle-notch fa-spin"></i> Saving…',
        failed: '<i class="fa-solid fa-triangle-exclamation"></i> Save failed',
      };
      saveEl.className = "fab-save is-" + s.saveStatus;
      saveEl.innerHTML = map[s.saveStatus] || "";
      if (s.saveStatus === "failed") {
        saveEl.innerHTML += ' <button type="button" class="fab-retry">Retry</button>';
        saveEl.querySelector(".fab-retry").addEventListener("click", function () {
          ws.store.save().catch(function () { /* status already reflects it */ });
        });
        saveEl.title = s.saveError || "";
      }
      root.querySelector('[data-act="undo"]').disabled = !ws.store.canUndo();
      root.querySelector('[data-act="redo"]').disabled = !ws.store.canRedo();
    }

    function renderTopbar() {
      var p = ws.product;
      root.querySelector(".fab-title-name").textContent = p.name || "Untitled program";
      var badge = p.status === "published" ? "Published"
        : p.status === "scheduled" ? "Scheduled"
        : p.status === "private" ? "Private"
        : p.status === "archived" ? "Archived"
        : p.status === "presentation" ? "Showcase only"
        : "Draft";
      root.querySelector(".fab-title-meta").innerHTML =
        '<span class="fab-status fab-status-' + esc(p.status) + '">' + esc(badge) + "</span>" +
        (p.durationWeeks ? " · " + p.durationWeeks + " weeks" : "");
    }

    // Full repaint. Cheap because the canvas is day-scoped — the DOM being
    // rebuilt is one day's cards plus ~96 outline rows, never the whole program.
    function refreshAll() {
      renderOutline();
      renderCanvas();
      renderInspector();
      renderSelectionBar();
      renderSaveStatus();
      renderTopbar();
    }

    // Only the pieces a keystroke can invalidate — used on "field" commits so
    // typing never rebuilds (and un-focuses) the input being typed into.
    function refreshLabelsOnly() {
      renderSaveStatus();
      var doc = ws.store.doc;
      outlineEl.querySelectorAll(".fab-row[data-node-id]").forEach(function (row) {
        var f = Core.locate(doc, row.dataset.nodeId);
        if (!f) return;
        var labelEl = row.querySelector(".fab-row-label");
        var text = Core.nodeLabel(f.node, f.kind);
        if (labelEl && labelEl.textContent !== text) labelEl.textContent = text;
      });
    }

    // ---------------------------------------------------------------------
    // Close
    // ---------------------------------------------------------------------
    function requestClose() {
      if (ws.closing) return;
      var s = ws.store && ws.store.state;
      if (!s || s.saveStatus === "saved") return doClose();
      if (s.saveStatus === "failed") {
        return window.AdminUI.confirmDialog({
          title: "Your last save failed.",
          message: (s.saveError || "The server rejected the change.") + " Closing now will lose the unsaved edits.",
          confirmLabel: "Close anyway",
          danger: true,
        }).then(function (ok) { if (ok) doClose(); });
      }
      // Everything else autosaves on the way out — the whole point of autosave
      // is that closing is never a decision.
      toast("Saving…");
      ws.store.flush().then(function () {
        if (ws.store.state.saveStatus === "failed") {
          toast(ws.store.state.saveError || "Could not save", "error");
          renderSaveStatus();
          return;
        }
        doClose();
      });
    }

    function doClose() {
      ws.closing = true;
      if (ws.unsubscribe) ws.unsubscribe();
      document.removeEventListener("keydown", onKeydown, true);
      closeContextMenu();
      document.body.classList.remove("fab-open");
      root.classList.add("is-closing");
      setTimeout(function () { root.remove(); }, 180);
      if (onDone) onDone(ws.product);
    }

    function toast(msg, type) { window.AdminUI.toast(msg, type || "success"); }

    // ---------------------------------------------------------------------
    // Boot
    // ---------------------------------------------------------------------
    root.querySelector('[data-act="close"]').addEventListener("click", requestClose);
    root.querySelector('[data-act="undo"]').addEventListener("click", function () {
      if (ws.store.undo()) refreshAll();
    });
    root.querySelector('[data-act="redo"]').addEventListener("click", function () {
      if (ws.store.redo()) refreshAll();
    });
    root.querySelector('[data-act="shortcuts"]').addEventListener("click", function () {
      window.AdminBuilderDialogs.shortcuts();
    });
    root.querySelector('[data-act="preview"]').addEventListener("click", function () {
      ws.store.flush().then(function () {
        window.open("/my-library/" + encodeURIComponent(ws.product.id), "_blank", "noopener");
      });
    });
    root.querySelector('[data-act="publish"]').addEventListener("click", function () {
      ws.store.flush().then(function () { window.AdminBuilderDialogs.publish(ws, refreshAll); });
    });
    root.querySelectorAll(".fab-tab").forEach(function (tab) {
      tab.addEventListener("click", function () {
        ws.view = tab.dataset.view;
        root.querySelectorAll(".fab-tab").forEach(function (t) { t.classList.toggle("is-active", t === tab); });
        root.classList.toggle("is-settings", ws.view === "settings");
        renderCanvas();
      });
    });
    document.addEventListener("keydown", onKeydown, true);

    function boot(product, taxonomies) {
      ws.product = product;
      ws.taxonomies = taxonomies;
      ws.store = Core.createStore({ product: product });
      ws.unsubscribe = ws.store.subscribe(function (reason) {
        if (reason === "save-status") { renderSaveStatus(); return; }
        if (reason === "field") { refreshLabelsOnly(); return; }
        refreshAll();
      });
      loadingEl.remove();
      // Land on the first day so the builder opens on something editable
      // rather than an empty canvas the admin has to click out of.
      var firstWeek = ws.store.doc.training.weeks[0];
      if (firstWeek) {
        ws.expanded[firstWeek.id] = true;
        var firstDay = firstWeek.days[0];
        ws.focusId = firstDay ? firstDay.id : firstWeek.id;
        ws.focusKind = firstDay ? "day" : "week";
        if (ws.focusId) ws.selection = [ws.focusId];
        ws.anchorId = ws.focusId;
      }
      refreshAll();
      window.AdminAPI.listBuilderTemplates()
        .then(function (data) { ws.templates = data.templates || []; })
        .catch(function () { ws.templates = []; });
    }

    var taxonomyPromise = window.AdminAPI.getTaxonomy()
      .then(function (d) { return d.taxonomies; })
      .catch(function () { return []; });

    if (productId) {
      Promise.all([window.AdminAPI.getProduct(productId), taxonomyPromise])
        .then(function (r) { boot(r[0].product, r[1]); })
        .catch(function (err) { window.AdminUI.toast(err.message, "error"); doClose(); });
    } else {
      var fd = new FormData();
      fd.append("name", "Untitled Program");
      fd.append("slug", "untitled-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      Promise.all([window.AdminAPI.createProduct(fd), taxonomyPromise])
        .then(function (r) { boot(r[0].product, r[1]); ws.view = "settings"; root.classList.add("is-settings");
          root.querySelectorAll(".fab-tab").forEach(function (t) { t.classList.toggle("is-active", t.dataset.view === "settings"); });
          renderCanvas();
        })
        .catch(function (err) { window.AdminUI.toast(err.message, "error"); doClose(); });
    }
  }

  return { open: open, SETTINGS_PANELS: SETTINGS_PANELS };
})();
