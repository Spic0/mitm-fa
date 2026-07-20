// Step-by-step Setup Wizard for creating/editing a promotion. Replaces the
// old single-modal create/edit form in promotions.js (still a giant technical
// form with every field visible at once). Unlike the Product wizard, a
// promotion is never partially created server-side — the whole draft lives
// in local state and only ever hits the API once, on the Review step's
// Create/Save Changes button. That also makes the "unsaved changes" story
// simpler: `state.dirty` just tracks whether anything has been typed since
// the wizard opened, and closing while dirty asks for confirmation.
//
// Shell layout is intentionally identical to AdminProductWizard's — same
// fixed-height modal, step rail, scrollable body, pinned footer — so the two
// wizards feel like one system rather than two different ones bolted together.
window.AdminPromotionWizard = (function () {
  var STEPS = [
    { key: "type", label: "Promotion Type" },
    { key: "code", label: "Code & Schedule" },
    { key: "discount", label: "Discount & Eligibility" },
    { key: "influencer", label: "Influencer" },
    { key: "review", label: "Review" },
  ];

  var DISCOUNT_TYPES = [
    { value: "PERCENTAGE", label: "Percentage", desc: "e.g. 20% off the order", icon: "fa-percent" },
    { value: "FIXED_AMOUNT", label: "Fixed Amount", desc: "e.g. $10 off the order", icon: "fa-dollar-sign" },
    { value: "FREE_PRODUCT", label: "Free Product", desc: "Gift one product for free", icon: "fa-gift" },
  ];

  function esc(s) { return window.AdminUI.escapeHtml(s); }

  function defaultDraft() {
    return {
      code: "", name: "", description: "",
      discountType: "PERCENTAGE", discountValue: "", maxDiscountCents: "", freeProductId: "",
      maxUses: "", maxUsesPerCustomer: "", minSpendCents: "",
      activatesAt: "", expiresAt: "", timezone: "UTC", status: "enabled",
      firstPurchaseOnly: false, singleUse: false, stackable: false, autoApply: false,
      codeKind: "STANDARD", influencerId: "",
      productIds: [], categoryIds: [], userEmails: [],
    };
  }

  function draftFromPromotion(p) {
    return {
      code: p.code || "", name: p.name || "", description: p.description || "",
      discountType: p.discountType || "PERCENTAGE",
      discountValue: p.discountType === "FIXED_AMOUNT" ? ((p.discountValue || 0) / 100) : (p.discountValue != null ? p.discountValue : ""),
      maxDiscountCents: p.maxDiscountCents != null ? (p.maxDiscountCents / 100) : "",
      freeProductId: p.freeProductId || "",
      maxUses: p.maxUses != null ? p.maxUses : "",
      maxUsesPerCustomer: p.maxUsesPerCustomer != null ? p.maxUsesPerCustomer : "",
      minSpendCents: p.minSpendCents != null ? (p.minSpendCents / 100) : "",
      activatesAt: toLocalInput(p.activatesAt), expiresAt: toLocalInput(p.expiresAt),
      timezone: p.timezone || "UTC", status: p.status || "enabled",
      firstPurchaseOnly: !!p.firstPurchaseOnly, singleUse: !!p.singleUse, stackable: !!p.stackable, autoApply: !!p.autoApply,
      codeKind: p.codeKind || "STANDARD", influencerId: (p.influencer && p.influencer.id) || "",
      productIds: (p.products || []).slice(), categoryIds: (p.categories || []).slice(), userEmails: (p.userEmails || []).slice(),
    };
  }

  function toLocalInput(iso) {
    if (!iso) return "";
    var d = new Date(iso);
    var pad = function (n) { return String(n).padStart(2, "0"); };
    return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + "T" + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }

  function flattenTaxonomy(taxonomies) {
    var out = [];
    function walk(node, trail) {
      out.push({ id: node.id, label: trail.concat(node.name).join(" > ") });
      (node.children || []).forEach(function (child) { walk(child, trail.concat(node.name)); });
    }
    (taxonomies || []).forEach(function (t) { (t.nodes || []).forEach(function (n) { walk(n, [t.label]); }); });
    return out;
  }

  function alertHtml(variant, iconClass, bodyHtml) {
    return '<div class="a-wizard-alert a-wizard-alert-' + variant + '"><i class="fa-solid ' + iconClass + '"></i><div>' + bodyHtml + "</div></div>";
  }

  function payloadFromDraft(d) {
    var payload = {
      code: d.code.trim(), name: d.name.trim(), description: d.description.trim() || null,
      discountType: d.discountType, codeKind: d.codeKind, status: d.status, timezone: d.timezone,
      firstPurchaseOnly: d.firstPurchaseOnly, singleUse: d.singleUse, stackable: d.stackable, autoApply: d.autoApply,
    };
    if (d.discountType === "FIXED_AMOUNT") payload.discountValue = Math.round(parseFloat(d.discountValue || "0") * 100);
    else if (d.discountType === "PERCENTAGE") payload.discountValue = Math.round(parseFloat(d.discountValue || "0"));
    else { payload.discountValue = 0; payload.freeProductId = d.freeProductId || null; }
    payload.maxDiscountCents = d.maxDiscountCents !== "" ? Math.round(parseFloat(d.maxDiscountCents) * 100) : null;
    payload.minSpendCents = d.minSpendCents !== "" ? Math.round(parseFloat(d.minSpendCents) * 100) : null;
    payload.maxUses = d.maxUses !== "" ? d.maxUses : null;
    payload.maxUsesPerCustomer = d.maxUsesPerCustomer !== "" ? d.maxUsesPerCustomer : null;
    payload.activatesAt = d.activatesAt ? new Date(d.activatesAt).toISOString() : null;
    payload.expiresAt = d.expiresAt ? new Date(d.expiresAt).toISOString() : null;
    payload.influencerId = d.influencerId || null;
    payload.productIds = d.productIds;
    payload.categoryIds = d.categoryIds;
    payload.userEmails = d.userEmails;
    return payload;
  }

  function open(promotionId, onDone) {
    var state = {
      draft: defaultDraft(), stepIndex: 0, dirty: false, isEdit: !!promotionId,
      products: [], categories: [], influencers: [], productsOpen: false, categoriesOpen: false,
    };

    var backdrop = document.createElement("div");
    backdrop.className = "a-modal-backdrop";
    backdrop.innerHTML =
      '<div class="a-modal a-wizard">' +
      '<button type="button" class="a-wizard-close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>' +
      '<div class="a-wizard-steps"></div>' +
      '<div class="a-wizard-main">' +
      '<div class="a-wizard-body"><div class="a-wizard-step-content a-wizard-loading">Loading…</div></div>' +
      '<div class="a-wizard-footer"></div>' +
      "</div></div>";
    window.AdminUI.openModal(backdrop);
    var stepsEl = backdrop.querySelector(".a-wizard-steps");
    var bodyEl = backdrop.querySelector(".a-wizard-body");
    var footerEl = backdrop.querySelector(".a-wizard-footer");

    // Any input/change anywhere in the body marks the draft dirty — attached
    // to the body's stable container (not the per-step content, which is
    // torn down and recreated on every step change) so it survives step
    // navigation without needing to be rewired each time.
    bodyEl.addEventListener("input", function () { state.dirty = true; });
    bodyEl.addEventListener("change", function () { state.dirty = true; });

    function close() {
      window.AdminUI.closeModal(backdrop);
      if (onDone) onDone(state.result || null);
    }
    function requestClose() {
      if (!state.dirty) return close();
      window.AdminUI.confirmDialog({
        title: "Discard changes?",
        message: state.isEdit
          ? "Your changes to this promotion haven't been saved yet."
          : "This promotion hasn't been created yet — everything entered will be lost.",
        confirmLabel: "Discard",
        danger: true,
      }).then(function (ok) { if (ok) close(); });
    }
    backdrop.querySelector(".a-wizard-close").addEventListener("click", requestClose);

    function renderSteps() {
      stepsEl.innerHTML = STEPS.map(function (s, i) {
        var cls = "a-wizard-step" + (i === state.stepIndex ? " active" : "") + (i < state.stepIndex ? " complete" : "");
        var icon = i < state.stepIndex ? "fa-circle-check" : "fa-circle";
        return '<div class="' + cls + '" data-step="' + i + '"><span class="a-wizard-step-icon"><i class="fa-solid ' + icon + '"></i></span>' + esc(s.label) + "</div>";
      }).join("");
      stepsEl.querySelectorAll("[data-step]").forEach(function (el) {
        el.addEventListener("click", function () {
          var idx = parseInt(el.dataset.step, 10);
          if (idx <= state.stepIndex) goToStep(idx); // only ever hop backward by clicking the rail — forward requires passing Next's validation
        });
      });
    }

    function goToStep(idx) {
      state.stepIndex = idx;
      renderSteps();
      renderBody();
    }

    function renderBody() {
      var wrapper = document.createElement("div");
      wrapper.className = "a-wizard-step-content";
      bodyEl.innerHTML = "";
      bodyEl.appendChild(wrapper);
      bodyEl.scrollTop = 0;
      var key = STEPS[state.stepIndex].key;
      if (key === "type") renderTypeStep(wrapper);
      else if (key === "code") renderCodeStep(wrapper);
      else if (key === "discount") renderDiscountStep(wrapper);
      else if (key === "influencer") renderInfluencerStep(wrapper);
      else if (key === "review") renderReviewStep(wrapper);
    }

    // Footer shared by every step except Review — Close / Back / Next.
    function renderStepFooter(opts) {
      footerEl.innerHTML =
        '<div class="a-wizard-actions">' +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-act="cancel">Close</button>' +
        '<div style="display:flex;gap:10px;">' +
        (state.stepIndex > 0 ? '<button type="button" class="a-btn a-btn-secondary" data-act="back">Back</button>' : "") +
        '<button type="button" class="a-btn a-btn-primary" data-act="next">Next</button>' +
        "</div></div>";
      footerEl.querySelector('[data-act="cancel"]').addEventListener("click", requestClose);
      var backBtn = footerEl.querySelector('[data-act="back"]');
      if (backBtn) backBtn.addEventListener("click", function () { goToStep(state.stepIndex - 1); });
      footerEl.querySelector('[data-act="next"]').addEventListener("click", function () {
        var error = opts.validate ? opts.validate() : null;
        if (error) {
          window.AdminUI.toast(error, "error");
          var alertHost = bodyEl.querySelector(".a-wizard-step-content");
          if (alertHost) { alertHost.classList.remove("a-wizard-alert-shake"); void alertHost.offsetWidth; alertHost.classList.add("a-wizard-alert-shake"); }
          return;
        }
        goToStep(state.stepIndex + 1);
      });
    }

    // ---- Step 1: Promotion Type ----
    function renderTypeStep(container) {
      var d = state.draft;
      container.innerHTML =
        "<h5>Promotion Type</h5><p class=\"a-modal-desc\">What kind of discount does this promotion give?</p>" +
        '<div class="a-wizard-type-grid">' +
        DISCOUNT_TYPES.map(function (t) {
          var selected = d.discountType === t.value;
          return (
            '<div class="a-wizard-option-card' + (selected ? " selected" : "") + '" data-type="' + t.value + '">' +
            '<div class="a-wizard-option-icon"><i class="fa-solid ' + t.icon + '"></i></div>' +
            '<div class="a-wizard-option-text"><strong>' + t.label + "</strong><span>" + t.desc + "</span></div>" +
            '<div class="a-wizard-option-check"><i class="fa-solid fa-circle-check"></i></div>' +
            "</div>"
          );
        }).join("") +
        "</div>";
      container.querySelectorAll("[data-type]").forEach(function (card) {
        card.addEventListener("click", function () {
          d.discountType = card.dataset.type;
          state.dirty = true;
          renderTypeStep(container);
        });
      });
      renderStepFooter({});
    }

    // ---- Step 2: Code & Schedule ----
    function renderCodeStep(container) {
      var d = state.draft;
      container.innerHTML =
        "<h5>Code &amp; Schedule</h5><p class=\"a-modal-desc\">The code customers enter, and when/how often it can be used.</p>" +
        '<form id="wizCodeForm">' +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label>Promo Code</label><input name="code" required value="' + esc(d.code) + '" placeholder="SUMMER20"></div>' +
        '<div class="a-form-row"><label>Internal Name</label><input name="name" required value="' + esc(d.name) + '" placeholder="Summer Sale 20%"></div>' +
        "</div>" +
        '<div class="a-form-row"><label>Description (optional)</label><textarea name="description" rows="2">' + esc(d.description) + "</textarea></div>" +
        "<h6>Schedule</h6>" +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label>Activation Date</label><input name="activatesAt" type="datetime-local" value="' + d.activatesAt + '"></div>' +
        '<div class="a-form-row"><label>Expiration Date</label><input name="expiresAt" type="datetime-local" value="' + d.expiresAt + '"></div>' +
        "</div>" +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label>Timezone</label><select name="timezone">' +
        ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Australia/Sydney"].map(function (tz) {
          return '<option value="' + tz + '"' + (d.timezone === tz ? " selected" : "") + ">" + tz + "</option>";
        }).join("") +
        "</select></div>" +
        '<div class="a-form-row"><label>Status</label><select name="status">' +
        '<option value="enabled"' + (d.status === "enabled" ? " selected" : "") + ">Enabled</option>" +
        '<option value="disabled"' + (d.status === "disabled" ? " selected" : "") + ">Disabled</option>" +
        "</select></div>" +
        "</div>" +
        "<h6>Usage Limit</h6>" +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label>Maximum Uses (total)</label><input name="maxUses" type="number" min="0" value="' + esc(String(d.maxUses)) + '" placeholder="Unlimited"></div>' +
        '<div class="a-form-row"><label>Maximum Uses Per Customer</label><input name="maxUsesPerCustomer" type="number" min="0" value="' + esc(String(d.maxUsesPerCustomer)) + '" placeholder="Unlimited"></div>' +
        "</div>" +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label><input type="checkbox" name="singleUse" ' + (d.singleUse ? "checked" : "") + "> Single use (one redemption, globally, then it's spent)</label></div>" +
        '<div class="a-form-row"><label><input type="checkbox" name="firstPurchaseOnly" ' + (d.firstPurchaseOnly ? "checked" : "") + "> First purchase only</label></div>" +
        "</div>" +
        "</form>";

      var form = container.querySelector("#wizCodeForm");
      form.addEventListener("input", sync);
      form.addEventListener("change", sync);
      function sync() {
        d.code = form.code.value; d.name = form.name.value; d.description = form.description.value;
        d.activatesAt = form.activatesAt.value; d.expiresAt = form.expiresAt.value;
        d.timezone = form.timezone.value; d.status = form.status.value;
        d.maxUses = form.maxUses.value; d.maxUsesPerCustomer = form.maxUsesPerCustomer.value;
        d.singleUse = form.singleUse.checked; d.firstPurchaseOnly = form.firstPurchaseOnly.checked;
      }

      renderStepFooter({
        validate: function () {
          if (!d.code.trim()) return "A promo code is required";
          if (!d.name.trim()) return "An internal name is required";
          if (d.expiresAt && d.activatesAt && new Date(d.expiresAt) <= new Date(d.activatesAt)) return "Expiration must be after the activation date";
          return null;
        },
      });
    }

    // ---- Step 3: Discount & Eligibility ----
    function renderDiscountStep(container) {
      var d = state.draft;
      var isFree = d.discountType === "FREE_PRODUCT";
      var isPct = d.discountType === "PERCENTAGE";

      function productPill(p) {
        var checked = d.productIds.indexOf(p.id) !== -1;
        return '<label class="a-wizard-tax-leaf' + (checked ? " is-checked" : "") + '"><input type="checkbox" value="' + p.id + '" data-product-cb ' + (checked ? "checked" : "") + "> " + esc(p.name) + "</label>";
      }
      function categoryPill(c) {
        var checked = d.categoryIds.indexOf(c.id) !== -1;
        return '<label class="a-wizard-tax-leaf' + (checked ? " is-checked" : "") + '"><input type="checkbox" value="' + c.id + '" data-category-cb ' + (checked ? "checked" : "") + "> " + esc(c.label) + "</label>";
      }

      container.innerHTML =
        "<h5>Discount &amp; Eligibility</h5><p class=\"a-modal-desc\">How much customers save, and what it applies to.</p>" +
        '<form id="wizDiscountForm">' +
        '<div class="a-form-grid">' +
        (isFree
          ? '<div class="a-form-row"><label>Free Product</label><select name="freeProductId"><option value="">Select a product…</option>' +
            state.products.map(function (p) { return '<option value="' + p.id + '"' + (d.freeProductId === p.id ? " selected" : "") + ">" + esc(p.name) + "</option>"; }).join("") +
            "</select></div>"
          : '<div class="a-form-row"><label>Discount Value (' + (isPct ? "%" : "$") + ")</label><input name=\"discountValue\" type=\"number\" min=\"0\" step=\"0.01\" value=\"" + esc(String(d.discountValue)) + '"></div>') +
        (isPct ? '<div class="a-form-row"><label>Max Discount Cap ($, optional)</label><input name="maxDiscountCents" type="number" min="0" step="0.01" value="' + esc(String(d.maxDiscountCents)) + '" placeholder="No cap"></div>' : "") +
        "</div>" +
        '<div class="a-form-row"><label>Minimum Purchase ($, optional)</label><input name="minSpendCents" type="number" min="0" step="0.01" value="' + esc(String(d.minSpendCents)) + '" placeholder="No minimum"></div>' +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label><input type="checkbox" name="stackable" ' + (d.stackable ? "checked" : "") + "> Stackable with auto-apply promotions</label></div>" +
        '<div class="a-form-row"><label><input type="checkbox" name="autoApply" ' + (d.autoApply ? "checked" : "") + "> Auto-apply (no code needed at checkout)</label></div>" +
        "</div>" +
        "</form>" +
        '<label style="display:block;font-size:13px;font-weight:600;margin:20px 0 8px;">Eligible Products <span style="font-weight:400;color:var(--a-text-muted);">(leave empty for all products)</span></label>' +
        '<div class="a-wizard-tax-pills" id="productPills">' + state.products.map(productPill).join("") + "</div>" +
        '<label style="display:block;font-size:13px;font-weight:600;margin:20px 0 8px;">Eligible Categories <span style="font-weight:400;color:var(--a-text-muted);">(leave empty for all categories)</span></label>' +
        '<div class="a-wizard-tax-pills" id="categoryPills">' + state.categories.map(categoryPill).join("") + "</div>" +
        '<label style="display:block;font-size:13px;font-weight:600;margin:20px 0 8px;">Eligible Customers <span style="font-weight:400;color:var(--a-text-muted);">(emails, leave empty for everyone)</span></label>' +
        '<textarea id="userEmailsInput" rows="2" placeholder="one@example.com, two@example.com">' + esc(d.userEmails.join("\n")) + "</textarea>";

      var form = container.querySelector("#wizDiscountForm");
      form.addEventListener("input", sync);
      form.addEventListener("change", sync);
      function sync() {
        if (isFree) d.freeProductId = form.freeProductId.value;
        else d.discountValue = form.discountValue.value;
        if (isPct) d.maxDiscountCents = form.maxDiscountCents.value;
        d.minSpendCents = form.minSpendCents.value;
        d.stackable = form.stackable.checked;
        d.autoApply = form.autoApply.checked;
      }
      container.querySelectorAll("[data-product-cb]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          var idx = d.productIds.indexOf(cb.value);
          if (cb.checked && idx === -1) d.productIds.push(cb.value);
          else if (!cb.checked && idx !== -1) d.productIds.splice(idx, 1);
          cb.closest(".a-wizard-tax-leaf").classList.toggle("is-checked", cb.checked);
        });
      });
      container.querySelectorAll("[data-category-cb]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          var idx = d.categoryIds.indexOf(cb.value);
          if (cb.checked && idx === -1) d.categoryIds.push(cb.value);
          else if (!cb.checked && idx !== -1) d.categoryIds.splice(idx, 1);
          cb.closest(".a-wizard-tax-leaf").classList.toggle("is-checked", cb.checked);
        });
      });
      container.querySelector("#userEmailsInput").addEventListener("input", function (e) {
        d.userEmails = e.target.value.split(/[\n,]/).map(function (s) { return s.trim(); }).filter(Boolean);
      });

      renderStepFooter({
        validate: function () {
          if (isFree) { if (!d.freeProductId) return "Choose which product is free"; }
          else {
            var v = parseFloat(d.discountValue);
            if (!Number.isFinite(v) || v < 0) return "Enter a valid discount value";
            if (isPct && v > 100) return "Percentage discount can't exceed 100";
          }
          return null;
        },
      });
    }

    // ---- Step 4: Influencer ----
    function renderInfluencerStep(container) {
      var d = state.draft;
      container.innerHTML =
        "<h5>Influencer</h5><p class=\"a-modal-desc\">Attach an affiliate, athlete, or creator to track commission — optional.</p>" +
        '<form id="wizInfluencerForm">' +
        '<div class="a-form-row"><label>Code Kind</label><select name="codeKind">' +
        ["STANDARD", "AFFILIATE", "INFLUENCER", "CAMPAIGN"].map(function (k) {
          return '<option value="' + k + '"' + (d.codeKind === k ? " selected" : "") + ">" + k.charAt(0) + k.slice(1).toLowerCase() + "</option>";
        }).join("") +
        "</select></div>" +
        '<div class="a-form-row"><label>Influencer / Athlete / Creator / Affiliate</label><select name="influencerId" id="influencerSelect"><option value="">None</option>' +
        state.influencers.map(function (inf) {
          var commission = inf.commissionType === "percentage" ? inf.commissionPct + "%" : inf.commissionType === "fixed" ? window.AdminUI.formatCents(inf.commissionFixedCents) : "no commission set";
          return '<option value="' + inf.id + '"' + (d.influencerId === inf.id ? " selected" : "") + ">" + esc(inf.name) + " (" + inf.type + " — " + commission + ")</option>";
        }).join("") +
        "</select></div>" +
        "</form>" +
        '<div id="addInfluencerHost"></div>' +
        alertHtml("success", "fa-bell",
          "<strong>Automatic notifications</strong><p>No setup needed — you'll see a bell alert here in the admin when this promotion is about to expire, nears its usage limit, or sees unusually high sales.</p>");

      container.querySelector('select[name="codeKind"]').addEventListener("change", function (e) { d.codeKind = e.target.value; });
      container.querySelector("#influencerSelect").addEventListener("change", function (e) { d.influencerId = e.target.value; });

      var addHost = container.querySelector("#addInfluencerHost");
      addHost.innerHTML = '<button type="button" class="a-wizard-tax-add-trigger" id="addInfluencerBtn"><i class="fa-solid fa-plus"></i> Add a new influencer/affiliate</button>';
      addHost.querySelector("#addInfluencerBtn").addEventListener("click", function () { renderAddInfluencerForm(addHost); });

      function renderAddInfluencerForm(host) {
        host.innerHTML =
          '<div class="a-wizard-repeat-item">' +
          '<div class="a-form-grid">' +
          '<div class="a-form-row"><label>Name</label><input id="newInfName" placeholder="Jane Doe"></div>' +
          '<div class="a-form-row"><label>Type</label><select id="newInfType"><option value="influencer">Influencer</option><option value="athlete">Athlete</option><option value="creator">Creator</option><option value="affiliate">Affiliate</option></select></div>' +
          "</div>" +
          '<div class="a-form-grid">' +
          '<div class="a-form-row"><label>Commission Type</label><select id="newInfCommType"><option value="">None</option><option value="percentage">Percentage</option><option value="fixed">Fixed per order</option></select></div>' +
          '<div class="a-form-row" id="newInfCommValueRow" style="display:none;"><label id="newInfCommValueLabel">Value</label><input id="newInfCommValue" type="number" min="0" step="0.01"></div>' +
          "</div>" +
          '<div style="display:flex;gap:10px;"><button type="button" class="a-btn a-btn-primary a-btn-sm" style="width:auto;" id="saveInfluencerBtn">Add Influencer</button>' +
          '<button type="button" class="a-btn a-btn-secondary a-btn-sm" style="width:auto;" id="cancelInfluencerBtn">Cancel</button></div>' +
          "</div>";
        host.querySelector("#newInfCommType").addEventListener("change", function (e) {
          var row = host.querySelector("#newInfCommValueRow");
          var label = host.querySelector("#newInfCommValueLabel");
          if (!e.target.value) { row.style.display = "none"; return; }
          row.style.display = "";
          label.textContent = e.target.value === "percentage" ? "Commission %" : "Commission ($ per order)";
        });
        host.querySelector("#cancelInfluencerBtn").addEventListener("click", function () {
          host.innerHTML = '<button type="button" class="a-wizard-tax-add-trigger" id="addInfluencerBtn"><i class="fa-solid fa-plus"></i> Add a new influencer/affiliate</button>';
          host.querySelector("#addInfluencerBtn").addEventListener("click", function () { renderAddInfluencerForm(host); });
        });
        host.querySelector("#saveInfluencerBtn").addEventListener("click", function (e) {
          var name = host.querySelector("#newInfName").value.trim();
          if (!name) return window.AdminUI.toast("Name is required", "error");
          var type = host.querySelector("#newInfType").value;
          var commType = host.querySelector("#newInfCommType").value;
          var commValueRaw = host.querySelector("#newInfCommValue").value;
          var payload = { name: name, type: type };
          if (commType) {
            payload.commissionType = commType;
            if (commType === "percentage") payload.commissionPct = parseFloat(commValueRaw) || 0;
            else payload.commissionFixedCents = Math.round((parseFloat(commValueRaw) || 0) * 100);
          }
          var btn = e.currentTarget;
          btn.classList.add("is-loading");
          btn.disabled = true;
          window.AdminAPI.createInfluencer(payload).then(function (data) {
            state.influencers.push(data.influencer);
            d.influencerId = data.influencer.id;
            state.dirty = true;
            window.AdminUI.toast('"' + data.influencer.name + '" added', "success");
            renderInfluencerStep(container);
          }).catch(function (err) {
            window.AdminUI.toast(err.message || "Could not create influencer", "error");
            btn.classList.remove("is-loading");
            btn.disabled = false;
          });
        });
      }

      renderStepFooter({});
    }

    // ---- Step 5: Review ----
    function renderReviewStep(container) {
      var d = state.draft;
      var typeInfo = DISCOUNT_TYPES.filter(function (t) { return t.value === d.discountType; })[0];
      var freeProduct = state.products.filter(function (p) { return p.id === d.freeProductId; })[0];
      var discountLabel = d.discountType === "PERCENTAGE" ? (d.discountValue || 0) + "% off"
        : d.discountType === "FIXED_AMOUNT" ? "$" + (parseFloat(d.discountValue) || 0).toFixed(2) + " off"
        : "Free: " + (freeProduct ? freeProduct.name : "no product selected");
      var influencer = state.influencers.filter(function (i) { return i.id === d.influencerId; })[0];
      var productNames = d.productIds.map(function (id) { var p = state.products.filter(function (x) { return x.id === id; })[0]; return p ? p.name : id; });
      var categoryNames = d.categoryIds.map(function (id) { var c = state.categories.filter(function (x) { return x.id === id; })[0]; return c ? c.label : id; });

      function row(label, value) { return "<div><strong>" + label + "</strong>" + (value || "<em>—</em>") + "</div>"; }

      container.innerHTML =
        "<h5>Review</h5><p class=\"a-modal-desc\">One last look before this promotion goes live.</p>" +
        '<div class="a-wizard-review-grid">' +
        row("Type", typeInfo.label) +
        row("Code", "<code>" + esc(d.code || "—") + "</code>") +
        row("Name", esc(d.name || "—")) +
        row("Discount", discountLabel) +
        row("Status", d.status === "enabled" ? "Enabled" : "Disabled") +
        row("Expires", d.expiresAt ? window.AdminUI.formatDateTime(new Date(d.expiresAt).toISOString()) : "Never") +
        row("Usage Limit", (d.maxUses !== "" ? d.maxUses : "Unlimited") + (d.maxUsesPerCustomer !== "" ? " (" + d.maxUsesPerCustomer + " per customer)" : "")) +
        row("Minimum Purchase", d.minSpendCents !== "" ? window.AdminUI.formatCents(Math.round(parseFloat(d.minSpendCents) * 100)) : "None") +
        row("Eligible Products", productNames.length ? esc(productNames.join(", ")) : "All products") +
        row("Eligible Categories", categoryNames.length ? esc(categoryNames.join(", ")) : "All categories") +
        row("Influencer", influencer ? esc(influencer.name) + " (" + influencer.type + ")" : "None") +
        row("Code Kind", d.codeKind) +
        row("Auto-apply / Stackable", (d.autoApply ? "Auto-apply" : "Code required") + " · " + (d.stackable ? "Stackable" : "Not stackable")) +
        "</div>";

      footerEl.innerHTML =
        '<div class="a-wizard-actions">' +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-act="cancel">Close</button>' +
        '<div style="display:flex;gap:10px;">' +
        '<button type="button" class="a-btn a-btn-secondary" data-act="back">Back</button>' +
        '<button type="button" class="a-btn a-btn-primary" data-act="submit">' + (state.isEdit ? "Save Changes" : "Create Promotion") + "</button>" +
        "</div></div>";
      footerEl.querySelector('[data-act="cancel"]').addEventListener("click", requestClose);
      footerEl.querySelector('[data-act="back"]').addEventListener("click", function () { goToStep(state.stepIndex - 1); });
      footerEl.querySelector('[data-act="submit"]').addEventListener("click", function (e) {
        var btn = e.currentTarget;
        btn.classList.add("is-loading");
        btn.disabled = true;
        var payload = payloadFromDraft(d);
        var call = state.isEdit ? window.AdminAPI.updatePromotion(promotionId, payload) : window.AdminAPI.createPromotion(payload);
        call.then(function (data) {
          state.dirty = false;
          state.result = data.promotion;
          window.AdminUI.toast(state.isEdit ? "Promotion updated" : "Promotion created", "success");
          close();
        }).catch(function (err) {
          window.AdminUI.toast(err.message || "Could not save", "error");
          btn.classList.remove("is-loading");
          btn.disabled = false;
        });
      });
    }

    // ---- Boot: load lookups (+ the existing promotion, if editing) ----
    Promise.all([
      window.AdminAPI.listProducts({ status: "published" }).then(function (r) { return r.products; }).catch(function () { return []; }),
      window.AdminAPI.getTaxonomy().then(function (r) { return flattenTaxonomy(r.taxonomies); }).catch(function () { return []; }),
      window.AdminAPI.listInfluencers().then(function (r) { return r.influencers; }).catch(function () { return []; }),
      promotionId ? window.AdminAPI.getPromotion(promotionId).then(function (r) { return r.promotion; }) : Promise.resolve(null),
    ]).then(function (results) {
      state.products = results[0];
      state.categories = results[1];
      state.influencers = results[2];
      if (results[3]) state.draft = draftFromPromotion(results[3]);
      state.dirty = false; // loading existing data isn't a user edit
      renderSteps();
      renderBody();
    }).catch(function (err) {
      window.AdminUI.toast(err.message || "Could not load promotion", "error");
      close();
    });
  }

  return { open: open };
})();
