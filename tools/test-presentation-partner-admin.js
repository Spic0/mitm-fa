// Browser test for the Partner Profile picker in
// Admin -> Private Presentations -> Edit -> Content.
//
// Drives the REAL admin SPA with a real admin session — no stub API — so it
// exercises the picker, the partner-options endpoint behind it and the save
// path as one thing. The seven capabilities the brief asks for are the seven
// named checks: enable/disable, search, select, change, remove, preview, save.
//
// The one thing worth stating up front, because it is what makes the picker
// different from the product picker beside it: an UNPUBLISHED profile is
// selectable and saveable, but the deck will not render it. That is a
// deliberate pair of decisions (attach-before-publish is a real workflow;
// publishing by attaching is not), and it is only safe if the admin is told.
// So "a draft profile is clearly marked" is a correctness check here, not
// cosmetics.
//
// Seeds and removes its own fixtures. Needs only a server on --base pointed
// at the SAME database, and that database must be a throwaway schema — the
// house one is `?schema=builder_test`, never `public`:
//
//   DATABASE_URL="...?schema=builder_test" node test-presentation-partner-admin.js
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
const PREFIX = "zztest-pp-";
const TARGET_SLUG = PREFIX + "product-only"; // starts with a product and NO partner

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
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const fixtures = require("./seed-presentation-partner-fixtures");

(async () => {
  await fixtures.seed();
  const partner = await prisma.partner.findUnique({ where: { slug: PREFIX + "profile" } });
  const draft = await prisma.partner.findUnique({ where: { slug: PREFIX + "draft" } });
  const target = await prisma.privatePresentation.findUnique({ where: { slug: TARGET_SLUG } });
  if (!partner || !draft || !target) throw new Error("fixtures failed to seed");

  // Reset to the pre-integration shape, so this run starts from a deck that
  // has a product and no partner.
  await prisma.privatePresentation.update({
    where: { id: target.id },
    data: { content: { ...target.content, partnerProfileId: "" } },
  });

  const admin = await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true, email: true } });
  const adminToken = await createSession(admin.id);

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

  // Every partner-options request the picker makes, so "does not load every
  // profile up front" and "debounces" are measured, not assumed.
  const optionCalls = [];
  page.on("request", (r) => {
    const u = r.url();
    if (u.includes("/api/admin/presentations/partner-options")) {
      optionCalls.push({ url: u, at: Date.now() });
    }
  });

  await page.setCookie({ name: "profit_session", value: adminToken, domain: new URL(BASE).hostname, path: "/" });
  await page.goto(`${BASE}/admin/manage/presentations`, { waitUntil: "networkidle0" });
  await wait(900);

  // ---- Open the target deck's drawer, Content tab ----
  const opened = await page.evaluate((id) => {
    const row = document.querySelector(`tr[data-id="${id}"]`);
    if (!row) return false;
    row.querySelector('[data-action="edit"]').click();
    return true;
  }, target.id);
  check("opened the presentation drawer", opened);
  await wait(1200);

  await page.evaluate(() => document.querySelector('.a-drawer-tab[data-tab="content"]').click());
  await wait(500);

  const layout = await page.evaluate(() => {
    const headings = Array.prototype.slice.call(document.querySelectorAll(".pres-form-heading"))
      .map((h) => h.textContent.trim());
    return {
      headings,
      hasProductPicker: !!document.querySelector("[data-product-picker]"),
      hasPartnerPicker: !!document.querySelector("[data-partner-picker]"),
      partnerSectionToggle: !!document.querySelector('[data-section="partner"]'),
      // The picker must reuse the product picker's classes, not invent a look.
      sharedClasses: !!document.querySelector("[data-partner-picker] .pres-picker__search")
        && !!document.querySelector("[data-partner-picker] .pres-picker__list")
        && !!document.querySelector("[data-partner-picker] .pres-picker__current"),
      currentText: (document.querySelector("[data-partner-picker] [data-picker-current]") || {}).textContent || "",
    };
  });

  check("Content has BOTH pickers", layout.hasProductPicker && layout.hasPartnerPicker,
    "the product picker must not be replaced");
  check("'Presentation product' heading kept", layout.headings.includes("Presentation product"));
  check("'Partner profile' heading added", layout.headings.includes("Partner profile"));
  check("picker reuses the existing pres-picker component", layout.sharedClasses);
  check("1  enable/disable — a Sections toggle exists", layout.partnerSectionToggle);
  check("empty state is explicit", /No partner profile/i.test(layout.currentText), layout.currentText.trim().slice(0, 60));

  // ---- 2. Search ----
  check("no profiles loaded before the picker is touched", optionCalls.length === 0,
    `${optionCalls.length} call(s)`);

  await page.focus("#presPartnerSearch");
  await wait(600);
  check("2  focusing the field queries the server", optionCalls.length === 1);

  const listAfterFocus = await page.evaluate(() =>
    Array.prototype.slice.call(document.querySelectorAll("#presPartnerList [data-idx]")).map((li) => li.textContent.trim()));
  check("   the list opens with options", listAfterFocus.length >= 2, `${listAfterFocus.length} rows`);
  check("   row 0 is the explicit remove option", /No partner profile/i.test(listAfterFocus[0] || ""));
  check("   the published fixture is offered", listAfterFocus.some((t) => t.includes(partner.displayName)));
  check("   the draft fixture is offered AND labelled draft",
    listAfterFocus.some((t) => t.includes(draft.displayName) && /draft/i.test(t)),
    "an unpublished profile must never be offered silently");
  check("   the archived state is not offered", !listAfterFocus.some((t) => /archived/i.test(t)));

  // Search by name, then by slug — both are in the brief.
  const before = optionCalls.length;
  await page.click("#presPartnerSearch", { clickCount: 3 });
  await page.type("#presPartnerSearch", "Fixture Partner", { delay: 25 });
  await wait(700);
  const byName = await page.evaluate(() =>
    Array.prototype.slice.call(document.querySelectorAll("#presPartnerList [data-idx]")).map((li) => li.textContent.trim()));
  check("2  search by name reaches the server", optionCalls.length > before);
  check("   search by name is debounced into few requests", optionCalls.length - before <= 3,
    `${optionCalls.length - before} requests for 14 keystrokes`);
  check("   search by name finds the profile", byName.some((t) => t.includes(partner.displayName)));
  check("   the server did the filtering", optionCalls[optionCalls.length - 1].url.includes("search="));

  await page.click("#presPartnerSearch", { clickCount: 3 });
  await page.type("#presPartnerSearch", partner.slug, { delay: 20 });
  await wait(700);
  const bySlug = await page.evaluate(() =>
    Array.prototype.slice.call(document.querySelectorAll("#presPartnerList [data-idx]")).map((li) => li.textContent.trim()));
  check("2  search by slug finds the profile", bySlug.some((t) => t.includes(partner.displayName)));

  // ---- 3. Select ----
  await page.evaluate((name) => {
    const li = Array.prototype.slice.call(document.querySelectorAll("#presPartnerList [data-idx]"))
      .find((el) => el.textContent.includes(name));
    li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  }, partner.displayName);
  await wait(300);

  const afterSelect = await page.evaluate(() => ({
    hiddenValue: document.querySelector("#presPartnerProfile").value,
    current: document.querySelector("[data-partner-picker] [data-picker-current]").textContent.trim(),
    listHidden: document.querySelector("#presPartnerList").hidden,
    previewHref: (document.querySelector(".pres-picker__preview") || {}).getAttribute
      ? document.querySelector(".pres-picker__preview").getAttribute("href") : null,
    previewTarget: document.querySelector(".pres-picker__preview")
      ? document.querySelector(".pres-picker__preview").getAttribute("target") : null,
  }));
  check("3  selecting stores the partner id", afterSelect.hiddenValue === partner.id, afterSelect.hiddenValue);
  check("   the list closes after choosing", afterSelect.listHidden);
  check("   the selection shows the real name", afterSelect.current.includes(partner.displayName));
  check("   a published selection says it will render",
    /live|will show/i.test(afterSelect.current), afterSelect.current.slice(0, 90));
  check("6  Preview links to the profile's own page",
    afterSelect.previewHref === `/partners/${partner.slug}`, afterSelect.previewHref);
  check("   Preview opens in a new tab", afterSelect.previewTarget === "_blank");

  // ---- 7. Save ----
  await page.evaluate(() => document.querySelector('[data-drawer-action="save"]').click());
  await wait(1600);

  const saved = await prisma.privatePresentation.findUnique({ where: { id: target.id } });
  check("7  save persists partnerProfileId", saved.content.partnerProfileId === partner.id,
    String(saved.content.partnerProfileId));
  check("   save did NOT disturb the product", saved.content.featuredProductId === target.content.featuredProductId,
    `${saved.content.featuredProductId}`);
  check("   the deck now renders the profile",
    (await (await fetch(`${BASE}/presentation/${TARGET_SLUG}`, { headers: { "x-forwarded-proto": "https" } })).text())
      .includes('class="pprofile'));

  // ---- 4. Change to a different (draft) profile, and be warned ----
  await page.goto(`${BASE}/admin/manage/presentations`, { waitUntil: "networkidle0" });
  await wait(900);
  await page.evaluate((id) => document.querySelector(`tr[data-id="${id}"] [data-action="edit"]`).click(), target.id);
  await wait(1200);
  await page.evaluate(() => document.querySelector('.a-drawer-tab[data-tab="content"]').click());
  await wait(700);

  const reopened = await page.evaluate(() => ({
    hiddenValue: document.querySelector("#presPartnerProfile").value,
    current: document.querySelector("[data-partner-picker] [data-picker-current]").textContent.trim(),
  }));
  check("reopening resolves the saved id to a name", reopened.current.includes("Fixture Partner"),
    reopened.current.slice(0, 70));
  check("reopening keeps the saved id", reopened.hiddenValue !== "");

  await page.focus("#presPartnerSearch");
  await wait(650);
  await page.evaluate((name) => {
    const li = Array.prototype.slice.call(document.querySelectorAll("#presPartnerList [data-idx]"))
      .find((el) => el.textContent.includes(name));
    li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  }, draft.displayName);
  await wait(300);

  const afterChange = await page.evaluate(() => ({
    hiddenValue: document.querySelector("#presPartnerProfile").value,
    current: document.querySelector("[data-partner-picker] [data-picker-current]").textContent.trim(),
    warned: !!document.querySelector(".pres-picker__link-note--warn"),
  }));
  check("4  changing the profile replaces the id", afterChange.hiddenValue === draft.id);
  check("   a draft selection is clearly marked", afterChange.warned && /draft/i.test(afterChange.current),
    afterChange.current.slice(0, 110));
  check("   it states the deck will NOT show it", /not show|NOT show/i.test(afterChange.current));

  // ---- 5. Remove ----
  await page.focus("#presPartnerSearch");
  await wait(650);
  await page.evaluate(() => {
    const li = document.querySelector("#presPartnerList .pres-picker__opt--none");
    li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await wait(300);
  const afterRemove = await page.evaluate(() => ({
    hiddenValue: document.querySelector("#presPartnerProfile").value,
    current: document.querySelector("[data-partner-picker] [data-picker-current]").textContent.trim(),
  }));
  check("5  removing clears the id", afterRemove.hiddenValue === "");
  check("   the empty state returns", /No partner profile/i.test(afterRemove.current));

  await page.evaluate(() => document.querySelector('[data-drawer-action="save"]').click());
  await wait(1600);
  const cleared = await prisma.privatePresentation.findUnique({ where: { id: target.id } });
  check("5  the removal is persisted", !cleared.content.partnerProfileId);
  check("   the product SURVIVED every edit", cleared.content.featuredProductId === target.content.featuredProductId,
    cleared.content.featuredProductId);

  check("11 no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 4).join(" | "));

  await browser.close();
  if (!process.argv.includes("--keep")) await fixtures.clean();
  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nAll presentation-partner admin checks passed");
  process.exitCode = failures ? 1 : 0;
})()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
