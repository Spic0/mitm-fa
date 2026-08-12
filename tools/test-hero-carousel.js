// Hero carousel regression harness.
//
// The invariant this file exists to hold, and the one the component was
// rebuilt around: AT EVERY FRAME THERE IS A FULLY RENDERED PRODUCT ON SCREEN.
// Never a blank plate, never a missing title or price, never a moment where
// the artwork and the caption belong to different products.
//
// It is measured, not inspected. A sampler runs on every animation frame from
// before the first script executes and records, per card: its slot, its
// computed opacity, the opacity of its <img>, whether that image has actually
// decoded, and the opacity of its caption. From that it derives two numbers
// per frame —
//
//   artwork visibility = max over cards of (card opacity x img opacity), for
//                        cards whose image has decoded
//   caption visibility = max over cards of (card opacity x caption opacity)
//
// — and the test is that neither ever collapses. Both used to. Before the
// rebuild, artwork bottomed out at 0.703 and the caption at 0.088 for ~200ms
// on EVERY transition, which is the "everything disappears for a moment" the
// rebuild was asked to fix. Thresholds below are set well under the values the
// fixed component actually holds (0.974 / 0.918) so this catches a regression
// rather than tracking noise.
//
//   node tools/test-hero-carousel.js [--url http://127.0.0.1:3200/] [--net slow]
//
// Requires the site running on the given URL.
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const URL = arg("--url", "http://127.0.0.1:3200/");
const NET = arg("--net", "fast");

// Thresholds. The measured values on the fixed component are 0.974 / 0.918;
// these sit far enough below to be a real regression signal.
const MIN_ARTWORK = 0.9;
const MIN_CAPTION = 0.7;

const WIDTHS = [320, 375, 390, 430, 1280];

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  const builds = fs.readdirSync(root).sort();
  return path.join(root, builds[builds.length - 1], "chrome-linux64", "chrome");
}

let failures = 0;
function check(ok, label, detail) {
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}${detail ? "  — " + detail : ""}`);
  if (!ok) failures++;
}

// The sampler. Installed with evaluateOnNewDocument so it is running before
// hero-slideshow.js does, which is the only way to see the first transition.
function installSampler() {
  window.__hero = { samples: [], activeLog: [] };
  const t0 = performance.now();
  let lastActive = null;
  function sample() {
    const cards = document.querySelectorAll(".hero-card");
    const row = { t: Math.round(performance.now() - t0), cards: [] };
    cards.forEach((c) => {
      const cs = getComputedStyle(c);
      if (cs.display === "none") return;
      const img = c.querySelector(".pmedia__img");
      const info = c.querySelector(".hero-card__info");
      const cardOp = parseFloat(cs.opacity);
      const imgOp = img ? parseFloat(getComputedStyle(img).opacity) : 0;
      const painted = img ? img.complete && img.naturalWidth > 0 : false;
      const infoOp = info ? parseFloat(getComputedStyle(info).opacity) : 0;
      row.cards.push({
        slot: c.dataset.slot || "",
        id: c.dataset.productId || "",
        cardOp, imgOp, painted, infoOp,
        name: (c.querySelector(".hero-card__name") || {}).textContent || "",
        meta: (c.querySelector(".hero-card__meta") || {}).textContent || "",
        alt: img ? img.alt : "",
        art: cardOp * imgOp * (painted ? 1 : 0),
        cap: cardOp * infoOp,
      });
    });
    window.__hero.samples.push(row);
    // A record of which product was active, in order, so the loop can be
    // checked without depending on timing.
    const act = row.cards.find((c) => c.slot === "is-active");
    if (act && act.id && act.id !== lastActive) {
      lastActive = act.id;
      window.__hero.activeLog.push({ t: row.t, id: act.id, name: act.name.trim() });
    }
    requestAnimationFrame(sample);
  }
  requestAnimationFrame(sample);
}

// Reduces a sample run to the invariants, ignoring the initial-load window in
// which the two flank cards are still filling in behind a solid active card —
// that is correct behaviour, not a hand-off defect, and the active card is at
// full strength throughout it.
//
// The window ends at the first frame where the deck is FULLY POPULATED (the
// script has built the flanks, so 3 cards on a catalog of 3 or more) and every
// one of them has decoded. Testing only "every card has decoded" is not
// enough: the very first samples contain the lone server-rendered card, which
// is painted by definition, so the window would close before the flanks even
// exist and their initial fill-in would be reported as a defect.
function analyse(samples, n) {
  const full = Math.min(3, n);
  let settled = false;
  const out = { minArt: 1, minArtT: 0, minCap: 1, minCapT: 0, unpainted: [], frames: 0, settledAt: 0 };
  for (const s of samples) {
    if (!s.cards.length) continue;
    if (!settled) {
      if (s.cards.length >= full && s.cards.every((c) => c.painted)) {
        settled = true;
        out.settledAt = s.t;
      } else continue;
    }
    out.frames++;
    const art = s.cards.reduce((m, c) => Math.max(m, c.art), 0);
    const cap = s.cards.reduce((m, c) => Math.max(m, c.cap), 0);
    if (art < out.minArt) { out.minArt = art; out.minArtT = s.t; }
    if (cap < out.minCap) { out.minCap = cap; out.minCapT = s.t; }
    // Any card visible enough to be noticed that has no decoded artwork.
    const bad = s.cards.filter((c) => c.cardOp > 0.15 && !c.painted);
    if (bad.length) out.unpainted.push({ t: s.t, slots: bad.map((c) => c.slot) });
  }
  return out;
}

async function swipe(client, from, to, y) {
  await client.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: from, y }] });
  for (let i = 1; i <= 6; i++) {
    await client.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [{ x: from + ((to - from) * i) / 6, y }],
    });
    await new Promise((r) => setTimeout(r, 12));
  }
  await client.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
}

(async () => {
  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    args: [
      "--no-sandbox",
      "--disable-dev-shm-usage",
      // A CDP-synthesized horizontal touch drag on a page that cannot scroll
      // horizontally triggers Chrome's overscroll history navigation, so the
      // swipe-right assertion navigated to about:blank and the test read that
      // as a broken carousel. It is a harness artifact: the gesture fires on
      // horizontal overscroll of the DOCUMENT, which a real reader's swipe
      // inside the 264px stage (63px in from the edge at 390px) does not
      // produce. Switched off so the assertion measures the component.
      "--disable-features=OverscrollHistoryNavigation,TouchpadOverscrollHistoryNavigation",
    ],
  });

  // ---- 1. the hand-off, cold cache, over a full loop ---------------------
  console.log(`\nHAND-OFF (390x844, cold cache, net=${NET})`);
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  await page.setCacheEnabled(false);
  const client = await page.target().createCDPSession();
  await client.send("Network.enable");
  if (NET === "slow") {
    await client.send("Network.emulateNetworkConditions", {
      offline: false, latency: 150,
      downloadThroughput: (10 * 1024 * 1024) / 8,
      uploadThroughput: (2 * 1024 * 1024) / 8,
    });
  }

  const consoleErrors = [];
  page.on("console", (m) => { if (m.type() === "error") consoleErrors.push(m.text()); });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));
  const imageReqs = [];
  page.on("request", (r) => { if (r.resourceType() === "image") imageReqs.push(r.url()); });

  await page.evaluateOnNewDocument(installSampler);
  await page.goto(URL, { waitUntil: "domcontentloaded" });

  // Long enough to cover a full lap plus the wrap back to the first product.
  const n = await page.evaluate(async () => {
    await new Promise((r) => setTimeout(r, 1500));
    return document.querySelectorAll(".hero__progress-seg").length;
  });
  const dwell = await page.evaluate(() => {
    const raw = getComputedStyle(document.querySelector(".hero")).getPropertyValue("--hero-dwell").trim();
    return /ms$/.test(raw) ? parseFloat(raw) : parseFloat(raw) * 1000;
  });
  // n+1 steps guarantees the E -> A wrap is inside the window.
  const runFor = Math.max(6, n + 1) * (dwell + 900);
  console.log(`  ${n} products, dwell ${dwell}ms — watching ${Math.round(runFor / 1000)}s (${n + 1} transitions incl. the wrap)`);
  await new Promise((r) => setTimeout(r, runFor));

  const { samples, activeLog } = await page.evaluate(() => window.__hero);
  const a = analyse(samples, n);
  console.log(`  deck fully populated and decoded at ${a.settledAt}ms; ${a.frames} frames measured after that`);

  check(a.minArt >= MIN_ARTWORK, "artwork never collapses",
    `min ${a.minArt.toFixed(3)} @ ${a.minArtT}ms (floor ${MIN_ARTWORK})`);
  check(a.minCap >= MIN_CAPTION, "title/creator/price never collapse",
    `min ${a.minCap.toFixed(3)} @ ${a.minCapT}ms (floor ${MIN_CAPTION})`);
  check(a.unpainted.length === 0, "no card enters the stage without its artwork",
    a.unpainted.length ? `${a.unpainted.length} frames, first @ ${a.unpainted[0].t}ms (${a.unpainted[0].slots})` : "0 frames");

  // ---- 2. every card is internally consistent ----------------------------
  // The caption lives inside the card, so a mismatch would be structural — but
  // that is exactly the guarantee worth pinning, since the brief calls out
  // "Sam Sulek image + Bradley Martyn title" as the forbidden state.
  let mismatches = 0;
  for (const s of samples) {
    for (const c of s.cards) {
      if (!c.alt || !c.name) continue;
      if (c.alt.trim() !== c.name.trim()) mismatches++;
    }
  }
  check(mismatches === 0, "image alt and title always name the same product",
    mismatches ? `${mismatches} mismatched frames` : "0 mismatched frames");

  // ---- 3. infinite loop --------------------------------------------------
  const order = activeLog.map((x) => x.id);
  const uniqueFirstLap = new Set(order.slice(0, n));
  check(uniqueFirstLap.size === n, "one lap visits every product exactly once",
    `${uniqueFirstLap.size}/${n} distinct in the first ${n} steps`);
  check(order.length > n && order[n] === order[0], "wraps from the last product back to the first",
    order.length > n ? `step ${n} returned to ${order[0].slice(0, 8)}` : "loop did not complete");

  // The wrap must be an ordinary transition, not a special case. Compare the
  // worst frame inside the wrap window against the worst frame overall.
  if (activeLog.length > n) {
    const wrapT = activeLog[n].t;
    const win = samples.filter((s) => s.t >= wrapT - 900 && s.t <= wrapT + 900 && s.cards.length);
    const wrapMin = win.reduce((m, s) => Math.min(m, s.cards.reduce((x, c) => Math.max(x, c.art), 0)), 1);
    check(wrapMin >= MIN_ARTWORK, "the E -> A wrap is no different from any other transition",
      `min artwork ${wrapMin.toFixed(3)} across the wrap`);
  }

  // ---- 4. image budget ---------------------------------------------------
  const originals = imageReqs.filter((u) => /\/uploads\//.test(u) && !/-\d{3,4}\.(avif|webp)$/.test(u) && !/^data:/.test(u));
  check(originals.length === 0, "no full-resolution original is ever fetched",
    originals.length ? originals[0] : "0 originals");
  const real = imageReqs.filter((u) => !u.startsWith("data:"));
  check(real.length <= n * 3 + 12, "image requests stay bounded over a full lap",
    `${real.length} requests for ${n} products`);

  check(consoleErrors.length === 0, "no console errors",
    consoleErrors.length ? consoleErrors[0] : "clean");

  // ---- 5. swipe ----------------------------------------------------------
  console.log("\nSWIPE (390x844)");
  const before = await page.evaluate(() => document.querySelector(".hero-card.is-active").dataset.productId);
  const box = await page.evaluate(() => {
    const r = document.querySelector(".hero__stage").getBoundingClientRect();
    return { x: r.x, y: r.y, w: r.width, h: r.height };
  });
  const midY = Math.round(box.y + box.h / 2);

  await swipe(client, Math.round(box.x + box.w * 0.8), Math.round(box.x + box.w * 0.1), midY);
  await new Promise((r) => setTimeout(r, 1200));
  const afterLeft = await page.evaluate(() => document.querySelector(".hero-card.is-active").dataset.productId);
  check(afterLeft !== before, "swipe left advances to the next product",
    `${before.slice(0, 8)} -> ${afterLeft.slice(0, 8)}`);

  await swipe(client, Math.round(box.x + box.w * 0.1), Math.round(box.x + box.w * 0.8), midY);
  await new Promise((r) => setTimeout(r, 1200));
  const afterRight = await page.evaluate(() => document.querySelector(".hero-card.is-active").dataset.productId);
  check(afterRight === before, "swipe right returns to the previous product",
    `${afterLeft.slice(0, 8)} -> ${afterRight.slice(0, 8)}`);

  // A short, mostly-vertical drag is a scroll, not a swipe.
  const settled = await page.evaluate(() => document.querySelector(".hero-card.is-active").dataset.productId);
  await page.evaluate(() => {
    // freeze autoplay so the assertion measures the gesture, not the timer
    document.dispatchEvent(new Event("visibilitychange"));
    Object.defineProperty(document, "hidden", { value: true, configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
  });
  await swipe(client, Math.round(box.x + box.w * 0.5), Math.round(box.x + box.w * 0.5 + 18), midY);
  await new Promise((r) => setTimeout(r, 400));
  const afterTap = await page.evaluate(() => document.querySelector(".hero-card.is-active").dataset.productId);
  check(afterTap === settled, "an 18px drag is below the swipe threshold and changes nothing");

  await page.close();

  // ---- 6. geometry -------------------------------------------------------
  console.log("\nGEOMETRY");
  for (const width of WIDTHS) {
    const p = await browser.newPage();
    await p.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
    await p.setViewport({ width, height: width >= 1024 ? 900 : 844, deviceScaleFactor: 1 });
    await p.goto(URL, { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 900));

    const g = await p.evaluate(() => {
      const deck = document.querySelector(".hero__deck");
      const plate = document.querySelector(".hero-card.is-active .hero-card__media");
      const dr = deck.getBoundingClientRect();
      const pr = plate.getBoundingClientRect();
      return {
        deckH: dr.height,
        plateW: pr.width, plateH: pr.height,
        ratio: pr.height / pr.width,
        docW: document.documentElement.scrollWidth,
        viewW: document.documentElement.clientWidth,
        // widest rendered box anywhere, to catch a flank card overhanging
        maxRight: Math.max(...[...document.querySelectorAll(".hero *")].map((e) => e.getBoundingClientRect().right)),
      };
    });

    // Sample the deck height across a transition — it must not move at all.
    const heights = await p.evaluate(() => new Promise((res) => {
      const deck = document.querySelector(".hero__deck");
      const seen = [];
      const t = setInterval(() => seen.push(Math.round(deck.getBoundingClientRect().height * 100) / 100), 50);
      setTimeout(() => { clearInterval(t); res([...new Set(seen)]); }, 4600);
    }));

    const ratioOk = Math.abs(g.ratio - 4 / 3) < 0.02;
    console.log(`  ${width}px:`);
    check(ratioOk, `    plate holds a 3:4 cover`, `${g.plateW.toFixed(1)}x${g.plateH.toFixed(1)} = 1:${g.ratio.toFixed(3)}`);
    check(g.docW <= g.viewW, `    no horizontal page overflow`, `doc ${g.docW} vs view ${g.viewW}`);
    check(g.maxRight <= g.viewW + 1, `    no hero element clipped past the viewport`, `max right edge ${g.maxRight.toFixed(1)}`);
    check(heights.length === 1, `    deck height is constant through a transition`, `${heights.length} distinct: ${heights.join(", ")}`);
    await p.close();
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILED` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})();
