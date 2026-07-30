/* ===========================================================================
   PURCHASED PROGRAM — /my-library/:slug

   The controller for the app shell in program.html. Access is enforced
   server-side (GET /api/library/program/:id 403s if not entitled); this
   script only reflects that outcome, then turns the payload into an
   application: one section visible at a time, a resume control that knows
   where the customer stopped, and progress that survives closing the tab.

   Three ideas hold the whole thing together:

   1. TRACKABLES. Everything a customer can finish — a handbook chapter, a
      training day, a meal, a video — is reduced to one flat list of items
      with a stable key, a kind and a minutes estimate. Completion, the
      per-kind counters and "time left" are all derived from that one list,
      so no two numbers on the page can ever disagree.

   2. NO DOUBLE COUNTING. The handbook paginates a training day into its own
      chapter page, so `chapter:day:*` and `chapter:meal:*` keys are
      deliberately excluded from the completion denominator — the day itself
      already counts, once, as a session. Reading about a session is not
      doing it, and the page never claims otherwise.

   3. KEYS ARE CONTENT-DERIVED, NOT ORDINAL. "training:2:1" is week 3 day 2
      by identity, so a creator inserting a week in the admin wizard shifts
      nobody's history. Keys that no longer resolve are ignored at render
      time rather than cleared — see the ProgramProgress comment in
      server/prisma/schema.prisma for why the server never validates them.
   =========================================================================== */
(function () {
  "use strict";

  var SAVE_DEBOUNCE_MS = 700;

  // Minutes-per-item estimates behind "≈ 4h left". Deliberately coarse and
  // always rendered with a "≈": the platform stores no durations, so these
  // are honest approximations, not measurements.
  var MINUTES = { chapter: 3, session: 45, meal: 4, video: 6 };

  var ICON = {
    overview: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="7" height="7" rx="2"/><rect x="13.5" y="3.5" width="7" height="7" rx="2"/><rect x="3.5" y="13.5" width="7" height="7" rx="2"/><rect x="13.5" y="13.5" width="7" height="7" rx="2"/></svg>',
    program: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6M7 6.5v11M17 6.5v11M20 9v6M7 12h10"/></svg>',
    videos: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="5" width="19" height="14" rx="3"/><path d="M10.5 9.2v5.6L15 12z"/></svg>',
    handbook: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2 2 0 016 3.5h5.5v17H6a2 2 0 01-2-2z"/><path d="M20 5.5a2 2 0 00-2-2h-6.5v17H18a2 2 0 002-2z"/></svg>',
    downloads: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.5v11M8 11l4 3.5 4-3.5"/><path d="M4.5 16v2.5a2 2 0 002 2h11a2 2 0 002-2V16"/></svg>',
    updates: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3l2.1 5.2L19.5 10l-5.4 1.8L12 17l-2.1-5.2L4.5 10l5.4-1.8z"/><path d="M18.5 15.5l.9 2.1 2.1.9-2.1.9-.9 2.1-.9-2.1-2.1-.9 2.1-.9z"/></svg>',
    community: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="9" cy="8" r="3.4"/><path d="M2.8 20a6.2 6.2 0 0112.4 0"/><path d="M16 5.2a3.4 3.4 0 010 5.6M17.6 14.6A6.2 6.2 0 0121.2 20"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="18.5" cy="12" r="1.4"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    chevron: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9.5l6 6 6-6"/></svg>',
    arrow: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    play: '<svg viewBox="0 0 24 24" aria-hidden="true" class="is-solid"><path d="M8 5.2v13.6L19 12z"/></svg>',
    clock: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 1.8"/></svg>',
    level: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 20V14M12 20V8M19 20V4"/></svg>',
    calendar: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5"/><path d="M3.5 10h17M8 3.5v3M16 3.5v3"/></svg>',
    tag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11V4.5a1 1 0 011-1H11l9 9-7.5 7.5z"/><circle cx="7.8" cy="7.8" r="1.2"/></svg>',
    file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3.5H7.5A2 2 0 005.5 5.5v13a2 2 0 002 2h9a2 2 0 002-2V8z"/><path d="M14 3.5V8h4.5"/></svg>',
    link: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4h6v6M20 4l-8.5 8.5"/><path d="M18 14v5a1.8 1.8 0 01-1.8 1.8H5A1.8 1.8 0 013.2 19V7.8A1.8 1.8 0 015 6h5"/></svg>',
    bulb: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 17h6M10 20.5h4"/><path d="M12 3a5.5 5.5 0 00-3.2 10c.5.4.7.9.7 1.5h5c0-.6.2-1.1.7-1.5A5.5 5.5 0 0012 3z"/></svg>',
    info: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.8v.4"/></svg>',
    mail: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2.5"/><path d="M3.6 6.5L12 13l8.4-6.5"/></svg>',
    flag: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 21V3.5M5.5 4.5h11l-2 3.5 2 3.5h-11"/></svg>',
    image: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.6"/><path d="M3.5 17l5-4.5 4 3.5 3-2.5 5 4"/></svg>',
  };

  /* ------------------------------------------------------------- helpers --- */

  function esc(str) {
    return String(str == null ? "" : str).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }

  function $(id) { return document.getElementById(id); }

  function el(html) {
    var wrap = document.createElement("div");
    wrap.innerHTML = html;
    return wrap.firstElementChild;
  }

  // Paragraph-splits CMS free text. Creators type into a plain textarea, so
  // blank lines are the only structure the content has — honouring them is
  // the difference between a readable page and one wall of text.
  function paragraphs(text) {
    if (!text) return "";
    return String(text)
      .split(/\n\s*\n|\n/)
      .map(function (line) { return line.trim(); })
      .filter(Boolean)
      .map(function (line) { return "<p>" + esc(line) + "</p>"; })
      .join("");
  }

  function plural(n, one, many) { return n + " " + (n === 1 ? one : many); }

  function fmtDuration(minutes) {
    if (!minutes) return "0m";
    var h = Math.floor(minutes / 60);
    var m = Math.round(minutes % 60);
    if (h && m) return h + "h " + m + "m";
    if (h) return h + "h";
    return m + "m";
  }

  function fmtDate(value) {
    if (!value) return "";
    var d = new Date(value);
    if (isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
  }

  function fmtRelative(value) {
    if (!value) return "";
    var d = new Date(value);
    if (isNaN(d)) return "";
    var diff = Date.now() - d.getTime();
    var mins = Math.round(diff / 60000);
    if (mins < 2) return "just now";
    if (mins < 60) return mins + " minutes ago";
    var hours = Math.round(mins / 60);
    if (hours < 24) return plural(hours, "hour", "hours") + " ago";
    var days = Math.round(hours / 24);
    if (days === 1) return "yesterday";
    if (days < 30) return plural(days, "day", "days") + " ago";
    return "on " + fmtDate(value);
  }

  // YouTube/Vimeo links stored as ProductResource(type:"link") become real
  // players. Anything else stays a link — we never iframe an arbitrary
  // third-party URL. (Both hosts are allow-listed in the CSP; nothing else
  // is, so this list and that policy have to stay in step.)
  function toEmbedUrl(url, type) {
    if (type !== "link" || !url) return null;
    var yt = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([\w-]{6,})/);
    if (yt) return "https://www.youtube.com/embed/" + yt[1];
    var vimeo = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
    if (vimeo) return "https://player.vimeo.com/video/" + vimeo[1];
    return null;
  }

  /* --------------------------------------------------------------- state --- */

  var productRef = "";      // the id or slug in the URL
  var payload = null;
  var product = null;
  var chapters = [];        // handbook pages, from ProgramViewer
  var trackables = [];      // the single completion denominator
  var byKey = Object.create(null);
  var done = Object.create(null);
  var lastKey = null;
  var lastSection = null;
  var canSync = true;       // false in admin preview — no entitlement to write against
  var videoItems = [];      // media-viewer items for the Videos section
  var galleryItems = [];    // media-viewer items for the Overview gallery
  var sections = [];
  var activeSection = "overview";
  var saveTimer = 0;

  /* ------------------------------------------------------------ progress --- */

  function isDone(key) { return !!done[key]; }

  function markDone(key, value) {
    if (!key) return;
    if (value === false) delete done[key];
    else done[key] = true;
    scheduleSave();
    refreshProgress();
  }

  function setPosition(key, section) {
    lastKey = key || lastKey;
    lastSection = section || lastSection;
    scheduleSave();
  }

  function scheduleSave() {
    if (!canSync) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(save, SAVE_DEBOUNCE_MS);
  }

  function save() {
    if (!canSync) return;
    clearTimeout(saveTimer);
    window.ProFitAPI.saveProgramProgress(productRef, {
      completedKeys: Object.keys(done),
      lastKey: lastKey,
      lastSection: lastSection,
    }).catch(function () {
      // A failed sync is not worth interrupting a workout over: the page
      // keeps its in-memory state and the next change tries again.
    });
  }

  function stats() {
    var total = trackables.length;
    var complete = 0;
    var minutesLeft = 0;
    var byKind = {};

    trackables.forEach(function (item) {
      var kind = byKind[item.kind] || (byKind[item.kind] = { total: 0, done: 0 });
      kind.total++;
      if (isDone(item.key)) { complete++; kind.done++; }
      else minutesLeft += item.minutes;
    });

    // Chapters read is counted across every handbook page, including the
    // day/meal pages excluded from the completion denominator — "how much
    // of the book have I read" is a different question from "how much of
    // the program have I done", and both are shown.
    var chaptersRead = 0;
    chapters.forEach(function (ch) { if (isDone(ch.key)) chaptersRead++; });

    return {
      total: total,
      complete: complete,
      pct: total ? Math.round((complete / total) * 100) : 0,
      minutesLeft: minutesLeft,
      byKind: byKind,
      chaptersRead: chaptersRead,
      chaptersTotal: chapters.length,
    };
  }

  // The next thing to do: the stored position if it still resolves and is
  // unfinished, otherwise the first incomplete trackable in program order.
  function nextTrackable() {
    if (lastKey && byKey[lastKey] && !isDone(lastKey)) return byKey[lastKey];
    for (var i = 0; i < trackables.length; i++) {
      if (!isDone(trackables[i].key)) return trackables[i];
    }
    return null;
  }

  /* ------------------------------------------------------- trackable list --- */

  function buildTrackables() {
    trackables = [];
    byKey = Object.create(null);

    function add(key, kind, label, section, meta) {
      var item = { key: key, kind: kind, label: label, section: section, minutes: MINUTES[kind] || 3, meta: meta || null };
      trackables.push(item);
      byKey[key] = item;
      return item;
    }

    // Prose chapters only — see "NO DOUBLE COUNTING" in the header.
    chapters.forEach(function (ch) {
      if (/^chapter:(day|meal):/.test(ch.key)) return;
      add(ch.key, "chapter", ch.title || ch.section, "handbook");
    });

    var weeks = (product.trainingContent && product.trainingContent.weeks) || [];
    weeks.forEach(function (week, wi) {
      (week.days || []).forEach(function (day, di) {
        add("training:" + wi + ":" + di, "session",
          day.title || "Day " + (di + 1), "program",
          { weekTitle: week.title || "Week " + (wi + 1), wi: wi, di: di });
      });
    });

    var meals = (product.nutritionContent && product.nutritionContent.meals) || [];
    meals.forEach(function (meal, mi) {
      add("meal:" + mi, "meal", meal.name || "Meal " + (mi + 1), "program", { mi: mi });
    });

    videoItems.forEach(function (v) {
      add(v.key, "video", v.title, "videos");
    });
  }

  /* ---------------------------------------------------------- media lists --- */

  function buildMediaLists() {
    galleryItems = [];
    videoItems = [];

    (product.media || []).forEach(function (m) {
      if (m.type === "video") {
        videoItems.push({
          key: "video:" + m.id,
          type: "video",
          url: m.url,
          title: m.alt || product.name,
          subtitle: "Program video",
        });
      } else {
        galleryItems.push({
          key: "image:" + m.id,
          type: "image",
          url: m.url,
          alt: m.alt || product.name,
          title: m.alt || product.name,
          subtitle: product.name,
        });
      }
    });

    // Embeddable bonus links are videos too — a customer does not care that
    // one lives in ProductMedia and the other in ProductResource.
    (product.resources || []).forEach(function (r) {
      var embed = toEmbedUrl(r.url, r.type);
      if (!embed) return;
      videoItems.push({
        key: "video:" + r.id,
        type: "embed",
        url: embed,
        title: r.title,
        subtitle: r.description || "Bonus video",
      });
    });
  }

  /* ------------------------------------------------------------ sections --- */

  var SECTION_DEFS = [
    { id: "overview", label: "Overview", icon: "overview" },
    { id: "program", label: "Program", icon: "program" },
    { id: "videos", label: "Videos", icon: "videos" },
    { id: "handbook", label: "Handbook", icon: "handbook" },
    { id: "downloads", label: "Downloads", icon: "downloads" },
    { id: "updates", label: "Updates", icon: "updates" },
    { id: "community", label: "Community", icon: "community", soon: true },
  ];

  function sectionCount(id) {
    if (id === "program") {
      var s = stats();
      var sessions = s.byKind.session ? s.byKind.session.total : 0;
      var meals = s.byKind.meal ? s.byKind.meal.total : 0;
      return sessions ? plural(sessions, "day", "days") : meals ? plural(meals, "meal", "meals") : "";
    }
    if (id === "videos") return videoItems.length ? String(videoItems.length) : "";
    if (id === "handbook") return chapters.length ? String(chapters.length) : "";
    if (id === "downloads") return downloadResources().length ? String(downloadResources().length) : "";
    if (id === "community") return "Soon";
    return "";
  }

  function downloadResources() {
    return (product.resources || []).filter(function (r) { return !toEmbedUrl(r.url, r.type); });
  }

  function hasContent(id) {
    switch (id) {
      case "overview": return true;
      case "program": return !!(trackables.some(function (t) { return t.kind === "session" || t.kind === "meal"; }));
      case "videos": return videoItems.length > 0;
      case "handbook": return chapters.length > 1;
      case "downloads": return downloadResources().length > 0;
      case "updates": return true;
      case "community": return true;
      default: return false;
    }
  }

  function setSection(id, opts) {
    var options = opts || {};
    if (!sections.some(function (s) { return s.id === id; })) id = "overview";
    activeSection = id;

    SECTION_DEFS.forEach(function (def) {
      var panel = $("pgPanel-" + def.id);
      if (!panel) return;
      var active = def.id === id;
      // The class drives the entry animation; toggling it off and on again
      // is what re-triggers it when the same section is re-selected.
      panel.classList.remove("is-active");
      if (active) {
        // Force a reflow so the animation restarts rather than being
        // coalesced away by the style recalculation.
        void panel.offsetWidth;
        panel.classList.add("is-active");
      }
    });

    document.querySelectorAll("[data-nav-section]").forEach(function (node) {
      node.classList.toggle("is-active", node.getAttribute("data-nav-section") === id);
    });

    if (!options.silent) {
      try { history.replaceState(null, "", "#" + id); } catch (e) { /* file:// and old Safari */ }
    }
    setPosition(null, id);
    revealIn($("pgPanel-" + id));

    if (options.scroll !== false) {
      var panels = $("pgPanels");
      var top = panels.getBoundingClientRect().top + window.pageYOffset - 68;
      window.scrollTo({ top: Math.max(0, top), behavior: options.instant ? "auto" : "smooth" });
    }
  }

  /* ------------------------------------------------------------ nav build --- */

  function navItemHtml(def, context) {
    var count = sectionCount(def.id);
    return (
      '<button type="button" class="pg-navitem' + (def.soon ? " pg-navitem--soon" : "") +
      '" data-nav-section="' + def.id + '" data-nav-context="' + context + '">' +
      '<span class="pg-navitem__icon">' + ICON[def.icon] + "</span>" +
      '<span class="pg-navitem__label">' + esc(def.label) + "</span>" +
      (count ? '<span class="pg-navitem__count">' + esc(count) + "</span>" : "") +
      "</button>"
    );
  }

  function buildNav() {
    $("pgRailNav").innerHTML = sections.map(function (def) { return navItemHtml(def, "rail"); }).join("");
    $("pgSheetList").innerHTML = sections.map(function (def) { return navItemHtml(def, "sheet"); }).join("");

    // Bottom bar: the three most-used sections plus an always-present
    // "More". Four 25%-wide targets, never a scrolling strip of tabs.
    var primary = sections.slice(0, 3);
    var tabbar = $("pgTabbar");
    tabbar.innerHTML =
      primary.map(function (def) {
        return (
          '<button type="button" class="pg-tab" data-nav-section="' + def.id + '" data-nav-context="tab">' +
          ICON[def.icon] + '<span class="pg-tab__label">' + esc(def.label) + "</span></button>"
        );
      }).join("") +
      '<button type="button" class="pg-tab" data-sheet-open>' + ICON.more + '<span class="pg-tab__label">More</span></button>';
    tabbar.classList.remove("u-hidden");

    document.querySelectorAll("[data-nav-section]").forEach(function (node) {
      node.addEventListener("click", function () {
        setSection(node.getAttribute("data-nav-section"));
        closeSheet();
      });
    });
    document.querySelectorAll("[data-sheet-open]").forEach(function (node) {
      node.addEventListener("click", openSheet);
    });
  }

  /* --------------------------------------------------------- bottom sheet --- */

  var sheetLastFocused = null;

  function openSheet() {
    sheetLastFocused = document.activeElement;
    var sheet = $("pgSheet");
    sheet.classList.add("is-open");
    sheet.setAttribute("aria-hidden", "false");
    document.body.classList.add("pg-sheet-open");
    $("pgSheetClose").focus();
    document.addEventListener("keydown", onSheetKey);
  }

  function closeSheet() {
    var sheet = $("pgSheet");
    if (!sheet.classList.contains("is-open")) return;
    sheet.classList.remove("is-open");
    sheet.setAttribute("aria-hidden", "true");
    document.body.classList.remove("pg-sheet-open");
    document.removeEventListener("keydown", onSheetKey);
    if (sheetLastFocused && sheetLastFocused.focus) sheetLastFocused.focus();
  }

  function onSheetKey(e) { if (e.key === "Escape") closeSheet(); }

  /* --------------------------------------------------------------- hero --- */

  function renderHero() {
    $("pgHeroTitle").textContent = product.name;
    $("pgAppbarTitle").textContent = product.name;
    $("pgRailTitle").textContent = product.name;
    $("pgRailCreator").textContent = product.creator || "";

    var cover = product.imageUrl || "/assets/images/product/product-image1.png";
    $("pgHeroImage").src = cover;
    $("pgHeroImage").alt = product.name + " cover";
    $("pgRailThumb").src = cover;
    $("pgRailThumb").alt = "";

    // Eyebrow: the fact the hero exists to confirm, plus when it became
    // theirs. In preview there is no purchase, so it says so instead.
    var eyebrow = $("pgHeroEyebrow");
    if (payload.preview) {
      eyebrow.innerHTML = '<span class="pg-hero__owned">Customer preview</span>';
    } else {
      eyebrow.innerHTML =
        '<span class="pg-hero__owned">In your library</span>' +
        (payload.purchasedAt ? "<span>· since " + esc(fmtDate(payload.purchasedAt)) + "</span>" : "");
    }

    if (product.creator) {
      $("pgHeroCreator").innerHTML = "by <strong>" + esc(product.creator) + "</strong>";
      $("pgHeroCreator").classList.remove("u-hidden");
    }

    var chips = [];
    if (product.durationWeeks) chips.push(ICON.calendar + plural(product.durationWeeks, "week", "weeks"));
    if (product.difficulty) chips.push(ICON.level + esc(product.difficulty));
    var totalMinutes = trackables.reduce(function (sum, t) { return sum + t.minutes; }, 0);
    // "of content", not "total": this is the sum of the MINUTES estimates
    // for everything in the program, which is not the same thing as how
    // long a 12-week block takes to run. Saying "total" would read as the
    // latter and be wrong by an order of magnitude.
    if (totalMinutes) chips.push(ICON.clock + "≈ " + fmtDuration(totalMinutes) + " of content");
    (product.categories || []).slice(0, 2).forEach(function (c) { chips.push(ICON.tag + esc(c)); });
    $("pgHeroChips").innerHTML = chips.map(function (c) { return "<li>" + c + "</li>"; }).join("");

    renderStats();
    renderContinue();
  }

  function renderStats() {
    var s = stats();
    var sessions = s.byKind.session;
    var videos = s.byKind.video;

    var tiles = [
      '<div class="pg-stat pg-stat--wide">' +
        '<span class="pg-stat__value">' + s.pct + "%</span>" +
        '<span class="pg-stat__label">Complete · ' + s.complete + " of " + s.total + " items</span>" +
        '<div class="pg-meter"><i data-hero-meter></i></div>' +
      "</div>",
    ];
    if (sessions) {
      tiles.push(
        '<div class="pg-stat"><span class="pg-stat__value">' + sessions.done + "/" + sessions.total + "</span>" +
        '<span class="pg-stat__label">Sessions done</span></div>'
      );
    }
    if (videos) {
      tiles.push(
        '<div class="pg-stat"><span class="pg-stat__value">' + videos.done + "/" + videos.total + "</span>" +
        '<span class="pg-stat__label">Videos watched</span></div>'
      );
    }
    if (s.chaptersTotal) {
      tiles.push(
        '<div class="pg-stat"><span class="pg-stat__value">' + s.chaptersRead + "/" + s.chaptersTotal + "</span>" +
        '<span class="pg-stat__label">Chapters read</span></div>'
      );
    }
    tiles.push(
      '<div class="pg-stat"><span class="pg-stat__value">≈ ' + fmtDuration(s.minutesLeft) + "</span>" +
      '<span class="pg-stat__label">Estimated time left</span></div>'
    );

    $("pgHeroStats").innerHTML = tiles.join("");
    var meter = $("pgHeroStats").querySelector("[data-hero-meter]");
    if (meter) {
      // Next frame so the bar animates from 0 rather than painting full.
      requestAnimationFrame(function () { meter.style.width = s.pct + "%"; });
    }
  }

  function renderContinue() {
    var s = stats();
    var next = nextTrackable();
    var label = $("pgContinueLabel");
    var sub = $("pgContinueSub");
    var railLabel = $("pgRailContinueLabel");

    if (!next) {
      label.textContent = "Review the program";
      railLabel.textContent = "Review";
    } else if (s.complete === 0) {
      label.textContent = "Start the program";
      railLabel.textContent = "Start";
    } else {
      label.textContent = "Continue: " + next.label;
      railLabel.textContent = "Continue";
    }

    var bits = [];
    if (payload.progress && payload.progress.lastOpenedAt) bits.push("Last opened " + fmtRelative(payload.progress.lastOpenedAt));
    if (s.complete) bits.push(s.pct + "% complete");
    else if (next) bits.push("Up next: " + next.label);
    sub.textContent = bits.join(" · ");
  }

  function refreshProgress() {
    var s = stats();
    renderStats();
    renderContinue();

    $("pgRailPct").textContent = s.pct + "% complete";
    $("pgRailCount").textContent = s.complete + "/" + s.total;
    $("pgRailMeter").style.width = s.pct + "%";

    $("pgAppbarRingLabel").textContent = s.pct + "%";
    // 97.4 is the circle's circumference (2π × r, r = 15.5 in the markup);
    // offset 0 is a full ring.
    $("pgAppbarRingFill").style.strokeDashoffset = (97.4 * (1 - s.pct / 100)).toFixed(2);

    // Counts in the nav track completion too.
    document.querySelectorAll("[data-nav-section]").forEach(function (node) {
      var countEl = node.querySelector(".pg-navitem__count");
      if (!countEl) return;
      countEl.textContent = sectionCount(node.getAttribute("data-nav-section"));
    });

    // Re-sync any check row currently on screen (the same key can be shown
    // in more than one place — a day card and the handbook chapter list).
    document.querySelectorAll("[data-check-key]").forEach(function (node) {
      node.setAttribute("aria-pressed", isDone(node.getAttribute("data-check-key")) ? "true" : "false");
    });
  }

  /* ---------------------------------------------------------- continue --- */

  function goToNext() {
    var next = nextTrackable();
    if (!next) { setSection("overview"); return; }

    if (next.kind === "chapter") { openHandbook(next.key); return; }
    if (next.kind === "video") { openVideo(next.key); return; }

    setSection(next.section);
    // Let the panel's entry animation start before hunting for the target,
    // otherwise the element is measured while still translated.
    setTimeout(function () { focusItem(next.key); }, 60);
  }

  function focusItem(key) {
    var node = document.querySelector('[data-item-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
    if (!node) return;
    // A day inside a collapsed week has to be opened before it can be seen.
    var acc = node.closest("details");
    if (acc && !acc.open) acc.open = true;
    node.scrollIntoView({ behavior: "smooth", block: "center" });
    node.classList.add("is-flash");
    setTimeout(function () { node.classList.remove("is-flash"); }, 1600);
  }

  function openHandbook(startKey) {
    if (!window.ProgramViewer) return;
    window.ProgramViewer.open(payload, {
      startKey: startKey || lastReadChapter(),
      onPage: function (page) {
        markDone(page.key, true);
        setPosition(page.key, "handbook");
      },
    });
  }

  function lastReadChapter() {
    return lastKey && /^chapter:/.test(lastKey) ? lastKey : null;
  }

  function openVideo(key) {
    var index = 0;
    videoItems.forEach(function (v, i) { if (v.key === key) index = i; });
    openMedia(videoItems, index);
  }

  function openMedia(items, index) {
    if (!window.ProgramMedia || !items.length) return;
    window.ProgramMedia.open(items, index, {
      onView: function (item) {
        if (item.key && byKey[item.key]) {
          markDone(item.key, true);
          setPosition(item.key, "videos");
        }
      },
    });
  }

  /* ------------------------------------------------------ section: overview */

  function renderOverview() {
    var host = $("pgOverview");
    var s = stats();
    var html = "";

    if (product.overview) {
      html += '<div class="pg-prose pg-prose--lead" data-reveal>' + paragraphs(product.overview) + "</div>";
    } else {
      html += '<div class="pg-prose pg-prose--lead" data-reveal><p>' +
        esc(product.name) + " is ready in your library. Use the sections below to work through it." +
        "</p></div>";
    }

    // What's inside — the product's assets as cards that go somewhere,
    // never a bulleted list of nouns.
    var inside = [];
    var sessions = s.byKind.session;
    var meals = s.byKind.meal;
    if (sessions) inside.push({ section: "program", icon: "program", title: plural(sessions.total, "training day", "training days"), sub: product.durationWeeks ? "Across " + plural(product.durationWeeks, "week", "weeks") : "Structured plan" });
    if (meals) inside.push({ section: "program", icon: "program", title: plural(meals.total, "meal", "meals"), sub: "Nutrition plan" });
    if (videoItems.length) inside.push({ section: "videos", icon: "videos", title: plural(videoItems.length, "video", "videos"), sub: "Full-screen player" });
    if (chapters.length > 1) inside.push({ section: "handbook", icon: "handbook", title: plural(chapters.length, "chapter", "chapters"), sub: "Readable handbook" });
    var dl = downloadResources().length;
    if (dl) inside.push({ section: "downloads", icon: "downloads", title: plural(dl, "download", "downloads"), sub: "Files and links" });

    if (inside.length) {
      html += '<div class="pg-subhead" data-reveal><h3>What\'s inside</h3></div><div class="pg-grid" data-reveal>' +
        inside.map(function (card) {
          return (
            '<button type="button" class="pg-card pg-card--link" data-goto="' + card.section + '">' +
            '<span class="pg-asset__icon">' + ICON[card.icon] + "</span>" +
            '<span class="pg-card__title">' + esc(card.title) + "</span>" +
            "<p>" + esc(card.sub) + "</p></button>"
          );
        }).join("") + "</div>";
    }

    if (galleryItems.length) {
      html += '<div class="pg-subhead" data-reveal><h3>Gallery</h3><span>' + plural(galleryItems.length, "image", "images") + "</span></div>" +
        '<div class="pg-grid" data-reveal>' +
        galleryItems.map(function (item, i) {
          return (
            '<button type="button" class="pg-tile" data-gallery="' + i + '">' +
            '<span class="pg-tile__frame"><img src="' + esc(item.url) + '" alt="' + esc(item.alt) + '" loading="lazy" decoding="async"></span>' +
            '<span class="pg-tile__caption"><strong>' + esc(item.title) + "</strong><em>Tap to open full screen</em></span>" +
            "</button>"
          );
        }).join("") + "</div>";
    }

    if (product.faqs && product.faqs.length) {
      html += '<div class="pg-subhead" data-reveal><h3>Questions</h3><span>' + plural(product.faqs.length, "answer", "answers") + "</span></div>" +
        '<div class="pg-stack" data-reveal>' +
        product.faqs.map(function (faq) {
          return (
            '<details class="pg-acc"><summary>' + esc(faq.question) +
            '<span class="pg-acc__chevron">' + ICON.chevron + "</span></summary>" +
            '<div class="pg-acc__body"><div><div class="pg-acc__body-inner pg-prose">' + paragraphs(faq.answer) + "</div></div></div></details>"
          );
        }).join("") + "</div>";
    }

    host.innerHTML = html;

    host.querySelectorAll("[data-goto]").forEach(function (node) {
      node.addEventListener("click", function () { setSection(node.getAttribute("data-goto")); });
    });
    host.querySelectorAll("[data-gallery]").forEach(function (node) {
      node.addEventListener("click", function () { openMedia(galleryItems, Number(node.getAttribute("data-gallery"))); });
    });
  }

  /* ------------------------------------------------------- section: program */

  var programView = "training";

  function renderProgram() {
    var weeks = (product.trainingContent && product.trainingContent.weeks) || [];
    var meals = (product.nutritionContent && product.nutritionContent.meals) || [];
    var hasTraining = weeks.length > 0 || !!(product.trainingContent && product.trainingContent.notes);
    var hasNutrition = meals.length > 0 || !!(product.nutritionContent && product.nutritionContent.notes);

    var sw = $("pgProgramSwitch");
    if (hasTraining && hasNutrition) {
      sw.innerHTML =
        '<button type="button" data-view="training">Training</button>' +
        '<button type="button" data-view="nutrition">Nutrition</button>';
      sw.querySelectorAll("[data-view]").forEach(function (node) {
        node.addEventListener("click", function () {
          programView = node.getAttribute("data-view");
          renderProgramBody();
        });
      });
    } else {
      sw.innerHTML = "";
      programView = hasTraining ? "training" : "nutrition";
    }
    renderProgramBody();
  }

  function renderProgramBody() {
    var host = $("pgProgram");
    $("pgProgramSwitch").querySelectorAll("[data-view]").forEach(function (node) {
      node.classList.toggle("is-active", node.getAttribute("data-view") === programView);
    });
    host.innerHTML = programView === "nutrition" ? nutritionHtml() : trainingHtml();
    wireProgramBody(host);
    revealIn(host);
  }

  function checkHtml(key, label) {
    return (
      '<button type="button" class="pg-check" data-check-key="' + esc(key) + '" aria-pressed="' + (isDone(key) ? "true" : "false") + '">' +
      '<span class="pg-check__box">' + ICON.check + "</span>" +
      '<span class="pg-check__label">' + esc(label) + "</span></button>"
    );
  }

  function exerciseHtml(ex, dayKey, exIndex) {
    var prescription = [ex.sets, ex.reps].filter(Boolean).join(" × ");
    var media = "";
    if (ex.mediaUrl) {
      // Exercise demo GIFs/videos ride the gated /api/library/media
      // endpoint. preload="none"/loading="lazy" keeps a whole day of clips
      // off the wire until the week is actually expanded.
      media =
        '<span class="pg-ex__media" data-demo="' + esc(dayKey) + ":" + exIndex + '">' +
        (ex.mediaType === "video"
          ? '<video src="' + esc(ex.mediaUrl) + '" muted loop playsinline preload="none" autoplay></video>'
          : '<img src="' + esc(ex.mediaUrl) + '" alt="' + esc(ex.name || "Exercise") + ' demonstration" loading="lazy" decoding="async">') +
        "</span>";
    }
    return (
      '<div class="pg-ex">' + media +
      '<div class="pg-ex__body">' +
      '<div class="pg-ex__name">' + esc(ex.name || "Exercise") + "</div>" +
      (prescription ? '<span class="pg-ex__reps">' + esc(prescription) + "</span>" : "") +
      (ex.notes ? '<p class="pg-ex__note">' + esc(ex.notes) + "</p>" : "") +
      (ex.substitutions ? '<p class="pg-ex__note"><b>Swap:</b> ' + esc(ex.substitutions) + "</p>" : "") +
      "</div></div>"
    );
  }

  function trainingHtml() {
    var content = product.trainingContent || {};
    var weeks = content.weeks || [];
    var html = "";

    if (content.notes) {
      html +=
        '<div class="pg-callout pg-callout--tip" data-reveal>' +
        '<span class="pg-callout__icon">' + ICON.bulb + "</span>" +
        '<div class="pg-callout__body"><div class="pg-callout__title">How to train this program</div>' +
        '<div class="pg-prose">' + paragraphs(content.notes) + "</div></div></div>";
    }

    if (!weeks.length) {
      return html || emptyHtml(ICON.program, "No training plan yet", "The creator hasn't added training content to this program.");
    }

    html += '<div class="pg-stack pg-stack--lg">';
    weeks.forEach(function (week, wi) {
      var days = week.days || [];
      var weekDone = days.length && days.every(function (_, di) { return isDone("training:" + wi + ":" + di); });
      // First week open, and any week that still has work left after the
      // customer has started — so resuming never lands on a closed drawer.
      var open = wi === 0 || (!weekDone && days.some(function (_, di) { return isDone("training:" + wi + ":" + di); }));
      html +=
        '<details class="pg-acc"' + (open ? " open" : "") + ' data-week="' + wi + '">' +
        "<summary><span>" + esc(week.title || "Week " + (wi + 1)) + "</span>" +
        '<span class="pg-navitem__count">' + plural(days.length, "day", "days") +
        (weekDone ? " · done" : "") + '</span><span class="pg-acc__chevron">' + ICON.chevron + "</span></summary>" +
        '<div class="pg-acc__body"><div><div class="pg-acc__body-inner"><div class="pg-timeline">';

      days.forEach(function (day, di) {
        var key = "training:" + wi + ":" + di;
        var exercises = day.exercises || [];
        html +=
          '<div class="pg-timeline__item' + (isDone(key) ? " is-done" : "") + '" data-item-key="' + esc(key) + '">' +
          '<span class="pg-timeline__dot"></span>' +
          '<p class="pg-timeline__when">' + esc(week.title || "Week " + (wi + 1)) + "</p>" +
          '<h4 class="pg-timeline__title">' + esc(day.title || "Day " + (di + 1)) + "</h4>" +
          (day.notes ? '<div class="pg-prose"><p>' + esc(day.notes) + "</p></div>" : "") +
          (exercises.length
            ? exercises.map(function (ex, ei) { return exerciseHtml(ex, key, ei); }).join("")
            : '<p class="pg-ex__note">Rest day — nothing scheduled.</p>') +
          checkHtml(key, isDone(key) ? "Session complete" : "Mark session complete") +
          "</div>";
      });

      html += "</div></div></div></div></details>";
    });
    html += "</div>";
    return html;
  }

  function nutritionHtml() {
    var content = product.nutritionContent || {};
    var meals = content.meals || [];
    var html = "";

    if (content.notes) {
      html +=
        '<div class="pg-callout pg-callout--note" data-reveal>' +
        '<span class="pg-callout__icon">' + ICON.info + "</span>" +
        '<div class="pg-callout__body"><div class="pg-callout__title">How to eat on this program</div>' +
        '<div class="pg-prose">' + paragraphs(content.notes) + "</div></div></div>";
    }

    if (!meals.length) {
      return html || emptyHtml(ICON.program, "No nutrition plan yet", "The creator hasn't added nutrition content to this program.");
    }

    html += '<div class="pg-stack" data-reveal>';
    meals.forEach(function (meal, mi) {
      var key = "meal:" + mi;
      html +=
        '<div class="pg-card" data-item-key="' + esc(key) + '">' +
        '<div class="pg-card__title">' + esc(meal.name || "Meal " + (mi + 1)) + "</div>" +
        (meal.macros
          ? '<div class="pg-macros">' + String(meal.macros).split(/[,·|]/).map(function (m) {
              return m.trim() ? "<span>" + esc(m.trim()) + "</span>" : "";
            }).join("") + "</div>"
          : "") +
        (meal.ingredients
          ? '<h5 class="pg-timeline__when">Ingredients</h5><ul class="pg-ingredients">' +
            String(meal.ingredients).split(/\n|,/).map(function (line) {
              return line.trim() ? "<li>" + esc(line.trim()) + "</li>" : "";
            }).join("") + "</ul>"
          : "") +
        (meal.notes ? '<div class="pg-prose">' + paragraphs(meal.notes) + "</div>" : "") +
        checkHtml(key, isDone(key) ? "Prepared" : "Mark as prepared") +
        "</div>";
    });
    html += "</div>";
    return html;
  }

  function wireProgramBody(host) {
    host.querySelectorAll("[data-check-key]").forEach(function (node) {
      node.addEventListener("click", function () {
        var key = node.getAttribute("data-check-key");
        var next = !isDone(key);
        markDone(key, next);
        setPosition(key, "program");
        // Re-render so the day's timeline dot, the week's "done" count and
        // the check's own label all move together.
        renderProgramBody();
        var again = host.querySelector('[data-item-key="' + (window.CSS && CSS.escape ? CSS.escape(key) : key) + '"]');
        if (again) {
          var acc = again.closest("details");
          if (acc) acc.open = true;
        }
      });
    });

    host.querySelectorAll("[data-demo]").forEach(function (node) {
      node.addEventListener("click", function () {
        var media = node.querySelector("video, img");
        if (!media) return;
        var isVideo = node.querySelector("video");
        var card = node.closest("[data-item-key]");
        var name = card ? card.querySelector(".pg-timeline__title") : null;
        openMedia([{
          type: isVideo ? "video" : "image",
          url: media.getAttribute("src"),
          alt: media.getAttribute("alt") || "",
          title: node.parentNode.querySelector(".pg-ex__name").textContent,
          subtitle: name ? name.textContent : product.name,
        }], 0);
      });
    });
  }

  /* -------------------------------------------------------- section: videos */

  function renderVideos() {
    var host = $("pgVideos");
    if (!videoItems.length) {
      host.innerHTML = emptyHtml(ICON.videos, "No videos yet", "When the creator adds video content it appears here, in a full-screen player.");
      return;
    }
    host.innerHTML =
      '<div class="pg-grid" data-reveal>' +
      videoItems.map(function (item, i) {
        var watched = isDone(item.key);
        return (
          '<button type="button" class="pg-tile" data-video="' + i + '">' +
          '<span class="pg-tile__frame">' +
          (item.type === "video"
            ? '<video src="' + esc(item.url) + '" muted playsinline preload="metadata"></video>'
            : "") +
          '<span class="pg-tile__play"><span>' + ICON.play + "</span></span>" +
          "</span>" +
          (watched ? '<span class="pg-tile__done">' + ICON.check + "</span>" : "") +
          '<span class="pg-tile__caption"><strong>' + esc(item.title) + "</strong>" +
          "<em>" + esc(watched ? "Watched" : item.subtitle || "") + "</em></span>" +
          "</button>"
        );
      }).join("") + "</div>";

    host.querySelectorAll("[data-video]").forEach(function (node) {
      node.addEventListener("click", function () { openMedia(videoItems, Number(node.getAttribute("data-video"))); });
    });
  }

  /* ------------------------------------------------------ section: handbook */

  function renderHandbook() {
    var host = $("pgHandbook");
    var s = stats();

    if (!chapters.length) {
      host.innerHTML = emptyHtml(ICON.handbook, "No handbook yet", "This program has no written handbook.");
      return;
    }

    var readable = s.chaptersRead;
    var resumeKey = lastReadChapter();
    var resumeChapter = null;
    chapters.forEach(function (ch) { if (ch.key === resumeKey) resumeChapter = ch; });

    host.innerHTML =
      '<div class="pg-card" data-reveal>' +
        '<div class="pg-card__title">' + esc(product.name) + " handbook</div>" +
        "<p>" + plural(chapters.length, "chapter", "chapters") + " · ≈ " +
        fmtDuration(chapters.length * MINUTES.chapter) + " to read · " + readable + " read</p>" +
        '<div class="pg-meter" data-book-meter><i></i></div>' +
        '<button type="button" class="pg-btn pg-btn--primary pg-btn--lg" data-open-book>' +
        '<span>' + (resumeChapter ? "Resume: " + esc(resumeChapter.title) : "Start reading") + "</span></button>" +
      "</div>" +
      '<div class="pg-subhead" data-reveal><h3>Chapters</h3><span>' + readable + " of " + chapters.length + " read</span></div>" +
      '<div class="pg-stack" data-reveal>' +
      chapters.map(function (ch, i) {
        return (
          '<button type="button" class="pg-asset" data-chapter="' + esc(ch.key) + '">' +
          '<span class="pg-asset__icon">' + (isDone(ch.key) ? ICON.check : ICON.handbook) + "</span>" +
          '<span class="pg-asset__body"><strong>' + esc(ch.title || ch.section) + "</strong>" +
          "<span>" + esc(ch.section) + " · chapter " + (i + 1) + (isDone(ch.key) ? " · read" : "") + "</span></span>" +
          '<span class="pg-asset__go">' + ICON.arrow + "</span></button>"
        );
      }).join("") + "</div>";

    var meter = host.querySelector("[data-book-meter] i");
    if (meter) {
      requestAnimationFrame(function () {
        meter.style.width = (chapters.length ? (readable / chapters.length) * 100 : 0) + "%";
      });
    }

    host.querySelector("[data-open-book]").addEventListener("click", function () { openHandbook(null); });
    host.querySelectorAll("[data-chapter]").forEach(function (node) {
      node.addEventListener("click", function () { openHandbook(node.getAttribute("data-chapter")); });
    });
  }

  /* ----------------------------------------------------- section: downloads */

  function renderDownloads() {
    var host = $("pgDownloads");
    var resources = downloadResources();

    var html = "";
    if (product.bonusNotes) {
      html +=
        '<div class="pg-callout" data-reveal>' +
        '<span class="pg-callout__icon">' + ICON.info + "</span>" +
        '<div class="pg-callout__body"><div class="pg-callout__title">From the creator</div>' +
        '<div class="pg-prose">' + paragraphs(product.bonusNotes) + "</div></div></div>";
    }

    if (!resources.length) {
      host.innerHTML = html + emptyHtml(ICON.downloads, "No downloads yet", "Files and links the creator adds to this program will appear here.");
      return;
    }

    html +=
      '<div class="pg-stack" data-reveal>' +
      resources.map(function (r) {
        var isFile = r.type !== "link";
        return (
          '<a class="pg-asset" href="' + esc(r.url) + '"' +
          (isFile ? "" : ' target="_blank" rel="noopener"') + ">" +
          '<span class="pg-asset__icon">' + (isFile ? ICON.file : ICON.link) + "</span>" +
          '<span class="pg-asset__body"><strong>' + esc(r.title) + "</strong>" +
          (r.description ? "<span>" + esc(r.description) + "</span>" : "") +
          '<span class="pg-asset__kind">' + (isFile ? "Download" : "External link") + "</span></span>" +
          '<span class="pg-asset__go">' + ICON.arrow + "</span></a>"
        );
      }).join("") + "</div>";

    host.innerHTML = html;
  }

  /* ------------------------------------------------------- section: updates */

  function renderUpdates() {
    var host = $("pgUpdates");
    var entries = [];
    var purchased = payload.purchasedAt ? new Date(payload.purchasedAt).getTime() : 0;

    // Built from real timestamps only. There is no changelog model behind
    // this section, so it reports what actually happened — when the program
    // was published, when it became yours, and anything the creator has
    // added since — rather than inventing release notes.
    if (product.createdAt) {
      entries.push({ at: product.createdAt, title: "Program published", body: esc(product.name) + " went live on the platform." });
    }
    if (payload.purchasedAt) {
      entries.push({ at: payload.purchasedAt, title: "Added to your library", body: "You got lifetime access to this program." });
    }
    (product.resources || []).forEach(function (r) {
      if (!r.createdAt) return;
      // Only material added *after* the purchase is an update; everything
      // else was part of what was bought.
      if (purchased && new Date(r.createdAt).getTime() <= purchased) return;
      entries.push({ at: r.createdAt, title: "New: " + esc(r.title), body: esc(r.description || "Added to this program.") });
    });

    entries.sort(function (a, b) { return new Date(b.at) - new Date(a.at); });

    if (!entries.length) {
      host.innerHTML = emptyHtml(ICON.updates, "Nothing new yet", "When the creator updates this program, the changes are listed here.");
      return;
    }

    host.innerHTML =
      '<div class="pg-timeline" data-reveal>' +
      entries.map(function (e) {
        return (
          '<div class="pg-timeline__item is-done"><span class="pg-timeline__dot"></span>' +
          '<p class="pg-timeline__when">' + esc(fmtDate(e.at)) + "</p>" +
          '<h4 class="pg-timeline__title">' + e.title + "</h4>" +
          '<div class="pg-prose"><p>' + e.body + "</p></div></div>"
        );
      }).join("") + "</div>";
  }

  /* ----------------------------------------------------- section: community */

  function renderCommunity() {
    $("pgCommunity").innerHTML =
      '<div class="pg-empty" data-reveal>' +
      '<div class="pg-empty__icon">' + ICON.community + "</div>" +
      "<h3>Community is coming</h3>" +
      "<p>A space to train alongside everyone else on " + esc(product.name) +
      ", ask " + esc(product.creator || "the creator") + " questions, and post progress. It isn't open yet — " +
      "until it is, the fastest way to reach the team is the contact form.</p>" +
      '<div class="pg-locked__actions"><a class="pg-btn pg-btn--ghost" href="/contact"><span>Contact the team</span></a></div>' +
      "</div>";
  }

  function emptyHtml(icon, title, body) {
    return (
      '<div class="pg-empty" data-reveal><div class="pg-empty__icon">' + icon + "</div>" +
      "<h3>" + esc(title) + "</h3><p>" + esc(body) + "</p></div>"
    );
  }

  /* ----------------------------------------------------------------- dock --- */

  function buildDock() {
    var actions = [
      { label: "Continue", icon: "play", run: goToNext },
    ];
    if (chapters.length > 1) actions.push({ label: "Open handbook", icon: "handbook", run: function () { openHandbook(null); } });
    if (videoItems.length) actions.push({ label: "Watch a video", icon: "videos", run: function () { openMedia(videoItems, 0); } });
    if (downloadResources().length) actions.push({ label: "Downloads", icon: "downloads", run: function () { setSection("downloads"); } });
    actions.push({ label: "Contact creator", icon: "mail", href: "/contact" });
    actions.push({ label: "Report an issue", icon: "flag", href: "/contact" });

    var menu = $("pgDockMenu");
    menu.innerHTML = actions.map(function (a, i) {
      return a.href
        ? '<a class="pg-dock__item" href="' + esc(a.href) + '" role="menuitem">' + ICON[a.icon] + esc(a.label) + "</a>"
        : '<button type="button" class="pg-dock__item" role="menuitem" data-dock="' + i + '">' + ICON[a.icon] + esc(a.label) + "</button>";
    }).join("");

    menu.querySelectorAll("[data-dock]").forEach(function (node) {
      node.addEventListener("click", function () {
        closeDock();
        actions[Number(node.getAttribute("data-dock"))].run();
      });
    });

    var dock = $("pgDock");
    var toggle = $("pgDockToggle");
    toggle.addEventListener("click", function () {
      var open = dock.classList.toggle("is-open");
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      menu.setAttribute("aria-hidden", open ? "false" : "true");
    });
    document.addEventListener("click", function (e) {
      if (!dock.contains(e.target)) closeDock();
    });
    document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeDock(); });
    dock.classList.remove("u-hidden");
  }

  function closeDock() {
    var dock = $("pgDock");
    if (!dock.classList.contains("is-open")) return;
    dock.classList.remove("is-open");
    $("pgDockToggle").setAttribute("aria-expanded", "false");
    $("pgDockMenu").setAttribute("aria-hidden", "true");
  }

  /* --------------------------------------------------------------- motion --- */

  var revealObserver = null;

  function initReveal() {
    if (!("IntersectionObserver" in window)) {
      document.querySelectorAll("[data-reveal]").forEach(function (n) { n.classList.add("is-revealed"); });
      return;
    }
    revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        entry.target.classList.add("is-revealed");
        revealObserver.unobserve(entry.target);
      });
    }, { rootMargin: "0px 0px -8% 0px", threshold: 0.04 });
    revealIn(document);
  }

  function revealIn(scope) {
    if (!scope) return;
    var nodes = scope.querySelectorAll ? scope.querySelectorAll("[data-reveal]") : [];
    if (!revealObserver) {
      Array.prototype.forEach.call(nodes, function (n) { n.classList.add("is-revealed"); });
      return;
    }
    Array.prototype.forEach.call(nodes, function (n) {
      if (!n.classList.contains("is-revealed")) revealObserver.observe(n);
    });
  }

  function initScrollEffects() {
    var art = $("pgHeroArt");
    var appbar = $("pgAppbar");
    var hero = $("pgHero");
    var ticking = false;
    var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    function frame() {
      ticking = false;
      var y = window.pageYOffset;
      appbar.classList.toggle("is-stuck", y > 120);

      // Parallax: the art layer is inset -8%/-12% in CSS, so it has real
      // travel to give. Capped so it can never expose an edge, and skipped
      // entirely once the hero is off screen (and under reduced motion).
      if (!reduce && art) {
        var rect = hero.getBoundingClientRect();
        if (rect.bottom > 0 && rect.top < window.innerHeight) {
          var shift = Math.max(-60, Math.min(60, y * 0.16));
          art.style.transform = "translate3d(0," + shift + "px,0)";
        }
      }
    }

    window.addEventListener("scroll", function () {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(frame);
    }, { passive: true });
    frame();
  }

  /* ----------------------------------------------------------------- boot --- */

  function showPreviewBar() {
    var note = payload.productStatus && payload.productStatus !== "published"
      ? " · status: " + esc(payload.productStatus) + " (not purchasable yet)"
      : "";
    var bar = el(
      '<div class="pg-preview"><span><strong>Customer preview</strong> — exactly what a buyer sees' +
      note + ". Progress isn't saved.</span><a href=\"/admin/manage/products\">Back to admin</a></div>"
    );
    document.body.appendChild(bar);
    document.body.classList.add("has-preview");
  }

  function render() {
    buildMediaLists();
    chapters = window.ProgramViewer
      ? window.ProgramViewer._buildPages(product).map(function (page) {
          return { key: page.key, title: page.title, section: page.section };
        })
      : [];
    buildTrackables();

    sections = SECTION_DEFS.filter(function (def) { return hasContent(def.id); });

    renderHero();
    renderOverview();
    renderProgram();
    renderVideos();
    renderHandbook();
    renderDownloads();
    renderUpdates();
    renderCommunity();

    // Only sections with something in them get a panel and a nav entry.
    SECTION_DEFS.forEach(function (def) {
      var panel = $("pgPanel-" + def.id);
      if (panel) panel.hidden = !sections.some(function (s) { return s.id === def.id; });
    });
    // Eyebrow numbering has to follow what actually survived, not the
    // static markup — "Section 05" above the third visible section reads
    // like something is missing.
    sections.forEach(function (def, i) {
      var panel = $("pgPanel-" + def.id);
      if (!panel) return;
      var eyebrow = panel.querySelector(".pg-panel__eyebrow");
      if (eyebrow) eyebrow.textContent = "Section " + String(i + 1).padStart(2, "0");
    });

    buildNav();
    buildDock();
    refreshProgress();

    $("pgBoot").classList.add("u-hidden");
    $("pgShell").classList.remove("u-hidden");

    initReveal();
    initScrollEffects();

    // Deep links: #handbook opens the reader (the library's "Continue"
    // action has always linked to it), any other known section selects it.
    var hash = (window.location.hash || "").replace("#", "");
    if (hash === "handbook" && chapters.length) {
      setSection("handbook", { silent: true, scroll: false });
      openHandbook(null);
    } else if (hash && sections.some(function (s) { return s.id === hash; })) {
      setSection(hash, { silent: true, scroll: false });
    } else {
      setSection(lastSection && sections.some(function (s) { return s.id === lastSection; }) ? lastSection : "overview",
        { silent: true, scroll: false });
    }

    $("pgContinue").addEventListener("click", goToNext);
    $("pgRailContinue").addEventListener("click", goToNext);
    $("pgSheetClose").addEventListener("click", closeSheet);
    $("pgSheetScrim").addEventListener("click", closeSheet);

    // Last chance to persist. A debounced save that hasn't fired yet would
    // otherwise be lost when the tab closes mid-workout.
    window.addEventListener("pagehide", function () { if (saveTimer) save(); });
    document.addEventListener("visibilitychange", function () {
      if (document.visibilityState === "hidden" && saveTimer) save();
    });
  }

  document.addEventListener("DOMContentLoaded", function () {
    productRef = decodeURIComponent(window.location.pathname.replace(/^\/my-library\//, "").split(/[/?#]/)[0] || "");
    if (!productRef) {
      window.location.href = "/my-library";
      return;
    }

    window.ProFitAPI.getProgram(productRef).then(function (data) {
      payload = data;
      product = data.product;

      // Customer Preview Mode: the server lets admins open any program
      // (including drafts) without a purchase and flags it. Nothing is
      // written back — the PUT would 403 anyway, by design.
      if (data.preview) {
        canSync = false;
        showPreviewBar();
      }

      var stored = data.progress || {};
      (stored.completedKeys || []).forEach(function (key) { done[key] = true; });
      lastKey = stored.lastKey || null;
      lastSection = stored.lastSection || null;

      render();
    }).catch(function () {
      $("pgBoot").classList.add("u-hidden");
      $("pgLocked").classList.remove("u-hidden");
    });
  });
})();
