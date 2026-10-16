// End-to-end test for the handbook's VIDEO demo architecture, in a real
// browser, against real transcoded files.
//
// The handbook renders exercise demos as <video> (MP4+WebM) rather than an
// animated <img>, for one reason above all: a video can be turned off. The
// tests below are therefore mostly about NOT loading and about RELEASING,
// because those are the properties an <img> could never have and the ones that
// decide whether a 70-demo handbook survives on a mid-range phone.
//
//   1. a demo with both renditions renders <video>, never <img>
//   2. nothing is fetched for a demo that is merely BUILT — pages are
//      pre-built one either side, so "built" must not mean "downloaded"
//   3. sources attach when the tile nears the viewport, WebM ahead of MP4
//   4. leaving the viewport pauses AND strips the sources — the release is
//      what frees the decoder; pausing alone does not
//   5. pages far from the current one are torn down entirely (virtualization)
//   6. a demo WITHOUT renditions still renders the old poster/anim <img>, so
//      programs uploaded before the pipeline keep working
//
//   cd tools && npm install && node test-handbook-video.js
const fs = require("fs"), path = require("path"), http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const FIX = path.join(ROOT, "server/storage/media/pipeline-test");
const CHROME = process.env.CHROME_PATH || (function () {
  const base = path.join(process.env.HOME || "/root", ".cache/puppeteer/chrome");
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).sort() : [];
  if (!dirs.length) throw new Error("No Chrome in " + base + " — set CHROME_PATH.");
  return path.join(base, dirs[dirs.length - 1], "chrome-linux64", "chrome");
})();

// Fixtures are built here rather than committed: server/storage/ is gitignored
// and per-checkout, so anything committed would be absent on a fresh clone.
// Building them also means this test exercises the REAL derivative pipeline —
// if generateAnimatedDerivatives stops producing a playable MP4/WebM, this
// fails at setup instead of quietly testing stale files.
async function ensureFixtures() {
  if (fs.existsSync(path.join(FIX, "demo-vid.mp4"))) return;
  const { execFileSync } = require("child_process");
  fs.mkdirSync(FIX, { recursive: true });
  const src = path.join(FIX, "demo.gif");
  // A synthetic moving source: no binary asset in the repo, and every frame
  // differs so the encoders have real work to do.
  execFileSync(process.env.FFMPEG_PATH || "ffmpeg",
    ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=480x270:rate=12", src],
    { stdio: "ignore" });
  const { generateAnimatedDerivatives } =
    require(path.join(ROOT, "server/src/lib/animatedMedia"));
  const m = await generateAnimatedDerivatives(src, "image/gif");
  if (!m.video) {
    console.error("fixture generation produced no video derivatives:", JSON.stringify(m));
    console.error("is ffmpeg installed? (ffmpeg -version)");
    process.exit(1);
  }
}

// Day 1 has transcoded demos; day 5 deliberately has one that was never
// transcoded, to prove the fallback path is still alive.
const VID = "/api/library/media/pipeline-test/demo.gif";
const OLD = "/api/library/media/pipeline-test/legacy.gif";
const DAYS = 6, PER_DAY = 3;
// Shaped exactly as resolveTrainingMedia() in server/src/routes/library.js
// emits it: mediaUrl is already the POSTER, and `media` carries finished urls.
// Nothing here is a raw .gif — that is the contract being tested.
const v = (u) => u + "?variant=";
const videoMedia = {
  kind: "video", src: v(VID) + "poster", poster: v(VID) + "poster",
  thumb: v(VID) + "thumb", mp4: v(VID) + "mp4", webm: v(VID) + "webm",
  animated: true, aspectRatio: 1.778,
};
const legacyMedia = {
  kind: "animated-image", src: v(OLD) + "poster", poster: v(OLD) + "poster",
  anim: v(OLD) + "anim", animated: true, aspectRatio: 1.778,
};
const product = {
  name: "Video Handbook",
  trainingContent: { weeks: [{ title: "Block 1", days: Array.from({ length: DAYS }, (_, d) => ({
    title: "Day " + (d + 1),
    exercises: Array.from({ length: PER_DAY }, (_, e) => {
      const m = d === 4 ? legacyMedia : videoMedia;
      return { name: `Ex ${d + 1}.${e + 1}`, sets: "4", reps: "8",
               mediaUrl: m.src, mediaType: "image", media: m };
    }),
  })) }] },
};

const hits = [];
const server = http.createServer((req, res) => {
  const u = req.url.split("?")[0];
  if (u.startsWith("/api/library/media/")) {
    hits.push(req.url);
    const q = req.url.split("?")[1] || "";
    const v = /variant=(\w+)/.exec(q);
    const variant = v ? v[1] : null;
    // Mirrors routes/library.js: video variants 404 rather than falling back,
    // still variants fall back to the original.
    const map = { poster: "demo-poster.webp", thumb: "demo-thumb.webp", anim: "demo-anim.webp", mp4: "demo-vid.mp4", webm: "demo-vid.webm" };
    const isLegacy = u.includes("legacy.gif");
    if (isLegacy && (variant === "mp4" || variant === "webm")) { res.writeHead(404); return res.end(); }
    const f = path.join(FIX, map[variant] || "demo.gif");
    if (!fs.existsSync(f)) { res.writeHead(404); return res.end(); }
    const buf = fs.readFileSync(f);
    const type = f.endsWith(".mp4") ? "video/mp4" : f.endsWith(".webm") ? "video/webm" : f.endsWith(".webp") ? "image/webp" : "image/gif";
    res.writeHead(200, { "Content-Type": type, "Content-Length": buf.length, "Accept-Ranges": "bytes" });
    return res.end(buf);
  }
  const l = path.join(ROOT, u);
  if (u !== "/" && fs.existsSync(l) && fs.statSync(l).isFile()) {
    const e = path.extname(l);
    res.writeHead(200, { "Content-Type": e === ".js" ? "text/javascript" : "text/css" });
    return res.end(fs.readFileSync(l));
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(`<!doctype html><html><head>
<link rel="stylesheet" href="/assets/css/program-viewer.css">
<link rel="stylesheet" href="/assets/css/program-media.css"></head><body>
<script src="/assets/js/program-media.js"></script>
<script src="/assets/js/program-viewer.js"></script>
<script>window.__P=${JSON.stringify(product)};window.ProgramViewer.open(window.__P,{});</script></body></html>`);
});

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await ensureFixtures();
  await new Promise((r) => server.listen(3405, r));
  const b = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-dev-shm-usage", "--autoplay-policy=no-user-gesture-required"] });
  const p = await b.newPage();
  await p.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "no-preference" }]);
  await p.setViewport({ width: 900, height: 800 });
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto("http://localhost:3405/", { waitUntil: "networkidle0" });
  await sleep(900);

  check("no JS errors", errs.length === 0, errs);

  // The handbook opens on its cover, not on a training day (cover -> overview
  // -> days...). Advance to the first page that actually carries demos.
  let dayIndex = -1;
  for (let i = 0; i < 8; i++) {
    dayIndex = await p.evaluate(() => {
      const pages = Array.prototype.slice.call(document.querySelectorAll(".pv-page"));
      return pages.findIndex((el) => el.querySelector("video[data-pv-vid]"));
    });
    const onScreen = await p.evaluate((di) => {
      const el = document.querySelectorAll(".pv-page")[di];
      if (!el) return false;
      const r = el.getBoundingClientRect();
      return r.left >= -5 && r.right <= window.innerWidth + 5;
    }, dayIndex);
    if (dayIndex >= 0 && onScreen) break;
    const n = await p.$("[data-pv-next]"); if (!n) break;
    await n.click(); await sleep(420);
  }
  await sleep(700);

  const shape = await p.evaluate((di) => {
    const first = document.querySelectorAll(".pv-page")[di];
    return {
      videos: first.querySelectorAll("video[data-pv-vid]").length,
      imgs: first.querySelectorAll("img[data-anim]").length,
      preload: (first.querySelector("video[data-pv-vid]") || {}).getAttribute ? first.querySelector("video[data-pv-vid]").getAttribute("preload") : null,
      muted: first.querySelector("video[data-pv-vid]") ? first.querySelector("video[data-pv-vid]").muted : null,
      loop: first.querySelector("video[data-pv-vid]") ? first.querySelector("video[data-pv-vid]").loop : null,
      playsinline: first.querySelector("video[data-pv-vid]") ? first.querySelector("video[data-pv-vid]").hasAttribute("playsinline") : null,
      poster: first.querySelector("video[data-pv-vid]") ? first.querySelector("video[data-pv-vid]").getAttribute("poster") : null,
    };
  }, dayIndex);
  check("transcoded demos render <video>, not <img>", shape.videos === PER_DAY && shape.imgs === 0, shape);
  check('preload="metadata", never auto', shape.preload === "metadata", shape.preload);
  check("muted + loop + playsinline (GIF-like behaviour)", shape.muted && shape.loop && shape.playsinline === true, shape);
  // The poster attribute is the 320px THUMB — a <video> poster is not lazy, so
  // it is the cheapest tier that still fills the tile.
  check("poster set so the tile is never blank",
    /variant=(thumb|poster)/.test(shape.poster || ""), shape.poster);

  // The original GIF is the thing this whole architecture exists to avoid.
  check("original GIF never requested", !hits.some((h) => !/variant=/.test(h)), hits.filter((h) => !/variant=/.test(h)));

  // Pages 2+ are BUILT (hydrate radius) but off-screen: they must not fetch.
  const built = await p.evaluate(() => document.querySelectorAll(".pv-page video[data-pv-vid]").length);
  const attachedNow = await p.evaluate(() => document.querySelectorAll('video[data-attached="1"]').length);
  check("off-screen built pages fetch nothing", built > shape.videos && attachedNow === shape.videos, { built, attachedNow });

  const order = hits.filter((h) => /variant=(mp4|webm)/.test(h));
  check("WebM preferred over MP4 where supported", !order.length || /variant=webm/.test(order[0]), order.slice(0, 3));

  const playing = await p.evaluate(() => {
    const v = document.querySelector('video[data-attached="1"]');
    return v ? { sources: v.querySelectorAll("source").length, paused: v.paused } : null;
  });
  check("visible demo attaches sources and plays", playing && playing.sources === 2 && playing.paused === false, playing);

  // ---- release on leaving the viewport ----
  await p.evaluate((di) => { window.__dayIndex = di; }, dayIndex);
  for (let i = 0; i < 3; i++) { const n = await p.$("[data-pv-next]"); if (n) await n.click(); await sleep(420); }
  await sleep(700);

  const released = await p.evaluate(() => {
    const all = Array.prototype.slice.call(document.querySelectorAll("video[data-pv-vid]"));
    const first = document.querySelectorAll(".pv-page")[window.__dayIndex].querySelectorAll("video[data-pv-vid]");
    return {
      page1Attached: Array.prototype.slice.call(first).filter((v) => v.getAttribute("data-attached") === "1").length,
      page1Sources: Array.prototype.slice.call(first).reduce((s, v) => s + v.querySelectorAll("source").length, 0),
      page1Paused: Array.prototype.slice.call(first).every((v) => v.paused),
      totalAttached: all.filter((v) => v.getAttribute("data-attached") === "1").length,
    };
  });
  check("left-behind demos are paused", released.page1Paused !== false, released);
  check("left-behind demos have sources STRIPPED (memory freed)",
    released.page1Attached === 0 && released.page1Sources === 0, released);

  // ---- virtualization ----
  const virt = await p.evaluate(() => {
    const pages = Array.prototype.slice.call(document.querySelectorAll(".pv-page"));
    return {
      total: pages.length,
      nonEmpty: pages.filter((el) => el.firstChild && el.firstChild.innerHTML.length > 0).length,
      liveVideos: document.querySelectorAll("video[data-pv-vid]").length,
    };
  });
  check("distant pages torn down (virtualized)", virt.nonEmpty < virt.total && virt.nonEmpty <= 5, virt);
  check("live <video> count stays bounded, not one per exercise",
    virt.liveVideos < DAYS * PER_DAY, { liveVideos: virt.liveVideos, totalExercises: DAYS * PER_DAY });

  // ---- legacy fallback: day 5 has no renditions ----
  for (let i = 0; i < 6; i++) {
    const cur = await p.evaluate(() => document.querySelector("[data-pv-count]").textContent);
    if (/^5 /.test(cur) || /^6 /.test(cur)) break;
    const n = await p.$("[data-pv-next]"); if (!n) break; await n.click(); await sleep(400);
  }
  await sleep(800);
  const legacy = await p.evaluate(() => {
    const pages = Array.prototype.slice.call(document.querySelectorAll(".pv-page"));
    const withLegacy = pages.filter((el) => el.innerHTML.indexOf("legacy.gif") !== -1)[0];
    if (!withLegacy) return null;
    return { imgs: withLegacy.querySelectorAll("img[data-anim]").length, videos: withLegacy.querySelectorAll("video[data-pv-vid]").length };
  });
  check("un-transcoded demo falls back to the <img> poster/anim path",
    legacy && legacy.imgs > 0 && legacy.videos === 0, legacy);
  check("no mp4/webm ever requested for the un-transcoded demo",
    !hits.some((h) => h.includes("legacy.gif") && /variant=(mp4|webm)/.test(h)),
    hits.filter((h) => h.includes("legacy.gif")));

  await b.close(); server.close();

  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    if (!r.pass) console.log("        ", JSON.stringify(r.detail));
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})();
