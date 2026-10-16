// Browser test for the Partner Profiles admin section and its setup wizard.
//
// Drives the real admin SPA with a real admin session and exercises the whole
// loop the brief's success criteria describe: see the section in the nav,
// open it, create a partner through the wizard, add a product from the
// existing CMS, add a custom link, publish, and confirm the public URL works.
//
// Also asserts the security boundary from the other side: the same endpoints
// must refuse a NON-admin session.
//
// Usage: node test-partner-admin.js [--base http://127.0.0.1:3200]
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

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  const builds = fs.readdirSync(root).sort();
  return path.join(root, builds[builds.length - 1], "chrome-linux64", "chrome");
}

let failures = 0;
function check(label, cond, detail) {
  if (!cond) failures++;
  console.log(`${cond ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
}

const TEST_SLUG = "zz-wizard-test";

(async () => {
  await prisma.partner.deleteMany({ where: { slug: { startsWith: TEST_SLUG } } });
  await prisma.partner.deleteMany({ where: { displayName: "Wizard Test Partner" } });

  const admin = await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true, email: true } });
  if (!admin) throw new Error("no admin user to test with");
  const adminToken = await createSession(admin.id);

  // A non-admin account, to prove the server (not the UI) is the boundary.
  let customer = await prisma.user.findFirst({ where: { role: { not: "admin" } }, select: { id: true, email: true } });
  if (!customer) {
    customer = await prisma.user.create({ data: { email: `zz-partner-test-${Date.now()}@example.test` } });
  }
  const customerToken = await createSession(customer.id);

  console.log(`admin: ${admin.email}   customer: ${customer.email}\n`);

  // ---- Server-side permission enforcement, before any browser work ----
  const origin = new URL(BASE).origin;
  async function api(pathname, token, method, body) {
    const res = await fetch(origin + pathname, {
      method: method || "GET",
      headers: {
        "x-forwarded-proto": "https",
        "content-type": "application/json",
        ...(token ? { cookie: `profit_session=${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return res.status;
  }

  check("anonymous GET  /api/admin/partners is refused", [401, 403].includes(await api("/api/admin/partners", null)));
  check("customer GET   /api/admin/partners is refused", [401, 403].includes(await api("/api/admin/partners", customerToken)));
  check("customer POST  /api/admin/partners is refused", [401, 403].includes(await api("/api/admin/partners", customerToken, "POST", { displayName: "Nope" })));
  check("customer POST  publish is refused", [401, 403, 404].includes(await api("/api/admin/partners/x/publish", customerToken, "POST")));
  check("customer DELETE is refused", [401, 403, 404].includes(await api("/api/admin/partners/x", customerToken, "DELETE")));
  // CSRF: an admin cookie WITHOUT the CSRF header must still be refused on a
  // mutating request, or the cookie alone is enough for a cross-site form.
  check("admin POST without CSRF token is refused", [403].includes(await api("/api/admin/partners", adminToken, "POST", { displayName: "Nope" })));
  console.log("");

  // ---- Browser: drive the real admin UI ----
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
  await page.setViewport({ width: 1440, height: 950 });

  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  await page.setCookie({
    name: "profit_session",
    value: adminToken,
    domain: new URL(BASE).hostname,
    path: "/",
  });

  await page.goto(`${BASE}/admin/manage/partners`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 900));

  const nav = await page.evaluate(() => {
    const link = document.querySelector('.admin-nav a[data-section="partners"]');
    return {
      present: !!link,
      label: link ? link.textContent.trim() : null,
      active: link ? link.classList.contains("active") : false,
      breadcrumb: (document.getElementById("adminBreadcrumbTitle") || {}).textContent || null,
      rows: document.querySelectorAll("#partnersTableBody tr").length,
      hasElenaCho: document.body.textContent.includes("Elena Cho"),
      createBtn: !!document.getElementById("createPartnerBtn"),
    };
  });
  check("Partner Profiles appears in admin nav", nav.present, nav.label);
  check("section is active on deep link", nav.active);
  check("breadcrumb reads Partner Profiles", nav.breadcrumb === "Partner Profiles", nav.breadcrumb);
  check("list renders rows", nav.rows > 0, `${nav.rows} rows`);
  check("existing Elena Cho profile is listed", nav.hasElenaCho);
  check("New Partner button present", nav.createBtn);

  // ---- Open the wizard and walk it ----
  await page.click("#createPartnerBtn");
  await page.waitForSelector(".a-wizard", { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 700));

  const steps = await page.evaluate(() =>
    Array.from(document.querySelectorAll(".a-wizard-step")).map((s) => s.textContent.trim())
  );
  check("wizard shows six steps", steps.length === 6, steps.join(" | "));

  // Step 1 — fill the identity fields.
  await page.type('#pwBasics [name="displayName"]', "Wizard Test Partner");
  await new Promise((r) => setTimeout(r, 150));
  const slugAuto = await page.$eval('#pwBasics [name="slug"]', (el) => el.value);
  check("slug auto-derives from the name", slugAuto === "wizard-test-partner", slugAuto);

  await page.$eval('#pwBasics [name="bio"]', (el) => { el.value = "A test profile created by the admin wizard test."; });
  await page.type('#pwBasics [name="handle"]', "wizardtest");

  // Next -> Social Links
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('.a-wizard-footer [data-act="next"]')).pop().click();
  });
  await new Promise((r) => setTimeout(r, 900));

  const socialCount = await page.evaluate(() => document.querySelectorAll(".partner-social-row").length);
  check("social step offers every platform", socialCount === 8, `${socialCount} rows`);

  // Reject a mismatched social URL server-side.
  await page.type('#pwSocials [name="instagram"]', "https://evil.example.com/sam");
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('.a-wizard-footer [data-act="next"]')).pop().click();
  });
  await new Promise((r) => setTimeout(r, 1000));
  const toastText = await page.evaluate(() => {
    const t = document.querySelector(".a-toast");
    return t ? t.textContent : "";
  });
  check("mismatched Instagram URL is rejected", /instagram\.com/i.test(toastText), toastText.slice(0, 90));

  // That rejection is a deliberate 400, so the browser logged a failed
  // request for it. Clear the buffer here rather than allowing 400s
  // generally — everything after this point must still be clean.
  consoleErrors.length = 0;

  // Correct it, then continue.
  await page.$eval('#pwSocials [name="instagram"]', (el) => { el.value = ""; });
  await page.evaluate(() => {
    Array.from(document.querySelectorAll('.a-wizard-step')).find((s) => /Products/.test(s.textContent)).click();
  });
  await page.waitForSelector("#pwProductSearch", { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 1200));

  const optionCount = await page.evaluate(() => document.querySelectorAll(".partner-picker-row").length);
  check("product picker lists existing CMS products", optionCount > 0, `${optionCount} options`);

  await page.evaluate(() => document.querySelector(".partner-picker-row").click());
  await new Promise((r) => setTimeout(r, 300));
  await page.evaluate(() => {
    const rows = document.querySelectorAll(".partner-picker-row");
    if (rows.length) rows[0].click();
  });
  await new Promise((r) => setTimeout(r, 300));
  const selected = await page.evaluate(() => document.querySelectorAll(".partner-selected-row").length);
  check("selected products appear in the ordered list", selected >= 1, `${selected} selected`);

  // Custom Links step
  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".a-wizard-step")).find((s) => /Custom Links/.test(s.textContent)).click();
  });
  await page.waitForSelector("#pwAddLink", { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.click("#pwAddLink");
  await new Promise((r) => setTimeout(r, 200));
  await page.type('.partner-link-row [data-field="title"]', "Shop all programs");
  await page.type('.partner-link-row [data-field="url"]', "/shop");

  // Publish step
  await page.evaluate(() => {
    Array.from(document.querySelectorAll(".a-wizard-step")).find((s) => /Publish/.test(s.textContent)).click();
  });
  await page.waitForSelector("#pwToggle", { timeout: 8000 });
  await new Promise((r) => setTimeout(r, 900));

  const publishView = await page.evaluate(() => ({
    url: (document.getElementById("pwPublicUrl") || {}).textContent || "",
    hasMobilePreview: !!document.querySelector(".partner-preview--mobile iframe"),
    toggleLabel: (document.getElementById("pwToggle") || {}).textContent.trim(),
  }));
  check("publish step shows the public URL", /\/partners\/wizard-test-partner/.test(publishView.url), publishView.url);
  check("mobile preview iframe renders", publishView.hasMobilePreview);
  check("publish button offered for a draft", /Publish/i.test(publishView.toggleLabel), publishView.toggleLabel);

  await page.click("#pwToggle");
  await new Promise((r) => setTimeout(r, 1200));
  const afterPublish = await page.evaluate(() => (document.getElementById("pwToggle") || {}).textContent.trim());
  check("button flips to Unpublish after publishing", /Unpublish/i.test(afterPublish), afterPublish);

  check("no console errors in the admin", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  // ---- The public URL the wizard just produced must actually work ----
  const anon = await browser.newPage();
  await anon.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
  const res = await anon.goto(`${BASE}/partners/wizard-test-partner`, { waitUntil: "domcontentloaded" });
  check("public profile URL returns 200 for anonymous", res.status() === 200, `status ${res.status()}`);
  const publicBody = await anon.evaluate(() => ({
    name: (document.querySelector(".pprofile__name") || {}).textContent || "",
    products: document.querySelectorAll(".pprofile__feature, .pprofile__row--product").length,
    links: document.querySelectorAll(".pprofile__row:not(.pprofile__row--product)").length,
    socials: document.querySelectorAll(".pprofile__social").length,
  }));
  check("public page shows the partner name", publicBody.name.includes("Wizard Test Partner"), publicBody.name);
  check("public page shows the selected product", publicBody.products >= 1, `${publicBody.products}`);
  check("public page shows the custom link", publicBody.links >= 1, `${publicBody.links}`);
  check("no empty social icons rendered", publicBody.socials === 0, `${publicBody.socials} icons`);

  await browser.close();

  // ---- Cleanup ----
  await prisma.partner.deleteMany({ where: { slug: "wizard-test-partner" } });
  console.log("\ncleaned up the wizard test partner");

  console.log(failures ? `\n${failures} FAILURE(S)` : "\nAll partner admin checks passed");
  await prisma.$disconnect();
  process.exit(failures ? 1 : 0);
})().catch(async (e) => {
  console.error(e);
  await prisma.$disconnect();
  process.exit(1);
});
