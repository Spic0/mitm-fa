// Network + loading measurement harness.
//
// Answers the questions a performance brief actually asks — how many bytes,
// how many image requests, which URLs, how long until the hero is usable —
// against a REAL rendered page under REAL throttling, rather than by reading
// code and estimating.
//
//   node tools/measure-page-network.js --url https://fitness.agency/program/foo \
//        [--net slow|medium|fast] [--view mobile|desktop] [--warm] [--json out.json]
//
// --net slow is the brief's target customer: ~10/2 Mbps, 60ms RTT. Throttling
// is applied through CDP Network.emulateNetworkConditions, which shapes the
// actual transfer, so Content Download timings are real and not simulated.
//
// --warm loads the page twice in the same browser context and reports the
// SECOND load, which is what a returning customer experiences. Without it the
// cache is cleared first, so the numbers are a true cold first visit.
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};

const URL = arg("--url", "https://fitness.agency/");
const NET = arg("--net", "fast");
const VIEW = arg("--view", "desktop");
const WARM = process.argv.includes("--warm");
const JSON_OUT = arg("--json", null);

// Downlink/uplink are bytes/sec, which is what CDP wants — not bits.
const PROFILES = {
  fast: { offline: false, latency: 5, downloadThroughput: (200 * 1e6) / 8, uploadThroughput: (100 * 1e6) / 8 },
  medium: { offline: false, latency: 40, downloadThroughput: (30 * 1e6) / 8, uploadThroughput: (5 * 1e6) / 8 },
  // The brief's stated target connection.
  slow: { offline: false, latency: 60, downloadThroughput: (10 * 1e6) / 8, uploadThroughput: (2 * 1e6) / 8 },
};

const VIEWPORTS = {
  desktop: { width: 1440, height: 900, deviceScaleFactor: 1, isMobile: false },
  mobile: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true },
};

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  const builds = fs.readdirSync(root).sort();
  return path.join(root, builds[builds.length - 1], "chrome-linux64", "chrome");
}

const kb = (n) => `${(n / 1024).toFixed(1)}KB`;
const mb = (n) => `${(n / 1048576).toFixed(2)}MB`;

(async () => {
  const profile = PROFILES[NET];
  if (!profile) throw new Error(`unknown --net ${NET} (fast|medium|slow)`);

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  const page = await browser.newPage();
  await page.setViewport(VIEWPORTS[VIEW] || VIEWPORTS.desktop);
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });

  const client = await page.createCDPSession();
  await client.send("Network.enable");

  async function run(record) {
    const reqs = new Map();
    const done = [];

    if (!record) {
      // Cold pass: nothing may survive from a previous run.
      await client.send("Network.clearBrowserCache");
    }
    await client.send("Network.emulateNetworkConditions", profile);

    const onReq = (e) => reqs.set(e.requestId, { url: e.request.url, type: e.type, start: e.timestamp });
    const onResp = (e) => {
      const r = reqs.get(e.requestId);
      if (!r) return;
      r.status = e.response.status;
      r.mime = e.response.mimeType;
      r.fromCache = e.response.fromDiskCache || e.response.fromPrefetchCache || false;
      r.headers = e.response.headers || {};
      const t = e.response.timing;
      // Chrome reports these relative to requestTime, in seconds.
      if (t) r.ttfb = Math.max(0, t.receiveHeadersEnd);
      r.respAt = e.timestamp;
    };
    const onFin = (e) => {
      const r = reqs.get(e.requestId);
      if (!r) return;
      r.bytes = e.encodedDataLength;
      r.end = e.timestamp;
      r.download = r.respAt ? Math.max(0, (e.timestamp - r.respAt) * 1000) : null;
      done.push(r);
    };
    const onServed = (e) => {
      // Served straight from the HTTP cache — no network request is emitted,
      // so a warm run would otherwise under-count what the page needs.
      //
      // This event carries only a requestId, NOT a request object, so the URL
      // has to be recovered from the requestWillBeSent we already recorded.
      // Reading `e.request.url` yields "" for every entry, which then collapses
      // into a single bogus "3x duplicate" line — a measurement artifact that
      // looks exactly like the real defect this harness exists to detect.
      const prior = reqs.get(e.requestId);
      done.push({ url: prior ? prior.url : "(unknown)", type: prior ? prior.type : "Other", fromCache: true, bytes: 0, status: 200 });
    };

    client.on("Network.requestWillBeSent", onReq);
    client.on("Network.responseReceived", onResp);
    client.on("Network.loadingFinished", onFin);
    client.on("Network.requestServedFromCache", onServed);

    const t0 = Date.now();
    await page.goto(URL, { waitUntil: "load", timeout: 120000 });
    const loadMs = Date.now() - t0;

    // Let lazy/deferred work settle, then measure paint metrics from the page.
    await new Promise((r) => setTimeout(r, 3000));

    const vitals = await page.evaluate(async () => {
      const out = {};
      // LCP is NOT retrievable via getEntriesByType — the buffered entries are
      // only delivered to a PerformanceObserver. Reading it the other way
      // silently yields undefined, which reads as "no LCP" rather than as a
      // broken measurement.
      out.lcp = null;
      out.lcpUrl = null;
      await new Promise((resolve) => {
        try {
          const po = new PerformanceObserver((list) => {
            const es = list.getEntries();
            const last = es[es.length - 1];
            if (last) {
              out.lcp = Math.round(last.startTime);
              out.lcpUrl = last.url || "(text)";
            }
          });
          po.observe({ type: "largest-contentful-paint", buffered: true });
          setTimeout(() => { po.disconnect(); resolve(); }, 250);
        } catch (e) { resolve(); }
      });
      const nav = performance.getEntriesByType("navigation")[0];
      if (nav) {
        out.ttfb = Math.round(nav.responseStart);
        out.domContentLoaded = Math.round(nav.domContentLoadedEventEnd);
        out.load = Math.round(nav.loadEventEnd);
      }
      for (const p of performance.getEntriesByType("paint")) {
        if (p.name === "first-contentful-paint") out.fcp = Math.round(p.startTime);
      }
      // What the hero actually is right now, for the "hero usable" question.
      const hero = document.querySelector(".hero-slider, .swiper, #productGallery");
      out.heroVisible = !!(hero && hero.getBoundingClientRect().height > 0);
      return out;
    });

    client.off("Network.requestWillBeSent", onReq);
    client.off("Network.responseReceived", onResp);
    client.off("Network.loadingFinished", onFin);
    client.off("Network.requestServedFromCache", onServed);

    return { done, loadMs, vitals };
  }

  if (WARM) await run(false); // prime the cache, discard
  const { done, loadMs, vitals } = await run(WARM);

  const images = done.filter((r) => r.type === "Image" || /^image\//.test(r.mime || ""));
  const total = done.reduce((a, r) => a + (r.bytes || 0), 0);
  const imgBytes = images.reduce((a, r) => a + (r.bytes || 0), 0);

  // Duplicates are a real defect class here — the same cover fetched twice.
  const seen = new Map();
  for (const r of done) seen.set(r.url, (seen.get(r.url) || 0) + 1);
  const dupes = [...seen.entries()].filter(([, n]) => n > 1);

  console.log(`\n${"=".repeat(74)}`);
  console.log(`${URL}`);
  console.log(`net=${NET}  view=${VIEW}  cache=${WARM ? "warm" : "cold"}`);
  console.log("=".repeat(74));
  console.log(`TTFB              ${vitals.ttfb}ms`);
  console.log(`FCP               ${vitals.fcp}ms`);
  console.log(`LCP               ${vitals.lcp}ms   <- ${vitals.lcpUrl}`);
  console.log(`DOMContentLoaded  ${vitals.domContentLoaded}ms`);
  console.log(`load event        ${vitals.load}ms  (wall ${loadMs}ms)`);
  console.log(`\nrequests ${done.length}   total ${mb(total)}`);
  console.log(`images   ${images.length}   image bytes ${mb(imgBytes)}`);
  if (dupes.length) {
    console.log(`\nDUPLICATE REQUESTS (${dupes.length}):`);
    for (const [u, n] of dupes) console.log(`  ${n}x  ${u}`);
  } else {
    console.log(`\nno duplicate requests`);
  }

  const heavy = images.filter((r) => (r.bytes || 0) > 0).sort((a, b) => b.bytes - a.bytes).slice(0, 15);
  if (heavy.length) {
    console.log(`\nHEAVIEST IMAGES`);
    for (const r of heavy) {
      const cc = (r.headers && (r.headers["cache-control"] || r.headers["Cache-Control"])) || "-";
      console.log(
        `  ${kb(r.bytes).padStart(10)}  dl=${r.download != null ? Math.round(r.download) + "ms" : "-"}`.padEnd(34) +
          `${(r.mime || "").padEnd(11)} ${r.url.replace(/^https?:\/\/[^/]+/, "")}`
      );
      console.log(`${" ".repeat(14)}cache-control: ${cc}`);
    }
  }

  const cached = done.filter((r) => r.fromCache).length;
  console.log(`\nserved from cache: ${cached}/${done.length}`);

  if (JSON_OUT) {
    fs.writeFileSync(JSON_OUT, JSON.stringify({ url: URL, net: NET, view: VIEW, warm: WARM, vitals, total, imgBytes, requests: done.length, images: images.length, dupes, files: done.map((r) => ({ url: r.url, bytes: r.bytes, mime: r.mime, cc: r.headers && r.headers["cache-control"] })) }, null, 2));
    console.log(`\njson -> ${JSON_OUT}`);
  }

  await browser.close();
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
