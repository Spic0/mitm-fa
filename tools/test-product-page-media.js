// Regression guard for the PRODUCT DETAIL page's media.
//
// This exists because the same defect has now happened twice, in two different
// renderers, for the same reason: a surface builds its own <img> and ships the
// stored original because nobody remembered it was a second consumer of the
// media payload.
//
//   1. assets/js/program.js  — shipped a 12.9MB original into the handbook
//      (see tools/test-program-page-media.js, which guards that one).
//   2. assets/js/shop-single.js — shipped a 2.0MB cover as the product page's
//      LCP element, eagerly, while 320/640/960 AVIF+WebP derivatives sat on
//      disk beside it. Guarded here.
//
// The load-bearing assertion is THE ORIGINAL IS NEVER FETCHED. Everything else
// (formats offered, eager/lazy split, geometry) is secondary: a page can have a
// perfectly-formed <picture> and still lose if the browser resolves it to the
// original, and every request in both incidents succeeded, so nothing but a
// byte-level check catches it.
//
//   node tools/test-product-page-media.js [--url http://127.0.0.1:3200] [--slug <slug>]
//
// With no --slug it tests every published product that HAS derivatives, which
// is what makes it useful after an upload: run it and it covers the new file.
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg("--url", "http://127.0.0.1:3200").replace(/\/$/, "");
const ONLY = arg("--slug", null);

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  const builds = fs.readdirSync(root).sort();
  return path.join(root, builds[builds.length - 1], "chrome-linux64", "chrome");
}

const VIEWS = [
  { name: "desktop", vp: { width: 1440, height: 900, deviceScaleFactor: 1 } },
  { name: "mobile", vp: { width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
];

let failures = 0;
const ok = (m) => console.log(`  ok    ${m}`);
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };

(async () => {
  const res = await fetch(`${BASE}/api/products`, { headers: { "x-forwarded-proto": "https" } });
  const all = (await res.json()).products || [];

  // Only products whose cover actually has derivatives can be asserted on —
  // an SVG or a pre-pipeline upload legitimately renders as a bare <img>.
  let targets = all.filter((p) => p.cover && p.cover.sources && p.cover.sources.length);
  if (ONLY) targets = all.filter((p) => p.slug === ONLY);
  if (!targets.length) {
    console.log("no products with derivatives to test — nothing to assert");
    process.exit(0);
  }
  console.log(`testing ${targets.length} product page(s) against ${BASE}\n`);

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });

  for (const product of targets) {
    // WHICH image the page actually renders first is not always the cover:
    // shop-single.js prefers the gallery when the product has one, and only
    // falls back to the cover. Asserting against product.cover when a gallery
    // item is on screen tests an image that is not there — it reported Sulek
    // as broken because its 250x250 gallery still legitimately has no
    // derivatives (nothing smaller than the 320w tier is worth cutting).
    const detail = await (await fetch(`${BASE}/api/products/${encodeURIComponent(product.slug)}`, {
      headers: { "x-forwarded-proto": "https" },
    })).json();
    const d = detail.product || {};
    const primary = (Array.isArray(d.media) && d.media.length)
      ? d.media[0]
      : { url: d.imageUrl, cover: d.cover, type: "image" };
    const primaryCover = primary.cover || null;
    const expectDerivatives = !!(primaryCover && primaryCover.sources && primaryCover.sources.length);

    // The filename of the original upload, which is what must never be fetched.
    const originalFile = (product.cover.src || product.imageUrl || "").split("/").pop();
    const originalBytes = (() => {
      const rel = (product.cover.src || product.imageUrl || "").replace(/^\/+/, "");
      try { return fs.statSync(path.join(__dirname, "..", rel)).size; } catch { return null; }
    })();

    for (const { name, vp } of VIEWS) {
      console.log(`${product.slug}  [${name}]`);
      const page = await browser.newPage();
      await page.setViewport(vp);
      await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });

      const errors = [];
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));

      const imageRequests = [];
      page.on("response", (r) => {
        const ct = r.headers()["content-type"] || "";
        if (/^image\//.test(ct)) imageRequests.push({ url: r.url(), ct, cc: r.headers()["cache-control"] || "" });
      });

      await page.goto(`${BASE}/program/${encodeURIComponent(product.slug)}`, { waitUntil: "networkidle0", timeout: 60000 });
      await new Promise((r) => setTimeout(r, 900));

      // --- the assertion that actually matters -------------------------------
      const fetchedOriginal = imageRequests.filter((r) => r.url.endsWith("/" + originalFile));
      if (fetchedOriginal.length) {
        fail(`the ORIGINAL upload was downloaded (${originalFile}${originalBytes ? `, ${Math.round(originalBytes / 1024)}KB` : ""}) — derivatives exist and were not used`);
      } else {
        ok(`original never fetched (${originalFile}${originalBytes ? `, ${Math.round(originalBytes / 1024)}KB` : ""} avoided)`);
      }

      const shape = await page.evaluate(() => {
        const sel = "#productGallery .shop-single-slide .product-gallery-img";
        const imgs = [...document.querySelectorAll(sel)];
        return imgs.map((i) => {
          const b = i.getBoundingClientRect();
          return {
            inPicture: i.parentElement && i.parentElement.tagName === "PICTURE",
            types: i.parentElement && i.parentElement.tagName === "PICTURE"
              ? [...i.parentElement.querySelectorAll("source")].map((s) => s.type) : [],
            currentSrc: i.currentSrc || "",
            loading: i.loading,
            fetchpriority: i.getAttribute("fetchpriority"),
            w: Math.round(b.width), h: Math.round(b.height),
            naturalW: i.naturalWidth,
            complete: i.complete,
          };
        });
      });

      if (!shape.length) { fail("no gallery image rendered at all"); await page.close(); continue; }

      const first = shape[0];

      // assets/images/product/gallery/ is gitignored and PER-CHECKOUT (like
      // server/storage/), so a worktree legitimately does not have the gallery
      // files that production has. That is an environment gap, not a code
      // defect, and reporting it as a failure sends the next person hunting a
      // bug that is not there.
      //
      // A BROKEN image is `complete: true` with `naturalWidth: 0` — the load
      // finished, it just finished in failure. (`complete: false` would mean
      // still in flight, which is a different thing and not what to skip on.)
      if (!first.currentSrc || (first.complete && first.naturalW === 0)) {
        console.log(`  skip  gallery media missing from this checkout (gallery/ is gitignored and per-checkout) — run against production to assert it`);
        await page.close();
        console.log("");
        continue;
      }

      // An image with no derivatives is a legitimate, expected state — an SVG,
      // a GIF (never rasterised on purpose), or a still smaller than the 320w
      // tier. The requirement there is that it degrades to a plain <img>, not
      // that it magically gains formats that were never generated.
      if (!expectDerivatives) {
        ok(`primary image has no derivatives by design (${primaryCover ? `${primaryCover.width}x${primaryCover.height}${primaryCover.tiny ? ", tiny" : ""}` : "no manifest"}) — degrades to plain <img>`);
        if (!first.inPicture) ok("rendered as a plain <img>, as intended");
        else fail("wrapped in <picture> with no sources to offer");
      } else if (first.inPicture && first.types.includes("image/avif") && first.types.includes("image/webp")) {
        ok(`main slide offers AVIF + WebP`);
      } else {
        fail(`main slide is not a <picture> with both formats (got ${JSON.stringify(first.types)})`);
      }

      if (!expectDerivatives) {
        ok(`resolved to the original by design: ${first.currentSrc.split("/").pop()}`);
      } else if (/-(320|640|960|1280)\.(avif|webp)$/.test(first.currentSrc)) {
        ok(`resolved to a derivative: ${first.currentSrc.split("/").pop()}`);
      } else {
        fail(`resolved to ${first.currentSrc.split("/").pop() || "(nothing)"} — expected a sized derivative`);
      }

      // The first slide is the LCP element; lazy-loading it is a regression.
      if (first.loading === "eager" && first.fetchpriority === "high") ok("first slide eager + fetchpriority=high");
      else fail(`first slide should be eager/high, got loading=${first.loading} fetchpriority=${first.fetchpriority}`);

      // Every LATER slide is behind the carousel and must not cost a download.
      const laterEager = shape.slice(1).filter((s) => s.loading !== "lazy");
      if (shape.length === 1) ok("single-media product — no extra slides to defer");
      else if (!laterEager.length) ok(`${shape.length - 1} off-screen slide(s) deferred`);
      else fail(`${laterEager.length} off-screen slide(s) are not lazy`);

      // Not upscaled into mush, and not absurdly over-provisioned. The box is
      // pinned by aspect-ratio in shop-single.css, so a mismatch here means the
      // `sizes` attribute is lying about how wide the gallery renders.
      //
      // The width comes from the FILENAME, not from img.naturalWidth. For an
      // image resolved through srcset+sizes, naturalWidth is density-corrected
      // — it reports the CSS-pixel size the browser chose to treat the bitmap
      // as, not the bitmap's real width. Asserting on it made a correctly
      // chosen 640w derivative look like a 234px one.
      const chosenW = Number((first.currentSrc.match(/-(\d+)\.(?:avif|webp)$/) || [])[1]) || 0;
      const need = first.w * (vp.deviceScaleFactor || 1);
      if (!expectDerivatives) {
        ok(`no derivative tiers to choose from — skipping size check`);
      } else if (!chosenW) {
        fail(`could not read a width from ${first.currentSrc.split("/").pop() || "(nothing)"}`);
      } else if (chosenW >= need * 0.75 && chosenW <= need * 2.2) {
        ok(`derivative sized sensibly: ${chosenW}w for a ${first.w}px box @${vp.deviceScaleFactor || 1}x (needs ~${need}px)`);
      } else {
        fail(`chose ${chosenW}w for a ${first.w}px box @${vp.deviceScaleFactor || 1}x (needs ~${need}px) — check the sizes attribute`);
      }

      // Immutable caching must actually reach the browser on the derivatives.
      const derivResponses = imageRequests.filter((r) => /-(320|640|960|1280)\.(avif|webp)$/.test(r.url));
      const unCached = derivResponses.filter((r) => !/immutable/.test(r.cc));
      if (!derivResponses.length) ok("no derivative responses to check caching on");
      else if (!unCached.length) ok(`all ${derivResponses.length} derivative response(s) sent immutable caching`);
      else fail(`${unCached.length} derivative(s) missing immutable Cache-Control`);

      if (!errors.length) ok("no console errors");
      else fail(`console errors: ${errors.slice(0, 3).join(" | ")}`);

      await page.close();
      console.log("");
    }
  }

  await browser.close();
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASSED");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
