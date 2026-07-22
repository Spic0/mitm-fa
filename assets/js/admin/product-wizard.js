// Step-by-step Setup Wizard for creating/editing a product. Replaces the old
// single-modal create/edit form: a product is now a structured platform
// program (overview, training, nutrition, FAQ, bonus resources), not a
// name/price/PDF triple, so it needs guided steps instead of one long form.
//
// Deliberately a *flexible workspace*, not a locked onboarding flow: a draft
// product is created the instant the wizard opens (even before Basic Info is
// filled in), so every sidebar step is clickable from the very first frame.
// Required-field validation guides (missing-field banners, a warning toast
// on Next) but never blocks navigation — the only hard gate is Publish,
// which runs full validation and keeps you in the wizard if anything's
// missing, with one-click links to the offending steps.
//
// Shell layout: a fixed-height modal split into a stable step rail, a
// scrollable body (the only thing that changes step to step), and a footer
// pinned outside that scroll region — so switching steps never resizes the
// modal or moves the action buttons. Only the body's content animates.
window.AdminProductWizard = (function () {
  var STEPS = [
    { key: "basics", label: "Basic Info" },
    { key: "pricing", label: "Pricing & Access" },
    { key: "structure", label: "Program Structure" },
    { key: "gallery", label: "Product Gallery" },
    { key: "seoTags", label: "SEO & Tags" },
    { key: "training", label: "Training Content" },
    { key: "nutrition", label: "Nutrition Content" },
    { key: "faqBonus", label: "FAQ & Bonus" },
    { key: "preview", label: "Preview & Publish" },
  ];
  var STEP_LABELS = STEPS.reduce(function (acc, s) { acc[s.key] = s.label; return acc; }, {});

  function esc(s) { return window.AdminUI.escapeHtml(s); }
  function uid() { return "n" + Math.random().toString(36).slice(2, 10); }

  // Renders the three CMS-managed taxonomy trees (Shop by Goal / Browse
  // Athletes / Browse Creators). A taxonomy's `hasSubcategories` flag (set
  // once when the taxonomy is created, not inferred from current content)
  // decides the shape:
  //   - flat (Goals): every top-level node is a directly-selectable pill,
  //     in one fixed row.
  //   - category/subcategory (Athletes, Creators): top-level nodes render as
  //     a FIXED row of category pills (Football, Basketball, ...) that never
  //     reflows — clicking one shows its subcategory pills in a single,
  //     separate panel below the whole row. Only one category's panel is
  //     open per taxonomy at a time (accordion, not a stack), so opening a
  //     second category replaces the panel instead of pushing every pill
  //     below it further down the page.
  // Only subcategories (leaves) are ever checkable, since a product belongs
  // to "Football → Cristiano Ronaldo", never to "Football" alone. Every
  // level gets an inline "+ Add new" control wired to the real taxonomy CRUD
  // API, so a brand-new subcategory can be created on the spot without
  // leaving the wizard.
  function leafPillHtml(node, checked) {
    return (
      '<label class="a-wizard-tax-leaf' + (checked ? " is-checked" : "") + '"><input type="checkbox" value="' + node.id + '"' + (checked ? " checked" : "") + "> " +
      esc(node.name) + (node.productCount ? '<span class="a-wizard-tax-count">' + node.productCount + "</span>" : "") +
      "</label>"
    );
  }

  function addTriggerHtml(taxonomyId, parentId, label) {
    return (
      '<button type="button" class="a-wizard-tax-add-trigger" data-add-trigger="' + taxonomyId + ":" + (parentId || "") + '">' +
      '<i class="fa-solid fa-plus"></i> ' + esc(label) + "</button>"
    );
  }

  // The category pill itself — always lives in the fixed top row, never
  // wraps a subpanel inline, so its position is unaffected by any
  // expand/collapse state anywhere in the taxonomy.
  function categoryPillHtml(node, taxonomyId, selectedIds, activeId) {
    var isOpen = activeId === node.id;
    var hasSelectedChild = node.children.some(function (c) { return selectedIds.indexOf(c.id) !== -1; });
    return (
      '<button type="button" class="a-wizard-tax-cat-pill' + (isOpen ? " is-open" : "") + (hasSelectedChild ? " has-selection" : "") + '" data-toggle-category="' + taxonomyId + ":" + node.id + '">' +
      esc(node.name) + '<i class="fa-solid fa-chevron-down" aria-hidden="true"></i>' +
      "</button>"
    );
  }

  function taxonomyGroupHtml(t, selectedIds, activeCategoryByTaxonomy) {
    if (!t.hasSubcategories) {
      return (
        '<div class="a-wizard-tax-group">' +
        '<h6 class="a-wizard-tax-group-title">' + esc(t.label) + "</h6>" +
        '<p class="a-wizard-tax-group-hint">Flat list — pick as many as apply.</p>' +
        '<div class="a-wizard-tax-pills">' +
        t.nodes.map(function (n) { return leafPillHtml(n, selectedIds.indexOf(n.id) !== -1); }).join("") +
        addTriggerHtml(t.id, null, "Add new") +
        "</div></div>"
      );
    }

    var activeId = activeCategoryByTaxonomy[t.id] || null;
    var activeNode = t.nodes.find(function (n) { return n.id === activeId; }) || null;
    return (
      '<div class="a-wizard-tax-group">' +
      '<h6 class="a-wizard-tax-group-title">' + esc(t.label) + "</h6>" +
      '<p class="a-wizard-tax-group-hint">Pick a category, then pick or add the specific item below.</p>' +
      '<div class="a-wizard-tax-cat-row">' +
      t.nodes.map(function (n) { return categoryPillHtml(n, t.id, selectedIds, activeId); }).join("") +
      addTriggerHtml(t.id, null, "Add category") +
      "</div>" +
      '<div class="a-wizard-tax-subpanel-area">' +
      (activeNode
        ? '<div class="a-wizard-tax-subpanel">' +
          activeNode.children.map(function (c) { return leafPillHtml(c, selectedIds.indexOf(c.id) !== -1); }).join("") +
          addTriggerHtml(t.id, activeNode.id, "Add new") +
          "</div>"
        : '<p class="a-wizard-tax-group-hint" style="margin:0;">Select a category above to see or add items.</p>') +
      "</div></div>"
    );
  }

  function taxonomyPickerHtml(taxonomies, selectedIds, activeCategoryByTaxonomy) {
    return (taxonomies || []).map(function (t) { return taxonomyGroupHtml(t, selectedIds, activeCategoryByTaxonomy); }).join("");
  }

  // Swaps an "+ Add new" trigger button for an inline name input, right where
  // it was clicked — no modal, no leaving the wizard. Calls onCreated(node)
  // once the real taxonomy node exists in the database.
  function beginInlineTaxonomyAdd(triggerBtn, taxonomyId, parentId, onCreated) {
    var wrap = document.createElement("span");
    wrap.className = "a-wizard-tax-add-form";
    wrap.innerHTML =
      '<input type="text" class="tax-inline-input" placeholder="Name…">' +
      '<button type="button" class="a-btn a-btn-primary a-btn-sm" style="width:auto;" data-confirm>Add</button>' +
      '<button type="button" class="a-btn a-btn-secondary a-btn-sm" style="width:auto;" data-cancel>Cancel</button>';
    triggerBtn.replaceWith(wrap);
    var input = wrap.querySelector("input");
    input.focus();

    function cancel() { wrap.replaceWith(triggerBtn); }
    function confirmAdd() {
      var name = input.value.trim();
      if (!name) return;
      wrap.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
      window.AdminAPI.createTaxonomyNode(taxonomyId, { name: name, parentId: parentId || null })
        .then(onCreated)
        .catch(function (err) {
          window.AdminUI.toast(err.message || "Could not create", "error");
          cancel();
        });
    }
    wrap.querySelector("[data-confirm]").addEventListener("click", confirmAdd);
    wrap.querySelector("[data-cancel]").addEventListener("click", cancel);
    input.addEventListener("keydown", function (e) {
      if (e.key === "Enter") { e.preventDefault(); confirmAdd(); }
      if (e.key === "Escape") { e.preventDefault(); cancel(); }
    });
  }

  function setPath(obj, path, value) {
    var keys = path.split(".");
    var last = keys.pop();
    var target = keys.reduce(function (o, k) { return o[k]; }, obj);
    target[last] = value;
  }

  function alertHtml(variant, iconClass, bodyHtml) {
    return (
      '<div class="a-wizard-alert a-wizard-alert-' + variant + '">' +
      '<i class="fa-solid ' + iconClass + '"></i><div>' + bodyHtml + "</div></div>"
    );
  }

  function open(productId, onDone) {
    var state = { product: null, workingTraining: null, workingNutrition: null, visitedSteps: {} };

    var shell = window.AdminWizardShell.build({
      steps: STEPS,
      loadingText: "Setting up your program…",
      getStatus: function (key) {
        var progress = (state.product && state.product.wizardProgress) || {};
        if (progress[key]) return "complete";
        if (state.visitedSteps[key]) return "missing";
        return "not-started";
      },
      renderBody: function (key, index) {
        state.visitedSteps[key] = true;
        var wrapper = document.createElement("div");
        wrapper.className = "a-wizard-step-content";
        var bannerHost = document.createElement("div");
        var stepHost = document.createElement("div");
        wrapper.appendChild(bannerHost);
        wrapper.appendChild(stepHost);
        shell.bodyEl.innerHTML = "";
        shell.bodyEl.appendChild(wrapper);
        shell.bodyEl.scrollTop = 0;

        if (key === "basics") renderBasics(stepHost, bannerHost);
        else if (key === "pricing") renderPricing(stepHost, bannerHost);
        else if (key === "structure") renderStructure(stepHost, bannerHost);
        else if (key === "gallery") renderGallery(stepHost, bannerHost);
        else if (key === "seoTags") renderSeoTags(stepHost, bannerHost);
        else if (key === "training") renderTraining(stepHost, bannerHost);
        else if (key === "nutrition") renderNutrition(stepHost, bannerHost);
        else if (key === "faqBonus") renderFaqBonus(stepHost, bannerHost);
        else if (key === "preview") renderPreview(stepHost);
      },
      getResult: function () { return state.product; },
      onClose: function (result) { if (onDone) onDone(result); },
    });

    // Non-blocking reminder shown above a step's fields when it isn't
    // complete yet — validation as guidance, never a lockout.
    function renderMissingBanner(host, key) {
      var progress = (state.product && state.product.wizardProgress) || {};
      if (progress[key]) { host.innerHTML = ""; return; }
      host.innerHTML = alertHtml("warning", "fa-triangle-exclamation",
        "<strong>Missing required information</strong><p>This step isn't complete yet — feel free to work on other steps and come back before publishing.</p>");
    }

    // ---- Step 1: Basic Info ----
    function renderBasics(container, bannerHost) {
      renderMissingBanner(bannerHost, "basics");
      var p = state.product || {};

      // Selection/active-category state lives on `state` (not re-derived
      // from `p` on every render) so it survives the re-renders triggered by
      // switching categories or creating a new subcategory inline — only
      // seeded from the server once, the first time this step is shown. Only
      // one category can be "active" (its subpanel open) per taxonomy at a
      // time — an accordion, not a stack — so the category pill row never
      // reflows no matter how many categories get explored.
      if (!state.taxonomySelection) {
        state.taxonomySelection = (p.taxonomyNodeIds || []).slice();
        state.taxonomyActiveCategory = {}; // taxonomyId -> single active category node id
        (state.taxonomies || []).forEach(function (t) {
          if (!t.hasSubcategories) return;
          var preselected = t.nodes.find(function (n) {
            return n.children.some(function (c) { return state.taxonomySelection.indexOf(c.id) !== -1; });
          });
          if (preselected) state.taxonomyActiveCategory[t.id] = preselected.id;
        });
      }

      container.innerHTML =
        '<h5>Basic Info</h5><p class="a-modal-desc">The essentials — what this program is called and how customers discover it.</p>' +
        '<form id="wizForm">' +
        '<div class="a-form-row"><label>Program Title</label><input name="name" required value="' + esc(p.name || "") + '"></div>' +
        '<div class="a-form-row"><label>Slug (URL-friendly)</label><input name="slug" required value="' + esc(p.slug || "") + '"></div>' +
        '<div class="a-form-row"><label>Creator / Athlete / Influencer</label><input name="creator" value="' + esc(p.creator || "") + '"></div>' +
        '<div class="a-form-row"><label>Short Description</label><textarea name="description" rows="3">' + esc(p.description || "") + "</textarea>" +
        '<p style="font-size:12px;color:var(--a-text-muted);margin-top:6px;">Shown on the shop grid and product cards — one or two sentences.</p></div>' +
        '<div class="a-form-row"><label>Cover Image' + (p.imageUrl ? " (leave empty to keep current)" : "") + '</label><input type="file" name="coverImage" accept="image/*"></div>' +
        '<div class="a-form-row"><label>Thumbnail' + (p.thumbnailUrl ? " (leave empty to keep current)" : "") + '</label><input type="file" name="thumbnail" accept="image/*"></div>' +
        "</form>" +
        '<div class="a-form-row"><label>Navigation Placement</label>' +
        '<p style="font-size:12px;color:var(--a-text-muted);margin:0 0 8px;">Pick a category, then pick (or create) the specific item this program belongs to — e.g. Football → Cristiano Ronaldo. New items are saved immediately and reusable for future products.</p>' +
        '<div id="taxonomyPicker"></div>' +
        "</div>";

      var pickerEl = container.querySelector("#taxonomyPicker");

      function refreshPicker() {
        pickerEl.innerHTML = taxonomyPickerHtml(state.taxonomies, state.taxonomySelection, state.taxonomyActiveCategory);
        wirePicker();
      }

      function wirePicker() {
        pickerEl.querySelectorAll("input[type=checkbox]").forEach(function (cb) {
          cb.addEventListener("change", function () {
            var idx = state.taxonomySelection.indexOf(cb.value);
            if (cb.checked && idx === -1) state.taxonomySelection.push(cb.value);
            else if (!cb.checked && idx !== -1) state.taxonomySelection.splice(idx, 1);
            cb.closest(".a-wizard-tax-leaf").classList.toggle("is-checked", cb.checked);
          });
        });
        // Toggling a category never touches the pill row's own layout — it
        // only swaps which subpanel (if any) is rendered below the fixed
        // row, and re-clicking the already-open category closes it.
        pickerEl.querySelectorAll("[data-toggle-category]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var parts = btn.getAttribute("data-toggle-category").split(":");
            var taxId = parts[0], nodeId = parts[1];
            state.taxonomyActiveCategory[taxId] = state.taxonomyActiveCategory[taxId] === nodeId ? null : nodeId;
            refreshPicker();
          });
        });
        pickerEl.querySelectorAll("[data-add-trigger]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var parts = btn.getAttribute("data-add-trigger").split(":");
            var taxId = parts[0], parentId = parts[1] || null;
            var taxonomy = state.taxonomies.find(function (t) { return t.id === taxId; });
            // Only a true leaf is ever checkable/assignable: either this is
            // a flat taxonomy (every node is a leaf) or it's a subcategory
            // created inside an existing category. A brand-new top-level
            // category in a hierarchical taxonomy (e.g. adding a new sport)
            // is never itself selectable — it just gets opened so a leaf can
            // be added under it right away.
            var isLeafCreation = !taxonomy.hasSubcategories || !!parentId;
            beginInlineTaxonomyAdd(btn, taxId, parentId, function (data) {
              var node = data.node;
              if (isLeafCreation) {
                state.taxonomySelection.push(node.id);
                if (parentId) state.taxonomyActiveCategory[taxId] = parentId;
              } else {
                state.taxonomyActiveCategory[taxId] = node.id;
              }
              window.AdminAPI.getTaxonomy().then(function (result) {
                state.taxonomies = result.taxonomies;
                refreshPicker();
                window.AdminUI.toast('"' + node.name + '" added', "success");
              });
            });
          });
        });
      }

      refreshPicker();

      shell.standardFooter({
        save: function () {
          var form = container.querySelector("#wizForm");
          var fd = new FormData();
          fd.append("name", form.name.value);
          fd.append("slug", form.slug.value);
          fd.append("creator", form.creator.value);
          fd.append("description", form.description.value);
          if (form.coverImage.files[0]) fd.append("coverImage", form.coverImage.files[0]);
          if (form.thumbnail.files[0]) fd.append("thumbnail", form.thumbnail.files[0]);
          return window.AdminAPI.updateProduct(state.product.id, fd)
            .then(function () { return window.AdminAPI.updateProductTaxonomy(state.product.id, state.taxonomySelection); })
            .then(function (data) { state.product = data.product; });
        },
      });
    }

    // ---- Step 2: Pricing & Access ----
    function renderPricing(container, bannerHost) {
      renderMissingBanner(bannerHost, "pricing");
      var p = state.product || {};
      container.innerHTML =
        '<h5>Pricing & Access</h5><p class="a-modal-desc">How much this program costs and whether customers can see it yet.</p>' +
        '<form id="wizForm">' +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label>Price (USD)</label><input name="price" type="number" step="0.01" min="0" required value="' + (p.priceCents != null ? (p.priceCents / 100).toFixed(2) : "") + '"></div>' +
        '<div class="a-form-row"><label>Featured on storefront</label><select name="featured"><option value="false"' + (!p.featured ? " selected" : "") + '>No</option><option value="true"' + (p.featured ? " selected" : "") + ">Yes</option></select></div>" +
        "</div>" +
        '<div class="a-form-row"><label>Publish Status</label><select name="status">' +
        ["draft", "published", "archived"].map(function (s) {
          return '<option value="' + s + '"' + (p.status === s ? " selected" : "") + '>' + s.charAt(0).toUpperCase() + s.slice(1) + "</option>";
        }).join("") +
        '</select><p style="font-size:12px;color:var(--a-text-muted);margin-top:6px;">Draft programs are only visible here in Admin, never on the storefront.</p></div>' +
        '<label style="display:block;font-size:13px;font-weight:600;margin:20px 0 10px;">Access Type</label>' +
        '<div class="a-wizard-option-card selected">' +
        '<div class="a-wizard-option-icon"><i class="fa-solid fa-bolt"></i></div>' +
        '<div class="a-wizard-option-text"><strong>One-time purchase</strong><span>Customer pays once and gets permanent access to this program.</span></div>' +
        '<div class="a-wizard-option-check"><i class="fa-solid fa-circle-check"></i></div>' +
        "</div>" +
        '<div class="a-wizard-option-card disabled">' +
        '<div class="a-wizard-option-icon"><i class="fa-solid fa-arrows-rotate"></i></div>' +
        '<div class="a-wizard-option-text"><strong>Subscription</strong><span>Coming soon — recurring access billed on an interval.</span></div>' +
        "</div>" +
        "</form>";

      shell.standardFooter({
        save: function () {
          var form = container.querySelector("#wizForm");
          var fd = new FormData();
          fd.append("priceCents", Math.round((parseFloat(form.price.value) || 0) * 100));
          fd.append("featured", form.featured.value);
          fd.append("status", form.status.value);
          return window.AdminAPI.updateProduct(state.product.id, fd).then(function (data) { state.product = data.product; });
        },
      });
    }

    // ---- Step 3: Program Structure ----
    function renderStructure(container, bannerHost) {
      renderMissingBanner(bannerHost, "structure");
      var p = state.product || {};
      container.innerHTML =
        '<h5>Program Structure</h5><p class="a-modal-desc">The shape of the program — how long it runs, who it is for, and what it is meant to achieve.</p>' +
        '<form id="wizForm">' +
        '<div class="a-form-row"><label>Program Overview</label><textarea name="overview" rows="4" required>' + esc(p.overview || "") + "</textarea>" +
        "<p style=\"font-size:12px;color:var(--a-text-muted);margin-top:6px;\">The long-form intro shown at the top of the customer's program page.</p></div>" +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label>Duration (weeks)</label><input name="durationWeeks" type="number" min="1" value="' + (p.durationWeeks || "") + '"></div>' +
        '<div class="a-form-row"><label>Difficulty</label><select name="difficulty">' +
        ["", "beginner", "intermediate", "advanced"].map(function (d) {
          return '<option value="' + d + '"' + (p.difficulty === d ? " selected" : "") + '>' + (d ? d.charAt(0).toUpperCase() + d.slice(1) : "Not set") + "</option>";
        }).join("") +
        "</select></div>" +
        "</div>" +
        "</form>";

      shell.standardFooter({
        save: function () {
          var form = container.querySelector("#wizForm");
          var fd = new FormData();
          fd.append("durationWeeks", form.durationWeeks.value);
          fd.append("difficulty", form.difficulty.value);
          return window.AdminAPI.updateProduct(state.product.id, fd)
            .then(function () { return window.AdminAPI.updateProductContent(state.product.id, { overview: form.overview.value }); })
            .then(function (data) { state.product = data.product; });
        },
      });
    }

    // ---- SEO & Tags: freeform keywords, independent of taxonomy/navigation ----
    // Public sales-page carousel. Unlike every other step, this one writes
    // immediately rather than collecting into `state` for the wizard's Save:
    // each item is a real uploaded file that needs a product id to belong to,
    // and gallery rows live in their own table, so there is nothing for the
    // product PUT to carry. That means an unsaved *new* product has nowhere
    // to put media yet — hence the guard below.
    function renderGallery(container, bannerHost) {
      renderMissingBanner(bannerHost, "gallery");
      var p = state.product || {};

      if (!p.id) {
        container.innerHTML =
          "<h5>Product Gallery</h5>" +
          '<p class="a-modal-desc">Images, GIFs and short videos for the product page carousel — shown to shoppers before they buy.</p>' +
          '<div class="a-wizard-empty" style="padding:24px;text-align:center;color:var(--a-text-muted);font-size:13px;">' +
          "Save this product first, then come back to add gallery media." +
          "</div>";
        return;
      }

      container.innerHTML =
        "<h5>Product Gallery</h5>" +
        '<p class="a-modal-desc">Shown as a swipeable carousel at the top of the product page. The cover image from Basic Info is used for cards and sharing; this gallery is the product page itself. Drag to reorder — the first item is what shoppers see first.</p>' +
        '<div class="a-form-row"><label>Add media</label>' +
        '<input type="file" id="galleryFile" accept="image/png,image/jpeg,image/webp,image/gif,video/mp4,video/webm" multiple>' +
        '<p style="font-size:12px;color:var(--a-text-muted);margin-top:6px;">PNG, JPG, WebP, GIF, MP4 or WebM. Up to 30MB each. Videos play muted and looped.</p>' +
        "</div>" +
        '<div id="galleryStatus" style="font-size:13px;margin-bottom:10px;"></div>' +
        '<div id="galleryList" class="a-wizard-gallery-list"></div>';

      var listHost = container.querySelector("#galleryList");
      var statusHost = container.querySelector("#galleryStatus");
      var items = [];

      function setStatus(msg, isError) {
        statusHost.textContent = msg || "";
        statusHost.style.color = isError ? "var(--a-danger, #dc2626)" : "var(--a-text-muted)";
      }

      function itemHtml(m, i) {
        var preview = m.type === "video"
          ? '<video src="' + esc(m.url) + '" muted playsinline preload="metadata"></video>'
          : '<img src="' + esc(m.url) + '" alt="">';
        return '<li class="a-wizard-gallery-item" draggable="true" data-index="' + i + '" data-id="' + esc(m.id) + '">' +
          '<span class="a-wizard-gallery-handle" aria-hidden="true"><i class="fa-solid fa-grip-vertical"></i></span>' +
          '<span class="a-wizard-gallery-thumb">' + preview + "</span>" +
          '<span class="a-wizard-gallery-meta">' +
          '<strong>' + (i === 0 ? "First slide" : "Slide " + (i + 1)) + "</strong>" +
          '<span class="a-wizard-gallery-type">' + esc(m.type) + "</span>" +
          "</span>" +
          '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-remove-media="' + esc(m.id) + '" aria-label="Remove media"><i class="fa-solid fa-trash"></i></button>' +
          "</li>";
      }

      function rerender() {
        if (!items.length) {
          listHost.innerHTML = '<p style="color:var(--a-text-muted);font-size:13px;">No gallery media yet. The product page will fall back to the cover image.</p>';
          return;
        }
        listHost.innerHTML = '<ul class="a-wizard-gallery-ul">' + items.map(itemHtml).join("") + "</ul>";
        bindRows();
      }

      function bindRows() {
        listHost.querySelectorAll("[data-remove-media]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            var id = btn.dataset.removeMedia;
            btn.disabled = true;
            setStatus("Removing…");
            AdminAPI.deleteProductGallery(p.id, id).then(function () {
              items = items.filter(function (m) { return m.id !== id; });
              setStatus("");
              rerender();
            }).catch(function (err) {
              btn.disabled = false;
              setStatus(err.message || "Could not remove that item", true);
            });
          });
        });

        var dragFrom = null;
        listHost.querySelectorAll(".a-wizard-gallery-item").forEach(function (row) {
          row.addEventListener("dragstart", function () {
            dragFrom = parseInt(row.dataset.index, 10);
            row.classList.add("is-dragging");
          });
          row.addEventListener("dragend", function () { row.classList.remove("is-dragging"); });
          row.addEventListener("dragover", function (e) { e.preventDefault(); });
          row.addEventListener("drop", function (e) {
            e.preventDefault();
            var to = parseInt(row.dataset.index, 10);
            if (dragFrom === null || dragFrom === to) return;
            var moved = items.splice(dragFrom, 1)[0];
            items.splice(to, 0, moved);
            dragFrom = null;
            rerender();
            setStatus("Saving order…");
            AdminAPI.reorderProductGallery(p.id, items.map(function (m) { return m.id; }))
              .then(function () { setStatus(""); })
              .catch(function (err) { setStatus(err.message || "Could not save the new order", true); });
          });
        });
      }

      AdminAPI.listProductGallery(p.id).then(function (data) {
        items = data.media || [];
        rerender();
      }).catch(function () {
        listHost.innerHTML = '<p style="color:var(--a-text-muted);font-size:13px;">Could not load the gallery.</p>';
      });

      container.querySelector("#galleryFile").addEventListener("change", function (e) {
        var files = Array.prototype.slice.call(e.target.files || []);
        if (!files.length) return;
        e.target.value = "";

        // Uploaded one at a time on purpose: each response carries the row the
        // server actually created (including the order it was given), and a
        // failure part-way leaves the successful ones already saved rather
        // than rolling the whole batch back.
        var done = 0;
        (function next() {
          if (!files.length) {
            setStatus(done ? done + " item" + (done === 1 ? "" : "s") + " added" : "");
            return;
          }
          var file = files.shift();
          setStatus("Uploading " + file.name + "…");
          var fd = new FormData();
          fd.append("media", file);
          AdminAPI.uploadProductGallery(p.id, fd).then(function (data) {
            items.push(data.media);
            done += 1;
            rerender();
            next();
          }).catch(function (err) {
            setStatus(err.message || ("Could not upload " + file.name), true);
          });
        })();
      });
    }

    function renderSeoTags(container, bannerHost) {
      renderMissingBanner(bannerHost, "seoTags");
      var p = state.product || {};
      if (!state.seoTagsWorking) state.seoTagsWorking = (p.seoTags || []).slice();
      var tags = state.seoTagsWorking;

      function tagsHtml() {
        if (!tags.length) return '<span style="color:var(--a-text-muted);font-size:13px;">No tags yet.</span>';
        return tags.map(function (t, i) {
          return '<span class="a-wizard-tag-chip">' + esc(t) + '<button type="button" data-remove-tag="' + i + '" aria-label="Remove tag"><i class="fa-solid fa-xmark"></i></button></span>';
        }).join("");
      }

      container.innerHTML =
        "<h5>SEO &amp; Tags</h5><p class=\"a-modal-desc\">Freeform keywords for search relevance and structured data — separate from storefront navigation, which is set on the Basic Info step.</p>" +
        '<div class="a-form-row"><label>Tags</label>' +
        '<div class="a-wizard-tag-input-wrap"><span class="a-wizard-tag-chips" id="tagChips">' + tagsHtml() + "</span>" +
        '<input type="text" id="newTagInput" placeholder="Type a tag and press Enter…"></div>' +
        '<p style="font-size:12px;color:var(--a-text-muted);margin-top:6px;">Used for meta keywords and structured data — never shown as navigation or filters.</p>' +
        "</div>";

      function rerenderChips() {
        container.querySelector("#tagChips").innerHTML = tagsHtml();
        container.querySelectorAll("[data-remove-tag]").forEach(function (btn) {
          btn.addEventListener("click", function () {
            tags.splice(parseInt(btn.dataset.removeTag, 10), 1);
            rerenderChips();
          });
        });
      }
      rerenderChips();

      var input = container.querySelector("#newTagInput");
      input.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === ",") {
          e.preventDefault();
          var val = input.value.trim().replace(/,$/, "");
          if (val && tags.indexOf(val) === -1) tags.push(val);
          input.value = "";
          rerenderChips();
        }
      });

      shell.standardFooter({
        save: function () {
          return window.AdminAPI.updateProductContent(state.product.id, { seoTags: tags }).then(function (data) { state.product = data.product; });
        },
      });
    }

    // ---- Step 4: Training Content ----
    function renderTraining(container, bannerHost) {
      renderMissingBanner(bannerHost, "training");
      if (!state.workingTraining) {
        state.workingTraining = JSON.parse(JSON.stringify(state.product.trainingContent || { notes: "", weeks: [] }));
      }
      var tc = state.workingTraining;

      function weekHtml(week, wi) {
        var daysHtml = (week.days || []).map(function (day, di) {
          var dayBase = "weeks." + wi + ".days." + di;
          var exHtml = (day.exercises || []).map(function (ex, ei) {
            var base = dayBase + ".exercises." + ei;
            var exKey = wi + "," + di + "," + ei;
            // Demo media (GIF / short video): uploaded immediately on file
            // pick via POST /:id/media; the returned gated URL is stored on
            // the exercise itself inside trainingContent.
            var mediaHtml = ex.mediaUrl
              ? '<div class="a-wizard-media">' +
                (ex.mediaType === "video"
                  ? '<video src="' + esc(ex.mediaUrl) + '" muted loop playsinline autoplay></video>'
                  : '<img src="' + esc(ex.mediaUrl) + '" alt="">') +
                '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-remove-media="' + exKey + '">Remove demo</button>' +
                "</div>"
              : '<label class="a-btn a-btn-secondary a-btn-sm a-wizard-media-add">+ Demo GIF / video' +
                '<input type="file" hidden accept="image/gif,image/png,image/jpeg,image/webp,video/mp4,video/webm" data-media-exercise="' + exKey + '">' +
                "</label>";
            return (
              '<div class="a-wizard-repeat-item">' +
              '<button type="button" class="a-wizard-remove" data-remove-exercise="' + exKey + '"><i class="fa-solid fa-xmark"></i></button>' +
              '<div class="a-form-grid">' +
              '<div class="a-form-row"><label>Exercise Name</label><input data-field="' + base + '.name" value="' + esc(ex.name || "") + '"></div>' +
              '<div class="a-form-row"><label>Sets x Reps</label><input data-field="' + base + '.reps" value="' + esc(ex.reps || "") + '" placeholder="e.g. 3x10"></div>' +
              "</div>" +
              '<div class="a-form-row"><label>Notes</label><input data-field="' + base + '.notes" value="' + esc(ex.notes || "") + '"></div>' +
              '<div class="a-form-row"><label>Substitutions</label><input data-field="' + base + '.substitutions" value="' + esc(ex.substitutions || "") + '"></div>' +
              mediaHtml +
              "</div>"
            );
          }).join("");
          return (
            '<div class="a-wizard-repeat-item">' +
            '<button type="button" class="a-wizard-remove" data-remove-day="' + wi + "," + di + '"><i class="fa-solid fa-xmark"></i></button>' +
            '<div class="a-form-row"><label>Day Title</label><input data-field="' + dayBase + '.title" value="' + esc(day.title || "") + '"></div>' +
            '<div class="a-form-row"><label>Day Notes</label><textarea rows="2" data-field="' + dayBase + '.notes">' + esc(day.notes || "") + "</textarea></div>" +
            '<h6 style="font-size:12px;color:var(--a-text-muted);">Exercises</h6>' + exHtml +
            '<button type="button" class="a-btn a-btn-secondary a-btn-sm a-wizard-add-btn" data-add-exercise="' + wi + "," + di + '">+ Add Exercise</button>' +
            "</div>"
          );
        }).join("");
        return (
          '<div class="a-wizard-repeat-item" style="border-color:var(--a-primary);">' +
          '<button type="button" class="a-wizard-remove" data-remove-week="' + wi + '"><i class="fa-solid fa-xmark"></i></button>' +
          '<div class="a-form-row"><label>Week Title</label><input data-field="weeks.' + wi + '.title" value="' + esc(week.title || "") + '"></div>' +
          daysHtml +
          '<button type="button" class="a-btn a-btn-secondary a-btn-sm a-wizard-add-btn" data-add-day="' + wi + '">+ Add Day</button>' +
          "</div>"
        );
      }

      container.innerHTML =
        '<h5>Training Content</h5><p class="a-modal-desc">Break the program into weeks, workout days, and exercises. Skip this if the program is nutrition-only.</p>' +
        '<div class="a-form-row"><label>Program Notes</label><textarea id="trainingNotes" rows="3" placeholder="General training guidance shown above the weekly breakdown">' + esc(tc.notes || "") + "</textarea></div>" +
        '<div id="weeksHost">' + (tc.weeks || []).map(weekHtml).join("") + "</div>" +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm a-wizard-add-btn" id="addWeekBtn">+ Add Week</button>';

      function rerenderWeeks() {
        container.querySelector("#weeksHost").innerHTML = (tc.weeks || []).map(weekHtml).join("");
        bindWeekEvents();
      }
      function bindWeekEvents() {
        container.querySelectorAll("#weeksHost [data-field]").forEach(function (el) {
          el.addEventListener("input", function () { setPath(tc, el.dataset.field, el.value); });
        });
        container.querySelectorAll("[data-add-day]").forEach(function (el) {
          el.addEventListener("click", function () {
            var wi = parseInt(el.dataset.addDay, 10);
            tc.weeks[wi].days = tc.weeks[wi].days || [];
            tc.weeks[wi].days.push({ id: uid(), title: "", notes: "", exercises: [] });
            rerenderWeeks();
          });
        });
        container.querySelectorAll("[data-add-exercise]").forEach(function (el) {
          el.addEventListener("click", function () {
            var parts = el.dataset.addExercise.split(",").map(Number);
            var day = tc.weeks[parts[0]].days[parts[1]];
            day.exercises = day.exercises || [];
            day.exercises.push({ id: uid(), name: "", sets: "", reps: "", notes: "", substitutions: "" });
            rerenderWeeks();
          });
        });
        container.querySelectorAll("[data-remove-week]").forEach(function (el) {
          el.addEventListener("click", function () { tc.weeks.splice(parseInt(el.dataset.removeWeek, 10), 1); rerenderWeeks(); });
        });
        container.querySelectorAll("[data-remove-day]").forEach(function (el) {
          el.addEventListener("click", function () {
            var parts = el.dataset.removeDay.split(",").map(Number);
            tc.weeks[parts[0]].days.splice(parts[1], 1);
            rerenderWeeks();
          });
        });
        container.querySelectorAll("[data-remove-exercise]").forEach(function (el) {
          el.addEventListener("click", function () {
            var parts = el.dataset.removeExercise.split(",").map(Number);
            tc.weeks[parts[0]].days[parts[1]].exercises.splice(parts[2], 1);
            rerenderWeeks();
          });
        });
        container.querySelectorAll("[data-media-exercise]").forEach(function (el) {
          el.addEventListener("change", function () {
            var file = el.files[0];
            if (!file) return;
            var parts = el.dataset.mediaExercise.split(",").map(Number);
            var ex = tc.weeks[parts[0]].days[parts[1]].exercises[parts[2]];
            var label = el.closest("label");
            label.classList.add("is-loading");
            var fd = new FormData();
            fd.append("media", file);
            window.AdminAPI.uploadProductMedia(state.product.id, fd).then(function (data) {
              ex.mediaUrl = data.url;
              ex.mediaType = data.mediaType;
              rerenderWeeks();
              window.AdminUI.toast("Demo uploaded — remember to Save Draft", "success");
            }).catch(function (err) {
              label.classList.remove("is-loading");
              window.AdminUI.toast(err.message || "Upload failed", "error");
            });
          });
        });
        container.querySelectorAll("[data-remove-media]").forEach(function (el) {
          el.addEventListener("click", function () {
            var parts = el.dataset.removeMedia.split(",").map(Number);
            var ex = tc.weeks[parts[0]].days[parts[1]].exercises[parts[2]];
            delete ex.mediaUrl;
            delete ex.mediaType;
            rerenderWeeks();
          });
        });
      }
      bindWeekEvents();
      container.querySelector("#trainingNotes").addEventListener("input", function (e) { tc.notes = e.target.value; });
      container.querySelector("#addWeekBtn").addEventListener("click", function () {
        tc.weeks = tc.weeks || [];
        tc.weeks.push({ id: uid(), title: "Week " + (tc.weeks.length + 1), days: [] });
        rerenderWeeks();
      });

      shell.standardFooter({
        save: function () {
          return window.AdminAPI.updateProductContent(state.product.id, { trainingContent: tc }).then(function (data) { state.product = data.product; });
        },
      });
    }

    // ---- Step 5: Nutrition Content ----
    function renderNutrition(container, bannerHost) {
      renderMissingBanner(bannerHost, "nutrition");
      if (!state.workingNutrition) {
        state.workingNutrition = JSON.parse(JSON.stringify(state.product.nutritionContent || { notes: "", meals: [] }));
      }
      var nc = state.workingNutrition;

      function mealHtml(meal, mi) {
        var base = "meals." + mi;
        return (
          '<div class="a-wizard-repeat-item">' +
          '<button type="button" class="a-wizard-remove" data-remove-meal="' + mi + '"><i class="fa-solid fa-xmark"></i></button>' +
          '<div class="a-form-grid">' +
          '<div class="a-form-row"><label>Meal Name</label><input data-field="' + base + '.name" value="' + esc(meal.name || "") + '"></div>' +
          '<div class="a-form-row"><label>Macros</label><input data-field="' + base + '.macros" value="' + esc(meal.macros || "") + '" placeholder="e.g. 40P / 50C / 15F"></div>' +
          "</div>" +
          '<div class="a-form-row"><label>Ingredients</label><textarea rows="2" data-field="' + base + '.ingredients">' + esc(meal.ingredients || "") + "</textarea></div>" +
          '<div class="a-form-row"><label>Notes</label><textarea rows="2" data-field="' + base + '.notes">' + esc(meal.notes || "") + "</textarea></div>" +
          "</div>"
        );
      }

      container.innerHTML =
        '<h5>Nutrition Content</h5><p class="a-modal-desc">Meal structure and food guidance. Skip this if the program is training-only.</p>' +
        '<div class="a-form-row"><label>Program Notes</label><textarea id="nutritionNotes" rows="3" placeholder="Calorie/macro guidance, restrictions, general notes">' + esc(nc.notes || "") + "</textarea></div>" +
        '<div id="mealsHost">' + (nc.meals || []).map(mealHtml).join("") + "</div>" +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm a-wizard-add-btn" id="addMealBtn">+ Add Meal</button>';

      function rerenderMeals() {
        container.querySelector("#mealsHost").innerHTML = (nc.meals || []).map(mealHtml).join("");
        bindMealEvents();
      }
      function bindMealEvents() {
        container.querySelectorAll("#mealsHost [data-field]").forEach(function (el) {
          el.addEventListener("input", function () { setPath(nc, el.dataset.field, el.value); });
        });
        container.querySelectorAll("[data-remove-meal]").forEach(function (el) {
          el.addEventListener("click", function () { nc.meals.splice(parseInt(el.dataset.removeMeal, 10), 1); rerenderMeals(); });
        });
      }
      bindMealEvents();
      container.querySelector("#nutritionNotes").addEventListener("input", function (e) { nc.notes = e.target.value; });
      container.querySelector("#addMealBtn").addEventListener("click", function () {
        nc.meals = nc.meals || [];
        nc.meals.push({ id: uid(), name: "", macros: "", ingredients: "", notes: "" });
        rerenderMeals();
      });

      shell.standardFooter({
        save: function () {
          return window.AdminAPI.updateProductContent(state.product.id, { nutritionContent: nc }).then(function (data) { state.product = data.product; });
        },
      });
    }

    // ---- Step 6: FAQ & Bonus ----
    function renderFaqBonus(container, bannerHost) {
      renderMissingBanner(bannerHost, "faqBonus");
      var p = state.product;

      function faqRow(faq) {
        return (
          '<div class="a-wizard-repeat-item" data-faq="' + faq.id + '">' +
          '<button type="button" class="a-wizard-remove" data-remove-faq="' + faq.id + '"><i class="fa-solid fa-xmark"></i></button>' +
          '<div class="a-form-row"><label>Question</label><input class="faq-q" value="' + esc(faq.question) + '"></div>' +
          '<div class="a-form-row"><label>Answer</label><textarea rows="2" class="faq-a">' + esc(faq.answer) + "</textarea></div>" +
          '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-save-faq="' + faq.id + '">Save</button>' +
          "</div>"
        );
      }
      function resourceRow(r) {
        return (
          '<div class="a-wizard-repeat-item">' +
          '<button type="button" class="a-wizard-remove" data-remove-resource="' + r.id + '"><i class="fa-solid fa-xmark"></i></button>' +
          "<strong>" + esc(r.title) + '</strong><div style="font-size:12px;color:var(--a-text-muted);">' + (r.type === "link" ? "Link — " + esc(r.url || "") : "File") + "</div>" +
          "</div>"
        );
      }

      container.innerHTML =
        "<h5>FAQ &amp; Bonus Content</h5><p class=\"a-modal-desc\">Answer common questions and add any optional extras — never the core product itself, just bonus material.</p>" +
        '<h6 style="font-size:13px;margin:0 0 10px;">FAQs</h6>' +
        '<div id="faqHost">' + (p.faqs || []).map(faqRow).join("") + "</div>" +
        '<div class="a-wizard-repeat-item"><div class="a-form-row"><label>New Question</label><input id="newFaqQ"></div>' +
        '<div class="a-form-row"><label>New Answer</label><textarea id="newFaqA" rows="2"></textarea></div>' +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm" id="addFaqBtn">+ Add FAQ</button></div>' +
        '<h6 style="font-size:13px;margin:24px 0 10px;">Bonus Resources (optional)</h6>' +
        '<div id="resourceHost">' + (p.resources || []).map(resourceRow).join("") + "</div>" +
        '<div class="a-wizard-repeat-item">' +
        '<div class="a-form-row"><label>Title</label><input id="newResTitle"></div>' +
        '<div class="a-form-grid"><div class="a-form-row"><label>Type</label><select id="newResType"><option value="file">File</option><option value="link">Link</option></select></div>' +
        '<div class="a-form-row"><label>Description</label><input id="newResDesc"></div></div>' +
        '<div class="a-form-row" id="newResFileRow"><label>File</label><input type="file" id="newResFile"></div>' +
        '<div class="a-form-row" id="newResUrlRow" style="display:none;"><label>URL</label><input id="newResUrl" placeholder="https://…"></div>' +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm" id="addResourceBtn">+ Add Resource</button>' +
        "</div>" +
        '<div class="a-form-row" style="margin-top:20px;"><label>Bonus Notes</label><textarea id="bonusNotes" rows="3" placeholder="Any freeform bonus guidance shown to customers">' + esc(p.bonusNotes || "") + "</textarea></div>";

      container.querySelector("#newResType").addEventListener("change", function (e) {
        var isLink = e.target.value === "link";
        container.querySelector("#newResFileRow").style.display = isLink ? "none" : "";
        container.querySelector("#newResUrlRow").style.display = isLink ? "" : "none";
      });

      function refreshFromServer() {
        return window.AdminAPI.getProduct(p.id).then(function (data) {
          state.product = data.product;
          renderMissingBanner(bannerHost, "faqBonus");
          renderFaqBonus(container, bannerHost);
          shell.refreshSteps();
        });
      }

      container.querySelector("#addFaqBtn").addEventListener("click", function () {
        var q = container.querySelector("#newFaqQ").value.trim();
        var a = container.querySelector("#newFaqA").value.trim();
        if (!q || !a) return window.AdminUI.toast("Question and answer are required", "error");
        window.AdminAPI.createProductFaq(p.id, { question: q, answer: a }).then(refreshFromServer).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
      });
      container.querySelectorAll("[data-remove-faq]").forEach(function (el) {
        el.addEventListener("click", function () {
          window.AdminAPI.deleteProductFaq(p.id, el.dataset.removeFaq).then(refreshFromServer).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
        });
      });
      container.querySelectorAll("[data-save-faq]").forEach(function (el) {
        el.addEventListener("click", function () {
          var row = container.querySelector('[data-faq="' + el.dataset.saveFaq + '"]');
          var q = row.querySelector(".faq-q").value.trim();
          var a = row.querySelector(".faq-a").value.trim();
          window.AdminAPI.updateProductFaq(p.id, el.dataset.saveFaq, { question: q, answer: a })
            .then(function () { window.AdminUI.toast("FAQ saved", "success"); })
            .catch(function (err) { window.AdminUI.toast(err.message, "error"); });
        });
      });
      container.querySelectorAll("[data-remove-resource]").forEach(function (el) {
        el.addEventListener("click", function () {
          window.AdminAPI.deleteProductResource(p.id, el.dataset.removeResource).then(refreshFromServer).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
        });
      });
      container.querySelector("#addResourceBtn").addEventListener("click", function () {
        var title = container.querySelector("#newResTitle").value.trim();
        var type = container.querySelector("#newResType").value;
        var description = container.querySelector("#newResDesc").value.trim();
        if (!title) return window.AdminUI.toast("Title is required", "error");
        var fd = new FormData();
        fd.append("title", title);
        fd.append("type", type);
        fd.append("description", description);
        if (type === "file") {
          var file = container.querySelector("#newResFile").files[0];
          if (!file) return window.AdminUI.toast("Choose a file", "error");
          fd.append("resourceFile", file);
        } else {
          var url = container.querySelector("#newResUrl").value.trim();
          if (!url) return window.AdminUI.toast("Enter a URL", "error");
          fd.append("url", url);
        }
        window.AdminAPI.createProductResource(p.id, fd).then(refreshFromServer).catch(function (err) { window.AdminUI.toast(err.message, "error"); });
      });

      shell.standardFooter({
        save: function () {
          var bonusNotes = container.querySelector("#bonusNotes").value;
          return window.AdminAPI.updateProductContent(state.product.id, { bonusNotes: bonusNotes }).then(function (data) { state.product = data.product; });
        },
      });
    }

    // ---- Step 7: Preview & Publish ----
    function renderPreview(container) {
      var p = state.product;
      var progress = p.wizardProgress || {};
      var missingKeys = Object.keys(progress).filter(function (k) { return k !== "preview" && !progress[k]; });

      container.innerHTML =
        "<h5>Preview &amp; Publish</h5><p class=\"a-modal-desc\">A final look before this program goes live.</p>" +
        '<div id="publishValidation"></div>' +
        // Customer Preview Mode: opens the real gated program page
        // (program.html) — the server lets admins through without a
        // purchase — so this is a true pre-ads QA pass on the exact page
        // a paying customer lands on, including on a phone.
        '<div class="a-wizard-preview-section"><h6>Customer Preview</h6>' +
        '<p style="font-size:13px;color:var(--a-text-muted);">Open the exact program page a customer sees after buying — check it on your phone before running ads.</p>' +
        '<a class="a-btn a-btn-primary a-btn-sm" href="/my-library/' + encodeURIComponent(p.id) + '" target="_blank" rel="noopener"><i class="fa-regular fa-eye" style="margin-right:6px;"></i>View as Customer</a></div>' +
        '<div class="a-wizard-preview-section"><h6>Overview</h6>' +
        "<p><strong>" + esc(p.name) + "</strong> — " + window.AdminUI.formatCents(p.priceCents || 0) + "</p>" +
        '<p style="font-size:13px;color:var(--a-text-muted);">' + esc(p.creator ? "By " + p.creator + " · " : "") + esc((p.taxonomyPaths || []).join(" · ")) + (p.durationWeeks ? " · " + p.durationWeeks + " weeks" : "") + (p.difficulty ? " · " + p.difficulty : "") + "</p>" +
        '<p style="font-size:13px;">' + esc(p.overview || "No overview written yet.") + "</p></div>" +
        '<div class="a-wizard-preview-section"><h6>Content</h6><p style="font-size:13px;">' +
        (((p.trainingContent && p.trainingContent.weeks) || []).length + " training week(s) · ") +
        (((p.nutritionContent && p.nutritionContent.meals) || []).length + " meal(s) · ") +
        ((p.faqs || []).length + " FAQ(s) · ") +
        ((p.resources || []).length + " bonus resource(s) · ") +
        ((p.seoTags || []).length + " SEO tag(s)") +
        "</p></div>";

      renderPublishSummary(container.querySelector("#publishValidation"), missingKeys, false);

      // Nothing on this step is user-editable, so there's nothing to
      // autosave — but every step must set a save handler so a sidebar
      // click away from Preview has something (harmless) to call.
      shell.setSaveHandler(function () { return Promise.resolve(); });

      shell.footerEl.innerHTML =
        '<div class="a-wizard-actions">' +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-act="cancel">Close</button>' +
        '<div class="a-wizard-actions-right">' +
        '<button type="button" class="a-btn a-btn-secondary" data-act="back">Back</button>' +
        '<button type="button" class="a-btn a-btn-secondary" data-act="save-draft-status">Save as Draft</button>' +
        '<button type="button" class="a-btn a-btn-primary" data-act="publish">Publish</button>' +
        "</div></div>";

      shell.footerEl.querySelector('[data-act="cancel"]').addEventListener("click", shell.requestClose);
      shell.footerEl.querySelector('[data-act="back"]').addEventListener("click", function () { shell.start(shell.getStepIndex() - 1); });
      shell.footerEl.querySelector('[data-act="save-draft-status"]').addEventListener("click", function (e) {
        var btn = e.currentTarget;
        btn.classList.add("is-loading");
        btn.disabled = true;
        var fd = new FormData();
        fd.append("status", "draft");
        window.AdminAPI.updateProduct(p.id, fd).then(function (data) {
          state.product = data.product;
          shell.markSaved();
          window.AdminUI.toast("Saved as draft", "success");
          shell.refreshSteps();
        }).catch(function (err) {
          window.AdminUI.toast(err.message, "error");
        }).finally(function () {
          btn.classList.remove("is-loading");
          btn.disabled = false;
        });
      });
      shell.footerEl.querySelector('[data-act="publish"]').addEventListener("click", function (e) {
        // Full validation runs here, at the one hard gate in the whole
        // wizard — everywhere else navigation stays free.
        var freshProgress = state.product.wizardProgress || {};
        var freshMissing = Object.keys(freshProgress).filter(function (k) { return k !== "preview" && !freshProgress[k]; });
        if (freshMissing.length) {
          renderPublishSummary(container.querySelector("#publishValidation"), freshMissing, true);
          window.AdminUI.toast("Finish the missing sections before publishing", "error");
          return;
        }
        var btn = e.currentTarget;
        btn.classList.add("is-loading");
        btn.disabled = true;
        var fd = new FormData();
        fd.append("status", "published");
        window.AdminAPI.updateProduct(p.id, fd).then(function (data) {
          state.product = data.product;
          window.AdminUI.toast("Product published", "success");
          shell.close(state.product);
        }).catch(function (err) {
          window.AdminUI.toast(err.message, "error");
          btn.classList.remove("is-loading");
          btn.disabled = false;
        });
      });

      function renderPublishSummary(host, keys, emphasize) {
        if (!keys.length) {
          host.innerHTML = alertHtml("success", "fa-circle-check", "<strong>Ready to publish</strong><p>Everything required looks complete.</p>");
          return;
        }
        host.innerHTML = alertHtml(
          "error",
          "fa-triangle-exclamation",
          "<strong>Not ready to publish yet</strong><p>These sections still need required information:</p>" +
          '<ul class="a-wizard-fix-list">' +
          keys.map(function (k) {
            var stepIdx = STEPS.findIndex(function (s) { return s.key === k; });
            return '<li><a href="#" data-fix-step="' + stepIdx + '">' + STEP_LABELS[k] + "</a></li>";
          }).join("") +
          "</ul>"
        );
        if (emphasize) {
          host.firstChild.classList.add("a-wizard-alert-shake");
        }
        host.querySelectorAll("[data-fix-step]").forEach(function (a) {
          a.addEventListener("click", function (e) {
            e.preventDefault();
            shell.start(parseInt(a.dataset.fixStep, 10));
          });
        });
      }
    }

    // A draft is created the instant the wizard opens (even before Basic
    // Info is filled in) so every sidebar step is clickable from frame one —
    // there is no "finish step 1 to unlock the rest" gate.
    var taxonomyPromise = window.AdminAPI.getTaxonomy().then(function (data) { return data.taxonomies; }).catch(function () { return []; });

    if (productId) {
      Promise.all([window.AdminAPI.getProduct(productId), taxonomyPromise]).then(function (results) {
        state.product = results[0].product;
        state.taxonomies = results[1];
        shell.start(0);
      }).catch(function (err) {
        window.AdminUI.toast(err.message, "error");
        shell.close(null);
      });
    } else {
      var fd = new FormData();
      fd.append("name", "Untitled Program");
      fd.append("slug", "untitled-" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
      Promise.all([window.AdminAPI.createProduct(fd), taxonomyPromise]).then(function (results) {
        state.product = results[0].product;
        state.taxonomies = results[1];
        shell.start(0);
      }).catch(function (err) {
        window.AdminUI.toast(err.message, "error");
        shell.close(null);
      });
    }
  }

  return { open: open };
})();
