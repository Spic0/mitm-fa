// Step-by-step Setup Wizard for creating/editing a promotion. Architecturally
// identical to AdminProductWizard (assets/js/admin/product-wizard.js) and
// built on the same shared chrome (assets/js/admin/wizard-shell.js): a real
// draft is created on the server the instant the wizard opens (even before
// any field is filled in), and every step persists its own slice of data via
// PATCH the moment the admin leaves it. That's what makes free navigation,
// autosave, and Save Draft actually mean something here rather than being a
// local-only simulation of them.
//
// The Promotion model has no separate "draft" business status the way
// Product has "draft"/"published"/"archived" — but its existing
// status:"disabled" already means exactly that ("not usable at checkout"),
// so a freshly-opened draft is created disabled and only flips to enabled
// when the admin explicitly publishes it from the Review step (or picks
// "enabled" on the Code & Schedule step and it survives to Review).
window.AdminPromotionWizard = (function () {
  var STEPS = [
    { key: "type", label: "Promotion Type" },
    { key: "code", label: "Code & Schedule" },
    { key: "discount", label: "Discount & Eligibility" },
    { key: "influencer", label: "Influencer" },
    { key: "review", label: "Review" },
  ];
  var STEP_LABELS = STEPS.reduce(function (acc, s) { acc[s.key] = s.label; return acc; }, {});

  var DISCOUNT_TYPES = [
    { value: "PERCENTAGE", label: "Percentage", desc: "e.g. 20% off the order", icon: "fa-percent" },
    { value: "FIXED_AMOUNT", label: "Fixed Amount", desc: "e.g. $10 off the order", icon: "fa-dollar-sign" },
    { value: "FREE_PRODUCT", label: "Free Product", desc: "Gift one product for free", icon: "fa-gift" },
  ];

  var PLACEHOLDER_NAME = "Untitled Promotion";

  function esc(s) { return window.AdminUI.escapeHtml(s); }
  function isPlaceholderCode(code) { return /^DRAFT-/.test(code || ""); }

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

  function open(promotionId, onDone) {
    var state = {
      promotion: null, isEdit: !!promotionId, visitedSteps: {},
      products: [], categories: [], influencers: [],
    };

    // ---- Step completeness, used by the rail's 4-state icons, the
    // non-blocking missing-field banner, and Review's publish gate. "type"
    // and "influencer" have no required fields of their own — every value
    // (including the defaults) is already valid — so they read complete the
    // moment the draft exists.
    function getStatus(key) {
      var p = state.promotion;
      if (!p) return "not-started";
      if (key === "type" || key === "influencer" || key === "review") return "complete";
      if (key === "code") {
        var codeOk = !!(p.code && !isPlaceholderCode(p.code) && p.name && p.name !== PLACEHOLDER_NAME);
        if (codeOk) return "complete";
        return state.visitedSteps.code ? "missing" : "not-started";
      }
      if (key === "discount") {
        var discountOk = p.discountType === "FREE_PRODUCT" ? !!p.freeProductId : p.discountValue != null;
        if (discountOk) return "complete";
        return state.visitedSteps.discount ? "missing" : "not-started";
      }
      return "not-started";
    }

    var shell = window.AdminWizardShell.build({
      steps: STEPS,
      loadingText: "Loading…",
      getStatus: getStatus,
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

        if (key === "type") renderTypeStep(stepHost, bannerHost);
        else if (key === "code") renderCodeStep(stepHost, bannerHost);
        else if (key === "discount") renderDiscountStep(stepHost, bannerHost);
        else if (key === "influencer") renderInfluencerStep(stepHost, bannerHost);
        else if (key === "review") renderReviewStep(stepHost);
      },
      getResult: function () { return state.promotion; },
      onClose: function (result) { if (onDone) onDone(result); },
    });

    // Non-blocking reminder shown above a step's fields when it isn't
    // complete yet — mirrors AdminProductWizard's renderMissingBanner
    // exactly, since both wizards must read as one system.
    function renderMissingBanner(host, key) {
      if (getStatus(key) !== "missing") { host.innerHTML = ""; return; }
      host.innerHTML = alertHtml("warning", "fa-triangle-exclamation",
        "<strong>Missing required information</strong><p>This step isn't complete yet — feel free to work on other steps and come back before publishing.</p>");
    }

    // ---- Step 1: Promotion Type ----
    function renderTypeStep(container, bannerHost) {
      renderMissingBanner(bannerHost, "type");
      var p = state.promotion;
      container.innerHTML =
        "<h5>Promotion Type</h5><p class=\"a-modal-desc\">What kind of discount does this promotion give?</p>" +
        '<div class="a-wizard-type-grid">' +
        DISCOUNT_TYPES.map(function (t) {
          var selected = p.discountType === t.value;
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
          if (card.dataset.type === p.discountType) return;
          p.discountType = card.dataset.type;
          shell.markDirty();
          renderTypeStep(container, bannerHost);
        });
      });
      shell.standardFooter({
        save: function () {
          return window.AdminAPI.updatePromotion(p.id, { discountType: p.discountType }).then(function (r) { state.promotion = r.promotion; });
        },
      });
    }

    // ---- Step 2: Code & Schedule ----
    function renderCodeStep(container, bannerHost) {
      renderMissingBanner(bannerHost, "code");
      var p = state.promotion;
      var codeValue = isPlaceholderCode(p.code) ? "" : p.code;
      var nameValue = p.name === PLACEHOLDER_NAME ? "" : p.name;
      container.innerHTML =
        "<h5>Code &amp; Schedule</h5><p class=\"a-modal-desc\">The code customers enter, and when/how often it can be used.</p>" +
        '<form id="wizCodeForm">' +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label>Promo Code</label><input name="code" required value="' + esc(codeValue) + '" placeholder="SUMMER20"></div>' +
        '<div class="a-form-row"><label>Internal Name</label><input name="name" required value="' + esc(nameValue) + '" placeholder="Summer Sale 20%"></div>' +
        "</div>" +
        '<div class="a-form-row"><label>Description (optional)</label><textarea name="description" rows="2">' + esc(p.description || "") + "</textarea></div>" +
        "<h6>Schedule</h6>" +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label>Activation Date</label><input name="activatesAt" type="datetime-local" value="' + toLocalInput(p.activatesAt) + '"></div>' +
        '<div class="a-form-row"><label>Expiration Date</label><input name="expiresAt" type="datetime-local" value="' + toLocalInput(p.expiresAt) + '"></div>' +
        "</div>" +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label>Timezone</label><select name="timezone">' +
        ["UTC", "America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Paris", "Australia/Sydney"].map(function (tz) {
          return '<option value="' + tz + '"' + (p.timezone === tz ? " selected" : "") + ">" + tz + "</option>";
        }).join("") +
        "</select></div>" +
        '<div class="a-form-row"><label>Status</label><select name="status">' +
        '<option value="enabled"' + (p.status === "enabled" ? " selected" : "") + ">Enabled</option>" +
        '<option value="disabled"' + (p.status === "disabled" ? " selected" : "") + ">Disabled</option>" +
        "</select></div>" +
        "</div>" +
        "<h6>Usage Limit</h6>" +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label>Maximum Uses (total)</label><input name="maxUses" type="number" min="0" value="' + (p.maxUses != null ? p.maxUses : "") + '" placeholder="Unlimited"></div>' +
        '<div class="a-form-row"><label>Maximum Uses Per Customer</label><input name="maxUsesPerCustomer" type="number" min="0" value="' + (p.maxUsesPerCustomer != null ? p.maxUsesPerCustomer : "") + '" placeholder="Unlimited"></div>' +
        "</div>" +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label><input type="checkbox" name="singleUse" ' + (p.singleUse ? "checked" : "") + "> Single use (one redemption, globally, then it's spent)</label></div>" +
        '<div class="a-form-row"><label><input type="checkbox" name="firstPurchaseOnly" ' + (p.firstPurchaseOnly ? "checked" : "") + "> First purchase only</label></div>" +
        "</div>" +
        "</form>";

      shell.standardFooter({
        save: function () {
          var form = container.querySelector("#wizCodeForm");
          var activatesAt = form.activatesAt.value ? new Date(form.activatesAt.value) : null;
          var expiresAt = form.expiresAt.value ? new Date(form.expiresAt.value) : null;
          // An actively wrong value (not merely a blank one) — this is the
          // one place on this step allowed to stay put and complain,
          // exactly like a blank/invalid discount value on the next step.
          if (activatesAt && expiresAt && expiresAt <= activatesAt) {
            throw new Error("Expiration must be after the activation date");
          }
          var payload = {
            description: form.description.value,
            activatesAt: activatesAt ? activatesAt.toISOString() : null,
            expiresAt: expiresAt ? expiresAt.toISOString() : null,
            timezone: form.timezone.value,
            status: form.status.value,
            maxUses: form.maxUses.value !== "" ? form.maxUses.value : null,
            maxUsesPerCustomer: form.maxUsesPerCustomer.value !== "" ? form.maxUsesPerCustomer.value : null,
            singleUse: form.singleUse.checked,
            firstPurchaseOnly: form.firstPurchaseOnly.checked,
          };
          // Code/name are required by the server even on a partial PATCH —
          // omitting them entirely (instead of sending "") when left blank
          // is what keeps a blank field a non-blocking "missing" step
          // instead of a hard save failure, matching every other step.
          if (form.code.value.trim()) payload.code = form.code.value.trim();
          if (form.name.value.trim()) payload.name = form.name.value.trim();
          return window.AdminAPI.updatePromotion(p.id, payload).then(function (r) { state.promotion = r.promotion; });
        },
      });
    }

    // ---- Step 3: Discount & Eligibility ----
    function renderDiscountStep(container, bannerHost) {
      renderMissingBanner(bannerHost, "discount");
      var p = state.promotion;
      var isFree = p.discountType === "FREE_PRODUCT";
      var isPct = p.discountType === "PERCENTAGE";
      var selectedProducts = (p.products || []).slice();
      var selectedCategories = (p.categories || []).slice();
      var emails = (p.userEmails || []).slice();

      var discountDisplay = p.discountValue == null ? "" : (isPct ? p.discountValue : (p.discountValue / 100).toFixed(2));
      var maxDiscountDisplay = p.maxDiscountCents != null ? (p.maxDiscountCents / 100).toFixed(2) : "";
      var minSpendDisplay = p.minSpendCents != null ? (p.minSpendCents / 100).toFixed(2) : "";

      function productPill(pr) {
        var checked = selectedProducts.indexOf(pr.id) !== -1;
        return '<label class="a-wizard-tax-leaf' + (checked ? " is-checked" : "") + '"><input type="checkbox" value="' + pr.id + '" data-product-cb ' + (checked ? "checked" : "") + "> " + esc(pr.name) + "</label>";
      }
      function categoryPill(c) {
        var checked = selectedCategories.indexOf(c.id) !== -1;
        return '<label class="a-wizard-tax-leaf' + (checked ? " is-checked" : "") + '"><input type="checkbox" value="' + c.id + '" data-category-cb ' + (checked ? "checked" : "") + "> " + esc(c.label) + "</label>";
      }

      container.innerHTML =
        "<h5>Discount &amp; Eligibility</h5><p class=\"a-modal-desc\">How much customers save, and what it applies to.</p>" +
        '<form id="wizDiscountForm">' +
        '<div class="a-form-grid">' +
        (isFree
          ? '<div class="a-form-row"><label>Free Product</label><select name="freeProductId"><option value="">Select a product…</option>' +
            state.products.map(function (pr) { return '<option value="' + pr.id + '"' + (p.freeProductId === pr.id ? " selected" : "") + ">" + esc(pr.name) + "</option>"; }).join("") +
            "</select></div>"
          : '<div class="a-form-row"><label>Discount Value (' + (isPct ? "%" : "$") + ")</label><input name=\"discountValue\" type=\"number\" min=\"0\" step=\"0.01\" value=\"" + esc(String(discountDisplay)) + '"></div>') +
        (isPct ? '<div class="a-form-row"><label>Max Discount Cap ($, optional)</label><input name="maxDiscountCents" type="number" min="0" step="0.01" value="' + esc(maxDiscountDisplay) + '" placeholder="No cap"></div>' : "") +
        "</div>" +
        '<div class="a-form-row"><label>Minimum Purchase ($, optional)</label><input name="minSpendCents" type="number" min="0" step="0.01" value="' + esc(minSpendDisplay) + '" placeholder="No minimum"></div>' +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label><input type="checkbox" name="stackable" ' + (p.stackable ? "checked" : "") + "> Stackable with auto-apply promotions</label></div>" +
        '<div class="a-form-row"><label><input type="checkbox" name="autoApply" ' + (p.autoApply ? "checked" : "") + "> Auto-apply (no code needed at checkout)</label></div>" +
        "</div>" +
        "</form>" +
        '<label style="display:block;font-size:13px;font-weight:600;margin:20px 0 8px;">Eligible Products <span style="font-weight:400;color:var(--a-text-muted);">(leave empty for all products)</span></label>' +
        '<div class="a-wizard-tax-pills" id="productPills">' + state.products.map(productPill).join("") + "</div>" +
        '<label style="display:block;font-size:13px;font-weight:600;margin:20px 0 8px;">Eligible Categories <span style="font-weight:400;color:var(--a-text-muted);">(leave empty for all categories)</span></label>' +
        '<div class="a-wizard-tax-pills" id="categoryPills">' + state.categories.map(categoryPill).join("") + "</div>" +
        '<label style="display:block;font-size:13px;font-weight:600;margin:20px 0 8px;">Eligible Customers <span style="font-weight:400;color:var(--a-text-muted);">(emails, leave empty for everyone)</span></label>' +
        '<textarea id="userEmailsInput" rows="2" placeholder="one@example.com, two@example.com">' + esc(emails.join("\n")) + "</textarea>";

      container.querySelectorAll("[data-product-cb]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          var idx = selectedProducts.indexOf(cb.value);
          if (cb.checked && idx === -1) selectedProducts.push(cb.value);
          else if (!cb.checked && idx !== -1) selectedProducts.splice(idx, 1);
          cb.closest(".a-wizard-tax-leaf").classList.toggle("is-checked", cb.checked);
        });
      });
      container.querySelectorAll("[data-category-cb]").forEach(function (cb) {
        cb.addEventListener("change", function () {
          var idx = selectedCategories.indexOf(cb.value);
          if (cb.checked && idx === -1) selectedCategories.push(cb.value);
          else if (!cb.checked && idx !== -1) selectedCategories.splice(idx, 1);
          cb.closest(".a-wizard-tax-leaf").classList.toggle("is-checked", cb.checked);
        });
      });
      container.querySelector("#userEmailsInput").addEventListener("input", function (e) {
        emails = e.target.value.split(/[\n,]/).map(function (s) { return s.trim(); }).filter(Boolean);
      });

      shell.standardFooter({
        save: function () {
          var form = container.querySelector("#wizDiscountForm");
          var payload = {
            stackable: form.stackable.checked,
            autoApply: form.autoApply.checked,
            minSpendCents: form.minSpendCents.value !== "" ? Math.round(parseFloat(form.minSpendCents.value) * 100) : null,
            productIds: selectedProducts,
            categoryIds: selectedCategories,
            userEmails: emails,
          };
          if (isFree) {
            payload.freeProductId = form.freeProductId.value || null;
          } else {
            var raw = form.discountValue.value;
            if (raw !== "") {
              var v = parseFloat(raw);
              if (!Number.isFinite(v) || v < 0) throw new Error("Enter a valid discount value");
              if (isPct && v > 100) throw new Error("Percentage discount can't exceed 100");
              payload.discountValue = isPct ? Math.round(v) : Math.round(v * 100);
            }
            if (isPct) payload.maxDiscountCents = form.maxDiscountCents.value !== "" ? Math.round(parseFloat(form.maxDiscountCents.value) * 100) : null;
          }
          return window.AdminAPI.updatePromotion(p.id, payload).then(function (r) { state.promotion = r.promotion; });
        },
      });
    }

    // ---- Step 4: Influencer ----
    function renderInfluencerStep(container, bannerHost) {
      renderMissingBanner(bannerHost, "influencer");
      var p = state.promotion;
      container.innerHTML =
        "<h5>Influencer</h5><p class=\"a-modal-desc\">Attach an affiliate, athlete, or creator to track commission — optional.</p>" +
        '<form id="wizInfluencerForm">' +
        '<div class="a-form-row"><label>Code Kind</label><select name="codeKind">' +
        ["STANDARD", "AFFILIATE", "INFLUENCER", "CAMPAIGN"].map(function (k) {
          return '<option value="' + k + '"' + (p.codeKind === k ? " selected" : "") + ">" + k.charAt(0) + k.slice(1).toLowerCase() + "</option>";
        }).join("") +
        "</select></div>" +
        '<div class="a-form-row"><label>Influencer / Athlete / Creator / Affiliate</label><select name="influencerId" id="influencerSelect"><option value="">None</option>' +
        state.influencers.map(function (inf) {
          var commission = inf.commissionType === "percentage" ? inf.commissionPct + "%" : inf.commissionType === "fixed" ? window.AdminUI.formatCents(inf.commissionFixedCents) : "no commission set";
          return '<option value="' + inf.id + '"' + ((p.influencer && p.influencer.id) === inf.id ? " selected" : "") + ">" + esc(inf.name) + " (" + inf.type + " — " + commission + ")</option>";
        }).join("") +
        "</select></div>" +
        "</form>" +
        '<div id="addInfluencerHost"></div>' +
        alertHtml("success", "fa-bell",
          "<strong>Automatic notifications</strong><p>No setup needed — you'll see a bell alert here in the admin when this promotion is about to expire, nears its usage limit, or sees unusually high sales.</p>");

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
            window.AdminUI.toast('"' + data.influencer.name + '" added', "success");
            renderInfluencerStep(container, bannerHost);
            container.querySelector("#influencerSelect").value = data.influencer.id;
          }).catch(function (err) {
            window.AdminUI.toast(err.message || "Could not create influencer", "error");
            btn.classList.remove("is-loading");
            btn.disabled = false;
          });
        });
      }

      shell.standardFooter({
        save: function () {
          var form = container.querySelector("#wizInfluencerForm");
          var payload = { codeKind: form.codeKind.value, influencerId: form.influencerId.value || null };
          return window.AdminAPI.updatePromotion(p.id, payload).then(function (r) { state.promotion = r.promotion; });
        },
      });
    }

    // ---- Step 5: Review ----
    function renderReviewStep(container) {
      var p = state.promotion;
      var typeInfo = DISCOUNT_TYPES.filter(function (t) { return t.value === p.discountType; })[0];
      var freeProduct = state.products.filter(function (pr) { return pr.id === p.freeProductId; })[0];
      var discountLabel = p.discountType === "PERCENTAGE" ? (p.discountValue || 0) + "% off"
        : p.discountType === "FIXED_AMOUNT" ? window.AdminUI.formatCents(p.discountValue || 0) + " off"
        : "Free: " + (freeProduct ? freeProduct.name : "no product selected");
      var productNames = (p.products || []).map(function (id) { var pr = state.products.filter(function (x) { return x.id === id; })[0]; return pr ? pr.name : id; });
      var categoryNames = (p.categories || []).map(function (id) { var c = state.categories.filter(function (x) { return x.id === id; })[0]; return c ? c.label : id; });

      function row(label, value) { return "<div><strong>" + label + "</strong>" + (value || "<em>—</em>") + "</div>"; }

      var missingKeys = ["code", "discount"].filter(function (k) { return getStatus(k) === "missing" || getStatus(k) === "not-started"; });

      container.innerHTML =
        "<h5>Review</h5><p class=\"a-modal-desc\">One last look before this promotion goes live.</p>" +
        '<div id="publishValidation"></div>' +
        '<div class="a-wizard-review-grid">' +
        row("Type", typeInfo.label) +
        row("Code", "<code>" + esc(isPlaceholderCode(p.code) ? "—" : p.code) + "</code>") +
        row("Name", esc(p.name === PLACEHOLDER_NAME ? "—" : p.name)) +
        row("Discount", discountLabel) +
        row("Status", p.status === "enabled" ? "Enabled" : "Disabled") +
        row("Expires", p.expiresAt ? window.AdminUI.formatDateTime(p.expiresAt) : "Never") +
        row("Usage Limit", (p.maxUses != null ? p.maxUses : "Unlimited") + (p.maxUsesPerCustomer != null ? " (" + p.maxUsesPerCustomer + " per customer)" : "")) +
        row("Minimum Purchase", p.minSpendCents != null ? window.AdminUI.formatCents(p.minSpendCents) : "None") +
        row("Eligible Products", productNames.length ? esc(productNames.join(", ")) : "All products") +
        row("Eligible Categories", categoryNames.length ? esc(categoryNames.join(", ")) : "All categories") +
        row("Influencer", p.influencer ? esc(p.influencer.name) + " (" + p.influencer.type + ")" : "None") +
        row("Code Kind", p.codeKind) +
        row("Auto-apply / Stackable", (p.autoApply ? "Auto-apply" : "Code required") + " · " + (p.stackable ? "Stackable" : "Not stackable")) +
        "</div>";

      renderPublishSummary(container.querySelector("#publishValidation"), missingKeys, false);

      // Nothing on this step is user-editable.
      shell.setSaveHandler(function () { return Promise.resolve(); });

      shell.footerEl.innerHTML =
        '<div class="a-wizard-actions">' +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-act="cancel">Close</button>' +
        '<div class="a-wizard-actions-right">' +
        '<button type="button" class="a-btn a-btn-secondary" data-act="back">Back</button>' +
        '<button type="button" class="a-btn a-btn-secondary" data-act="save-draft-status">Save as Draft</button>' +
        '<button type="button" class="a-btn a-btn-primary" data-act="publish">' + (state.isEdit ? "Save & Publish" : "Publish") + "</button>" +
        "</div></div>";

      shell.footerEl.querySelector('[data-act="cancel"]').addEventListener("click", shell.requestClose);
      shell.footerEl.querySelector('[data-act="back"]').addEventListener("click", function () { shell.start(shell.getStepIndex() - 1); });
      shell.footerEl.querySelector('[data-act="save-draft-status"]').addEventListener("click", function (e) {
        var btn = e.currentTarget;
        btn.classList.add("is-loading");
        btn.disabled = true;
        window.AdminAPI.updatePromotion(p.id, { status: "disabled" }).then(function (r) {
          state.promotion = r.promotion;
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
        var freshMissing = ["code", "discount"].filter(function (k) { return getStatus(k) !== "complete"; });
        if (freshMissing.length) {
          renderPublishSummary(container.querySelector("#publishValidation"), freshMissing, true);
          window.AdminUI.toast("Finish the missing sections before publishing", "error");
          return;
        }
        var btn = e.currentTarget;
        btn.classList.add("is-loading");
        btn.disabled = true;
        window.AdminAPI.updatePromotion(p.id, { status: "enabled" }).then(function (r) {
          state.promotion = r.promotion;
          window.AdminUI.toast("Promotion published", "success");
          shell.close(state.promotion);
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
        if (emphasize) host.firstChild.classList.add("a-wizard-alert-shake");
        host.querySelectorAll("[data-fix-step]").forEach(function (a) {
          a.addEventListener("click", function (e) {
            e.preventDefault();
            shell.start(parseInt(a.dataset.fixStep, 10));
          });
        });
      }
    }

    // ---- Boot: create (or load) the draft, plus lookups ----
    // A draft is created the instant the wizard opens (even before any
    // field is filled in) so every sidebar step is clickable from frame
    // one — same contract as AdminProductWizard. It starts disabled, so an
    // abandoned "New Promotion" click never becomes redeemable at checkout.
    function createPlaceholder(retry) {
      var suffix = Math.random().toString(36).slice(2, 8).toUpperCase() + (retry ? Date.now().toString(36).toUpperCase() : "");
      var payload = { code: "DRAFT-" + suffix, name: PLACEHOLDER_NAME, discountType: "PERCENTAGE", discountValue: 0, status: "disabled" };
      return window.AdminAPI.createPromotion(payload).then(function (r) { return r.promotion; }).catch(function (err) {
        if (retry) throw err; // extremely unlikely code collision twice in a row — give up
        return createPlaceholder(true);
      });
    }

    var loadPromise = promotionId
      ? window.AdminAPI.getPromotion(promotionId).then(function (r) { return r.promotion; })
      : createPlaceholder(false);

    Promise.all([
      window.AdminAPI.listProducts({ status: "published" }).then(function (r) { return r.products; }).catch(function () { return []; }),
      window.AdminAPI.getTaxonomy().then(function (r) { return flattenTaxonomy(r.taxonomies); }).catch(function () { return []; }),
      window.AdminAPI.listInfluencers().then(function (r) { return r.influencers; }).catch(function () { return []; }),
      loadPromise,
    ]).then(function (results) {
      state.products = results[0];
      state.categories = results[1];
      state.influencers = results[2];
      state.promotion = results[3];
      shell.start(0);
    }).catch(function (err) {
      window.AdminUI.toast(err.message || "Could not load promotion", "error");
      shell.close(null);
    });
  }

  return { open: open };
})();
