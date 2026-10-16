// Step-by-step Setup Wizard for creating/editing a Partner Profile.
//
// Built on the shared wizard chrome (assets/js/admin/wizard-shell.js), the
// same one the Promotion wizard uses, so the rail, progress readout, footer,
// autosave and leave-confirmation behave identically across the admin. This
// file owns only the six steps' fields, validation and API calls.
//
// Like the promotion wizard, a REAL draft is created on the server the moment
// the wizard opens, and every step persists its slice via PATCH when the
// admin leaves it. That is what makes free navigation, autosave and "Save
// Draft" mean something rather than simulate it locally.
window.AdminPartnerWizard = (function () {
  var STEPS = [
    { key: "basics", label: "Basic Information" },
    { key: "socials", label: "Social Links" },
    { key: "products", label: "Products" },
    { key: "links", label: "Custom Links" },
    { key: "appearance", label: "Appearance" },
    { key: "publish", label: "Publish" },
  ];

  var PLACEHOLDER_NAME = "Untitled Partner";

  // KEEP IN STEP WITH SOCIAL_PLATFORMS / PARTNER_TYPES / LINK_ICONS in
  // server/src/lib/partners.js. The server is the authority and re-validates
  // every one of these (including that an Instagram URL really points at
  // instagram.com); this list only drives what the form offers.
  var PLATFORMS = [
    { key: "instagram", label: "Instagram", icon: "fa-instagram", hint: "instagram.com/username" },
    { key: "tiktok", label: "TikTok", icon: "fa-tiktok", hint: "tiktok.com/@username" },
    { key: "youtube", label: "YouTube", icon: "fa-youtube", hint: "youtube.com/@channel" },
    // The bird mark, not the newer X glyph — the bundled Font Awesome 6.0.0
    // does not have the latter. See server/src/lib/partners.js for why its
    // class name must not be written in a comment either.
    { key: "x", label: "X", icon: "fa-twitter", hint: "x.com/username" },
    { key: "facebook", label: "Facebook", icon: "fa-facebook-f", hint: "facebook.com/page" },
    { key: "twitch", label: "Twitch", icon: "fa-twitch", hint: "twitch.tv/channel" },
    { key: "spotify", label: "Spotify", icon: "fa-spotify", hint: "spotify.com/artist/…" },
    { key: "linkedin", label: "LinkedIn", icon: "fa-linkedin-in", hint: "linkedin.com/in/username" },
  ];

  var PARTNER_TYPES = [
    { value: "athlete", label: "Athlete", desc: "Competitive or professional athlete", icon: "fa-medal" },
    { value: "creator", label: "Creator", desc: "Content-first sports or fitness brand", icon: "fa-video" },
    { value: "coach", label: "Coach", desc: "Trainer or nutrition practitioner", icon: "fa-clipboard-user" },
    { value: "influencer", label: "Influencer", desc: "Established audience across social", icon: "fa-bullhorn" },
    { value: "personality", label: "Sports Personality", desc: "Broadcaster, commentator or public figure", icon: "fa-microphone" },
  ];

  var LINK_ICONS = [
    { value: "link", icon: "fa-link", label: "Link" },
    { value: "cart", icon: "fa-cart-shopping", label: "Shop" },
    { value: "dumbbell", icon: "fa-dumbbell", label: "Training" },
    { value: "apple", icon: "fa-apple-whole", label: "Nutrition" },
    { value: "play", icon: "fa-circle-play", label: "Video" },
    { value: "calendar", icon: "fa-calendar-days", label: "Booking" },
    { value: "envelope", icon: "fa-envelope", label: "Contact" },
    { value: "star", icon: "fa-star", label: "Featured" },
    { value: "download", icon: "fa-download", label: "Download" },
    { value: "ticket", icon: "fa-ticket", label: "Event" },
  ];

  var LIMITS = { displayName: 80, handle: 40, bio: 300, ctaLabel: 32, linkTitle: 60, linkDescription: 120 };

  function esc(s) { return window.AdminUI.escapeHtml(s); }

  function alertHtml(variant, iconClass, bodyHtml) {
    return '<div class="a-wizard-alert a-wizard-alert-' + variant + '"><i class="fa-solid ' + iconClass + '"></i><div>' + bodyHtml + "</div></div>";
  }

  function slugify(v) {
    return String(v || "")
      .normalize("NFKD")
      .replace(/[̀-ͯ]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 60)
      .replace(/-+$/g, "");
  }

  function formatCents(cents) {
    return cents === 0 ? "Free" : "$" + (cents / 100).toFixed(2);
  }

  function open(partnerId, onDone) {
    var state = {
      partner: null,
      isEdit: !!partnerId,
      visitedSteps: {},
      // Local working copies of the ordered collections. Held here rather
      // than read back off state.partner on every keystroke so that
      // reordering and editing stay responsive and a save is one PATCH of
      // the whole array.
      socials: [],
      links: [],
      products: [],
      productOptions: [],
      optionsLoaded: false,
      optionSearch: "",
    };

    function isPlaceholderName(n) { return !n || n === PLACEHOLDER_NAME; }

    // ---- Step completeness. Drives the rail's four-state icons, the
    // non-blocking missing-field banner, and the Publish step's gate.
    // Socials/links/appearance have no required fields — an empty profile is
    // a valid one — so they always read complete.
    function getStatus(key) {
      var p = state.partner;
      if (!p) return "not-started";
      if (key === "socials" || key === "links" || key === "appearance" || key === "publish") return "complete";
      if (key === "basics") {
        if (!isPlaceholderName(p.displayName) && p.slug) return "complete";
        return state.visitedSteps.basics ? "missing" : "not-started";
      }
      if (key === "products") {
        if (state.products.length) return "complete";
        // Genuinely optional — a profile can be links-only — so this never
        // reads as "missing", only as untouched.
        return state.visitedSteps.products ? "complete" : "not-started";
      }
      return "not-started";
    }

    function syncCollections(partner) {
      state.partner = partner;
      state.socials = (partner.socials || []).map(function (s) { return { platform: s.platform, url: s.url }; });
      state.links = (partner.links || []).map(function (l) {
        return {
          title: l.title || "",
          url: l.url || "",
          description: l.description || "",
          icon: l.icon || "link",
          featured: !!l.featured,
        };
      });
      state.products = (partner.products || []).map(function (pp) {
        return {
          productId: pp.productId,
          featured: !!pp.featured,
          name: pp.name,
          slug: pp.slug,
          priceCents: pp.priceCents,
          imageUrl: pp.imageUrl,
          creator: pp.creator,
        };
      });
    }

    function patch(body) {
      return window.AdminAPI.updatePartner(state.partner.id, body).then(function (r) {
        syncCollections(r.partner);
        return r.partner;
      });
    }

    var shell = window.AdminWizardShell.build({
      steps: STEPS,
      loadingText: "Loading partner profile…",
      getStatus: getStatus,
      renderBody: function (key) {
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
        else if (key === "socials") renderSocials(stepHost);
        else if (key === "products") renderProducts(stepHost);
        else if (key === "links") renderLinks(stepHost);
        else if (key === "appearance") renderAppearance(stepHost);
        else if (key === "publish") renderPublish(stepHost);
      },
      discardDraft: function () {
        // Only throw away a draft this wizard just created and that was never
        // named — deleting an existing profile because someone opened and
        // closed it would be catastrophic.
        if (state.isEdit || !state.partner) return null;
        if (!isPlaceholderName(state.partner.displayName)) return null;
        return window.AdminAPI.deletePartner(state.partner.id).catch(function () {});
      },
      getResult: function () { return state.partner; },
      onClose: function (result) { if (onDone) onDone(result); },
    });

    function renderMissingBanner(host, key) {
      if (getStatus(key) !== "missing") { host.innerHTML = ""; return; }
      host.innerHTML = alertHtml(
        "warning",
        "fa-triangle-exclamation",
        "<strong>Missing required information</strong><p>A profile needs a name and a URL before it can be published. You can keep working on other steps and come back.</p>"
      );
    }

    // -----------------------------------------------------------------
    // Step 1 — Basic Information
    // -----------------------------------------------------------------
    function renderBasics(container, bannerHost) {
      renderMissingBanner(bannerHost, "basics");
      var p = state.partner;
      var nameValue = isPlaceholderName(p.displayName) ? "" : p.displayName;

      container.innerHTML =
        "<h5>Basic Information</h5>" +
        '<p class="a-modal-desc">Who this profile is for, and the address it lives at.</p>' +
        '<form id="pwBasics">' +
        '<div class="a-form-grid">' +
        '<div class="a-form-row"><label>Partner name</label>' +
        '<input name="displayName" required maxlength="' + LIMITS.displayName + '" value="' + esc(nameValue) + '" placeholder="Sam Sulek"></div>' +
        '<div class="a-form-row"><label>Handle (optional)</label>' +
        '<input name="handle" maxlength="' + LIMITS.handle + '" value="' + esc(p.handle || "") + '" placeholder="samsulek">' +
        '<small class="a-form-hint">Shown as @handle. A label only — never a link.</small></div>' +
        "</div>" +
        '<div class="a-form-row"><label>Profile URL</label>' +
        '<div class="partner-slug-row"><span class="partner-slug-prefix">' + esc(window.location.origin) + "/partners/</span>" +
        '<input name="slug" value="' + esc(p.slug || "") + '" placeholder="sam-sulek"></div>' +
        '<small class="a-form-hint">Lowercase letters, numbers and hyphens. Changing this changes the public address of a profile that may already be shared.</small></div>' +
        "<h6>Partner type</h6>" +
        '<div class="a-wizard-type-grid">' +
        PARTNER_TYPES.map(function (t) {
          var selected = (p.partnerType || "creator") === t.value;
          return (
            '<div class="a-wizard-option-card' + (selected ? " selected" : "") + '" data-type="' + t.value + '">' +
            '<div class="a-wizard-option-icon"><i class="fa-solid ' + t.icon + '"></i></div>' +
            '<div class="a-wizard-option-text"><strong>' + t.label + "</strong><span>" + t.desc + "</span></div>" +
            '<div class="a-wizard-option-check"><i class="fa-solid fa-circle-check"></i></div>' +
            "</div>"
          );
        }).join("") +
        "</div>" +
        '<div class="a-form-row"><label>Short bio</label>' +
        '<textarea name="bio" rows="3" maxlength="' + LIMITS.bio + '" placeholder="One or two lines. This is also the profile\'s meta description if you don\'t set one.">' + esc(p.bio || "") + "</textarea>" +
        '<small class="a-form-hint"><span id="pwBioCount">' + (p.bio || "").length + "</span>/" + LIMITS.bio + " characters</small></div>" +
        '<div class="a-form-row"><label>Website (optional)</label>' +
        '<input name="websiteUrl" value="' + esc(p.websiteUrl || "") + '" placeholder="https://example.com"></div>' +
        "</form>" +
        "<h6>Profile image</h6>" +
        '<div class="partner-avatar-row">' +
        '<div class="partner-avatar-preview" id="pwAvatarPreview">' +
        (p.avatarUrl
          ? '<img src="' + esc(p.avatarUrl) + '" alt="">'
          : '<span class="partner-avatar-initials">' + esc(initialsOf(nameValue || "?")) + "</span>") +
        "</div>" +
        '<div class="partner-avatar-actions">' +
        '<input type="file" id="pwAvatarInput" accept="image/png,image/jpeg,image/webp" class="u-hidden">' +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm" id="pwAvatarBtn"><i class="fa-solid fa-upload"></i> Upload image</button>' +
        '<small class="a-form-hint">PNG, JPG or WebP, up to 10MB. Square images work best — the profile crops to a circle. Without one, the partner\'s initials are shown.</small>' +
        "</div></div>";

      var form = container.querySelector("#pwBasics");

      // Slug follows the name until an admin edits it by hand. After that it
      // is theirs: silently re-deriving it from the name would move the
      // public URL of a profile they had deliberately addressed.
      var slugInput = form.querySelector('[name="slug"]');
      var nameInput = form.querySelector('[name="displayName"]');
      // Whether the admin has taken ownership of the slug.
      //
      // A brand-new draft already carries a server-generated slug
      // ("untitled-partner") while its name field is still empty — so
      // comparing the stored slug against slugify("") marked EVERY new
      // profile as hand-edited, and the slug then never followed the name
      // being typed. An unnamed draft is by definition untouched.
      var slugTouched = !isPlaceholderName(p.displayName) && !!p.slug && p.slug !== slugify(nameValue);
      slugInput.addEventListener("input", function () { slugTouched = true; });
      nameInput.addEventListener("input", function () {
        if (!slugTouched) slugInput.value = slugify(nameInput.value);
      });

      var bio = form.querySelector('[name="bio"]');
      var bioCount = container.querySelector("#pwBioCount");
      bio.addEventListener("input", function () { bioCount.textContent = String(bio.value.length); });

      container.querySelectorAll("[data-type]").forEach(function (card) {
        card.addEventListener("click", function () {
          state.partner.partnerType = card.dataset.type;
          shell.markDirty();
          renderBasics(container, bannerHost);
        });
      });

      var avatarInput = container.querySelector("#pwAvatarInput");
      container.querySelector("#pwAvatarBtn").addEventListener("click", function () { avatarInput.click(); });
      avatarInput.addEventListener("change", function () {
        var file = avatarInput.files && avatarInput.files[0];
        if (!file) return;
        var fd = new FormData();
        fd.append("avatar", file);
        window.AdminUI.toast("Uploading image…", "info");
        window.AdminAPI.uploadPartnerAvatar(state.partner.id, fd)
          .then(function (r) {
            syncCollections(r.partner);
            window.AdminUI.toast("Profile image updated", "success");
            renderBasics(container, bannerHost);
          })
          .catch(function (err) {
            window.AdminUI.toast(err.message || "Upload failed", "error");
          });
      });

      shell.standardFooter({
        save: function () {
          var fd = new FormData(form);
          var name = String(fd.get("displayName") || "").trim();
          var body = {
            displayName: name || PLACEHOLDER_NAME,
            handle: String(fd.get("handle") || "").trim(),
            bio: String(fd.get("bio") || "").trim(),
            websiteUrl: String(fd.get("websiteUrl") || "").trim(),
            partnerType: state.partner.partnerType || "creator",
          };
          var slug = String(fd.get("slug") || "").trim();
          if (slug) body.slug = slug;
          return patch(body);
        },
      });
    }

    function initialsOf(name) {
      return String(name || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map(function (w) { return w[0]; })
        .join("")
        .toUpperCase();
    }

    // -----------------------------------------------------------------
    // Step 2 — Social Links
    // -----------------------------------------------------------------
    function renderSocials(container) {
      var byPlatform = {};
      state.socials.forEach(function (s) { byPlatform[s.platform] = s.url; });

      container.innerHTML =
        "<h5>Social Links</h5>" +
        '<p class="a-modal-desc">Leave a platform blank to hide it. The profile only renders icons that have a URL — there are never empty placeholders.</p>' +
        alertHtml("info", "fa-circle-info",
          "<strong>Each link is checked against its platform</strong><p>An Instagram field has to contain an instagram.com address, and so on. This stops a profile icon from pointing somewhere it doesn't claim to.</p>") +
        '<form id="pwSocials"><div class="partner-social-list">' +
        PLATFORMS.map(function (pl) {
          return (
            '<div class="partner-social-row">' +
            '<span class="partner-social-icon"><i class="fa-brands ' + pl.icon + '"></i></span>' +
            '<label class="partner-social-label">' + pl.label + "</label>" +
            '<input name="' + pl.key + '" value="' + esc(byPlatform[pl.key] || "") + '" placeholder="' + esc(pl.hint) + '">' +
            "</div>"
          );
        }).join("") +
        "</div></form>";

      var form = container.querySelector("#pwSocials");
      shell.standardFooter({
        save: function () {
          var fd = new FormData(form);
          var socials = [];
          PLATFORMS.forEach(function (pl) {
            var url = String(fd.get(pl.key) || "").trim();
            if (url) socials.push({ platform: pl.key, url: url });
          });
          return patch({ socials: socials });
        },
      });
    }

    // -----------------------------------------------------------------
    // Step 3 — Products (from the existing catalog)
    // -----------------------------------------------------------------
    function renderProducts(container) {
      container.innerHTML =
        "<h5>Products</h5>" +
        '<p class="a-modal-desc">Pick from the products already in the CMS. The profile stores only the selection and its order — name, price and cover are always read live, so editing a product updates every profile featuring it.</p>' +
        '<div class="a-form-row"><label>Search published products</label>' +
        '<input id="pwProductSearch" placeholder="Search by name or creator…" value="' + esc(state.optionSearch) + '"></div>' +
        '<div class="partner-picker" id="pwProductOptions"></div>' +
        "<h6>On this profile <span class=\"partner-count\" id=\"pwProductCount\">" + state.products.length + "</span></h6>" +
        '<div class="partner-selected" id="pwProductSelected"></div>';

      var optionsHost = container.querySelector("#pwProductOptions");
      var selectedHost = container.querySelector("#pwProductSelected");
      var countEl = container.querySelector("#pwProductCount");
      var searchInput = container.querySelector("#pwProductSearch");
      var searchTimer = null;

      function drawSelected() {
        countEl.textContent = String(state.products.length);
        if (!state.products.length) {
          selectedHost.innerHTML = window.AdminUI.emptyState("fa-box", "No products on this profile yet — search above to add some.");
          return;
        }
        selectedHost.innerHTML = state.products
          .map(function (p, i) {
            return (
              '<div class="partner-selected-row" data-index="' + i + '" draggable="true">' +
              '<span class="partner-drag" title="Drag to reorder"><i class="fa-solid fa-grip-vertical"></i></span>' +
              (p.imageUrl ? '<img class="partner-thumb" src="' + esc(p.imageUrl) + '" alt="">' : '<span class="partner-thumb partner-thumb--empty"></span>') +
              '<span class="partner-selected-body"><strong>' + esc(p.name || "(removed product)") + "</strong>" +
              "<span>" + esc([p.creator, formatCents(p.priceCents || 0)].filter(Boolean).join(" · ")) + "</span></span>" +
              '<button type="button" class="a-btn a-btn-sm ' + (p.featured ? "a-btn-primary" : "a-btn-secondary") + '" data-action="feature" title="Show as the featured product">' +
              '<i class="fa-solid fa-star"></i></button> ' +
              '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-action="up" title="Move up"><i class="fa-solid fa-arrow-up"></i></button> ' +
              '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-action="down" title="Move down"><i class="fa-solid fa-arrow-down"></i></button> ' +
              '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-action="remove" title="Remove"><i class="fa-solid fa-xmark"></i></button>' +
              "</div>"
            );
          })
          .join("");
        enableReorder(selectedHost, state.products, drawSelected);
      }

      function drawOptions() {
        var chosen = {};
        state.products.forEach(function (p) { chosen[p.productId] = true; });
        var available = state.productOptions.filter(function (o) { return !chosen[o.id]; });

        if (!state.optionsLoaded) {
          optionsHost.innerHTML = window.AdminUI.skeletonList ? window.AdminUI.skeletonList(3) : "";
          return;
        }
        if (!available.length) {
          optionsHost.innerHTML = window.AdminUI.emptyState(
            "fa-box-open",
            state.optionSearch ? "No published products match that search." : "Every published product is already on this profile."
          );
          return;
        }
        optionsHost.innerHTML = available
          .map(function (o) {
            return (
              '<button type="button" class="partner-picker-row" data-id="' + esc(o.id) + '">' +
              (o.imageUrl ? '<img class="partner-thumb" src="' + esc(o.imageUrl) + '" alt="">' : '<span class="partner-thumb partner-thumb--empty"></span>') +
              '<span class="partner-picker-body"><strong>' + esc(o.name) + "</strong>" +
              "<span>" + esc([o.creator, formatCents(o.priceCents)].filter(Boolean).join(" · ")) + "</span></span>" +
              '<span class="partner-picker-add"><i class="fa-solid fa-plus"></i></span>' +
              "</button>"
            );
          })
          .join("");
      }

      function loadOptions() {
        state.optionsLoaded = false;
        drawOptions();
        return window.AdminAPI.listPartnerProductOptions(state.optionSearch)
          .then(function (data) {
            state.productOptions = window.AdminAPI.rows(data, "products");
            state.optionsLoaded = true;
            drawOptions();
          })
          .catch(function (err) {
            state.optionsLoaded = true;
            optionsHost.innerHTML = window.AdminUI.emptyState("fa-triangle-exclamation", err.message || "Couldn't load products.");
          });
      }

      searchInput.addEventListener("input", function () {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(function () {
          state.optionSearch = searchInput.value.trim();
          loadOptions();
        }, 250);
      });

      optionsHost.addEventListener("click", function (e) {
        var row = e.target.closest("[data-id]");
        if (!row) return;
        var option = state.productOptions.filter(function (o) { return o.id === row.dataset.id; })[0];
        if (!option) return;
        state.products.push({
          productId: option.id,
          featured: state.products.length === 0, // first one added leads
          name: option.name,
          slug: option.slug,
          priceCents: option.priceCents,
          imageUrl: option.imageUrl,
          creator: option.creator,
        });
        shell.markDirty();
        drawSelected();
        drawOptions();
      });

      selectedHost.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-action]");
        if (!btn) return;
        var row = btn.closest("[data-index]");
        var i = parseInt(row.dataset.index, 10);
        var action = btn.dataset.action;

        if (action === "remove") state.products.splice(i, 1);
        else if (action === "up" && i > 0) swap(state.products, i, i - 1);
        else if (action === "down" && i < state.products.length - 1) swap(state.products, i, i + 1);
        else if (action === "feature") {
          var wasFeatured = state.products[i].featured;
          state.products.forEach(function (p) { p.featured = false; });
          state.products[i].featured = !wasFeatured;
        }
        shell.markDirty();
        drawSelected();
        drawOptions();
      });

      drawSelected();
      loadOptions();

      shell.standardFooter({
        save: function () {
          return patch({
            products: state.products.map(function (p) {
              return { productId: p.productId, featured: !!p.featured };
            }),
          });
        },
      });
    }

    function swap(arr, a, b) {
      var t = arr[a];
      arr[a] = arr[b];
      arr[b] = t;
    }

    // HTML5 drag-reorder, matching the pattern already used by the product
    // builder and gallery. The up/down buttons alongside it are not
    // redundant: HTML5 DnD does not fire on touch, and this admin is usable
    // on a tablet — so the buttons are the accessible, always-working path
    // and dragging is the fast one.
    function enableReorder(host, list, redraw) {
      var dragIndex = null;
      host.querySelectorAll("[data-index][draggable='true']").forEach(function (el) {
        el.addEventListener("dragstart", function (e) {
          dragIndex = parseInt(el.dataset.index, 10);
          el.classList.add("is-dragging");
          try { e.dataTransfer.setData("text/plain", String(dragIndex)); } catch (err) { /* Safari */ }
          e.dataTransfer.effectAllowed = "move";
        });
        el.addEventListener("dragend", function () { el.classList.remove("is-dragging"); });
        el.addEventListener("dragover", function (e) {
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
        });
        el.addEventListener("drop", function (e) {
          e.preventDefault();
          var to = parseInt(el.dataset.index, 10);
          if (dragIndex === null || to === dragIndex) return;
          var moved = list.splice(dragIndex, 1)[0];
          list.splice(to, 0, moved);
          dragIndex = null;
          shell.markDirty();
          redraw();
        });
      });
    }

    // -----------------------------------------------------------------
    // Step 4 — Custom Links
    // -----------------------------------------------------------------
    function renderLinks(container) {
      container.innerHTML =
        "<h5>Custom Links</h5>" +
        '<p class="a-modal-desc">Anything else the partner wants on the page. One link can be marked featured — it becomes the single primary button above the fold.</p>' +
        alertHtml("info", "fa-circle-info",
          "<strong>Internal links are welcome</strong><p>A path like <code>/shop</code> or <code>/goal/gain-muscle</code> keeps the visitor on the platform and passes crawl signal. Full https:// addresses open in a new tab.</p>") +
        '<div class="partner-selected" id="pwLinkList"></div>' +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm" id="pwAddLink"><i class="fa-solid fa-plus"></i> Add link</button>';

      var listHost = container.querySelector("#pwLinkList");

      function draw() {
        if (!state.links.length) {
          listHost.innerHTML = window.AdminUI.emptyState("fa-link", "No custom links yet.");
          return;
        }
        listHost.innerHTML = state.links
          .map(function (l, i) {
            return (
              '<div class="partner-link-row" data-index="' + i + '" draggable="true">' +
              '<span class="partner-drag" title="Drag to reorder"><i class="fa-solid fa-grip-vertical"></i></span>' +
              '<div class="partner-link-fields">' +
              '<input data-field="title" maxlength="' + LIMITS.linkTitle + '" placeholder="Link title" value="' + esc(l.title) + '">' +
              '<input data-field="url" placeholder="/shop or https://example.com" value="' + esc(l.url) + '">' +
              '<input data-field="description" maxlength="' + LIMITS.linkDescription + '" placeholder="Optional one-line description" value="' + esc(l.description) + '">' +
              '<select data-field="icon">' +
              LINK_ICONS.map(function (ic) {
                return '<option value="' + ic.value + '"' + (l.icon === ic.value ? " selected" : "") + ">" + ic.label + "</option>";
              }).join("") +
              "</select>" +
              "</div>" +
              '<div class="partner-link-actions">' +
              '<button type="button" class="a-btn a-btn-sm ' + (l.featured ? "a-btn-primary" : "a-btn-secondary") + '" data-action="feature" title="Make this the primary button"><i class="fa-solid fa-star"></i></button> ' +
              '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-action="up" title="Move up"><i class="fa-solid fa-arrow-up"></i></button> ' +
              '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-action="down" title="Move down"><i class="fa-solid fa-arrow-down"></i></button> ' +
              '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-action="remove" title="Remove"><i class="fa-solid fa-xmark"></i></button>' +
              "</div></div>"
            );
          })
          .join("");
        enableReorder(listHost, state.links, draw);
      }

      // Field edits are captured on input so a value survives a redraw
      // (reorder/feature) without needing a save round-trip first.
      listHost.addEventListener("input", function (e) {
        var input = e.target.closest("[data-field]");
        if (!input) return;
        var i = parseInt(input.closest("[data-index]").dataset.index, 10);
        state.links[i][input.dataset.field] = input.value;
        shell.markDirty();
      });
      listHost.addEventListener("change", function (e) {
        var sel = e.target.closest('select[data-field]');
        if (!sel) return;
        var i = parseInt(sel.closest("[data-index]").dataset.index, 10);
        state.links[i][sel.dataset.field] = sel.value;
        shell.markDirty();
      });

      listHost.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-action]");
        if (!btn) return;
        var i = parseInt(btn.closest("[data-index]").dataset.index, 10);
        var action = btn.dataset.action;
        if (action === "remove") state.links.splice(i, 1);
        else if (action === "up" && i > 0) swap(state.links, i, i - 1);
        else if (action === "down" && i < state.links.length - 1) swap(state.links, i, i + 1);
        else if (action === "feature") {
          var was = state.links[i].featured;
          state.links.forEach(function (l) { l.featured = false; });
          state.links[i].featured = !was;
        }
        shell.markDirty();
        draw();
      });

      container.querySelector("#pwAddLink").addEventListener("click", function () {
        state.links.push({ title: "", url: "", description: "", icon: "link", featured: false });
        shell.markDirty();
        draw();
      });

      draw();

      shell.standardFooter({
        save: function () {
          // Drop rows the admin added and never filled in, so an empty row
          // left behind is not a validation error they have to hunt down.
          var links = state.links.filter(function (l) { return l.title.trim() || l.url.trim(); });
          return patch({ links: links });
        },
      });
    }

    // -----------------------------------------------------------------
    // Step 5 — Appearance
    // -----------------------------------------------------------------
    function renderAppearance(container) {
      var p = state.partner;
      container.innerHTML =
        "<h5>Appearance</h5>" +
        '<p class="a-modal-desc">Deliberately limited. Every partner profile stays on the Fitness Agency design system — there are no free colour or font controls, so no profile can drift off-brand.</p>' +
        "<h6>Product layout</h6>" +
        '<div class="a-wizard-type-grid">' +
        [
          { value: "stack", label: "Stacked", desc: "One product per row. Best for most profiles.", icon: "fa-bars" },
          { value: "grid", label: "Two column", desc: "Products pair up on wider screens. Good for large catalogues.", icon: "fa-table-cells-large" },
        ].map(function (o) {
          var sel = (p.layout || "stack") === o.value;
          return (
            '<div class="a-wizard-option-card' + (sel ? " selected" : "") + '" data-layout="' + o.value + '">' +
            '<div class="a-wizard-option-icon"><i class="fa-solid ' + o.icon + '"></i></div>' +
            '<div class="a-wizard-option-text"><strong>' + o.label + "</strong><span>" + o.desc + "</span></div>" +
            '<div class="a-wizard-option-check"><i class="fa-solid fa-circle-check"></i></div></div>'
          );
        }).join("") +
        "</div>" +
        '<form id="pwAppearance">' +
        '<div class="a-form-row"><label>Featured product button label</label>' +
        '<input name="ctaLabel" maxlength="' + LIMITS.ctaLabel + '" value="' + esc(p.ctaLabel || "") + '" placeholder="View program">' +
        '<small class="a-form-hint">Shown on the featured product card. Leave blank for "View program".</small></div>' +
        '<div class="a-form-row"><label>Meta description (optional)</label>' +
        '<textarea name="metaDescription" rows="2" maxlength="200" placeholder="Falls back to the bio, then to a generated line.">' + esc(p.metaDescription || "") + "</textarea>" +
        '<small class="a-form-hint">Used by search engines and link previews.</small></div>' +
        "</form>";

      container.querySelectorAll("[data-layout]").forEach(function (card) {
        card.addEventListener("click", function () {
          state.partner.layout = card.dataset.layout;
          shell.markDirty();
          renderAppearance(container);
        });
      });

      var form = container.querySelector("#pwAppearance");
      shell.standardFooter({
        save: function () {
          var fd = new FormData(form);
          return patch({
            layout: state.partner.layout || "stack",
            accent: state.partner.accent || "brand",
            ctaLabel: String(fd.get("ctaLabel") || "").trim(),
            metaDescription: String(fd.get("metaDescription") || "").trim(),
          });
        },
      });
    }

    // -----------------------------------------------------------------
    // Step 6 — Publish (with live desktop + mobile preview)
    // -----------------------------------------------------------------
    function renderPublish(container) {
      var p = state.partner;
      var url = window.location.origin + "/partners/" + p.slug;
      var ready = !isPlaceholderName(p.displayName) && !!p.slug;
      var isPublished = p.status === "published";

      container.innerHTML =
        "<h5>Publish</h5>" +
        '<p class="a-modal-desc">The preview below is the real page, rendered by the same code the public gets — not a mock-up.</p>' +
        (ready
          ? ""
          : alertHtml("warning", "fa-triangle-exclamation",
              "<strong>Not ready to publish</strong><p>Give the profile a name on the Basic Information step first.</p>")) +
        '<div class="partner-publish-url"><span class="partner-publish-url__label">Public URL</span>' +
        '<code id="pwPublicUrl">' + esc(url) + "</code>" +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm" id="pwCopyUrl"><i class="fa-solid fa-link"></i> Copy</button>' +
        '<a class="a-btn a-btn-secondary a-btn-sm" href="' + esc(url) + '" target="_blank" rel="noopener"><i class="fa-solid fa-arrow-up-right-from-square"></i> Open</a>' +
        "</div>" +
        '<div class="partner-status-row">' +
        "<span>Status: <strong>" + esc(p.status) + "</strong></span>" +
        (isPublished
          ? '<button type="button" class="a-btn a-btn-secondary a-btn-sm" id="pwToggle"><i class="fa-solid fa-eye-slash"></i> Unpublish</button>'
          : '<button type="button" class="a-btn a-btn-primary a-btn-sm" id="pwToggle"' + (ready ? "" : " disabled") + '><i class="fa-solid fa-cloud-arrow-up"></i> Publish profile</button>') +
        "</div>" +
        '<div class="partner-preview-tabs">' +
        '<button type="button" class="a-btn a-btn-sm a-btn-primary" data-preview="mobile"><i class="fa-solid fa-mobile-screen"></i> Mobile</button> ' +
        '<button type="button" class="a-btn a-btn-sm a-btn-secondary" data-preview="desktop"><i class="fa-solid fa-desktop"></i> Desktop</button>' +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm" id="pwRefresh" title="Reload preview"><i class="fa-solid fa-rotate-right"></i></button>' +
        "</div>" +
        '<div class="partner-preview" id="pwPreviewHost"></div>';

      var host = container.querySelector("#pwPreviewHost");
      var mode = "mobile";

      function drawPreview() {
        // A cache-buster so the iframe reflects the save that just happened
        // rather than a cached render of the previous state.
        var src = url + "?preview=" + Date.now();
        host.className = "partner-preview partner-preview--" + mode;
        host.innerHTML =
          '<div class="partner-preview__frame">' +
          '<iframe src="' + esc(src) + '" title="Profile preview" loading="lazy"></iframe>' +
          "</div>";
      }

      container.querySelectorAll("[data-preview]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          mode = btn.dataset.preview;
          container.querySelectorAll("[data-preview]").forEach(function (b) {
            var active = b.dataset.preview === mode;
            b.classList.toggle("a-btn-primary", active);
            b.classList.toggle("a-btn-secondary", !active);
          });
          drawPreview();
        });
      });
      container.querySelector("#pwRefresh").addEventListener("click", drawPreview);

      container.querySelector("#pwCopyUrl").addEventListener("click", function () {
        if (navigator.clipboard && window.isSecureContext) {
          navigator.clipboard.writeText(url).then(
            function () { window.AdminUI.toast("Profile URL copied", "success"); },
            function () { window.prompt("Copy this profile URL:", url); }
          );
        } else {
          window.prompt("Copy this profile URL:", url);
        }
      });

      container.querySelector("#pwToggle").addEventListener("click", function () {
        var call = isPublished
          ? window.AdminAPI.unpublishPartner(state.partner.id)
          : window.AdminAPI.publishPartner(state.partner.id);
        call
          .then(function (r) {
            syncCollections(r.partner);
            window.AdminUI.toast(isPublished ? "Profile unpublished" : "Profile published", "success");
            shell.refreshSteps();
            renderPublish(container);
          })
          .catch(function (err) {
            window.AdminUI.toast(err.message || "Could not change status", "error");
          });
      });

      drawPreview();

      // Terminal step: its own footer, and a no-op save handler so the shell
      // has something to call when the admin navigates away from it.
      shell.setSaveHandler(function () { return Promise.resolve(); });
      shell.footerEl.innerHTML =
        '<div class="a-wizard-actions">' +
        '<button type="button" class="a-btn a-btn-secondary a-btn-sm" data-act="cancel">Close</button>' +
        '<div class="a-wizard-actions-right">' +
        '<button type="button" class="a-btn a-btn-secondary" data-act="back">Back</button>' +
        '<button type="button" class="a-btn a-btn-primary" data-act="done">Done</button>' +
        "</div></div>";
      shell.footerEl.querySelector('[data-act="cancel"]').addEventListener("click", shell.requestClose);
      shell.footerEl.querySelector('[data-act="back"]').addEventListener("click", function () {
        shell.start(STEPS.length - 2);
      });
      shell.footerEl.querySelector('[data-act="done"]').addEventListener("click", function () {
        shell.close(state.partner);
      });
    }

    // -----------------------------------------------------------------
    // Boot
    // -----------------------------------------------------------------
    var boot = partnerId
      ? window.AdminAPI.getPartner(partnerId)
      : window.AdminAPI.createPartner({ displayName: PLACEHOLDER_NAME });

    boot
      .then(function (r) {
        syncCollections(r.partner);
        shell.start(0);
      })
      .catch(function (err) {
        window.AdminUI.toast(err.message || "Could not open the partner wizard", "error");
        shell.close(null);
      });
  }

  return { open: open };
})();
