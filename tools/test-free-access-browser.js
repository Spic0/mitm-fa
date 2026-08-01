// The BROWSER half of the free-access proof.
//
// test-free-access.js proves the server answers a logged-out prospect. That is
// not sufficient on its own: a client-side guard can redirect on a 200, and the
// reported symptom ("View product still goes to checkout") was client-side —
// the page returns 200 and something in the browser moves you.
//
// So this drives the REAL assets/js/program.js against the REAL library router,
// in a real browser, with NO cookies and NO session. The only thing faked is
// the database row, because setting freeAccess on the production row is a write
// this process is not permitted to make.
//
//   cd tools && REAL_MEDIA_DIR=<a product media dir> node test-free-access-browser.js
const path = require("path");
const fs = require("fs");
const http = require("http");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, "server");
const dep = (m) => require(require.resolve(m, { paths: [path.join(SERVER, "src", "routes")] }));
const express = dep("express");
const puppeteer = require("puppeteer-core");

const FREE_ID = "freeaccess-test";
const FREE_SLUG = "sulek-strength-size-peak";
const PAID_ID = "paid-control-product";
const FIX = path.join(SERVER, "storage", "media", FREE_ID);
const PAID_FIX = path.join(SERVER, "storage", "media", PAID_ID);
const REAL = process.env.REAL_MEDIA_DIR || "";
const N = 3;
const CHROME = process.env.CHROME_PATH || (function () {
  const base = path.join(process.env.HOME || "/root", ".cache/puppeteer/chrome");
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).sort() : [];
  if (!dirs.length) throw new Error("No Chrome found");
  return path.join(base, dirs[dirs.length - 1], "chrome-linux64", "chrome");
})();

async function ensureFixtures() {
  if (fs.existsSync(path.join(FIX, "demo0-vid.mp4"))) return;
  fs.mkdirSync(FIX, { recursive: true });
  fs.mkdirSync(PAID_FIX, { recursive: true });
  const { generateAnimatedDerivatives } = require(path.join(SERVER, "src/lib/animatedMedia"));
  const real = REAL
    ? fs.readdirSync(REAL).filter((f) => /\.gif$/i.test(f) && fs.statSync(path.join(REAL, f)).size > 1024).sort()
    : [];
  if (real.length < N) throw new Error(`REAL_MEDIA_DIR needs >=${N} animated GIFs, found ${real.length}`);
  for (let i = 0; i < N; i++) {
    const src = path.join(FIX, `demo${i}.gif`);
    fs.copyFileSync(path.join(REAL, real[i]), src);
    const m = await generateAnimatedDerivatives(src, "image/gif");
    if (!m.video) throw new Error("fixture " + i + " produced no video");
  }
  fs.copyFileSync(path.join(FIX, "demo0.gif"), path.join(PAID_FIX, "demo0.gif"));
}

// Deliberate teaser shape: media on the first few exercises only, exactly as
// the real product is authored. Later exercises must render fine without it.
function trainingContent() {
  return { weeks: [{ id: "w1", title: "Week 1", days: [{
    id: "d1", title: "Day 1",
    exercises: Array.from({ length: 6 }, (_, i) => ({
      id: "e" + i, name: "Exercise " + (i + 1), sets: "3", reps: "10",
      ...(i < N ? { mediaUrl: `/api/library/media/${FREE_ID}/demo${i}.gif` } : {}),
    })),
  }] }] };
}

const PRODUCTS = [
  { id: FREE_ID, slug: FREE_SLUG, name: "Sulek Strength Size Peak", status: "unlisted",
    freeAccess: true, creator: "Sulek", difficulty: "advanced", durationWeeks: 8,
    overview: "Overview.", trainingContent: trainingContent(), nutritionContent: null,
    bonusNotes: null, priceCents: 4999 },
  { id: PAID_ID, slug: "paid-control", name: "Paid Control", status: "published",
    freeAccess: false, trainingContent: null, priceCents: 4999 },
];

function matches(where, p) {
  if (where.freeAccess !== undefined && p.freeAccess !== where.freeAccess) return false;
  if (where.id !== undefined && p.id !== where.id) return false;
  if (where.OR && !where.OR.some((c) => (c.id && c.id === p.id) || (c.slug && c.slug === p.slug))) return false;
  return true;
}
const prisma = {
  product: { findFirst: async ({ where }) => {
    const hit = PRODUCTS.find((p) => matches(where, p));
    return hit ? { ...hit, faqs: [], resources: [], media: [], taxonomies: [], createdAt: new Date(), imageUrl: null } : null;
  } },
  orderItem: { findFirst: async () => null },
  programProgress: { findUnique: async () => null, upsert: () => ({ catch: () => {} }) },
};

function stub(rel, exports, fromDir) {
  const p = require.resolve(rel, { paths: [fromDir] });
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
const ROUTES_DIR = path.join(SERVER, "src", "routes");
stub("../db", { prisma }, ROUTES_DIR);
stub("../db", { prisma }, path.join(SERVER, "src", "lib"));
stub("../middleware/auth", {
  requireAuth: (rq, rs, next) => (rq.user ? next() : rs.status(401).json({ error: "Not authenticated" })),
}, ROUTES_DIR);
stub("../middleware/rateLimit", { apiLimiter: (_rq, _rs, next) => next() }, ROUTES_DIR);
stub("../lib/adminLog", { logEvent: () => {} }, ROUTES_DIR);

const libraryRouter = require(path.join(ROUTES_DIR, "library.js"));

const results = [];
const check = (n, pass, d) => results.push({ name: n, pass, detail: d });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await ensureFixtures();

  const app = express();
  // NO session middleware at all: every request below is a logged-out visitor.
  app.use("/api/library", libraryRouter);
  app.get("/my-library/:slug", (_rq, rs) => rs.type("html").send(fs.readFileSync(path.join(ROOT, "program.html"))));
  app.use((rq, rs, next) => {
    const local = path.join(ROOT, rq.path);
    if (fs.existsSync(local) && fs.statSync(local).isFile()) return rs.sendFile(local);
    next();
  });
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = server.address().port;

  const b = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });
  // A clean context: no cookies, no storage, nothing carried in.
  const ctx = await b.createBrowserContext();
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  const media = []; p.on("response", (r) => {
    if (/\/api\/library\/media\//.test(r.url())) media.push({ url: r.url(), status: r.status() });
  });
  const navigations = [];
  p.on("framenavigated", (f) => { if (f === p.mainFrame()) navigations.push(f.url()); });

  const cookies = await ctx.cookies();
  check("session is genuinely empty (no cookies)", cookies.length === 0, cookies);

  const target = `http://127.0.0.1:${port}/my-library/${FREE_SLUG}`;
  const resp = await p.goto(target, { waitUntil: "networkidle0" });
  await sleep(1500);

  check("page responds 200 (no server redirect)", resp.status() === 200, resp.status());
  check("browser did NOT redirect away", p.url() === target, { landedOn: p.url(), navigations });
  check("no JS errors", errs.length === 0, errs.slice(0, 3));

  // The locked panel is what a logged-out visitor used to get. Its absence is
  // the actual regression test for the reported symptom.
  const ui = await p.evaluate(() => ({
    locked: !!document.querySelector("#pgLocked") && !document.querySelector("#pgLocked").classList.contains("u-hidden"),
    previewBar: !!document.querySelector(".pg-preview, [data-preview-bar]"),
    title: (document.querySelector(".pg-hero__title, h1") || {}).textContent || "",
    exercises: document.querySelectorAll("[data-demo]").length,
  }));
  check("the LOCKED panel is not shown", ui.locked === false, ui);
  check("no admin preview bar (seen as a customer, not a preview)", ui.previewBar === false, ui);
  check("the handbook rendered its exercises", ui.exercises > 0, ui);

  // Open the Program section and let the demos attach.
  await p.evaluate(() => { const n = document.querySelector('[data-nav-section="program"]'); if (n) n.click(); });
  await sleep(700);
  await p.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
  await sleep(1800);

  const bad = media.filter((m) => m.status >= 400);
  check("every media request for THIS product returned 200",
    media.length > 0 && bad.length === 0, { requests: media.length, failures: bad.slice(0, 3) });

  // The teaser shape is deliberate: only the first few exercises carry media.
  const vids = await p.evaluate(() => document.querySelectorAll("video[data-demo-vid]").length);
  check("demos that exist rendered as <video>", vids > 0, { videos: vids });

  // ---- the fullscreen viewer opens and plays, logged out ----
  await p.evaluate(() => {
    const tile = document.querySelector("[data-demo] video[data-demo-vid]");
    if (tile) tile.parentNode.click();
  });
  await sleep(2500);
  const viewer = await p.evaluate(() => {
    const v = document.querySelector(".pm-video video");
    if (!v) return { open: false };
    const r = v.getBoundingClientRect();
    return { open: true, w: Math.round(r.width), h: Math.round(r.height), readyState: v.readyState };
  });
  check("fullscreen viewer opened", viewer.open === true, viewer);
  check("viewer has a real box", !!viewer.open && viewer.w > 0 && viewer.h > 0, viewer);
  check("viewer video has data (it can play)", (viewer.readyState || 0) >= 2, viewer);

  // ---- negative case: a DIFFERENT paid product, same logged-out session ----
  const paid = await p.evaluate(async (id) => {
    const r = await fetch(`/api/library/media/${id}/demo0.gif`);
    const r2 = await fetch(`/api/library/program/${id}`);
    return { media: r.status, program: r2.status };
  }, PAID_ID);
  check("different paid product MEDIA refused (401)", paid.media === 401, paid);
  check("different paid product PROGRAM refused (401)", paid.program === 401, paid);

  await b.close(); server.close();
  fs.rmSync(PAID_FIX, { recursive: true, force: true });

  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    if (!r.pass) console.log("        got:", JSON.stringify(r.detail));
  }
  // 206 is a success: a <video> range-requests its own file.
  const byStatus = media.reduce((a, m) => ((a[m.status] = (a[m.status] || 0) + 1), a), {});
  console.log(`\n  media requests: ${media.length} — by status ${JSON.stringify(byStatus)} (200/206 both OK)`);
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})();
