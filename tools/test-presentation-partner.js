// Integration test for Partner Profiles inside Private Presentations.
//
// The feature is a REFERENCE, not a copy: a presentation stores a partner id
// in its content blob and the deck resolves it on every render. Almost every
// check below is really one of two questions —
//
//   does the reference stay live?   (rename the partner, reload the deck)
//   does it stay independent?       (the product bypass must not notice)
//
// It also guards the thing that would be quietly wrong rather than broken: an
// unpublished profile must not become readable through a deck link, which is
// the one way this feature could widen access to something /partners/:slug
// deliberately 404s.
//
// Seeds and removes its own fixtures, so it needs nothing but a server on
// --base pointed at the SAME database. Run it against a throwaway schema —
// the house one is `?schema=builder_test`, never `public`:
//
//   DATABASE_URL="...?schema=builder_test" node test-presentation-partner.js
//
// Pass --keep to leave the fixtures in place for manual poking afterwards.
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const SERVER = path.join(__dirname, "..", "server");
const { prisma } = require(path.join(SERVER, "src", "db.js"));
const { createSession } = require(path.join(SERVER, "src", "lib", "session.js"));
// The CSRF token is DERIVED from the session token (double-submit, see
// middleware/csrf.js) — there is no endpoint to fetch one from.
const { deriveCsrfToken } = require(path.join(SERVER, "src", "lib", "csrf.js"));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg("--base", "http://127.0.0.1:3200");
const ORIGIN = new URL(BASE).origin;

const PREFIX = "zztest-pp-";
const CASE = {
  A: PREFIX + "product-only",
  B: PREFIX + "partner-only",
  C: PREFIX + "both",
  D: PREFIX + "neither",
  E: PREFIX + "draft-partner",
  F: PREFIX + "dangling-partner",
};

// The brief's phone widths.
const PHONE_WIDTHS = [320, 375, 390, 430];

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
function section(name) {
  console.log(`\n---- ${name} ----`);
}

async function getDeck(slug) {
  const res = await fetch(`${ORIGIN}/presentation/${slug}`, {
    headers: { "x-forwarded-proto": "https" },
  });
  return { status: res.status, html: await res.text() };
}

// The deck ships HTML comments; every assertion about what a visitor can see
// has to ignore them, or a comment mentioning "partner.css" reads as a
// stylesheet link that isn't there.
function stripComments(html) {
  return html.replace(/<!--[\s\S]*?-->/g, "");
}

const fixtures = require("./seed-presentation-partner-fixtures");

(async () => {
  await fixtures.seed();
  const partner = await prisma.partner.findUnique({ where: { slug: PREFIX + "profile" } });
  const draftPartner = await prisma.partner.findUnique({ where: { slug: PREFIX + "draft" } });
  if (!partner || !draftPartner) throw new Error("fixtures failed to seed");
  const originalName = partner.displayName;

  const admin = await prisma.user.findFirst({ where: { role: "admin" }, select: { id: true, email: true } });
  if (!admin) throw new Error("no admin user in this schema");
  const adminToken = await createSession(admin.id);

  let customer = await prisma.user.findFirst({ where: { role: { not: "admin" } }, select: { id: true, email: true } });
  if (!customer) customer = await prisma.user.create({ data: { email: `zz-pp-test-${Date.now()}@example.test` } });
  const customerToken = await createSession(customer.id);

  // ---------------------------------------------------------------
  section("1-4  The four content states render correctly");
  // ---------------------------------------------------------------
  const decks = {};
  for (const [key, slug] of Object.entries(CASE)) {
    const d = await getDeck(slug);
    decks[key] = { ...d, clean: stripComments(d.html) };
    check(`${key} ${slug} responds 200`, d.status === 200, `http ${d.status}`);
  }

  const hasProfile = (k) => decks[k].clean.includes('class="pprofile');
  const hasSection = (k) => decks[k].clean.includes('id="pres-partner"');
  const hasProductCta = (k) => decks[k].clean.includes("data-product-cta");

  check("A  product only   — no partner section", !hasSection("A") && !hasProfile("A"));
  check("A  product only   — product buttons present", hasProductCta("A"));
  check("B  partner only   — profile rendered", hasProfile("B") && hasSection("B"));
  check("B  partner only   — no product buttons", !hasProductCta("B"));
  check("C  both           — profile rendered", hasProfile("C"));
  check("C  both           — product buttons ALSO present", hasProductCta("C"),
    "the two references must be independent");
  check("D  neither        — neither rendered", !hasSection("D") && !hasProductCta("D"));

  // ---------------------------------------------------------------
  section("9  An unpublished profile is never exposed through a deck");
  // ---------------------------------------------------------------
  check("E  draft partner  — section omitted", !hasSection("E") && !hasProfile("E"));
  check("E  draft partner  — no profile content leaks", !decks.E.clean.includes("Secret draft link"),
    "a draft's link titles must not appear in a deck");
  check("E  draft partner  — draft name absent", !decks.E.clean.includes(draftPartner.displayName));
  const draftPublic = await fetch(`${ORIGIN}/partners/${draftPartner.slug}`, {
    headers: { "x-forwarded-proto": "https" },
  });
  check("   draft profile still 404s publicly", draftPublic.status === 404, `http ${draftPublic.status}`);

  // ---------------------------------------------------------------
  section("F  A deleted / unknown partner id degrades, never errors");
  // ---------------------------------------------------------------
  check("F  dangling id    — deck still renders", decks.F.status === 200);
  check("F  dangling id    — section omitted", !hasSection("F"));

  // ---------------------------------------------------------------
  section("Assets are attached only when a profile is actually shown");
  // ---------------------------------------------------------------
  const links = (k) => (decks[k].clean.match(/<link[^>]+href="([^"]+\.css)"/g) || []).join(" ");
  check("C  loads partner.css", links("C").includes("partner.css"));
  check("C  loads media-container.css", links("C").includes("media-container.css"));
  check("C  loads the Font Awesome subset", links("C").includes("all.min.css"));
  check("A  loads NONE of them", !/partner\.css|media-container\.css|all\.min\.css/.test(links("A")),
    "a deck with no profile must not pay for the profile's assets");
  check("D  loads NONE of them", !/partner\.css|media-container\.css|all\.min\.css/.test(links("D")));

  // ---------------------------------------------------------------
  section("The deck holds a reference, not a snapshot");
  // ---------------------------------------------------------------
  check("profile name present before rename", decks.B.clean.includes(originalName));
  const renamed = originalName + " Official";
  await prisma.partner.update({ where: { id: partner.id }, data: { displayName: renamed } });
  const afterRename = stripComments((await getDeck(CASE.B)).html);
  check("6  renaming the partner updates the deck", afterRename.includes(renamed),
    "no edit to the presentation was made");
  check("   the old name is gone", !afterRename.includes(originalName + "<"));

  // A link added in Admin -> Partner Profiles must appear too — the reference
  // covers the whole profile, not just its name.
  const newLink = await prisma.partnerLink.create({
    data: { partnerId: partner.id, title: "Added after attaching", url: "/about", icon: "link", position: 9 },
  });
  const afterLink = stripComments((await getDeck(CASE.B)).html);
  check("   a link added later also appears", afterLink.includes("Added after attaching"));
  await prisma.partnerLink.delete({ where: { id: newLink.id } });
  await prisma.partner.update({ where: { id: partner.id }, data: { displayName: originalName } });

  // Nothing about the profile may be written into the presentation row.
  const rowB = await prisma.privatePresentation.findUnique({ where: { slug: CASE.B } });
  const contentJson = JSON.stringify(rowB.content);
  check("presentation stores ONLY the id", contentJson.includes(partner.id));
  check("presentation stores no profile name", !contentJson.includes(originalName));
  check("presentation stores no bio / links", !contentJson.includes("Fixture profile used by") && !contentJson.includes("/shop"));

  // ---------------------------------------------------------------
  section("8  The product bypass is untouched");
  // ---------------------------------------------------------------
  // Same assertion the deck renderer's own rule makes: a published product
  // links to its storefront page. What matters here is only that attaching a
  // partner did not change it.
  const productHrefA = (decks.A.clean.match(/href="(\/(?:program|showcase|my-library)\/[^"]+)"/) || [])[1];
  const productHrefC = (decks.C.clean.match(/href="(\/(?:program|showcase|my-library)\/[^"]+)"/) || [])[1];
  check("product link present with no partner attached", !!productHrefA, productHrefA);
  check("product link IDENTICAL with a partner attached", productHrefA === productHrefC,
    `${productHrefA} vs ${productHrefC}`);
  const ctaCountA = (decks.A.clean.match(/data-product-cta/g) || []).length;
  const ctaCountC = (decks.C.clean.match(/data-product-cta/g) || []).length;
  check("same number of View Product buttons", ctaCountA === ctaCountC, `${ctaCountA} vs ${ctaCountC}`);

  // ---------------------------------------------------------------
  section("10  Authorization is enforced server-side");
  // ---------------------------------------------------------------
  async function api(pathname, token, method, body) {
    const res = await fetch(ORIGIN + pathname, {
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
  const patchBody = { content: { partnerProfileId: partner.id } };
  check("anonymous GET  partner-options refused",
    [401, 403].includes(await api("/api/admin/presentations/partner-options", null)));
  check("customer  GET  partner-options refused",
    [401, 403].includes(await api("/api/admin/presentations/partner-options", customerToken)));
  check("customer  GET  partner-options/:id refused",
    [401, 403].includes(await api(`/api/admin/presentations/partner-options/${partner.id}`, customerToken)));
  check("anonymous PATCH presentation refused",
    [401, 403].includes(await api(`/api/admin/presentations/${rowB.id}`, null, "PATCH", patchBody)));
  check("customer  PATCH presentation refused",
    [401, 403].includes(await api(`/api/admin/presentations/${rowB.id}`, customerToken, "PATCH", patchBody)));
  check("admin PATCH without CSRF header refused",
    (await api(`/api/admin/presentations/${rowB.id}`, adminToken, "PATCH", patchBody)) === 403,
    "the session cookie alone must never be enough");

  // The reference itself is validated on the way in.
  const csrfToken = deriveCsrfToken(adminToken);
  async function adminPatch(id, body) {
    const res = await fetch(`${ORIGIN}/api/admin/presentations/${id}`, {
      method: "PATCH",
      headers: {
        "x-forwarded-proto": "https",
        "content-type": "application/json",
        cookie: `profit_session=${adminToken}`,
        ...(csrfToken ? { "x-csrf-token": csrfToken } : {}),
      },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: await res.json().catch(() => ({})) };
  }
  if (csrfToken) {
    const bad = await adminPatch(rowB.id, { content: { partnerProfileId: "cnotarealpartneridxxxxxxx" } });
    check("saving an unknown partner id is rejected", bad.status === 400, `http ${bad.status} ${bad.body.error || ""}`);

    // 4/5: remove, then replace, through the real API.
    const removed = await adminPatch(rowB.id, { content: { partnerProfileId: "" } });
    const afterRemove = stripComments((await getDeck(CASE.B)).html);
    check("4  removing the profile drops the section", removed.status === 200 && !afterRemove.includes('id="pres-partner"'));

    const replaced = await adminPatch(rowB.id, { content: { partnerProfileId: partner.id } });
    const afterReplace = stripComments((await getDeck(CASE.B)).html);
    check("5  re-selecting the profile restores it", replaced.status === 200 && afterReplace.includes('class="pprofile'));

    // A draft IS saveable (attach-before-publish is a real workflow) but the
    // deck still refuses to show it.
    const draftSave = await adminPatch(rowB.id, { content: { partnerProfileId: draftPartner.id } });
    const afterDraft = stripComments((await getDeck(CASE.B)).html);
    check("a draft profile saves but does not render", draftSave.status === 200 && !afterDraft.includes('id="pres-partner"'),
      `http ${draftSave.status}`);
    await adminPatch(rowB.id, { content: { partnerProfileId: partner.id } });
  } else {
    check("could not obtain a CSRF token — API write checks skipped", false);
  }

  // ---------------------------------------------------------------
  section("13  Mobile + console");
  // ---------------------------------------------------------------
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  for (const width of PHONE_WIDTHS) {
    await page.setViewport({ width, height: 780, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/presentation/${CASE.C}`, { waitUntil: "networkidle0" });
    // The section is well below the fold; scroll it into view so its reveal
    // fires and anything lazily laid out settles.
    await page.evaluate(() => {
      const el = document.querySelector("#pres-partner");
      if (el) el.scrollIntoView({ block: "center" });
    });
    await new Promise((r) => setTimeout(r, 700));

    const m = await page.evaluate(() => {
      const sec = document.querySelector("#pres-partner");
      if (!sec) return null;
      const prof = sec.querySelector(".pprofile");
      const vw = document.documentElement.clientWidth;
      // Decorative aura orbs are deliberately larger than their section and
      // are clipped by `.pres-aura { overflow: hidden }` — every deck section
      // has them, and their unclipped bounding box is not overflow. The
      // document-level scrollWidth check below is what actually proves no
      // horizontal overflow; this one names the offending CONTENT element.
      const overflowing = [];
      sec.querySelectorAll("*").forEach((el) => {
        if (el.closest(".pres-aura")) return;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
          overflowing.push(el.className + " @" + Math.round(r.left) + ".." + Math.round(r.right));
        }
      });
      // Anything the profile drew that ended up invisible — the failure mode
      // this codebase has actually shipped (a span on a filled surface, and
      // an image revealed only by a script that never runs on server markup).
      const invisible = [];
      sec.querySelectorAll(".pprofile__name, .pprofile__cta, .pprofile__row-title, .pmedia__img").forEach((el) => {
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        if (cs.opacity === "0" || cs.visibility === "hidden" || r.width === 0 || r.height === 0) {
          invisible.push(el.className);
        }
      });
      // Tap targets inside the profile.
      const small = [];
      sec.querySelectorAll("a").forEach((a) => {
        const r = a.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && r.height < 44) small.push(a.className + " h" + Math.round(r.height));
      });
      const secRect = sec.getBoundingClientRect();
      const profRect = prof ? prof.getBoundingClientRect() : null;
      return {
        docOverflow: document.documentElement.scrollWidth - vw,
        overflowing: overflowing.slice(0, 6),
        invisible,
        small: small.slice(0, 6),
        profileWidth: profRect ? Math.round(profRect.width) : 0,
        // The gap between the section heading block and the profile — the
        // "giant empty space" the brief calls out, which is what a leftover
        // 68px fixed-header clearance would produce here.
        gapAboveProfile: profRect
          ? Math.round(profRect.top - sec.querySelector(".pres-head").getBoundingClientRect().bottom)
          : -1,
        vw,
        secTop: Math.round(secRect.top),
      };
    });

    console.log(`\n${width}px`);
    check("  section is present", !!m);
    if (!m) continue;
    check("  no horizontal document overflow", m.docOverflow <= 0, `scrollWidth-vw ${m.docOverflow}`);
    check("  nothing past the viewport edge", m.overflowing.length === 0, JSON.stringify(m.overflowing));
    check("  profile fits the viewport", m.profileWidth <= m.vw, `${m.profileWidth} <= ${m.vw}`);
    check("  nothing rendered invisible", m.invisible.length === 0, JSON.stringify(m.invisible));
    check("  tap targets >= 44px", m.small.length === 0, JSON.stringify(m.small));
    check("  no giant empty space above the profile", m.gapAboveProfile >= 0 && m.gapAboveProfile < 90,
      `${m.gapAboveProfile}px`);
  }

  // Desktop sanity, and the deck's own nav must have picked the new section up.
  await page.setViewport({ width: 1440, height: 950 });
  await page.goto(`${BASE}/presentation/${CASE.C}`, { waitUntil: "networkidle0" });
  await new Promise((r) => setTimeout(r, 600));
  const nav = await page.evaluate(() => {
    const links = Array.prototype.slice.call(document.querySelectorAll("[data-section-id]"));
    return {
      ids: links.map((l) => l.getAttribute("data-section-id")),
      railHasPartner: !!document.querySelector('.pres-rail a[href="#pres-partner"], a[href="#pres-partner"]'),
    };
  });
  console.log("");
  check("7  the deck's section list includes the new section", nav.ids.includes("partner"), nav.ids.join(","));
  check("   the deck nav links to it", nav.railHasPartner);

  check("11 no console errors", consoleErrors.length === 0, consoleErrors.slice(0, 4).join(" | "));

  await browser.close();
  if (!process.argv.includes("--keep")) await fixtures.clean();

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nAll presentation-partner checks passed");
  process.exitCode = failures ? 1 : 0;
})()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
