// The header navigation, in a real browser, at real widths.
//
// This guards the thing the redesign was for: a panel whose size comes from
// its content. The old menus were 540 / 760 / 580 CSS px wide whatever they
// held, so "Browse Athletes" rendered four short columns inside a box that
// was 60% empty — and no screenshot review catches that reliably, because a
// half-empty panel and a full one look equally "fine" in isolation. So the
// emptiness is MEASURED here: the union of a panel's own children has to
// account for its box, minus padding, to within a few pixels.
//
// Two harness traps this file is written around, both already paid for once
// in this repo:
//   - Chrome paints a `visibility: hidden` panel into page.screenshot(), so
//     "is it open" is decided by hit-testing with elementFromPoint, never by
//     looking at an image.
//   - `img.naturalWidth` is density-corrected when srcset+sizes are in play,
//     so a derivative check reads the tier off the URL, not off the element.
//
//   node test-nav-menu.js --base http://127.0.0.1:3210
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const SERVER = path.join(__dirname, "..", "server");
const { prisma } = require(path.join(SERVER, "src", "db.js"));
const { createSession } = require(path.join(SERVER, "src", "lib", "session.js"));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg("--base", "http://127.0.0.1:3210");

const DESKTOP = [992, 1024, 1280, 1440, 1920];
const MOBILE = [320, 375, 390, 430];

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail !== undefined && detail !== "" ? "  — " + detail : ""}`);
}
function section(name) { console.log(`\n---- ${name} ----`); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  const builds = fs.readdirSync(root).sort();
  return path.join(root, builds[builds.length - 1], "chrome-linux64", "chrome");
}

// ---------------------------------------------------------------------------
// In-page helpers. Everything that decides "is this open / is this empty" is
// measured from the RENDERED box, never inferred from a class name.
// ---------------------------------------------------------------------------
const PAGE_HELPERS = `
window.__nav = {
  triggers: function () {
    return Array.prototype.slice.call(document.querySelectorAll(".site-header .main-menu li.nav-mega"));
  },
  panelOf: function (li) { return li.querySelector("[data-menu-panel]"); },
  // Open means: really hit-testable at its own centre. A visibility:hidden
  // panel still has a box and still photographs, so neither is proof.
  isOpen: function (panel) {
    var r = panel.getBoundingClientRect();
    if (!r.width || !r.height) return false;
    if (getComputedStyle(panel).visibility === "hidden") return false;
    var el = document.elementFromPoint(r.left + r.width / 2, r.top + Math.min(20, r.height / 2));
    return !!(el && (el === panel || panel.contains(el)));
  },
  // How much of the panel's inner box its content actually occupies. The
  // union of every leaf child's rect, compared with the panel minus padding.
  fill: function (panel) {
    var inner = panel.querySelector(".nav-panel__inner");
    var cs = getComputedStyle(inner);
    var box = inner.getBoundingClientRect();
    var availW = box.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    var availH = box.height - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    var kids = panel.querySelectorAll("a, li, picture, span.nav-panel__thumb-box, p");
    var l = Infinity, r = -Infinity, t = Infinity, b = -Infinity;
    Array.prototype.forEach.call(kids, function (k) {
      var kr = k.getBoundingClientRect();
      if (!kr.width || !kr.height) return;
      l = Math.min(l, kr.left); r = Math.max(r, kr.right);
      t = Math.min(t, kr.top); b = Math.max(b, kr.bottom);
    });
    if (l === Infinity) return { widthRatio: 0, heightRatio: 0, box: box };
    return {
      widthRatio: (r - l) / availW,
      heightRatio: (b - t) / availH,
      width: box.width,
      height: box.height,
      contentWidth: r - l,
      contentHeight: b - t,
    };
  },
};
`;

async function openPanel(page, index) {
  await page.evaluate((i) => {
    const li = window.__nav.triggers()[i];
    li.dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
  }, index);
  await wait(260);
}

async function closeAll(page) {
  await page.keyboard.press("Escape");
  await wait(220);
}

// ---------------------------------------------------------------------------
async function desktop(browser, taxonomies) {
  for (const width of DESKTOP) {
    section(`Desktop ${width}px`);
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
    await page.setViewport({ width, height: 900 });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    await page.evaluate(PAGE_HELPERS);

    const labels = await page.evaluate(() =>
      window.__nav.triggers().map((li) => li.querySelector(".nav-top-link").textContent.trim())
    );
    check(
      `${width}: one trigger per CMS category, in CMS order`,
      labels.length === taxonomies.length && labels.every((l, i) => l === taxonomies[i].label),
      `${labels.join(" | ")}`
    );

    for (let i = 0; i < labels.length; i++) {
      await openPanel(page, i);
      const m = await page.evaluate((idx) => {
        const li = window.__nav.triggers()[idx];
        const panel = window.__nav.panelOf(li);
        const fill = window.__nav.fill(panel);
        const trigger = li.querySelector(".nav-top-link");
        return {
          open: window.__nav.isOpen(panel),
          fill,
          expanded: trigger.getAttribute("aria-expanded"),
          controls: trigger.getAttribute("aria-controls"),
          panelId: panel.id,
          actions: panel.querySelectorAll(".nav-panel__action").length,
          text: panel.textContent,
          rect: panel.getBoundingClientRect().toJSON(),
          docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          othersOpen: window.__nav.triggers().filter((o, j) => j !== idx && window.__nav.isOpen(window.__nav.panelOf(o))).length,
        };
      }, i);

      check(`${width}: "${labels[i]}" opens and is hit-testable`, m.open);
      check(`${width}: "${labels[i]}" is the only open panel`, m.othersOpen === 0, `${m.othersOpen} others`);
      check(`${width}: "${labels[i]}" aria wired`, m.expanded === "true" && m.controls === m.panelId, `${m.expanded} / ${m.controls}`);
      check(`${width}: "${labels[i]}" has exactly one View all`, m.actions === 1, `${m.actions}`);
      check(
        `${width}: "${labels[i]}" carries no redundant category tag`,
        !/\bATHLETE\b|\bCREATOR\b|FEATURED|TOP PICKS|DISCOVER/.test(m.text),
        ""
      );
      // The headline assertion of this whole file.
      check(
        `${width}: "${labels[i]}" width is content-driven`,
        m.fill.widthRatio > 0.9,
        `content ${Math.round(m.fill.contentWidth)}px of ${Math.round(m.fill.width)}px panel (${(m.fill.widthRatio * 100).toFixed(1)}% filled)`
      );
      check(
        `${width}: "${labels[i]}" height is content-driven`,
        m.fill.heightRatio > 0.9,
        `content ${Math.round(m.fill.contentHeight)}px of ${Math.round(m.fill.height)}px panel`
      );
      check(
        `${width}: "${labels[i]}" fits the viewport`,
        m.rect.left >= -1 && m.rect.right <= width + 1 && m.docOverflow <= 0,
        `left ${Math.round(m.rect.left)} right ${Math.round(m.rect.right)} overflow ${m.docOverflow}`
      );
    }

    // Panels must differ in size, or the width is not really coming from the
    // content — three identical boxes would pass every ratio above only if
    // all three happened to hold the same amount, which they do not.
    const widths = [];
    for (let i = 0; i < labels.length; i++) {
      await openPanel(page, i);
      widths.push(await page.evaluate((idx) => Math.round(window.__nav.panelOf(window.__nav.triggers()[idx]).getBoundingClientRect().width), i));
    }
    check(`${width}: panels are not all one size`, new Set(widths).size > 1, widths.join(" / "));

    // ---- Continuous switching: sample every frame of an A -> B change and
    // assert the surface is never blank. This is the "close, gap, open"
    // flash the brief calls out, and it is invisible in a screenshot. ----
    await closeAll(page);
    await openPanel(page, 0);
    const dip = await page.evaluate(async () => {
      const lis = window.__nav.triggers();
      const panels = lis.map((li) => window.__nav.panelOf(li));
      let minCombined = 1;
      let sampling = true;
      (function sample() {
        if (!sampling) return;
        const total = panels.reduce((acc, p) => acc + parseFloat(getComputedStyle(p).opacity || "0"), 0);
        minCombined = Math.min(minCombined, total);
        requestAnimationFrame(sample);
      })();
      lis[1].dispatchEvent(new MouseEvent("mouseenter", { bubbles: false }));
      await new Promise((r) => setTimeout(r, 420));
      sampling = false;
      return minCombined;
    });
    check(
      `${width}: switching category never blanks the surface`,
      dip > 0.55,
      `lowest combined panel opacity during the switch: ${dip.toFixed(3)}`
    );

    // ---- Escape, outside click, keyboard entry ----
    await openPanel(page, 0);
    await page.keyboard.press("Escape");
    await wait(200);
    const afterEsc = await page.evaluate(() => ({
      anyOpen: window.__nav.triggers().some((li) => window.__nav.isOpen(window.__nav.panelOf(li))),
      focused: document.activeElement && document.activeElement.classList.contains("nav-top-link"),
    }));
    check(`${width}: Escape closes the panel`, !afterEsc.anyOpen);
    check(`${width}: Escape returns focus to the trigger`, afterEsc.focused);

    await openPanel(page, 0);
    await page.mouse.click(width - 8, 700);
    await wait(220);
    check(
      `${width}: an outside click closes the panel`,
      !(await page.evaluate(() => window.__nav.triggers().some((li) => window.__nav.isOpen(window.__nav.panelOf(li)))))
    );

    const kb = await page.evaluate(async () => {
      const li = window.__nav.triggers()[0];
      const trigger = li.querySelector(".nav-top-link");
      trigger.focus();
      await new Promise((r) => setTimeout(r, 60));
      const openedOnFocus = window.__nav.isOpen(window.__nav.panelOf(li));
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      await new Promise((r) => setTimeout(r, 60));
      return { openedOnFocus, inPanel: window.__nav.panelOf(li).contains(document.activeElement) };
    });
    check(`${width}: keyboard focus opens the panel without a mouse`, kb.openedOnFocus);
    check(`${width}: ArrowDown moves focus into the panel`, kb.inPanel);

    // Every destination is a real crawlable URL, not a JS-only handler.
    const hrefs = await page.evaluate(() =>
      Array.prototype.slice.call(document.querySelectorAll(".site-header .main-menu a[href]")).map((a) => a.getAttribute("href"))
    );
    check(
      `${width}: no .html / id / query-param URLs in the nav`,
      hrefs.every((h) => h && h.startsWith("/") && !/\.html|\?|c[a-z0-9]{24}/.test(h)),
      hrefs.filter((h) => !h || !h.startsWith("/") || /\.html|\?/.test(h)).join(" ")
    );

    await page.close();
  }
}

// ---------------------------------------------------------------------------
async function mobile(browser) {
  for (const width of MOBILE) {
    section(`Mobile ${width}px`);
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
    await page.setViewport({ width, height: 780, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/`, { waitUntil: "networkidle2" });
    await page.evaluate(PAGE_HELPERS);

    const baseOverflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    check(`${width}: page has no horizontal overflow closed`, baseOverflow <= 0, `${baseOverflow}px`);

    await page.click(".site-header .header-bar");
    await wait(420);

    const rows = await page.evaluate(() =>
      window.__nav.triggers().map((li) => {
        const a = li.querySelector(".nav-top-link");
        const r = a.getBoundingClientRect();
        return { label: a.textContent.trim(), h: r.height, expanded: a.getAttribute("aria-expanded") };
      })
    );
    check(`${width}: every category is a drawer row`, rows.length >= 3, rows.map((r) => r.label).join(" | "));
    check(`${width}: trigger rows are comfortably tappable`, rows.every((r) => r.h >= 44), rows.map((r) => Math.round(r.h)).join("/"));
    check(`${width}: all sections start collapsed`, rows.every((r) => r.expanded === "false"));

    // Expand each in turn; single-open, real content, no blank space.
    for (let i = 0; i < rows.length; i++) {
      await page.evaluate((idx) => {
        window.__nav.triggers()[idx].querySelector(".nav-top-link").click();
      }, i);
      await wait(380);
      const m = await page.evaluate((idx) => {
        const lis = window.__nav.triggers();
        const panel = window.__nav.panelOf(lis[idx]);
        const openCount = lis.filter((li) => window.__nav.panelOf(li).classList.contains("open")).length;
        const inner = panel.querySelector(".nav-panel__inner");
        const links = Array.prototype.slice.call(panel.querySelectorAll("a[href]"));
        const rects = links.map((a) => a.getBoundingClientRect());
        return {
          openCount,
          links: links.length,
          panelH: panel.getBoundingClientRect().height,
          innerH: inner.getBoundingClientRect().height,
          minTap: rects.length ? Math.min.apply(null, rects.map((r) => r.height)) : 0,
          widest: rects.length ? Math.max.apply(null, rects.map((r) => r.right)) : 0,
          docOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
          actions: panel.querySelectorAll(".nav-panel__action").length,
        };
      }, i);

      check(`${width}: "${rows[i].label}" expands with real CMS content`, m.links > 1, `${m.links} links`);
      check(`${width}: "${rows[i].label}" is the only open section`, m.openCount === 1, `${m.openCount} open`);
      check(`${width}: "${rows[i].label}" has no blank space below its content`, Math.abs(m.panelH - m.innerH) < 2, `panel ${Math.round(m.panelH)} vs content ${Math.round(m.innerH)}`);
      check(`${width}: "${rows[i].label}" rows are tappable`, m.minTap >= 36, `smallest ${Math.round(m.minTap)}px`);
      check(`${width}: "${rows[i].label}" causes no horizontal overflow`, m.docOverflow <= 0 && m.widest <= width + 1, `overflow ${m.docOverflow}, widest ${Math.round(m.widest)}`);
      check(`${width}: "${rows[i].label}" has exactly one View all`, m.actions === 1, `${m.actions}`);
    }

    // The sport rail is allowed to scroll INSIDE itself; the page is not.
    const rail = await page.evaluate(() => {
      const el = document.querySelector(".nav-panel__rail");
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { right: r.right, scrolls: el.scrollWidth > el.clientWidth + 1, doc: document.documentElement.scrollWidth - document.documentElement.clientWidth };
    });
    if (rail) {
      check(`${width}: the group rail is contained, page still does not scroll sideways`, rail.doc <= 0 && rail.right <= width + 1, `rail right ${Math.round(rail.right)}`);
    }

    await page.close();
  }
}

// ---------------------------------------------------------------------------
// Images: the menu must never be a new source of the media problem this
// codebase has repeatedly had. Nothing is fetched until a panel is opened,
// and what is fetched is a derivative, not the stored original.
// ---------------------------------------------------------------------------
async function media(browser) {
  section("Menu imagery");
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
  await page.setViewport({ width: 1440, height: 900 });
  const requested = [];
  page.on("request", (r) => { if (r.resourceType() === "image") requested.push(r.url()); });
  // /about, not the homepage: the homepage renders some of the same product
  // covers the menu does, so every menu image there is also a page image and
  // the attribution below has nothing left to measure. /about carries the
  // header and no product imagery of its own, which is the case that matters
  // anyway — the menu must cost nothing on a page that is not about products.
  await page.goto(`${BASE}/about`, { waitUntil: "networkidle2" });
  await page.evaluate(PAGE_HELPERS);

  // Only images that appear NOWHERE ELSE on the page can be attributed to the
  // menu. A menu thumbnail is a product cover, and the homepage renders some
  // of the same covers itself — matching on the URL alone reports the page's
  // own eager hero image as a menu leak, which cost one false alarm here
  // already. (The FA logo is excluded for the same reason: it is a deliberate
  // eager part of the header, not panel imagery.)
  // The strongest available statement, and the one that does not depend on
  // matching URLs: on a cold page, no panel <img> has a src at all, so there
  // is nothing for the browser to have fetched. (Matching request URLs would
  // be wrong twice over — a <picture> requests a derivative, not the `src` it
  // carries, and the homepage renders some of the same covers itself.)
  const cold = await page.evaluate(() => {
    const imgs = Array.prototype.slice.call(document.querySelectorAll(".site-header .nav-panel img"));
    return {
      total: imgs.length,
      withSrc: imgs.filter((i) => i.getAttribute("src")).length,
      pending: imgs.filter((i) => i.getAttribute("data-src")).length,
      loaded: imgs.filter((i) => i.currentSrc).length,
    };
  });
  check(
    "no panel thumbnail is fetched before the visitor touches the nav",
    cold.total > 0 && cold.withSrc === 0 && cold.loaded === 0,
    `${cold.total} thumbs, ${cold.withSrc} with src, ${cold.loaded} loaded, ${cold.pending} deferred`
  );

  // Touching the nav promotes them. This has to happen through a real pointer
  // event on the header, because that is the only trigger there is.
  await page.hover(".site-header .main-menu");
  await openPanel(page, 1);
  await wait(900);
  const loaded = await page.evaluate(() =>
    Array.prototype.slice.call(document.querySelectorAll(".site-header .nav-panel img"))
      .filter((i) => i.currentSrc)
      .map((i) => i.currentSrc)
  );
  check("touching the nav does load its thumbnails", loaded.length > 0, `${loaded.length} images`);
  // Anything under /product/uploads/ that is not a numbered derivative IS the
  // original — the exact signature of the bug this repo keeps rediscovering.
  const originals = loaded.filter((u) => /\/product\/uploads\//.test(u) && !/-(320|640|960|1280)\.(avif|webp)$/.test(u));
  check("no stored original is used as a menu thumbnail", originals.length === 0, originals.join(" "));

  await page.close();
}

// ---------------------------------------------------------------------------
// The CMS contract: the header follows the database, with no frontend edit.
// Every one of these is done through the real tables the admin panel writes.
// ---------------------------------------------------------------------------
async function cms(browser, adminToken) {
  section("CMS drives the header");
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
  await page.setViewport({ width: 1440, height: 900 });
  await page.setCookie({ name: "profit_session", value: adminToken, domain: new URL(BASE).hostname, path: "/" });

  // Everything below goes through the REAL admin endpoints, from a real admin
  // session in a real browser (so the CSRF header is produced the way the CMS
  // produces it). Writing to the tables directly would prove the query is
  // right and prove nothing at all about whether saving in the CMS updates
  // what a customer sees — which is the actual requirement, and which depends
  // on the header cache being invalidated on write.
  await page.goto(`${BASE}/admin/manage/navigation`, { waitUntil: "networkidle2" });
  await page.waitForFunction(() => !!window.AdminAPI, { timeout: 8000 });

  const api = (method, path, body) =>
    page.evaluate(async (m, p, b) => {
      // Same-origin fetch from the admin page, carrying the CSRF token out of
      // the cookie exactly as assets/js/admin/api.js does — the endpoints
      // refuse a session cookie on its own, and they should.
      const readCookie = (n) => (document.cookie.match("(^|;)\\s*" + n + "\\s*=\\s*([^;]+)") || [])[2] || "";
      const res = await fetch(p, {
        method: m,
        headers: Object.assign({ "Content-Type": "application/json" }, m === "GET" ? {} : { "X-CSRF-Token": readCookie("profit_csrf") }),
        body: b ? JSON.stringify(b) : undefined,
      });
      return { status: res.status, body: await res.json().catch(() => ({})) };
    }, method, path, body || null);

  const labels = async () => {
    const p2 = await browser.newPage();
    await p2.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
    await p2.goto(`${BASE}/`, { waitUntil: "domcontentloaded" });
    await p2.evaluate(PAGE_HELPERS);
    const out = await p2.evaluate(() => ({
      labels: window.__nav.triggers().map((li) => li.querySelector(".nav-top-link").textContent.trim()),
      panels: window.__nav.triggers().map((li) => {
        const panel = window.__nav.panelOf(li);
        return {
          key: li.dataset.navItem,
          layout: (panel.className.match(/nav-panel--(\w+)/) || [])[1],
          links: Array.prototype.slice.call(panel.querySelectorAll("a[href]")).map((a) => a.getAttribute("href")),
          items: Array.prototype.slice.call(panel.querySelectorAll(".nav-panel__link-name")).map((s2) => s2.textContent),
        };
      }),
    }));
    await p2.close();
    return out;
  };

  const before = (await labels()).labels;

  const created = await api("POST", "/api/admin/taxonomy", { label: "Equipment" });
  check("admin can create a whole new nav category", created.status === 201, `HTTP ${created.status} ${JSON.stringify(created.body).slice(0, 120)}`);
  const tax = created.body.taxonomy;
  if (!tax) { await page.close(); return; }

  const added = await api("POST", `/api/admin/taxonomy/${tax.id}/nodes`, { name: "Kettlebells" });
  await api("POST", `/api/admin/taxonomy/${tax.id}/nodes`, { name: "Resistance Bands" });

  let now = await labels();
  check("it appears in the storefront header immediately", now.labels.includes("Equipment"), now.labels.join(" | "));
  const panel = now.panels.find((p2) => p2.key === tax.key);
  check("its panel is laid out from its structure, with no configuration", panel && panel.layout === "list", panel && panel.layout);
  check("its items get working clean URLs", panel && panel.links.includes(`/${tax.nodeRoute}/kettlebells`), panel && panel.links.join(" "));
  const status = await page.evaluate(async (u) => (await fetch(u)).status, `/${tax.nodeRoute}/kettlebells`);
  check("and those URLs resolve to a real listing page", status === 200, `HTTP ${status}`);

  await api("PUT", `/api/admin/taxonomy/${tax.id}`, { label: "Gear" });
  now = await labels();
  check("renaming the category updates the header", now.labels.includes("Gear") && !now.labels.includes("Equipment"), now.labels.join(" | "));

  await api("PUT", `/api/admin/taxonomy/${tax.id}`, { order: -1 });
  now = await labels();
  check("reordering the category updates the header", now.labels[0] === "Gear", now.labels.join(" | "));

  await api("PUT", `/api/admin/taxonomy/nodes/${added.body.node.id}`, { name: "Kettlebell" });
  now = await labels();
  check("renaming an item updates the panel", (now.panels.find((p2) => p2.key === tax.key) || { items: [] }).items.includes("Kettlebell"));

  await api("DELETE", `/api/admin/taxonomy/nodes/${added.body.node.id}`);
  now = await labels();
  check("deleting an item removes it from the panel", !(now.panels.find((p2) => p2.key === tax.key) || { items: [] }).items.includes("Kettlebell"));

  await api("PUT", `/api/admin/taxonomy/${tax.id}`, { showInNav: false });
  now = await labels();
  check("hiding the category removes it from the header only", !now.labels.includes("Gear"), now.labels.join(" | "));
  const stillThere = await api("GET", "/api/admin/taxonomy");
  check("...while it still exists in the CMS", (stillThere.body.taxonomies || []).some((t) => t.id === tax.id));

  const blocked = await api("DELETE", `/api/admin/taxonomy/${tax.id}`);
  check("deleting a category that still holds items is refused", blocked.status === 409, `HTTP ${blocked.status}`);

  for (const t of (stillThere.body.taxonomies || []).filter((t2) => t2.id === tax.id)) {
    for (const n of t.nodes) await api("DELETE", `/api/admin/taxonomy/nodes/${n.id}`);
  }
  const removed = await api("DELETE", `/api/admin/taxonomy/${tax.id}`);
  check("deleting an empty category succeeds", removed.status === 200, `HTTP ${removed.status}`);

  now = await labels();
  check("the header is back exactly as it started", now.labels.join("|") === before.join("|"), now.labels.join(" | "));

  await page.close();
}

(async () => {
  // A previous crashed run can leave its fixture behind, and every "one
  // trigger per category" assertion would then measure the wreckage instead
  // of the site.
  const leftovers = await prisma.taxonomy.findMany({ where: { key: { startsWith: "zz-" } } });
  for (const t of leftovers) {
    await prisma.taxonomyNode.deleteMany({ where: { taxonomyId: t.id } });
    await prisma.taxonomy.delete({ where: { id: t.id } });
  }
  const stray = await prisma.taxonomy.findMany({ where: { label: { in: ["Equipment", "Gear"] } } });
  for (const t of stray) {
    await prisma.taxonomyNode.deleteMany({ where: { taxonomyId: t.id } });
    await prisma.taxonomy.delete({ where: { id: t.id } });
  }

  const admin = await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true, email: true } });
  if (!admin) throw new Error("no admin user to test the CMS with");
  const adminToken = await createSession(admin.id);

  const taxonomies = (await prisma.taxonomy.findMany({ where: { showInNav: true }, orderBy: { order: "asc" } }));
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    headless: "new",
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  try {
    await desktop(browser, taxonomies);
    await mobile(browser);
    await media(browser);
    await cms(browser, adminToken);
  } finally {
    await browser.close();
    await prisma.$disconnect();
  }
  console.log(`\n${failures ? failures + " FAILURE(S)" : "All checks passed"}`);
  process.exit(failures ? 1 : 0);
})();
