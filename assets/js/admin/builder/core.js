// The Product Builder's engine: document model, undo/redo, clipboard, and the
// bulk/generate/replace operations. Deliberately free of DOM — everything here
// is pure data, so the UI layer (ui.js) can re-render from a snapshot and the
// operations can be unit-reasoned about without a browser.
//
// The load-bearing constraint: whatever this produces must still deserialize
// into the SAME `trainingContent` / `nutritionContent` shape the customer-facing
// program page already reads (assets/js/program.js reads
// trainingContent.weeks[].days[].exercises[] and nutritionContent.meals[]).
// So the document model is a *superset*: it adds stable ids and new per-day
// collections (meals, blocks) that the viewer simply ignores, and never moves
// or renames a field the viewer depends on. That is why there is no migration
// and no viewer change in this whole redesign.
window.AdminBuilderCore = (function () {
  // ---------------------------------------------------------------------------
  // Node kinds
  // ---------------------------------------------------------------------------
  // Every editable thing in a program is a "node" with a stable id and a kind.
  // Copy/paste, drag/drop, duplicate, delete and multi-select are all written
  // once against this table instead of once per content type — which is the
  // only reason "everything supports everything" is maintainable at all.
  //
  //   root-level:  week (training), meal (the legacy flat nutrition list)
  //   week-level:  day
  //   day-level:   exercise, daymeal, block
  //
  // `block` is the catch-all for the mixed media an admin drops into a day:
  // note, video, image, pdf, gallery. They share one kind because they share
  // one set of operations; only their inspector fields differ.
  var KINDS = {
    week: { label: "Week", childKeys: ["days"], root: "weeks" },
    day: { label: "Day", parent: "week", key: "days", childKeys: ["exercises", "meals", "blocks"] },
    exercise: { label: "Exercise", parent: "day", key: "exercises" },
    daymeal: { label: "Meal", parent: "day", key: "meals" },
    block: { label: "Block", parent: "day", key: "blocks" },
    meal: { label: "Meal", root: "meals" },
  };

  var BLOCK_TYPES = {
    note: { label: "Note", icon: "fa-note-sticky" },
    video: { label: "Video", icon: "fa-video" },
    image: { label: "Image", icon: "fa-image" },
    pdf: { label: "PDF", icon: "fa-file-pdf" },
    gallery: { label: "Gallery", icon: "fa-images" },
  };

  var WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

  // Prefixed so ids minted here can never collide with the `n…` ids the old
  // wizard generated, which are still present in every existing product.
  var idCounter = 0;
  function uid() {
    idCounter += 1;
    return "b" + Date.now().toString(36) + idCounter.toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

  // ---------------------------------------------------------------------------
  // Normalization
  // ---------------------------------------------------------------------------
  // Existing products were written by the old wizard, which gave ids to some
  // nodes and not others, and never had day-level meals or blocks at all. Every
  // document is normalized on load so the rest of the engine can assume a
  // stable id on every node and an array (never undefined) on every collection.
  function normalizeExercise(ex) {
    return {
      id: ex.id || uid(),
      name: ex.name || "",
      sets: ex.sets || "",
      reps: ex.reps || "",
      notes: ex.notes || "",
      substitutions: ex.substitutions || "",
      mediaUrl: ex.mediaUrl || "",
      mediaType: ex.mediaType || "",
    };
  }

  function normalizeMeal(m) {
    return {
      id: m.id || uid(),
      name: m.name || "",
      macros: m.macros || "",
      ingredients: m.ingredients || "",
      notes: m.notes || "",
    };
  }

  function normalizeBlock(b) {
    return {
      id: b.id || uid(),
      type: BLOCK_TYPES[b.type] ? b.type : "note",
      title: b.title || "",
      body: b.body || "",
      url: b.url || "",
      mediaType: b.mediaType || "",
      items: Array.isArray(b.items) ? b.items.slice() : [],
    };
  }

  function normalizeDay(d) {
    return {
      id: d.id || uid(),
      title: d.title || "",
      notes: d.notes || "",
      // Per-day publish control. Absent on every legacy day, which is why the
      // check is `=== true` rather than truthiness on a possibly-missing field.
      hidden: d.hidden === true,
      exercises: (d.exercises || []).map(normalizeExercise),
      meals: (d.meals || []).map(normalizeMeal),
      blocks: (d.blocks || []).map(normalizeBlock),
    };
  }

  function normalizeWeek(w) {
    return {
      id: w.id || uid(),
      title: w.title || "",
      hidden: w.hidden === true,
      days: (w.days || []).map(normalizeDay),
    };
  }

  function normalizeDoc(product) {
    var t = product.trainingContent || {};
    var n = product.nutritionContent || {};
    return {
      training: { notes: t.notes || "", weeks: (t.weeks || []).map(normalizeWeek) },
      nutrition: { notes: n.notes || "", meals: (n.meals || []).map(normalizeMeal) },
    };
  }

  // The inverse. Emits exactly the two JSON blobs the server's
  // PUT /api/admin/products/:id/content already accepts — no new columns, no
  // new endpoint, and a shape the existing customer viewer keeps rendering.
  function serializeDoc(doc) {
    return {
      trainingContent: { notes: doc.training.notes, weeks: doc.training.weeks },
      nutritionContent: { notes: doc.nutrition.notes, meals: doc.nutrition.meals },
    };
  }

  // ---------------------------------------------------------------------------
  // Locating nodes
  // ---------------------------------------------------------------------------
  // Returns { node, kind, list, index, parent } for an id, or null. A linear
  // walk: at the sizes this builder targets (12 weeks / 84 days / 500+
  // exercises is a few thousand nodes) this is microseconds, and it keeps
  // there from being a second index to hold in sync with the document.
  function locate(doc, id) {
    var weeks = doc.training.weeks;
    for (var wi = 0; wi < weeks.length; wi++) {
      var week = weeks[wi];
      if (week.id === id) return { node: week, kind: "week", list: weeks, index: wi, parent: null };
      for (var di = 0; di < week.days.length; di++) {
        var day = week.days[di];
        if (day.id === id) return { node: day, kind: "day", list: week.days, index: di, parent: week };
        var found = locateInDay(day, id);
        if (found) return found;
      }
    }
    for (var mi = 0; mi < doc.nutrition.meals.length; mi++) {
      if (doc.nutrition.meals[mi].id === id) {
        return { node: doc.nutrition.meals[mi], kind: "meal", list: doc.nutrition.meals, index: mi, parent: null };
      }
    }
    return null;
  }

  function locateInDay(day, id) {
    var buckets = [["exercises", "exercise"], ["meals", "daymeal"], ["blocks", "block"]];
    for (var b = 0; b < buckets.length; b++) {
      var list = day[buckets[b][0]];
      for (var i = 0; i < list.length; i++) {
        if (list[i].id === id) return { node: list[i], kind: buckets[b][1], list: list, index: i, parent: day };
      }
    }
    return null;
  }

  // Every node under (and including) a subtree, flattened — the basis for
  // smart replace, counting, and "select all inside this week".
  function walk(doc, fn) {
    doc.training.weeks.forEach(function (week) {
      fn(week, "week", null);
      week.days.forEach(function (day) {
        fn(day, "day", week);
        day.exercises.forEach(function (x) { fn(x, "exercise", day); });
        day.meals.forEach(function (x) { fn(x, "daymeal", day); });
        day.blocks.forEach(function (x) { fn(x, "block", day); });
      });
    });
    doc.nutrition.meals.forEach(function (m) { fn(m, "meal", null); });
  }

  // Deep copy with every id in the subtree regenerated. This is what makes
  // duplicate/paste produce a genuinely independent copy rather than two
  // references that fight over the same id in `locate`.
  function cloneNode(node, kind) {
    var copy = clone(node);
    reid(copy, kind);
    return copy;
  }

  function reid(node, kind) {
    node.id = uid();
    var spec = KINDS[kind];
    if (!spec || !spec.childKeys) return;
    spec.childKeys.forEach(function (key) {
      var childKind = key === "days" ? "day" : key === "exercises" ? "exercise" : key === "meals" ? "daymeal" : "block";
      (node[key] || []).forEach(function (child) { reid(child, childKind); });
    });
  }

  // ---------------------------------------------------------------------------
  // Factories
  // ---------------------------------------------------------------------------
  function newExercise(over) { return Object.assign(normalizeExercise({}), over || {}, { id: uid() }); }
  function newMeal(over) { return Object.assign(normalizeMeal({}), over || {}, { id: uid() }); }
  function newBlock(type, over) { return Object.assign(normalizeBlock({ type: type }), over || {}, { id: uid() }); }
  function newDay(over) { return Object.assign(normalizeDay({}), over || {}, { id: uid() }); }
  function newWeek(over) { return Object.assign(normalizeWeek({}), over || {}, { id: uid() }); }

  function makeNode(kind, over) {
    if (kind === "week") return newWeek(over);
    if (kind === "day") return newDay(over);
    if (kind === "exercise") return newExercise(over);
    if (kind === "daymeal" || kind === "meal") return newMeal(over);
    if (kind === "block") return newBlock((over && over.type) || "note", over);
    return null;
  }

  // ---------------------------------------------------------------------------
  // Store: document + history + autosave
  // ---------------------------------------------------------------------------
  // `commit` is the single mutation funnel. Everything — a keystroke, a paste,
  // a 12-week generate — goes through it, so undo, dirty-tracking, autosave and
  // re-render are wired up exactly once and can't be forgotten by a new feature.
  //
  // History is snapshot-based (a full clone of the document per commit) rather
  // than a command/inverse-command log. Snapshots are ~200KB at the top end of
  // the target size, and correctness matters far more here than memory: an
  // inverse-command log has to get every one of ~20 operations exactly right or
  // undo silently corrupts a program, whereas a snapshot cannot be wrong.
  // Typing is coalesced (see COALESCE_MS) so a sentence is one undo step, not
  // forty, and the stack is capped at MAX_HISTORY to bound worst-case memory.
  var MAX_HISTORY = 400;
  var COALESCE_MS = 600;
  var AUTOSAVE_MS = 1200;
  // Autosave retry: three attempts at 3s, 6s, 12s before we stop and leave it
  // to the admin, which covers a server restart or a brief network drop
  // without hammering a server that is genuinely rejecting the payload.
  var SAVE_RETRIES = 3;
  var SAVE_RETRY_MS = 3000;

  function createStore(options) {
    var product = options.product;
    var state = {
      productId: product.id,
      doc: normalizeDoc(product),
      past: [],
      future: [],
      lastCommitKey: null,
      lastCommitAt: 0,
      saveStatus: "saved", // "saved" | "dirty" | "saving" | "failed"
      saveError: null,
      lastSavedAt: null,
      pendingSave: null,
      inFlight: false,
      // Set when a save fails so the next successful save can clear it, and so
      // "Retry" has something to retry.
      retryQueued: false,
      // Counts consecutive failed autosaves; reset the moment one succeeds.
      retryCount: 0,
    };

    var listeners = [];
    function subscribe(fn) { listeners.push(fn); return function () { listeners = listeners.filter(function (f) { return f !== fn; }); }; }
    function emit(reason) { listeners.forEach(function (fn) { fn(reason); }); }

    function snapshot() { return clone(state.doc); }

    // coalesceKey: when two consecutive commits share a non-null key within
    // COALESCE_MS they collapse into one undo step. Text fields pass
    // "field:<nodeId>:<fieldName>" so typing in one box is one step but moving
    // to the next box starts a new one.
    function commit(label, mutate, coalesceKey) {
      var now = Date.now();
      var canCoalesce = coalesceKey && state.lastCommitKey === coalesceKey && (now - state.lastCommitAt) < COALESCE_MS;

      if (!canCoalesce) {
        state.past.push(snapshot());
        if (state.past.length > MAX_HISTORY) state.past.shift();
        state.future = [];
      }
      state.lastCommitKey = coalesceKey || null;
      state.lastCommitAt = now;

      var result = mutate(state.doc);
      markDirty();
      emit(label || "commit");
      return result;
    }

    function undo() {
      if (!state.past.length) return false;
      state.future.push(snapshot());
      state.doc = state.past.pop();
      state.lastCommitKey = null;
      markDirty();
      emit("undo");
      return true;
    }

    function redo() {
      if (!state.future.length) return false;
      state.past.push(snapshot());
      state.doc = state.future.pop();
      state.lastCommitKey = null;
      markDirty();
      emit("redo");
      return true;
    }

    // ---- autosave -----------------------------------------------------------
    function markDirty() {
      state.saveStatus = "dirty";
      clearTimeout(state.pendingSave);
      state.pendingSave = setTimeout(save, AUTOSAVE_MS);
      emit("save-status");
    }

    function save() {
      clearTimeout(state.pendingSave);
      // One save in flight at a time. If edits land mid-flight the status stays
      // "dirty" underneath and the .then below re-runs — otherwise a fast typist
      // can race two PUTs and have the older one land last.
      if (state.inFlight) { state.retryQueued = true; return Promise.resolve(); }
      if (state.saveStatus === "saved") return Promise.resolve();

      state.inFlight = true;
      state.saveStatus = "saving";
      state.saveError = null;
      emit("save-status");

      var payload = serializeDoc(state.doc);
      var docAtSend = JSON.stringify(payload);

      return window.AdminAPI.updateProductContent(state.productId, payload).then(function (data) {
        state.inFlight = false;
        state.lastSavedAt = Date.now();
        state.retryCount = 0;
        // Only declare "saved" if nothing changed while the request was in
        // flight; otherwise stay dirty and let the queued save run.
        var stillCurrent = JSON.stringify(serializeDoc(state.doc)) === docAtSend;
        if (stillCurrent && !state.retryQueued) {
          state.saveStatus = "saved";
        } else {
          state.saveStatus = "dirty";
          state.retryQueued = false;
          state.pendingSave = setTimeout(save, 200);
        }
        emit("save-status");
        return data;
      }).catch(function (err) {
        state.inFlight = false;
        state.saveStatus = "failed";
        state.saveError = err.message || "Could not save";
        emit("save-status");
        // A dropped connection or a restarting server must not leave the work
        // sitting unsaved until the admin happens to notice the banner: back
        // off and try again a few times on our own. The banner and its Retry
        // button stay up throughout, so a failure that outlives the attempts
        // is still visible rather than silently abandoned.
        if (state.retryCount < SAVE_RETRIES) {
          var wait = SAVE_RETRY_MS * Math.pow(2, state.retryCount);
          state.retryCount += 1;
          clearTimeout(state.pendingSave);
          state.pendingSave = setTimeout(save, wait);
        }
        throw err;
      });
    }

    // Called before closing the workspace / navigating away.
    function flush() {
      if (state.saveStatus === "saved") return Promise.resolve();
      return save().catch(function () { /* surfaced via save-status */ });
    }

    return {
      state: state,
      get doc() { return state.doc; },
      subscribe: subscribe,
      emit: emit,
      commit: commit,
      undo: undo,
      redo: redo,
      canUndo: function () { return state.past.length > 0; },
      canRedo: function () { return state.future.length > 0; },
      save: save,
      flush: flush,
      locate: function (id) { return locate(state.doc, id); },
    };
  }

  // ---------------------------------------------------------------------------
  // Clipboard
  // ---------------------------------------------------------------------------
  // Session-scoped and kind-tagged. Held in a module variable rather than the
  // system clipboard so a copied *subtree* (a week with its days, exercises and
  // media) survives a paste intact — the OS clipboard would only carry text.
  // It is mirrored into sessionStorage so a copy survives a page reload and can
  // be pasted into a different product, which is how "build the women's version
  // from the men's" actually gets done.
  var CLIP_KEY = "fa.builder.clipboard";
  var clipboard = null;

  function readClipboard() {
    if (clipboard) return clipboard;
    try {
      var raw = sessionStorage.getItem(CLIP_KEY);
      if (raw) clipboard = JSON.parse(raw);
    } catch (e) { /* private mode / quota — in-memory clipboard still works */ }
    return clipboard;
  }

  function writeClipboard(kind, nodes) {
    clipboard = { kind: kind, nodes: clone(nodes), at: Date.now() };
    try { sessionStorage.setItem(CLIP_KEY, JSON.stringify(clipboard)); } catch (e) { /* non-fatal */ }
    return clipboard;
  }

  // Where a node of `kind` is allowed to land, in priority order. Paste resolves
  // the anchor selection against this so "copy an exercise, click a day, paste"
  // works without the admin having to click exactly the right list header.
  function containerFor(doc, kind, anchorId) {
    var anchor = anchorId ? locate(doc, anchorId) : null;

    if (kind === "week") {
      var idx = anchor && anchor.kind === "week" ? anchor.index + 1 : doc.training.weeks.length;
      return { list: doc.training.weeks, index: idx };
    }
    if (kind === "meal") {
      var mi = anchor && anchor.kind === "meal" ? anchor.index + 1 : doc.nutrition.meals.length;
      return { list: doc.nutrition.meals, index: mi };
    }
    if (kind === "day") {
      if (anchor && anchor.kind === "day") return { list: anchor.list, index: anchor.index + 1 };
      if (anchor && anchor.kind === "week") return { list: anchor.node.days, index: anchor.node.days.length };
      // Anchored inside a day (an exercise, say) — land next to that day.
      if (anchor && anchor.parent && anchor.parent.days) return { list: anchor.parent.days, index: anchor.parent.days.length };
      var lastWeek = doc.training.weeks[doc.training.weeks.length - 1];
      return lastWeek ? { list: lastWeek.days, index: lastWeek.days.length } : null;
    }
    // Day-scoped kinds: resolve the anchor up to its owning day.
    var key = kind === "exercise" ? "exercises" : kind === "daymeal" ? "meals" : "blocks";
    var day = null;
    var index = null;
    if (anchor) {
      if (anchor.kind === "day") { day = anchor.node; }
      else if (anchor.parent && anchor.parent.exercises) { day = anchor.parent; if (anchor.kind === kind) index = anchor.index + 1; }
      else if (anchor.kind === "week" && anchor.node.days.length) { day = anchor.node.days[0]; }
    }
    if (!day) return null;
    return { list: day[key], index: index == null ? day[key].length : index };
  }

  // ---------------------------------------------------------------------------
  // Operations
  // ---------------------------------------------------------------------------
  // Each takes the store and returns a short human summary, which the UI shows
  // as the toast — so every bulk action tells you exactly what it did
  // ("Duplicated Week 1 into 5 weeks") instead of a generic "Done".
  var ops = {};

  ops.copy = function (store, ids) {
    var doc = store.doc;
    var found = ids.map(function (id) { return locate(doc, id); }).filter(Boolean);
    if (!found.length) return null;
    // A mixed selection copies as its dominant kind — pasting a week and an
    // exercise together has no coherent destination, so the rarer kind is
    // dropped rather than silently landing somewhere surprising.
    var kind = found[0].kind;
    var same = found.filter(function (f) { return f.kind === kind; });
    writeClipboard(kind, same.map(function (f) { return f.node; }));
    return { kind: kind, count: same.length };
  };

  ops.cut = function (store, ids) {
    var res = ops.copy(store, ids);
    if (!res) return null;
    ops.remove(store, ids, "Cut");
    return res;
  };

  ops.paste = function (store, anchorId) {
    var clip = readClipboard();
    if (!clip || !clip.nodes.length) return null;
    var inserted = [];
    store.commit("paste", function (doc) {
      var target = containerFor(doc, clip.kind, anchorId);
      if (!target) return;
      var copies = clip.nodes.map(function (n) { return cloneNode(n, clip.kind); });
      Array.prototype.splice.apply(target.list, [target.index, 0].concat(copies));
      inserted = copies.map(function (c) { return c.id; });
    });
    if (!inserted.length) return null;
    return { kind: clip.kind, count: inserted.length, ids: inserted };
  };

  ops.duplicate = function (store, ids) {
    var newIds = [];
    store.commit("duplicate", function (doc) {
      // Right-to-left so each splice can't shift the index of one not yet done.
      var found = ids.map(function (id) { return locate(doc, id); }).filter(Boolean)
        .sort(function (a, b) { return b.index - a.index; });
      found.forEach(function (f) {
        var copy = cloneNode(f.node, f.kind);
        if (f.kind === "week" && copy.title) copy.title = nextTitle(copy.title, doc.training.weeks.map(function (w) { return w.title; }));
        f.list.splice(f.index + 1, 0, copy);
        newIds.push(copy.id);
      });
    });
    return { count: newIds.length, ids: newIds };
  };

  ops.remove = function (store, ids, label) {
    var removed = 0;
    store.commit(label || "delete", function (doc) {
      // Resolve every node first, then splice — resolving and splicing in the
      // same pass invalidates the indices of the not-yet-removed siblings.
      var found = ids.map(function (id) { return locate(doc, id); }).filter(Boolean);
      found.sort(function (a, b) { return b.index - a.index; });
      found.forEach(function (f) {
        var at = f.list.indexOf(f.node);
        if (at !== -1) { f.list.splice(at, 1); removed += 1; }
      });
    });
    return { count: removed };
  };

  // Move by drag/drop or the Move command. `position` is the index within the
  // destination list, computed by the caller from the drop point.
  ops.move = function (store, ids, destParentId, position) {
    var moved = 0;
    store.commit("move", function (doc) {
      var nodes = ids.map(function (id) { return locate(doc, id); }).filter(Boolean);
      if (!nodes.length) return;
      var kind = nodes[0].kind;
      var dest = destParentId ? locate(doc, destParentId) : null;
      var destList = resolveDestList(doc, kind, dest);
      if (!destList) return;

      var lifted = [];
      nodes.filter(function (n) { return n.kind === kind; })
        .sort(function (a, b) { return b.index - a.index; })
        .forEach(function (n) {
          var at = n.list.indexOf(n.node);
          if (at === -1) return;
          n.list.splice(at, 1);
          lifted.unshift(n.node);
        });

      var index = position == null ? destList.length : Math.max(0, Math.min(position, destList.length));
      Array.prototype.splice.apply(destList, [index, 0].concat(lifted));
      moved = lifted.length;
    });
    return { count: moved };
  };

  function resolveDestList(doc, kind, dest) {
    if (kind === "week") return doc.training.weeks;
    if (kind === "meal") return doc.nutrition.meals;
    if (!dest) return null;
    if (kind === "day") return dest.kind === "week" ? dest.node.days : (dest.kind === "day" ? dest.list : null);
    var key = kind === "exercise" ? "exercises" : kind === "daymeal" ? "meals" : "blocks";
    if (dest.kind === "day") return dest.node[key];
    if (dest.parent && dest.parent.exercises) return dest.parent[key];
    return null;
  }

  // "Week 1" -> "Week 2"; "Push Day" -> "Push Day copy"; avoids colliding with
  // titles already in use so a duplicated week doesn't read as a second "Week 3".
  function nextTitle(title, existing) {
    var m = /^(.*?)(\d+)\s*$/.exec(title);
    if (m) {
      var base = m[1];
      var n = parseInt(m[2], 10);
      var candidate;
      do { n += 1; candidate = base + n; } while (existing.indexOf(candidate) !== -1);
      return candidate;
    }
    var copy = title + " copy";
    var i = 2;
    while (existing.indexOf(copy) !== -1) { copy = title + " copy " + i++; }
    return copy;
  }

  // --- Week / day generators -------------------------------------------------
  // "Create 12 weeks" in one action. `withDays` optionally fills each generated
  // week with a full Monday–Sunday skeleton, which is the difference between
  // one click and eighty-four.
  ops.generateWeeks = function (store, count, opts) {
    opts = opts || {};
    var created = [];
    store.commit("generate-weeks", function (doc) {
      var start = doc.training.weeks.length;
      for (var i = 0; i < count; i++) {
        var week;
        if (opts.fromWeekId) {
          var src = locate(doc, opts.fromWeekId);
          week = src ? cloneNode(src.node, "week") : newWeek();
          week.title = "Week " + (start + i + 1);
        } else {
          week = newWeek({ title: "Week " + (start + i + 1) });
          if (opts.withDays) {
            week.days = (opts.dayNames || WEEKDAYS).map(function (name) { return newDay({ title: name }); });
          }
        }
        doc.training.weeks.push(week);
        created.push(week.id);
      }
    });
    return { count: created.length, ids: created };
  };

  ops.generateDays = function (store, weekId, names) {
    var created = [];
    store.commit("generate-days", function (doc) {
      var w = locate(doc, weekId);
      if (!w || w.kind !== "week") return;
      (names || WEEKDAYS).forEach(function (name) {
        var d = newDay({ title: name });
        w.node.days.push(d);
        created.push(d.id);
      });
    });
    return { count: created.length, ids: created };
  };

  // --- Fan-out: one week into many -------------------------------------------
  // The headline operation. "Copy Week 1, paste into weeks 2-6" as a single
  // undoable action. `mode` decides what happens to whatever is already there:
  //   replace — the target week's days are overwritten (a true clone)
  //   append  — the source days are added after the target's existing days
  ops.applyWeekTo = function (store, sourceWeekId, targetWeekIds, mode) {
    var touched = 0;
    store.commit("apply-week", function (doc) {
      var src = locate(doc, sourceWeekId);
      if (!src || src.kind !== "week") return;
      targetWeekIds.forEach(function (targetId) {
        if (targetId === sourceWeekId) return;
        var dest = locate(doc, targetId);
        if (!dest || dest.kind !== "week") return;
        var days = src.node.days.map(function (d) { return cloneNode(d, "day"); });
        dest.node.days = mode === "append" ? dest.node.days.concat(days) : days;
        touched += 1;
      });
    });
    return { count: touched };
  };

  // "Copy Monday, Wednesday, Friday → paste into weeks 3, 4 and 5."
  ops.applyDaysTo = function (store, dayIds, targetWeekIds, mode) {
    var touched = 0;
    store.commit("apply-days", function (doc) {
      var sources = dayIds.map(function (id) { return locate(doc, id); }).filter(function (f) { return f && f.kind === "day"; });
      if (!sources.length) return;
      targetWeekIds.forEach(function (weekId) {
        var dest = locate(doc, weekId);
        if (!dest || dest.kind !== "week") return;
        var days = sources.map(function (s) { return cloneNode(s.node, "day"); });
        dest.node.days = mode === "replace" ? days : dest.node.days.concat(days);
        touched += 1;
      });
    });
    return { count: touched };
  };

  // --- Bulk field operations -------------------------------------------------
  // Set the same value across every selected node — "replace coach notes on all
  // 12 recovery days", "hide every week 9-12 day while they're being written".
  ops.bulkSet = function (store, ids, field, value) {
    var n = 0;
    store.commit("bulk-set", function (doc) {
      ids.forEach(function (id) {
        var f = locate(doc, id);
        if (!f) return;
        f.node[field] = value;
        n += 1;
      });
    });
    return { count: n };
  };

  // Attach the same media to every selected exercise/block — the "replace media"
  // bulk action. Skips nodes the field makes no sense for rather than writing a
  // stray mediaUrl onto a week.
  ops.bulkSetMedia = function (store, ids, url, mediaType) {
    var n = 0;
    store.commit("bulk-media", function (doc) {
      ids.forEach(function (id) {
        var f = locate(doc, id);
        if (!f) return;
        if (f.kind === "exercise" || f.kind === "block") {
          f.node.mediaUrl = url;
          f.node.mediaType = mediaType;
          if (f.kind === "block") f.node.url = url;
          n += 1;
        }
      });
    });
    return { count: n };
  };

  // --- Smart replace ---------------------------------------------------------
  // "Replace Bench Press with Incline Bench everywhere in this product."
  // Runs over every text field of every node in one undoable commit. `scopeIds`
  // limits it to a subtree (a week, a set of days) when the admin only wants
  // the change in part of the program.
  var TEXT_FIELDS = ["title", "name", "notes", "reps", "sets", "substitutions", "macros", "ingredients", "body"];

  ops.smartReplacePreview = function (store, find, opts) {
    return smartReplaceRun(store.doc, find, null, opts, true);
  };

  ops.smartReplace = function (store, find, replaceWith, opts) {
    var result;
    store.commit("smart-replace", function (doc) {
      result = smartReplaceRun(doc, find, replaceWith, opts, false);
    });
    return result;
  };

  function smartReplaceRun(doc, find, replaceWith, opts, dryRun) {
    opts = opts || {};
    if (!find) return { matches: 0, nodes: [] };

    var scope = opts.scopeIds && opts.scopeIds.length ? collectScope(doc, opts.scopeIds) : null;
    var flags = "g" + (opts.caseSensitive ? "" : "i");
    var pattern = escapeRe(find);
    if (opts.wholeWord) pattern = "\\b" + pattern + "\\b";
    var re = new RegExp(pattern, flags);

    var matches = 0;
    var hitNodes = [];

    walk(doc, function (node, kind) {
      if (scope && !scope.has(node.id)) return;
      var hitHere = 0;
      TEXT_FIELDS.forEach(function (field) {
        var val = node[field];
        if (typeof val !== "string" || !val) return;
        re.lastIndex = 0;
        var found = val.match(re);
        if (!found) return;
        hitHere += found.length;
        if (!dryRun) node[field] = val.replace(re, replaceWith);
      });
      if (hitHere) {
        matches += hitHere;
        hitNodes.push({ id: node.id, kind: kind, label: nodeLabel(node, kind), hits: hitHere });
      }
    });

    return { matches: matches, nodes: hitNodes };
  }

  function collectScope(doc, ids) {
    var set = new Set();
    ids.forEach(function (id) {
      var f = locate(doc, id);
      if (!f) return;
      addSubtree(f.node, f.kind, set);
    });
    return set;
  }

  function addSubtree(node, kind, set) {
    set.add(node.id);
    var spec = KINDS[kind];
    if (!spec || !spec.childKeys) return;
    spec.childKeys.forEach(function (key) {
      var childKind = key === "days" ? "day" : key === "exercises" ? "exercise" : key === "meals" ? "daymeal" : "block";
      (node[key] || []).forEach(function (child) { addSubtree(child, childKind, set); });
    });
  }

  function escapeRe(s) { return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

  // ---------------------------------------------------------------------------
  // Display helpers shared by every view
  // ---------------------------------------------------------------------------
  function nodeLabel(node, kind) {
    if (kind === "week") return node.title || "Untitled week";
    if (kind === "day") return node.title || "Untitled day";
    if (kind === "block") return node.title || (BLOCK_TYPES[node.type] ? BLOCK_TYPES[node.type].label : "Block");
    return node.name || (kind === "exercise" ? "Untitled exercise" : "Untitled meal");
  }

  function countsFor(node, kind) {
    if (kind === "week") {
      var ex = 0;
      node.days.forEach(function (d) { ex += d.exercises.length; });
      return { days: node.days.length, exercises: ex };
    }
    if (kind === "day") {
      return { exercises: node.exercises.length, meals: node.meals.length, blocks: node.blocks.length };
    }
    return {};
  }

  function docStats(doc) {
    var s = { weeks: doc.training.weeks.length, days: 0, exercises: 0, meals: doc.nutrition.meals.length, blocks: 0 };
    doc.training.weeks.forEach(function (w) {
      s.days += w.days.length;
      w.days.forEach(function (d) {
        s.exercises += d.exercises.length;
        s.meals += d.meals.length;
        s.blocks += d.blocks.length;
      });
    });
    return s;
  }

  return {
    KINDS: KINDS,
    BLOCK_TYPES: BLOCK_TYPES,
    WEEKDAYS: WEEKDAYS,
    uid: uid,
    clone: clone,
    createStore: createStore,
    normalizeDoc: normalizeDoc,
    serializeDoc: serializeDoc,
    locate: locate,
    walk: walk,
    cloneNode: cloneNode,
    makeNode: makeNode,
    newWeek: newWeek,
    newDay: newDay,
    newExercise: newExercise,
    newMeal: newMeal,
    newBlock: newBlock,
    ops: ops,
    readClipboard: readClipboard,
    writeClipboard: writeClipboard,
    nodeLabel: nodeLabel,
    countsFor: countsFor,
    docStats: docStats,
  };
})();
