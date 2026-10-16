// The whole post-purchase customer journey, end to end, in a real browser.
//
//   paid order -> confirmation -> magic link -> setup wizard -> password
//   -> session -> My Library -> open program -> My Profile -> edit -> save
//   -> Orders -> back to Library
//
// It drives the REAL pages against a REAL server with a REAL magic-link
// token, because the things most worth guarding here are not visual. The
// security half of this file asserts that the claim link is single-use, that
// it cannot be replayed after setup, that no token ends up in a URL the
// customer can see afterwards, that one customer cannot read another's order
// or profile, and that completing setup creates no second account and no
// second order.
//
// Seeds and removes its own fixtures. Run against a throwaway schema — the
// house one is `?schema=builder_test`, never `public`:
//
//   DATABASE_URL="...?schema=builder_test" node test-customer-journey.js
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const SERVER = path.join(__dirname, "..", "server");
const { prisma } = require(path.join(SERVER, "src", "db.js"));
const { createMagicLinkToken, buildMagicLinkUrl } = require(path.join(SERVER, "src", "lib", "magicLink.js"));
const { createSession } = require(path.join(SERVER, "src", "lib", "session.js"));
const { deriveCsrfToken } = require(path.join(SERVER, "src", "lib", "csrf.js"));

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg("--base", "http://127.0.0.1:3200");
const ORIGIN = new URL(BASE).origin;
const HOST = new URL(BASE).hostname;

const EMAIL = "zz-journey@example.test";
const OTHER_EMAIL = "zz-journey-other@example.test";
const PASSWORD = "correct-horse-9";

const PHONE_WIDTHS = [320, 375, 390, 430];
const DESKTOP_WIDTHS = [768, 1024, 1280, 1440, 1920];

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
function section(name) { console.log(`\n---- ${name} ----`); }
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function cleanup() {
  for (const email of [EMAIL, OTHER_EMAIL]) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user) continue;
    // Nothing here cascades from User in this schema, so every child row is
    // removed explicitly, deepest first. Getting this wrong shows up as a
    // foreign-key error on the NEXT run rather than this one, which is why
    // it is spelled out rather than relying on onDelete.
    await prisma.orderItem.deleteMany({ where: { order: { userId: user.id } } });
    await prisma.order.deleteMany({ where: { userId: user.id } });
    await prisma.magicLinkToken.deleteMany({ where: { userId: user.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.programProgress.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } });
  }
}

async function seed() {
  await cleanup();
  const products = await prisma.product.findMany({
    where: { status: "published" },
    select: { id: true, slug: true, name: true, priceCents: true },
    orderBy: { createdAt: "asc" },
    take: 2,
  });
  if (products.length < 2) throw new Error("need 2 published products in this schema");

  // The buyer, exactly as fulfillment leaves them: an account with the
  // checkout's name/phone/country backfilled and NO password. That "no
  // password + has a paid order" state is what routes/auth.js keys the
  // setup redirect off.
  const user = await prisma.user.create({
    data: { email: EMAIL, name: "Alex Journey", phone: "+1 555 0100", country: "US" },
  });
  const order = await prisma.order.create({
    data: {
      userId: user.id,
      status: "paid",
      provider: "stripe",
      // Required, and it is the provider's own reference — a fixture value
      // that could never collide with a real Stripe id.
      providerRef: "zz_journey_" + Date.now(),
      totalCents: products[0].priceCents,
      items: { create: [{ productId: products[0].id, priceCents: products[0].priceCents }] },
    },
  });

  // A second customer, to prove one cannot read the other's things.
  const other = await prisma.user.create({ data: { email: OTHER_EMAIL, name: "Other Person" } });
  const otherOrder = await prisma.order.create({
    data: {
      userId: other.id, status: "paid", provider: "stripe",
      providerRef: "zz_journey_other_" + Date.now(),
      totalCents: products[1].priceCents,
      items: { create: [{ productId: products[1].id, priceCents: products[1].priceCents }] },
    },
  });

  return { user, order, other, otherOrder, products };
}

async function api(pathname, token, method, body) {
  const res = await fetch(ORIGIN + pathname, {
    method: method || "GET",
    headers: {
      "x-forwarded-proto": "https",
      "content-type": "application/json",
      ...(token ? { cookie: `profit_session=${token}`, "x-csrf-token": deriveCsrfToken(token) } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}

(async () => {
  const fx = await seed();

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2 });

  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  // Every image the browser actually fetches, so "does My Library preload
  // every product's media" is measured rather than assumed.
  const imageRequests = [];
  page.on("request", (r) => {
    if (r.resourceType() === "image") imageRequests.push(r.url());
  });

  // =================================================================
  section("1  Order confirmation (signed out, straight after payment)");
  // =================================================================
  await page.goto(`${BASE}/order/success?order=${fx.order.id}`, { waitUntil: "networkidle0" });
  await wait(700);
  let conf = await page.evaluate(() => {
    var vis = (id) => {
      var el = document.getElementById(id);
      return !!el && !el.classList.contains("ac-hidden");
    };
    return {
      problem: vis("osProblem"),
      success: vis("osSuccess"),
      title: (document.querySelector(".ac-conf__title") || {}).textContent || "",
    };
  });
  // Signed out, the order endpoint is session-scoped, so this is the honest
  // "sign in to see it" path — not a success page for someone who cannot be
  // identified.
  check("signed-out buyer does not see a success panel", conf.problem && !conf.success,
    "order reads are session-scoped");

  // =================================================================
  section("2  The claim link — single use, no token left in the URL");
  // =================================================================
  const rawToken = await createMagicLinkToken(fx.user.id);
  const magicUrl = buildMagicLinkUrl(rawToken).replace(/^https?:\/\/[^/]+/, BASE);

  const navResponse = await page.goto(magicUrl, { waitUntil: "networkidle0" });
  await wait(900);

  // /api/auth/verify is behind authLimiter (10 requests / 15 min / IP). That
  // is correct production behaviour, but it means running this file several
  // times in a row against one server exhausts the window and every check
  // below fails for a reason that has nothing to do with the code. Say so
  // rather than reporting six misleading failures — the in-memory limiter
  // resets when the server restarts.
  if (navResponse && navResponse.status() === 429) {
    console.log("SKIP  the claim-link section — /api/auth/verify is rate limited (429).");
    console.log("      authLimiter allows 10 attempts per 15 minutes per IP; restart the");
    console.log("      test server to reset it, then re-run.");
    await browser.close();
    await cleanup();
    process.exitCode = 2;
    return;
  }

  let landed = page.url();
  check("claim link lands on the setup wizard", landed.endsWith("/welcome"), landed);
  check("no token left in the address bar", !/token=/.test(landed), landed);
  const wizardHtml = await page.content();
  check("no token anywhere in the wizard markup", !wizardHtml.includes(rawToken));

  // Replay: the same token again must not work.
  const replay = await fetch(magicUrl, { headers: { "x-forwarded-proto": "https" }, redirect: "manual" });
  const replayTarget = replay.headers.get("location") || "";
  check("the claim token cannot be replayed", /\/login\?error=expired/.test(replayTarget), replayTarget);

  // =================================================================
  section("3  Setup wizard");
  // =================================================================
  const wz = await page.evaluate(() => ({
    step: (document.getElementById("wzCount") || {}).textContent || "",
    greeting: (document.getElementById("wzT1") || {}).textContent || "",
    ownedShown: !!document.querySelector("#wzOwned .ac-conf__item"),
    headerHidden: !document.querySelector("header.site-header:not(.u-hidden)"),
  }));
  check("wizard opens on step 1", /Step 1 of 5/.test(wz.step), wz.step);
  check("greets the customer by name", /Alex/.test(wz.greeting), wz.greeting.slice(0, 60));
  check("names what they bought", wz.ownedShown);
  check("site header is hidden during setup", wz.headerHidden);

  // Step 1 -> 2
  await page.click("#wzNext");
  await wait(600);

  // Weak password is refused client-side before a request is made.
  await page.type("#wzPwd", "short");
  await page.click("#wzNext");
  await wait(400);
  let pwdState = await page.evaluate(() => ({
    step: (document.getElementById("wzCount") || {}).textContent,
    err: (document.getElementById("wzPwdError") || {}).textContent || "",
  }));
  check("a too-short password does not advance", /Step 2 of 5/.test(pwdState.step), pwdState.step);

  await page.evaluate(() => { document.getElementById("wzPwd").value = ""; });
  await page.type("#wzPwd", PASSWORD);
  await page.type("#wzPwd2", PASSWORD + "x");
  await wait(300);
  let mismatch = await page.evaluate(() =>
    !document.getElementById("wzPwdError").classList.contains("ac-hidden"));
  check("mismatched confirmation is flagged inline", mismatch);

  await page.evaluate(() => { document.getElementById("wzPwd2").value = ""; });
  await page.type("#wzPwd2", PASSWORD);
  await wait(300);
  await page.click("#wzNext");
  await wait(1100);

  let step3 = await page.evaluate(() => ({
    step: (document.getElementById("wzCount") || {}).textContent,
    name: (document.getElementById("wzFullName") || {}).value,
    email: (document.getElementById("wzEmail") || {}).value,
    phone: (document.getElementById("wzPhone") || {}).value,
    country: (document.getElementById("wzCountry") || {}).value,
    emailReadonly: (document.getElementById("wzEmail") || {}).readOnly,
  }));
  check("password accepted, wizard advances to details", /Step 3 of 5/.test(step3.step), step3.step);
  check("checkout name is prefilled, not re-asked", step3.name === "Alex Journey", step3.name);
  check("checkout email is prefilled", step3.email === EMAIL, step3.email);
  check("checkout phone is prefilled", !!step3.phone, step3.phone);
  check("checkout country is prefilled", step3.country === "US", step3.country);
  check("email is read-only in the wizard", step3.emailReadonly === true);

  const passwordRow = await prisma.user.findUnique({ where: { id: fx.user.id }, select: { passwordHash: true } });
  check("password is actually stored (hashed)", !!passwordRow.passwordHash && passwordRow.passwordHash.startsWith("$2"));

  await page.click("#wzNext");
  await wait(900);
  check("advances to the optional profile step",
    /Step 4 of 5/.test(await page.evaluate(() => document.getElementById("wzCount").textContent)));

  // The optional step must be skippable.
  await page.click("#wzSkip");
  await wait(700);
  check("optional profile can be skipped",
    /Step 5 of 5/.test(await page.evaluate(() => document.getElementById("wzCount").textContent)));

  await page.click("#wzNext");
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  await wait(800);
  check("finishing setup lands in My Library", page.url().endsWith("/my-library"), page.url());

  // =================================================================
  section("4  No duplicate account, no duplicate order");
  // =================================================================
  const users = await prisma.user.count({ where: { email: EMAIL } });
  const orders = await prisma.order.count({ where: { userId: fx.user.id } });
  check("still exactly one account for this email", users === 1, String(users));
  check("still exactly one order", orders === 1, String(orders));

  // Second sign-in must NOT re-run setup now that a password exists.
  const token2 = await createMagicLinkToken(fx.user.id);
  const second = await fetch(buildMagicLinkUrl(token2).replace(/^https?:\/\/[^/]+/, BASE), {
    headers: { "x-forwarded-proto": "https" }, redirect: "manual",
  });
  check("a later sign-in skips setup and goes to the library",
    (second.headers.get("location") || "").endsWith("/my-library"),
    second.headers.get("location"));

  // =================================================================
  section("5  My Library");
  // =================================================================
  imageRequests.length = 0;
  await page.goto(`${BASE}/my-library`, { waitUntil: "networkidle0" });
  await wait(900);

  const lib = await page.evaluate(() => {
    var greet = document.querySelector(".ac-greet__title");
    return {
      greeting: greet ? greet.textContent : "",
      hasContinue: !!document.querySelector(".ac-continue"),
      continueTitle: (document.querySelector(".ac-continue__title") || {}).textContent || "",
      // Nothing has been opened yet, so there must be NO percentage anywhere.
      percents: Array.prototype.slice.call(document.querySelectorAll(".ac-progress__val"))
        .map((e) => e.textContent.trim()),
      emptyShown: !document.getElementById("libEmpty").classList.contains("ac-hidden"),
    };
  });
  check("greets the customer by name", /Alex/.test(lib.greeting), lib.greeting);
  check("shows a Continue card", lib.hasContinue, lib.continueTitle);
  check("does not show the empty state", !lib.emptyShown);
  check("no fabricated percentage before the program is opened",
    lib.percents.every((t) => !/%/.test(t)), JSON.stringify(lib.percents));
  check("status is stated honestly instead",
    lib.percents.some((t) => /Not started|In progress/i.test(t)), JSON.stringify(lib.percents));

  // Media budget: one product owned, so at most a handful of images and
  // certainly not a program's whole gallery.
  const productImages = imageRequests.filter((u) => /\/assets\/images\/product\//.test(u));
  check("library loads covers only, not program media", productImages.length <= 3,
    `${productImages.length} product images`);

  // =================================================================
  section("6  Open the purchased program, then progress becomes real");
  // =================================================================
  await page.click(".ac-continue");
  await page.waitForNavigation({ waitUntil: "networkidle0" }).catch(() => {});
  await wait(1500);
  check("Continue opens the program", /\/my-library\/[^/]+$/.test(page.url()), page.url());

  const totals = await prisma.programProgress.findFirst({
    where: { userId: fx.user.id },
    select: { totalKeys: true, lastOpenedAt: true },
  });
  check("opening the program records how many items it has",
    !!totals && typeof totals.totalKeys === "number" && totals.totalKeys > 0,
    totals ? String(totals.totalKeys) : "no row");

  // Mark one item complete server-side, then confirm the library reports a
  // REAL percentage derived from that stored denominator.
  if (totals && totals.totalKeys > 0) {
    await prisma.programProgress.updateMany({
      where: { userId: fx.user.id },
      data: { completedKeys: ["training:0:0"] },
    });
    await page.goto(`${BASE}/my-library`, { waitUntil: "networkidle0" });
    await wait(900);
    const pct = await page.evaluate(() => {
      var el = document.querySelector(".ac-continue .ac-progress__val");
      var bar = document.querySelector(".ac-continue .ac-progress__bar");
      return { text: el ? el.textContent.trim() : "", width: bar ? bar.style.width : "" };
    });
    const expected = Math.round((1 / totals.totalKeys) * 100);
    check("library now shows a real percentage", pct.text === expected + "%",
      `${pct.text} (expected ${expected}% from 1/${totals.totalKeys})`);
    check("the progress bar is actually painted", /%$/.test(pct.width), pct.width);
  }

  // =================================================================
  section("7  My Profile");
  // =================================================================
  await page.goto(`${BASE}/my-profile`, { waitUntil: "networkidle0" });
  await wait(900);
  const prof = await page.evaluate(() => ({
    name: (document.getElementById("prFullName") || {}).value,
    email: (document.getElementById("prEmailField") || {}).value,
    emailReadonly: (document.getElementById("prEmailField") || {}).readOnly,
    currentShown: !document.getElementById("prCurrentWrap").classList.contains("ac-hidden"),
    sections: document.querySelectorAll(".ac-profile__main .ac-sect").length,
  }));
  check("profile loads the real account", prof.name === "Alex Journey" && prof.email === EMAIL);
  check("email is read-only", prof.emailReadonly === true);
  check("password change asks for the current password", prof.currentShown,
    "an account with a password must re-authenticate to change it");
  check("settings are split into sections, not one form", prof.sections >= 3, String(prof.sections));

  // Edit + save
  await page.evaluate(() => { document.getElementById("prDisplayName").value = ""; });
  await page.type("#prDisplayName", "AJ");
  await page.click("#prSaveDetails");
  await wait(1200);
  const saved = await prisma.user.findUnique({ where: { id: fx.user.id }, select: { displayName: true, name: true, country: true } });
  check("display name saves", saved.displayName === "AJ", String(saved.displayName));
  check("saving one card does not blank the others",
    saved.name === "Alex Journey" && saved.country === "US",
    `name=${saved.name} country=${saved.country}`);

  // The greeting must follow the display name.
  await page.goto(`${BASE}/my-library`, { waitUntil: "networkidle0" });
  await wait(800);
  const greet2 = await page.evaluate(() => (document.querySelector(".ac-greet__title") || {}).textContent || "");
  check("library greeting uses the new display name", /AJ/.test(greet2), greet2);

  // Wrong current password must be refused by the SERVER.
  const sessionToken = await createSession(fx.user.id);
  const badChange = await api("/api/auth/set-password", sessionToken, "POST", {
    password: "another-good-one-1", currentPassword: "wrong",
  });
  check("changing a password with the wrong current one is refused", badChange.status === 401,
    `http ${badChange.status}`);

  // =================================================================
  section("8  Orders");
  // =================================================================
  await page.goto(`${BASE}/orders`, { waitUntil: "networkidle0" });
  await wait(900);
  const ord = await page.evaluate(() => {
    var head = document.querySelector(".ac-order__head");
    if (head) head.click();
    return {
      rows: document.querySelectorAll(".ac-order").length,
      ref: (document.querySelector(".ac-order__ref") || {}).textContent || "",
      // No card numbers, no gateway ids, anywhere on the page.
      body: document.body.innerText,
    };
  });
  check("the order is listed", ord.rows === 1, String(ord.rows));
  check("shows a customer-facing reference", /^#/.test(ord.ref.trim()), ord.ref);
  check("no provider transaction id is exposed", !/pi_|ch_|PAYID|tok_/.test(ord.body));

  // =================================================================
  section("9  Authorization");
  // =================================================================
  const otherSession = await createSession(fx.other.id);
  check("another customer cannot read this order",
    (await api(`/api/library/orders/${fx.order.id}`, otherSession)).status === 404,
    "scoped by session user, 404 not 403 so ids cannot be probed");
  check("anonymous cannot read the profile",
    [401, 403].includes((await api("/api/account/profile", null)).status));
  check("anonymous cannot patch a profile",
    [401, 403].includes((await api("/api/account/profile", null, "PATCH", { name: "X" })).status));
  const noCsrf = await fetch(ORIGIN + "/api/account/profile", {
    method: "PATCH",
    headers: { "x-forwarded-proto": "https", "content-type": "application/json", cookie: `profit_session=${sessionToken}` },
    body: JSON.stringify({ name: "No CSRF" }),
  });
  check("a session cookie without the CSRF header cannot write", noCsrf.status === 403, `http ${noCsrf.status}`);
  // The other customer's library must not contain this customer's product.
  const otherLib = await api("/api/library", otherSession);
  check("libraries are per-customer",
    (otherLib.body.library || []).every((e) => e.product.id !== fx.products[0].id));

  // =================================================================
  section("10  Responsive");
  // =================================================================
  const PAGES = [
    ["/my-library", ".ac-continue"],
    ["/my-profile", ".ac-idcard"],
    ["/orders", ".ac-order"],
    [`/order/success?order=${fx.order.id}`, ".ac-conf__title"],
  ];
  for (const width of PHONE_WIDTHS.concat(DESKTOP_WIDTHS)) {
    await page.setViewport({ width, height: 860, deviceScaleFactor: width < 600 ? 2 : 1 });
    let worst = null;
    for (const [url, marker] of PAGES) {
      await page.goto(BASE + url, { waitUntil: "networkidle0" });
      await wait(650);
      const m = await page.evaluate((sel) => {
        var vw = document.documentElement.clientWidth;
        var over = [];
        document.querySelectorAll(".ac-page *").forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (r.width > 0 && (r.right > vw + 1 || r.left < -1)) {
            over.push((el.className || el.tagName) + " @" + Math.round(r.left) + ".." + Math.round(r.right));
          }
        });
        var small = [];
        document.querySelectorAll(".ac-page a, .ac-page button").forEach(function (el) {
          var r = el.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && r.height < 44) small.push(el.className + " h" + Math.round(r.height));
        });
        var invisible = [];
        document.querySelectorAll(".ac-btn span, .ac-pill span").forEach(function (el) {
          var cs = getComputedStyle(el);
          var bg = getComputedStyle(el.closest(".ac-btn, .ac-pill") || el).backgroundColor;
          if (cs.color === bg && cs.color !== "rgba(0, 0, 0, 0)") invisible.push(el.textContent.trim());
        });
        return {
          docOverflow: document.documentElement.scrollWidth - vw,
          over: over.slice(0, 4),
          small: small.slice(0, 4),
          invisible: invisible.slice(0, 4),
          markerFound: !!document.querySelector(sel),
        };
      }, marker);
      if (!worst) worst = { width, ...m, url };
      if (m.docOverflow > 0 || m.over.length || m.small.length || m.invisible.length) {
        worst = { width, ...m, url };
        break;
      }
    }
    console.log(`\n${width}px`);
    check("  no horizontal overflow", worst.docOverflow <= 0, `${worst.url} scrollWidth-vw ${worst.docOverflow}`);
    check("  nothing past the viewport edge", worst.over.length === 0, worst.url + " " + JSON.stringify(worst.over));
    check("  tap targets >= 44px", worst.small.length === 0, worst.url + " " + JSON.stringify(worst.small));
    check("  no invisible button labels", worst.invisible.length === 0, JSON.stringify(worst.invisible));
  }

  console.log("");
  check("11 no console errors anywhere in the journey", consoleErrors.length === 0,
    consoleErrors.slice(0, 4).join(" | "));

  await browser.close();
  if (!process.argv.includes("--keep")) await cleanup();

  console.log(failures ? `\n${failures} CHECK(S) FAILED` : "\nAll customer-journey checks passed");
  process.exitCode = failures ? 1 : 0;
})()
  .catch((err) => { console.error(err); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
