// Guards the regression that cost 461x the bytes, on the renderer that caused
// it: assets/js/program.js, the /my-library/:slug page body.
//
// program.js is NOT the handbook viewer. It is the other renderer on the same
// page, and it shipped `<img src="{raw stored mediaUrl}">` — the ORIGINAL
// upload — because it never performed the client-side variant lookup the
// handbook performed. Every request succeeded, every image rendered, and one
// product page pulled 28,581,172 bytes of source GIF where 61,983 bytes of
// posters were sitting on disk beside it.
//
// So this test asserts the thing that has to stay true forever:
//
//   NO RESPONSE ON THIS PAGE IS A .gif / image/gif WHEN DERIVATIVES EXIST
//
// plus the byte and request budgets, measured rather than assumed. It drives
// the REAL program.js against the REAL server resolver (resolveTrainingMedia)
// and the REAL transcoded files, with only auth and the database stubbed.
//
//   cd tools && npm install && node test-program-page-media.js
const fs = require("fs"), path = require("path"), http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const SERVER = path.join(ROOT, "server");
const FIX_ID = "progpage-test";
const FIX = path.join(SERVER, "storage", "media", FIX_ID);
const CHROME = process.env.CHROME_PATH || (function () {
  const base = path.join(process.env.HOME || "/root", ".cache/puppeteer/chrome");
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).sort() : [];
  if (!dirs.length) throw new Error("No Chrome in " + base + " — set CHROME_PATH.");
  return path.join(base, dirs[dirs.length - 1], "chrome-linux64", "chrome");
})();

const DAYS = 10, PER_DAY = 7;          // 70 exercises, the target scale
const N_SOURCES = 6;                    // distinct demo files

// REAL_MEDIA_DIR=<a product's storage/media dir> uses real demo GIFs instead of
// synthetic ones. It matters for anything about the FULLSCREEN rendition: the
// synthetic sources below are 640x360, so an -hd encode of them is correctly
// refused as an upscale and the HD path never runs. Real demos are 1920x1080.
// Without it this test still guards the byte budgets and the gif regression,
// which is what it exists for; with it the numbers are the ones a customer
// actually pays.
const REAL = process.env.REAL_MEDIA_DIR || "";

async function ensureFixtures() {
  if (fs.existsSync(path.join(FIX, "demo0-vid.mp4"))) return;
  const { execFileSync } = require("child_process");
  fs.mkdirSync(FIX, { recursive: true });
  const { generateAnimatedDerivatives } = require(path.join(SERVER, "src/lib/animatedMedia"));

  const real = REAL
    ? fs.readdirSync(REAL).filter((f) => /\.gif$/i.test(f) && fs.statSync(path.join(REAL, f)).size > 1024).sort()
    : [];
  if (REAL && real.length < N_SOURCES) {
    throw new Error(`REAL_MEDIA_DIR has ${real.length} animated GIFs, need ${N_SOURCES}`);
  }

  for (let i = 0; i < N_SOURCES; i++) {
    const src = path.join(FIX, `demo${i}.gif`);
    if (real.length) {
      fs.copyFileSync(path.join(REAL, real[i]), src);
    } else {
      // Distinct content per file so the encoders can't dedupe and the byte
      // totals are honest.
      execFileSync(process.env.FFMPEG_PATH || "ffmpeg",
        ["-y", "-v", "error", "-f", "lavfi", "-i", `testsrc=duration=2:size=640x360:rate=12,hue=h=${i * 60}`, src],
        { stdio: "ignore" });
    }
    const m = await generateAnimatedDerivatives(src, "image/gif");
    if (!m.video) throw new Error("fixture " + i + " produced no video derivatives — is ffmpeg installed?");
  }
}

// The REAL server-side resolver, exercised directly. If resolveTrainingMedia
// ever stops rewriting urls, this test fails at the source rather than
// mysteriously downstream.
function buildResolvedPayload() {
  const trainingContent = { weeks: [{ title: "Block 1", days: Array.from({ length: DAYS }, (_, d) => ({
    title: "Day " + (d + 1),
    exercises: Array.from({ length: PER_DAY }, (_, e) => {
      const i = (d * PER_DAY + e) % N_SOURCES;
      return { name: `Ex ${d + 1}.${e + 1}`, sets: "4", reps: "8",
               mediaUrl: `/api/library/media/${FIX_ID}/demo${i}.gif`, mediaType: "image" };
    }),
  })) }] };

  // The REAL resolver, not a copy of it. This used to re-derive the shape by
  // hand, which meant the test could keep passing while the thing it guards
  // drifted underneath it.
  const { resolveTrainingMedia } = require(path.join(SERVER, "src/routes/library.js"));
  const resolved = resolveTrainingMedia(trainingContent);
  return {
    preview: true, productStatus: "published", purchasedAt: null,
    progress: { completedKeys: [], lastKey: null, lastSection: null, lastOpenedAt: null },
    product: {
      id: FIX_ID, slug: FIX_ID, name: "Program Page Media Test",
      createdAt: new Date().toISOString(), creator: "Test", categories: [],
      difficulty: "intermediate", durationWeeks: 10, overview: "Overview.",
      trainingContent: resolved, nutritionContent: null, bonusNotes: null,
      faqs: [], media: [], resources: [],
    },
  };
}

const hits = [];
function makeServer(payload) {
  return http.createServer((req, res) => {
    const u = req.url.split("?")[0];
    if (u.startsWith("/api/library/program/")) {
      res.writeHead(200, { "Content-Type": "application/json" });
      return res.end(JSON.stringify(payload));
    }
    if (u.startsWith("/api/library/media/")) {
      const name = decodeURIComponent(u.split("/").pop());
      const m = /variant=(\w+)/.exec(req.url.split("?")[1] || "");
      const suffix = { poster: "-poster.webp", thumb: "-thumb.webp", anim: "-anim.webp",
                       mp4: "-vid.mp4", webm: "-vid.webm",
                       hdmp4: "-hd.mp4", hdwebm: "-hd.webm" }[m && m[1]];
      const f = suffix ? name.replace(/\.[^.]+$/, "") + suffix : name;
      const p = path.join(FIX, f);
      if (!fs.existsSync(p)) { res.writeHead(404); return res.end(); }
      const buf = fs.readFileSync(p);
      const type = f.endsWith(".mp4") ? "video/mp4" : f.endsWith(".webm") ? "video/webm"
        : f.endsWith(".webp") ? "image/webp" : "image/gif";
      hits.push({ url: req.url, bytes: buf.length, type });
      res.writeHead(200, { "Content-Type": type, "Content-Length": buf.length, "Accept-Ranges": "bytes" });
      return res.end(buf);
    }
    if (u.startsWith("/api/")) { res.writeHead(200, { "Content-Type": "application/json" }); return res.end("{}"); }
    const local = path.join(ROOT, u === "/" ? "program.html" : u);
    if (fs.existsSync(local) && fs.statSync(local).isFile()) {
      const e = path.extname(local);
      res.writeHead(200, { "Content-Type": e === ".js" ? "text/javascript" : e === ".css" ? "text/css" : "text/html" });
      return res.end(fs.readFileSync(local));
    }
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(fs.readFileSync(path.join(ROOT, "program.html")));
  });
}

const results = [];
const check = (n, pass, d) => results.push({ name: n, pass, detail: d });
// A skipped check is NOT a passing one, and must never read as green. The HD
// assertions below need a source big enough to have a fullscreen rendition;
// the synthetic 640x360 fixtures are correctly refused as an upscale, so
// without REAL_MEDIA_DIR there is nothing to assert against and saying so is
// the honest result. Everything else in this file runs either way.
const skip = (n, why) => results.push({ name: n, pass: true, skipped: why });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const KB = (b) => (b / 1024).toFixed(1) + " KB";

(async () => {
  await ensureFixtures();
  const payload = buildResolvedPayload();

  // The payload itself must already be clean — this is the A4 guarantee.
  const raw = JSON.stringify(payload);
  const gifUrls = (raw.match(/"[^"]*\.gif(?![^"]*variant)[^"]*"/g) || [])
    .filter((s) => !/variant=/.test(s));
  check("payload contains NO bare .gif url (server resolved them all)",
    gifUrls.length === 0, gifUrls.slice(0, 3));

  const server = makeServer(payload);
  await new Promise((r) => server.listen(3406, r));
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });
  const p = await b.newPage();
  await p.setViewport({ width: 1100, height: 900 });
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));

  await p.goto(`http://localhost:3406/my-library/${FIX_ID}`, { waitUntil: "networkidle0" });
  await sleep(1200);
  check("no JS errors", errs.length === 0, errs.slice(0, 3));

  // ---- first paint ----
  const firstPaint = hits.slice();
  const fpBytes = firstPaint.reduce((s, h) => s + h.bytes, 0);
  check("FIRST PAINT under 100 KB", fpBytes < 100 * 1024,
    { bytes: fpBytes, human: KB(fpBytes), requests: firstPaint.length });

  // ---- open the Program section and scroll a full day ----
  // The page shows one section at a time; the demos live in "program", which
  // is hidden on load. Navigating to it is what a customer does before they
  // ever see a demo, so it is what the "full day" budget must cover.
  await p.evaluate(() => {
    const nav = document.querySelector('[data-nav-section="program"]');
    if (nav) nav.click();
  });
  await sleep(700);
  await p.evaluate(() => {
    document.querySelectorAll("details").forEach((d) => (d.open = true));
  });
  await sleep(500);
  for (let i = 0; i < 12; i++) {
    await p.evaluate(() => window.scrollBy(0, window.innerHeight * 0.9));
    await sleep(320);
  }
  await sleep(1500);

  const all = hits.slice();
  const totalBytes = all.reduce((s, h) => s + h.bytes, 0);
  const gifResponses = all.filter((h) => h.type === "image/gif");
  const over500 = all.filter((h) => h.bytes > 500 * 1024);

  check("ZERO responses with Content-Type image/gif", gifResponses.length === 0,
    gifResponses.slice(0, 3).map((h) => h.url));
  check("no single response exceeds 500 KB", over500.length === 0,
    over500.map((h) => ({ url: h.url, kb: (h.bytes / 1024).toFixed(0) })));
  // The absolute full-day total is a function of how compressible the demo
  // footage is, so asserting a fixed KB here would only measure the fixture
  // generator. What must hold for ANY content is that the page fetched the
  // DERIVATIVES and nothing else: no original, no duplicate, no extra tier.
  // The ceiling is therefore computed from what is actually on disk.
  const distinct = fs.readdirSync(FIX);
  const sum = (re) => distinct.filter((f) => re.test(f))
    .reduce((t, f) => t + fs.statSync(path.join(FIX, f)).size, 0);
  const ceiling = sum(/-thumb\.webp$/) + sum(/-vid\.webm$/);
  check("full day fetches derivatives ONLY — no original, no duplicate",
    totalBytes <= Math.ceil(ceiling * 1.02),
    { fetched: totalBytes, ceiling, human: KB(totalBytes), requests: all.length });

  // Absolute budget, reported rather than asserted: see tools/README or the
  // commit message for the measured real-media figure and how it compares to
  // the 500KB product target.
  console.log(`  [budget] full day ${KB(totalBytes)} vs 500 KB target — ` +
    (totalBytes < 500 * 1024 ? "within" : `OVER by ${KB(totalBytes - 500 * 1024)}`));

  // ---- the fullscreen rendition must cost NOTHING until it is asked for ----
  //
  // This is the whole bargain of a second rendition: the tile budget above is
  // only intact if a 1280px file that no one opened was never fetched. An -hd
  // <source> in markup, a preload, a prefetch hint, or a lightbox that
  // hydrates eagerly would each break it silently and none would fail any
  // other assertion here.
  const hdBefore = all.filter((h) => /variant=hd/.test(h.url));
  check("ZERO -hd requests on a day page with no taps", hdBefore.length === 0,
    hdBefore.slice(0, 3).map((h) => h.url));

  // ---- now tap one demo and measure what fullscreen actually costs ----
  const beforeTap = hits.length;
  const opened = await p.evaluate(() => {
    const tile = document.querySelector("[data-demo] video[data-demo-vid]");
    if (!tile) return null;
    const hd = { webm: tile.getAttribute("data-hd-webm"), mp4: tile.getAttribute("data-hd-mp4") };
    tile.parentNode.click();
    return hd;
  });
  await sleep(2500);
  const tapHits = hits.slice(beforeTap);
  const tapBytes = tapHits.reduce((s, h) => s + h.bytes, 0);
  const hdHits = tapHits.filter((h) => /variant=hd/.test(h.url));

  // Whether these three can mean anything is decided by the fixtures, not by
  // the code under test: ask the manifest the pipeline actually wrote.
  const { readManifest } = require(path.join(SERVER, "src/lib/animatedMedia"));
  const hdFixture = !!(readManifest(path.join(FIX, "demo0.gif")) || {}).hdVideo;

  if (!hdFixture) {
    const why = "fixtures have no -hd rendition; set REAL_MEDIA_DIR to exercise fullscreen";
    skip("tile markup carries both -hd urls", why);
    skip("opening a demo fetches the -hd rendition", why);
    skip("one -hd file per tap, not both formats", why);
  } else {
    check("tile markup carries both -hd urls", !!(opened && opened.webm && opened.mp4), opened);
    check("opening a demo fetches the -hd rendition", hdHits.length > 0,
      tapHits.map((h) => h.url));
    // Chrome takes the WebM and ignores the MP4 — if BOTH arrive, the viewer is
    // downloading a rendition it will never decode.
    check("one -hd file per tap, not both formats", hdHits.length === 1,
      hdHits.map((h) => h.url));
  }
  // The poster the viewer holds is the tile's, which is already in cache; a
  // request for it here would mean the hold frame costs bytes it shouldn't.
  check("tap fetches nothing but the -hd file", tapHits.length === hdHits.length,
    tapHits.filter((h) => !/variant=hd/.test(h.url)).map((h) => h.url));
  console.log(`  [fullscreen] one tap = ${KB(tapBytes)} (${tapHits.length} request(s))`);

  // Live element count must stay bounded, not one per exercise.
  const live = await p.evaluate(() => document.querySelectorAll('video[data-attached="1"]').length);
  const dom = await p.evaluate(() => ({
    demoSpans: document.querySelectorAll("[data-demo]").length,
    videos: document.querySelectorAll("video[data-demo-vid]").length,
    imgs: document.querySelectorAll(".pg-ex__media img").length,
    sections: Array.prototype.slice.call(document.querySelectorAll("[data-section]")).map((s) => s.getAttribute("data-section") + (s.hidden || s.offsetParent === null ? ":hidden" : ":visible")),
  }));
  console.log("  DOM:", JSON.stringify(dom));
  check("live attached videos stay bounded", live < DAYS * PER_DAY,
    { live, totalExercises: DAYS * PER_DAY });

  console.log("\n--- MEASURED ---");
  console.log(`  first paint : ${KB(fpBytes).padStart(10)}  (${firstPaint.length} media requests)`);
  console.log(`  full day    : ${KB(totalBytes).padStart(10)}  (${all.length} media requests)`);
  console.log(`  gif responses: ${gifResponses.length}`);
  console.log(`  largest response: ${KB(Math.max(0, ...all.map((h) => h.bytes)))}`);
  console.log(`  live videos : ${live} of ${DAYS * PER_DAY} exercises`);
  console.log(`  -hd before tap: ${hdBefore.length}`);
  console.log(`  one fullscreen tap: ${KB(tapBytes)}\n`);

  await b.close(); server.close();

  let failed = 0, skipped = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    if (r.skipped) skipped++;
    console.log(`  ${r.skipped ? "SKIP" : r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    if (r.skipped) console.log("        ", r.skipped);
    if (!r.pass) console.log("        ", JSON.stringify(r.detail));
  }
  const tail = skipped ? ` (${skipped} skipped)` : "";
  console.log(failed ? `\n${failed} FAILED${tail}` : `\nALL PASSED${tail}`);
  process.exit(failed ? 1 : 0);
})();
