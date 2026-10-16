// Desktop customer account navigation, in a real browser.
//
// The account rows (My Library / My Profile / Orders / Sign Out) used to live
// ONLY inside partials/header.html's .mobile-account-links, which is
// d-lg-none. Above 991px a signed-in customer therefore had no link to their
// own account settings anywhere on the site — the /my-profile page worked
// fine, nothing linked to it. This guards the desktop menu that closes that
// gap, and guards the mobile drawer against being duplicated or broken by it.
//
// Everything here uses REAL mouse clicks at real coordinates, because the
// whole question is whether a pointer can reach these controls.
//
//   DATABASE_URL="...?schema=builder_test" node test-account-nav.js --base http://127.0.0.1:3200
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
const BASE = arg("--base", "http://127.0.0.1:3200");
const EMAIL = "zz-account-nav@example.test";

const DESKTOP = [1024, 1280, 1440, 1920];
const MOBILE = [320, 375, 390, 430, 768];

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

async function cleanup() {
  const user = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (!user) return;
  await prisma.session.deleteMany({ where: { userId: user.id } });
  await prisma.user.delete({ where: { id: user.id } });
}

async function seed() {
  await cleanup();
  return prisma.user.create({
    data: { email: EMAIL, name: "Nav Tester", phone: "+1 555 0000", country: "US" },
  });
}

// The state of the header's account slot, measured rather than assumed.
const readHeader = () => ({
  link: (() => {
    const el = document.getElementById("headerAccountLink");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { visible: r.width > 0 && r.height > 0 && getComputedStyle(el).display !== "none", hidden: el.classList.contains("u-hidden") };
  })(),
  btn: (() => {
    const el = document.getElementById("headerAccountBtn");
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      visible: r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden",
      label: (document.getElementById("headerAccountBtnText") || {}).textContent,
      expanded: el.getAttribute("aria-expanded"),
      rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
    };
  })(),
  menu: (() => {
    const el = document.getElementById("headerAccountMenu");
    if (!el) return null;
    const cs = getComputedStyle(el);
    const r = el.getBoundingClientRect();
    return {
      hiddenAttr: el.hidden,
      open: document.getElementById("headerAccountWrap").classList.contains("is-open"),
      opacity: Number(cs.opacity), visibility: cs.visibility,
      rect: { left: Math.round(r.left), right: Math.round(r.right), top: Math.round(r.top), bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) },
    };
  })(),
  // Every account destination a pointer could actually use right now.
  reachable: (() => {
    const out = [];
    const hit = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      if (!(r.width > 0 && r.height > 0) || cs.visibility === "hidden" || cs.display === "none" || Number(cs.opacity) < 0.01) return false;
      const top = document.elementFromPoint(Math.round(r.left + r.width / 2), Math.round(r.top + r.height / 2));
      return !!top && (top === el || el.contains(top));
    };
    document.querySelectorAll('a[href="/my-library"], a[href="/my-profile"], a[href="/orders"], .js-signout').forEach((el) => {
      if (hit(el)) out.push(el.getAttribute("href") || "signout");
    });
    return out;
  })(),
  headerBottom: (() => {
    const h = document.querySelector(".site-header");
    return h ? Math.round(h.getBoundingClientRect().bottom) : null;
  })(),
  docOverflow: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth),
});

async function clickAt(page, rect) {
  await page.mouse.click(Math.round(rect.x + rect.w / 2), Math.round(rect.y + rect.h / 2));
}

(async () => {
  const user = await seed();
  const token = await createSession(user.id);
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const consoleErrors = [];

  // =================================================================
  section("1  Desktop — the account menu exists, opens and closes");
  // =================================================================
  for (const width of DESKTOP) {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
    await page.setViewport({ width, height: 900 });
    await page.setCookie({ name: "profit_session", value: token, domain: "127.0.0.1", path: "/" });
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${width}px ${m.text()}`); });
    page.on("pageerror", (e) => consoleErrors.push(`${width}px pageerror: ${e.message}`));

    await page.goto(`${BASE}/my-library`, { waitUntil: "networkidle0" });
    await wait(900);
    console.log(`\n${width}px`);

    let s = await page.evaluate(readHeader);
    check("account control is visible", !!s.btn && s.btn.visible, s.btn && s.btn.label);
    // Measured as PAINTED, not as "the class is on it". #headerAccountLink
    // carries .d-flex (display:flex !important), which the plain .u-hidden
    // utility cannot beat on its own — asserting the class here would pass
    // while the header showed two account icons.
    check("signed-out link stepped aside", !!s.link && !s.link.visible,
      "painted=" + (s.link && s.link.visible) + " u-hidden=" + (s.link && s.link.hidden));
    check("menu starts closed", s.menu.hiddenAttr === true && s.btn.expanded === "false");

    // --- open by clicking the button, with a real pointer
    await clickAt(page, s.btn.rect);
    await wait(400);
    s = await page.evaluate(readHeader);
    check("menu opens on click", s.menu.open && !s.menu.hiddenAttr && s.menu.opacity > 0.9 && s.menu.visibility === "visible",
      `open=${s.menu.open} opacity=${s.menu.opacity}`);
    check("aria-expanded follows the menu", s.btn.expanded === "true");

    const items = await page.evaluate(() => {
      const menu = document.getElementById("headerAccountMenu");
      return Array.from(menu.querySelectorAll(".header-account-menu__item")).map((el) => {
        const r = el.getBoundingClientRect();
        const cx = Math.round(r.left + r.width / 2), cy = Math.round(r.top + r.height / 2);
        const top = document.elementFromPoint(cx, cy);
        return {
          label: el.textContent.trim(),
          href: el.getAttribute("href") || "signout",
          w: Math.round(r.width), h: Math.round(r.height),
          clickable: !!top && (top === el || el.contains(top)),
        };
      });
    });
    const labels = items.map((i) => i.href);
    check("menu holds all four rows", labels.join(",") === "/my-library,/my-profile,/orders,signout", labels.join(","));
    check("every row is hit-testable (nothing clipping or covering)", items.every((i) => i.clickable),
      items.filter((i) => !i.clickable).map((i) => i.label).join(",") || "all reachable");

    // --- geometry: inside the viewport, below the header, no page overflow
    check("panel sits inside the viewport", s.menu.rect.left >= 0 && s.menu.rect.right <= width && s.menu.rect.top >= 0,
      `left=${s.menu.rect.left} right=${s.menu.rect.right} vw=${width}`);
    check("panel clears the header (no overlap)", s.menu.rect.top >= s.headerBottom - 1,
      `panelTop=${s.menu.rect.top} headerBottom=${s.headerBottom}`);
    check("no horizontal page overflow while open", s.docOverflow <= 0, `overflow=${s.docOverflow}px`);

    // --- close: outside click
    await page.mouse.click(Math.round(width / 2), 600);
    await wait(400);
    s = await page.evaluate(readHeader);
    check("closes on outside click", !s.menu.open && s.btn.expanded === "false");

    // --- close: Escape, and focus comes back to the button
    await clickAt(page, s.btn.rect);
    await wait(350);
    await page.keyboard.press("Escape");
    await wait(400);
    s = await page.evaluate(readHeader);
    const focused = await page.evaluate(() => document.activeElement && document.activeElement.id);
    check("closes on Escape", !s.menu.open && s.btn.expanded === "false");
    check("Escape returns focus to the account button", focused === "headerAccountBtn", focused);

    // --- close: clicking the button again
    await clickAt(page, s.btn.rect);
    await wait(350);
    s = await page.evaluate(readHeader);
    const reopened = s.menu.open;
    await clickAt(page, s.btn.rect);
    await wait(400);
    s = await page.evaluate(readHeader);
    check("toggles shut on a second button click", reopened && !s.menu.open);

    // --- exactly one account control, not two
    const controls = await page.evaluate(() => {
      // Deliberately computed-style only: a u-hidden class that lost to an
      // !important display is exactly the failure this check exists to catch.
      const vis = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
      };
      return {
        headerLink: vis(document.getElementById("headerAccountLink")),
        headerBtn: vis(document.getElementById("headerAccountBtn")),
        drawerRows: Array.from(document.querySelectorAll(".mobile-account-links__item")).filter(vis).length,
      };
    });
    check("no duplicate account controls", controls.headerBtn && !controls.headerLink && controls.drawerRows === 0,
      JSON.stringify(controls));

    await page.close();
  }

  // =================================================================
  section("2  Desktop — My Profile is reachable, editable and persists");
  // =================================================================
  for (const width of DESKTOP) {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
    await page.setViewport({ width, height: 900 });
    await page.setCookie({ name: "profit_session", value: token, domain: "127.0.0.1", path: "/" });
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${width}px ${m.text()}`); });
    page.on("pageerror", (e) => consoleErrors.push(`${width}px pageerror: ${e.message}`));

    const patches = [];
    page.on("response", async (res) => {
      const r = res.request();
      if (/\/api\/account\/profile/.test(r.url()) && r.method() === "PATCH") {
        patches.push({ status: res.status() });
      }
    });

    console.log(`\n${width}px`);
    await page.goto(`${BASE}/my-library`, { waitUntil: "networkidle0" });
    await wait(900);

    // Reach the editor the way a customer does: through the new menu.
    const btnRect = (await page.evaluate(readHeader)).btn.rect;
    await clickAt(page, btnRect);
    await wait(400);
    const profileRect = await page.evaluate(() => {
      const a = document.querySelector('#headerAccountMenu a[href="/my-profile"]');
      const r = a.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    await Promise.all([
      page.waitForNavigation({ waitUntil: "networkidle0" }),
      clickAt(page, profileRect),
    ]);
    await wait(900);
    check("menu navigates to My Profile", new URL(page.url()).pathname === "/my-profile", page.url());

    const want = {
      name: "Desktop " + width + " Name",
      phone: "+1 555 " + width,
      country: width % 2 === 0 ? "CA" : "GB",
    };
    await page.evaluate((w) => {
      const set = (id, v) => {
        const el = document.getElementById(id);
        el.value = v;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
      };
      set("prFullName", w.name);
      set("prPhone", w.phone);
      set("prCountry", w.country);
    }, want);

    // Save with a real click on the real button.
    const saveRect = await page.evaluate(() => {
      const b = document.getElementById("prSaveDetails");
      b.scrollIntoView({ block: "center", behavior: "instant" });
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    await wait(250);
    await clickAt(page, saveRect);
    await wait(1600);

    const status = await page.evaluate(() => (document.getElementById("prDetailsStatus") || {}).textContent);
    check("PATCH /api/account/profile fired and succeeded", patches.length === 1 && patches[0].status === 200,
      JSON.stringify(patches));
    check("UI confirms the save", (status || "").trim() === "Saved.", (status || "").trim());

    // Reload — the real persistence question.
    await page.reload({ waitUntil: "networkidle0" });
    await wait(900);
    const after = await page.evaluate(() => ({
      name: document.getElementById("prFullName").value,
      phone: document.getElementById("prPhone").value,
      country: document.getElementById("prCountry").value,
    }));
    check("name persists across a reload", after.name === want.name, after.name);
    check("phone persists across a reload", after.phone === want.phone, after.phone);
    check("country persists across a reload", after.country === want.country, after.country);

    const row = await prisma.user.findUnique({ where: { id: user.id }, select: { name: true, phone: true, country: true } });
    check("database holds the new values", row.name === want.name && row.phone === want.phone && row.country === want.country,
      JSON.stringify(row));

    await page.close();
  }

  // =================================================================
  section("3  Mobile — the drawer still works and gained no duplicate");
  // =================================================================
  for (const width of MOBILE) {
    const page = await browser.newPage();
    await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
    await page.setViewport({ width, height: 844 });
    await page.setCookie({ name: "profit_session", value: token, domain: "127.0.0.1", path: "/" });
    page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(`${width}px ${m.text()}`); });
    page.on("pageerror", (e) => consoleErrors.push(`${width}px pageerror: ${e.message}`));

    await page.goto(`${BASE}/my-library`, { waitUntil: "networkidle0" });
    await wait(900);
    console.log(`\n${width}px`);

    const closed = await page.evaluate(() => {
      const vis = (el) => {
        if (!el) return false;
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden";
      };
      return {
        desktopBtn: vis(document.getElementById("headerAccountBtn")),
        desktopMenu: vis(document.getElementById("headerAccountMenu")),
        burger: vis(document.querySelector(".header-bar")),
      };
    });
    check("desktop menu stays out of the way", !closed.desktopBtn && !closed.desktopMenu, JSON.stringify(closed));
    check("drawer toggle is present", closed.burger);

    // Open the drawer exactly as a thumb would.
    const burgerRect = await page.evaluate(() => {
      const b = document.querySelector(".header-bar");
      const r = b.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
    });
    await clickAt(page, burgerRect);
    await wait(900);

    const drawer = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".mobile-account-links__item"));
      const out = [];
      rows.forEach((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        const on = r.width > 0 && r.height > 0 && cs.display !== "none" && cs.visibility !== "hidden" && !el.classList.contains("u-hidden");
        if (on) out.push((el.getAttribute("href") || el.id || "").trim());
      });
      return { rows: out, overflow: Math.round(document.documentElement.scrollWidth - document.documentElement.clientWidth) };
    });
    const has = (h) => drawer.rows.some((r) => r === h);
    check("drawer still offers My Library / My Profile / Orders", has("/my-library") && has("/my-profile") && has("/orders"),
      drawer.rows.join(","));
    check("drawer still offers Sign Out", drawer.rows.some((r) => /drawerSignOut/.test(r)), drawer.rows.join(","));
    check("no horizontal overflow with the drawer open", drawer.overflow <= 0, `${drawer.overflow}px`);

    await page.close();
  }

  section("4  Console");
  check("no console errors anywhere", consoleErrors.length === 0, consoleErrors.slice(0, 4).join(" | "));

  await browser.close();
  await cleanup();
  await prisma.$disconnect();

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nAll account-navigation checks passed");
  process.exit(failures ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  try { await cleanup(); await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});
