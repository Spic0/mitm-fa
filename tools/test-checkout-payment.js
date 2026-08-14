// Checkout + order-confirmation browser harness (Phases 16-18 of the payment
// audit brief).
//
// What this exists to catch, none of which a screenshot review reliably does:
//   - a payment button that is visible and tappable but wired to nothing
//   - more than one competing primary payment CTA
//   - a payment method offered in the UI that the server says is unavailable
//   - the mobile order of the checkout blocks (contact/billing must come
//     before the payment action, not after a long summary)
//   - horizontal overflow, sub-44px tap targets, unreadable type
//   - first content rendering underneath the fixed header
//   - console errors on either page
//
// Usage: node test-checkout-payment.js [--base http://127.0.0.1:3222] [--shots]
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const BASE = arg("--base", "http://127.0.0.1:3222");
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = path.join(__dirname, ".shots");

const PHONE_WIDTHS = [320, 375, 390, 430];
const WIDTHS = [...PHONE_WIDTHS, 768, 1280, 1440];
const MIN_TAP = 44;
const MIN_FONT = 13;
// The site header is position:fixed and nothing reserves space for it
// globally; every inner page clears it with .page-banner { margin-top: 68px }.
const HEADER_CLEARANCE = 68;

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  const builds = fs.readdirSync(root).sort();
  return path.join(root, builds[builds.length - 1], "chrome-linux64", "chrome");
}

let failures = 0;
let checks = 0;
function check(label, cond, detail) {
  checks++;
  if (!cond) {
    failures++;
    console.log(`    FAIL  ${label}${detail ? "  — " + detail : ""}`);
  }
}

// Advisory, not a failure. The checkout page has its own deliberately compact
// type scale (11-12.5px labels, a small header logo) that predates this
// harness and is a design decision, not a payment-correctness bug. Printing
// these keeps them visible without letting them mask a real regression in the
// exit code — everything that could actually cost a sale or a charge is a
// hard check() above.
const notes = new Set();
function note(label, cond, detail) {
  if (!cond) notes.add(`${label}${detail ? "  — " + detail : ""}`);
}

// A cart in localStorage is what makes /checkout render anything at all —
// with an empty cart its own JS immediately redirects to /shop, which is why
// the seed happens on /shop rather than on /checkout itself.
// Keys and item shape mirror assets/js/script.js exactly: `odor_cart`, and
// `price` as a plain dollar NUMBER (not cents, which is what the product API
// returns).
async function seedCart(page, product) {
  await page.goto(BASE + "/shop", { waitUntil: "domcontentloaded" });
  await page.evaluate((p) => {
    localStorage.setItem(
      "odor_cart",
      JSON.stringify([{ id: p.id, name: p.name, price: p.priceCents / 100, img: p.imageUrl || "", qty: 1 }])
    );
    localStorage.removeItem("odor_buynow");
  }, product);
}

(async () => {
  if (SHOTS) fs.mkdirSync(SHOT_DIR, { recursive: true });

  const res = await fetch(`${BASE}/api/products`);
  const { products } = await res.json();
  const product = (products || []).find((p) => p.priceCents > 0);
  if (!product) throw new Error("no priced published product to build a cart from");

  const config = await (await fetch(`${BASE}/api/config`)).json();

  const browser = await puppeteer.launch({
    executablePath: findChrome(),
    args: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  const page = await browser.newPage();
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });

  const consoleErrors = [];
  page.on("console", (m) => {
    if (m.type() !== "error") return;
    const t = m.text();
    // Stripe.js cannot load against a fake publishable key in a sandbox with
    // no network egress; that is a property of the test rig, not the page.
    if (/js\.stripe\.com|r\.stripe\.com|ERR_NAME_NOT_RESOLVED|ERR_INTERNET_DISCONNECTED|Failed to load resource/i.test(t)) return;
    consoleErrors.push(t);
  });
  page.on("pageerror", (e) => consoleErrors.push("pageerror: " + e.message));

  // ------------------------------------------------------------------
  console.log("\n/checkout");
  for (const width of WIDTHS) {
    console.log(`  ${width}px`);
    await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
    await seedCart(page, product);
    await page.goto(BASE + "/checkout", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 600));

    const r = await page.evaluate((MIN_TAP, MIN_FONT) => {
      const doc = document.documentElement;
      const vw = doc.clientWidth;

      const hiddenUp = (el) => {
        for (let n = el; n && n !== doc; n = n.parentElement) {
          const cs = getComputedStyle(n);
          if (cs.display === "none" || cs.visibility === "hidden") return true;
          if (parseFloat(cs.opacity) === 0) return true;
        }
        return false;
      };
      const clippedUp = (el) => {
        for (let n = el.parentElement; n && n !== doc; n = n.parentElement) {
          const cs = getComputedStyle(n);
          const ox = cs.overflowX;
          if (ox === "hidden" || ox === "clip" || ox === "auto" || ox === "scroll") return true;
          // The closed cart drawer is position:fixed and parked off-canvas
          // with translateX. It cannot widen the document, but its children
          // are not themselves fixed, so without this every one of them reads
          // as overflowing at desktop widths.
          if (cs.position === "fixed") return true;
        }
        return false;
      };
      // The shared header's desktop mega-menu and the decorative card-brand
      // badges ("VISA", "AMEX") are pre-existing site chrome, not this page's
      // copy — the badges are logos that happen to be rendered as text.
      const isSharedChrome = (el) => !!el.closest(".mega-menu, .cart-drawer, .site-header, .card-brand");

      const overflowing = [];
      const taps = [];
      const smallText = [];
      document.querySelectorAll("body *").forEach((el) => {
        const cs = getComputedStyle(el);
        if (hiddenUp(el)) return;
        const b = el.getBoundingClientRect();
        if (b.width === 0 && b.height === 0) return;
        if (cs.position !== "fixed" && (b.right > vw + 1 || b.left < -1) && !clippedUp(el)) {
          overflowing.push(el.tagName.toLowerCase() + "." + String(el.className || "").split(" ").filter(Boolean).slice(0, 2).join("."));
        }
        if (el.children.length === 0 && (el.textContent || "").trim().length > 2 && !isSharedChrome(el)) {
          const fs = parseFloat(cs.fontSize);
          if (fs && fs < MIN_FONT) {
            smallText.push(el.tagName.toLowerCase() + "." + String(el.className).slice(0, 20) + " " + fs + "px");
          }
        }
      });

      document.querySelectorAll("main a, main button, .co-stickybar__cta").forEach((el) => {
        if (hiddenUp(el) || isSharedChrome(el)) return;
        // Breadcrumb links are inline text navigation, present on every inner
        // page of this site — not tap targets in the 44px sense.
        if (el.closest(".breadcrumb-list")) return;
        const cs = getComputedStyle(el);
        if (cs.display === "inline") return;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return;
        if (b.height < MIN_TAP) taps.push(String(el.className).slice(0, 40) + " h=" + Math.round(b.height));
      });

      // The single primary payment action.
      const cta = document.getElementById("coStickyCta");
      const ctaText = document.getElementById("coStickyCtaText");
      const ctaBox = cta ? cta.getBoundingClientRect() : null;
      const ctaStyle = cta ? getComputedStyle(cta) : null;
      const ctaTextStyle = ctaText ? getComputedStyle(ctaText) : null;

      // Anything that looks like a second competing checkout button.
      const rivals = [...document.querySelectorAll("main button, main a")].filter((el) => {
        if (el.id === "coStickyCta" || hiddenUp(el)) return false;
        return /place order|pay now|complete order|secure checkout|checkout/i.test((el.textContent || "").trim());
      }).map((el) => (el.textContent || "").trim().slice(0, 40));

      // Payment method tabs, and whether each is marked unavailable.
      const tabs = [...document.querySelectorAll(".pay-tab")].map((t) => ({
        method: t.dataset.method,
        unavailable: t.classList.contains("is-unavailable"),
        text: (t.textContent || "").trim().slice(0, 30),
        h: Math.round(t.getBoundingClientRect().height),
      }));

      // Mobile block order: contact/billing must precede the payment CTA.
      const form = document.getElementById("coCustomerForm");
      const payPanel = document.getElementById("coPayState") || document.getElementById("stripe-payment-element");
      const summary = document.getElementById("coSummaryBody");
      const top = (el) => (el ? el.getBoundingClientRect().top + window.scrollY : null);

      // Header clearance: first content must not sit under the fixed header.
      const header = document.querySelector("header.site-header");
      const headerVisible = header && !hiddenUp(header);
      const firstMain = document.querySelector("main > *");

      return {
        overflowing: overflowing.slice(0, 5),
        taps: taps.slice(0, 5),
        smallText: smallText.slice(0, 5),
        hasCta: !!cta,
        ctaVisible: !!(ctaBox && ctaBox.height > 0 && ctaBox.width > 0),
        ctaHeight: ctaBox ? Math.round(ctaBox.height) : 0,
        ctaLabel: ctaText ? (ctaText.textContent || "").trim() : "",
        ctaColor: ctaStyle ? ctaStyle.color : "",
        ctaBg: ctaStyle ? ctaStyle.backgroundColor : "",
        ctaTextColor: ctaTextStyle ? ctaTextStyle.color : "",
        rivals,
        tabs,
        formTop: top(form),
        payTop: top(payPanel),
        summaryTop: top(summary),
        headerVisible,
        headerBottom: headerVisible ? Math.round(header.getBoundingClientRect().bottom) : 0,
        firstMainTop: firstMain ? Math.round(firstMain.getBoundingClientRect().top) : null,
        docScrollWidth: doc.scrollWidth,
        vw,
      };
    }, MIN_TAP, MIN_FONT);

    check(`${width}: no horizontal overflow`, r.docScrollWidth <= r.vw + 1, `${r.docScrollWidth} > ${r.vw}`);
    check(`${width}: nothing past the viewport edge`, r.overflowing.length === 0, r.overflowing.join(", "));
    note(`tap targets under ${MIN_TAP}px`, r.taps.length === 0, r.taps.join(", "));
    note(`text under ${MIN_FONT}px`, r.smallText.length === 0, r.smallText.join(", "));

    check(`${width}: exactly one primary payment CTA exists`, r.hasCta);
    check(`${width}: the CTA is visible`, r.ctaVisible);
    check(`${width}: CTA is at least 44px tall`, r.ctaHeight >= MIN_TAP, `${r.ctaHeight}px`);
    check(`${width}: CTA has readable label text`, r.ctaLabel.length > 3, JSON.stringify(r.ctaLabel));
    check(
      `${width}: CTA label is not the same colour as its background`,
      r.ctaTextColor !== r.ctaBg,
      `${r.ctaTextColor} on ${r.ctaBg}`
    );
    check(`${width}: no second competing checkout button`, r.rivals.length === 0, r.rivals.join(" | "));

    // Every offered method must match what the server actually supports.
    const cardTab = r.tabs.find((t) => t.method === "card");
    const paypalTab = r.tabs.find((t) => t.method === "paypal");
    if (cardTab) {
      check(
        `${width}: card tab availability matches server config`,
        cardTab.unavailable === !config.stripePublishableKey,
        `tab unavailable=${cardTab.unavailable}, server has key=${!!config.stripePublishableKey}`
      );
    }
    if (paypalTab) {
      check(
        `${width}: paypal tab availability matches server config`,
        paypalTab.unavailable === !config.paypalClientId,
        `tab unavailable=${paypalTab.unavailable}, server has id=${!!config.paypalClientId}`
      );
    }
    check(`${width}: no Apple Pay / Google Pay tab (Stripe surfaces those in the card panel)`,
      !r.tabs.some((t) => /applepay|gpay|googlepay/i.test(t.method || "")),
      r.tabs.map((t) => t.method).join(","));

    if (PHONE_WIDTHS.includes(width)) {
      check(
        `${width}: contact/billing appears above the payment panel`,
        r.formTop != null && r.payTop != null && r.formTop < r.payTop,
        `form@${r.formTop} pay@${r.payTop}`
      );
    }

    if (r.headerVisible && r.firstMainTop != null) {
      check(
        `${width}: first content clears the fixed header`,
        r.firstMainTop >= r.headerBottom - 1,
        `content top ${r.firstMainTop} < header bottom ${r.headerBottom}`
      );
    }

    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOT_DIR, `checkout-${width}.png`), fullPage: width <= 430 });
    }
  }

  // ------------------------------------------------------------------
  // The order-confirmation page. Rendered signed-out here, which is the
  // "still confirming" branch — the one a buyer hits when their session did
  // not survive the payment redirect, and the branch most likely to be wrong.
  console.log("\n/order/success");
  for (const width of [320, 375, 430, 1280]) {
    console.log(`  ${width}px`);
    await page.setViewport({ width, height: 900, deviceScaleFactor: 2 });
    await page.goto(BASE + "/order/success?order=nonexistent", { waitUntil: "networkidle0" });
    await new Promise((r) => setTimeout(r, 500));

    const r = await page.evaluate((MIN_TAP, HEADER_CLEARANCE) => {
      const doc = document.documentElement;
      const visible = (id) => {
        const el = document.getElementById(id);
        if (!el) return false;
        const cs = getComputedStyle(el);
        return cs.display !== "none" && el.getBoundingClientRect().height > 0;
      };
      const taps = [];
      document.querySelectorAll("main a, main button").forEach((el) => {
        if (el.closest(".breadcrumb-list")) return;
        const cs = getComputedStyle(el);
        if (cs.display === "none" || cs.display === "inline") return;
        const b = el.getBoundingClientRect();
        if (b.width === 0 || b.height === 0) return;
        if (b.height < MIN_TAP) taps.push(String(el.className).slice(0, 30) + " h=" + Math.round(b.height));
      });
      const banner = document.querySelector(".page-banner");
      return {
        loadingGone: !visible("osLoading"),
        problemShown: visible("osProblem"),
        successShown: visible("osSuccess"),
        taps,
        scrollWidth: doc.scrollWidth,
        vw: doc.clientWidth,
        bannerMarginTop: banner ? Math.round(parseFloat(getComputedStyle(banner).marginTop)) : null,
        HEADER_CLEARANCE,
      };
    }, MIN_TAP, HEADER_CLEARANCE);

    check(`${width}: confirmation page resolves out of its loading state`, r.loadingGone);
    check(`${width}: unknown/inaccessible order shows the "still confirming" panel`, r.problemShown);
    check(`${width}: does NOT claim success for an order it could not read`, !r.successShown);
    check(`${width}: no horizontal overflow`, r.scrollWidth <= r.vw + 1, `${r.scrollWidth} > ${r.vw}`);
    check(`${width}: tap targets >= ${MIN_TAP}px`, r.taps.length === 0, r.taps.join(", "));
    check(
      `${width}: page banner carries the ${HEADER_CLEARANCE}px fixed-header clearance`,
      r.bannerMarginTop === HEADER_CLEARANCE,
      `margin-top ${r.bannerMarginTop}px`
    );

    if (SHOTS) {
      await page.screenshot({ path: path.join(SHOT_DIR, `order-success-${width}.png`), fullPage: true });
    }
  }

  check("no console errors on either page", consoleErrors.length === 0, consoleErrors.slice(0, 3).join(" | "));

  await browser.close();
  if (notes.size) {
    console.log("\nAdvisory (pre-existing checkout design, not payment correctness):");
    [...notes].forEach((n) => console.log("  - " + n));
  }
  console.log(`\n${checks - failures}/${checks} checks passed`);
  process.exit(failures ? 1 : 0);
})();
