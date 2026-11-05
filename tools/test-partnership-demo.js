// The /partnership "See a demo" viewer, end to end in headless Chrome:
// every tab x device at 1440x900 and 390x844, that each frame is the real page
// at a real viewport, scrolls and follows a link while staying in demo mode,
// and that nothing in demo mode can start a payment. Then the same product
// page and checkout WITHOUT demo mode, to prove they are untouched.
//
// Needs a worktree server on :3200 against builder_test, with the demo routes
// seeded first: node seed-partnership-demo-fixtures.js (--clean afterwards).
//   node test-partnership-demo.js [--base http://127.0.0.1:3200] [--shots]
const fs = require("fs");
const path = require("path");
const puppeteer = require("puppeteer-core");

const arg = (n, d) => { const i = process.argv.indexOf(n); return i > -1 ? process.argv[i + 1] : d; };
const BASE = arg("--base", "http://127.0.0.1:3200");
const SHOTS = process.argv.includes("--shots");
const SHOT_DIR = path.join(__dirname, "..", ".screens");
const PAY = /\/api\/checkout|\/checkout(\?|$|\/)|stripe\.com|paypal\.com/;
const TABS = ["storefront", "product", "plan", "checkout"];
const VIEWPORTS = [
  { name: "", width: 1440, height: 900 },
  { name: "-m", width: 390, height: 844, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
];

function findChrome() {
  const root = "/root/.cache/puppeteer/chrome";
  const build = fs.readdirSync(root).sort().pop();
  return path.join(root, build, "chrome-linux64", "chrome");
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
function check(ok, msg) {
  console.log((ok ? "  ok   " : "  FAIL ") + msg);
  if (!ok) failures++;
}

async function activeFrame(page) {
  await page.waitForFunction(() => document.querySelector(".pt-demo__view.is-loaded"), { timeout: 15000 });
  const handle = await page.$(".pt-demo__view iframe:not([hidden])");
  return handle.contentFrame();
}

// A real mouse click on an element inside the scaled frame. Puppeteer's own
// element.click() maps in-frame boxes without the ancestor scale() and misses;
// Chrome's hit testing through the transform is fine, so map it here.
async function realClick(page, el) {
  const r = await el.evaluate((e) => { const b = e.getBoundingClientRect(); return { x: b.left + b.width / 2, y: b.top + b.height / 2 }; });
  const f = await page.$eval(".pt-demo__view iframe:not([hidden])", (fr) => { const b = fr.getBoundingClientRect(); return { x: b.left, y: b.top, s: b.width / fr.offsetWidth }; });
  await page.mouse.click(f.x + r.x * f.s, f.y + r.y * f.s);
}

// Runs `action` (which navigates the visible frame) and waits for the new page.
async function navigate(page, action) {
  const sel = ".pt-demo__view iframe:not([hidden])";
  const before = await page.$eval(sel, (f) => { f.contentWindow.__old = true; return f.contentWindow.location.href; });
  await action().catch(() => null);
  await page.waitForFunction((s) => {
    const w = document.querySelector(s).contentWindow;
    return !w.__old && w.document.readyState === "complete";
  }, { timeout: 15000 }, sel);
  await sleep(300);
  return page.$eval(sel, (f, b) => ({ before: b, href: f.contentWindow.location.href, demo: f.contentWindow.document.documentElement.dataset.demo, text: f.contentWindow.document.body.innerText.slice(0, 200) }), before);
}

async function run(browser, vp) {
  const page = await browser.newPage();
  await page.setViewport(vp);
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
  const errors = [];
  const pay = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
  page.on("pageerror", (e) => errors.push(String(e)));
  // Calendly's own iframe on /partnership loads Stripe.js (its fraud check);
  // that predates the viewer and is not ours. Everything else counts.
  const inCalendly = (fr) => { for (; fr; fr = fr.parentFrame()) if (/calendly\.com/.test(fr.url())) return true; return false; };
  // Its m.stripe.com beacon also re-requests with no frame attached (measured).
  const calendlyBeacon = (r) => !r.frame() && /^https:\/\/m\.stripe\.(com|network)\//.test(r.url());
  page.on("request", (r) => { if (PAY.test(r.url()) && !inCalendly(r.frame()) && !calendlyBeacon(r)) pay.push(r.url()); });
  // Stands in for PostHog (not configured on :3200); records the viewer's events.
  await page.evaluateOnNewDocument(() => {
    if (window.top !== window) return;
    window.__ev = [];
    window.faTrack = { capture: (e, p) => window.__ev.push([e, p || {}]) };
  });
  await page.goto(BASE + "/partnership", { waitUntil: "networkidle0" });
  console.log(`\n${vp.width}x${vp.height}`);

  check(await page.$$eval(".pt-demo iframe", (f) => f.length) === 0, "no iframe before intent");
  const opener = vp.hasTouch ? ".ph__actions [data-demo-open]" : ".pt-actions [data-demo-open]";
  if (!vp.hasTouch) await page.hover(opener);
  else await page.$eval(opener, (a) => a.dispatchEvent(new TouchEvent("touchstart", { bubbles: true })));
  check(await page.$$eval(".pt-demo iframe", (f) => f.length) === 1, "intent warms exactly one iframe (first tab)");
  await page.click(opener);
  await page.waitForSelector(".pt-demo[open]");
  check(await page.$eval("html", (h) => h.classList.contains("pt-demo-lock") && getComputedStyle(h).overflow === "hidden"), "body scroll locked");

  // Phones always show the phone view; the Desktop/Phone switch is hidden there.
  if (vp.isMobile) check(await page.$eval(".pt-demo__devs", (d) => getComputedStyle(d).display === "none"), "device switch hidden on phones");
  for (const device of vp.isMobile ? ["phone"] : ["desktop", "phone"]) {
    if (!vp.isMobile) await page.click(`[data-demo-device="${device}"]`);
    for (const tab of TABS) {
      await page.click(`[data-demo-tab="${tab}"]`);
      const frame = await activeFrame(page);
      await frame.waitForFunction(() => document.readyState === "complete");
      // The page's own preloader fades for ~1.3s after load (style.css .loading.isdone).
      await sleep(1800);
      const info = await frame.evaluate(() => ({ w: innerWidth, url: location.pathname + location.search + location.hash, demo: document.documentElement.dataset.demo }));
      const nativePhone = device === "phone" && vp.width < 768;
      const want = nativePhone ? vp.width : device === "desktop" ? 1440 : 390;
      check(info.w === want && info.demo === "1", `${tab}/${device}: ${info.url} at ${info.w}px (want ${want}), demo mode on`);
      if (SHOTS) {
        fs.mkdirSync(SHOT_DIR, { recursive: true });
        await page.screenshot({ path: path.join(SHOT_DIR, `demo-${tab}-${device}${vp.name}.png`) });
      }
      // Scroll, then follow a real same-origin link with a real click.
      const scrolled = await frame.evaluate(async () => { scrollTo(0, 500); await new Promise((r) => setTimeout(r, 100)); return scrollY; });
      check(scrolled > 0 || tab === "checkout", `${tab}/${device}: frame scrolls (${scrolled}px)`);
      if (tab === "product" || tab === "checkout") {
        await buyAttempt(page, frame, tab, device);
        continue;
      }
      const want2 = tab === "storefront" ? 'a[href*="/program/"]' : "main a[href], a[href]";
      const link = await frame.evaluateHandle((sel) => {
        const ok = (a) => a.href.startsWith(location.origin) && a.href.split("#")[0] !== location.href.split("#")[0] && !a.closest("header, .header, footer, [data-add-to-cart]") && a.offsetParent;
        return [...document.querySelectorAll(sel)].find(ok) || null;
      }, want2);
      if (!(await link.evaluate((a) => !!a))) { check(false, `${tab}/${device}: no link to click`); continue; }
      await link.evaluate((a) => a.scrollIntoView({ block: "center" }));
      await sleep(200);
      const after = await navigate(page, () => realClick(page, link));
      check(/[?&]demo=1/.test(after.href) && after.demo === "1", `${tab}/${device}: real click -> ${after.href.replace(BASE, "")} (still demo)`);
      await navigate(page, () => frame.evaluate(() => history.back()));
    }
  }

  // Script-driven navigation to checkout (no demo flag): the server refuses framed checkout.
  const frame = await activeFrame(page);
  const refused = await navigate(page, () => frame.evaluate(() => { location.href = "/checkout?buynow=1"; }));
  check(/checkout disabled/.test(refused.text), "framed /checkout (no flag) refused by server");
  await navigate(page, () => frame.evaluate(() => history.back()));
  const payBeforeServerCheck = pay.filter((u) => !/\/checkout\?buynow=1/.test(u));
  check(payBeforeServerCheck.length === 0, `no payment/checkout request left any frame (${payBeforeServerCheck.join(", ") || "none"})`);

  // Open full demo: new tab with the current frame URL, demo flag kept.
  const popup = new Promise((r) => browser.once("targetcreated", (t) => r(t)));
  await page.click("[data-demo-full]");
  const target = await popup;
  check(/[?&]demo=1/.test(target.url()), `open full demo -> ${target.url().replace(BASE, "")}`);
  const p2 = await target.page();
  if (p2) await p2.close();

  // Close paths: Esc in the dialog, Esc inside the frame, backdrop, X. Focus returns.
  await page.keyboard.press("Escape");
  check(!(await page.$(".pt-demo[open]")), "Esc closes");
  check(await page.evaluate((s) => document.activeElement === document.querySelector(s), opener), "focus returns to the button");
  check(await page.$eval("html", (h) => !h.classList.contains("pt-demo-lock")), "scroll lock released");
  await page.click(opener);
  const f2 = await activeFrame(page);
  await f2.focus("body").catch(() => {});
  await f2.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
  check(!(await page.$(".pt-demo[open]")), "Esc inside the frame closes");
  await page.click(opener);
  if (!vp.isMobile) {
    await page.mouse.click(5, 5);
    check(!(await page.$(".pt-demo[open]")), "backdrop click closes");
    await page.click(opener);
  }
  await page.click("[data-demo-close]");
  check(!(await page.$(".pt-demo[open]")), "X closes");
  // Book a call: closes and lands on the booking section.
  await page.click(opener);
  await page.click("[data-demo-book]");
  await sleep(1500);
  const top = await page.$eval("#book", (b) => b.getBoundingClientRect().top);
  check(!(await page.$(".pt-demo[open]")) && Math.abs(top) < 120, `book CTA closes and scrolls to #book (top ${Math.round(top)}px)`);

  const ev = await page.evaluate(() => window.__ev);
  const names = new Set(ev.map((e) => e[0]));
  check(["partnership_demo_opened", "partnership_demo_tab_viewed", "partnership_demo_full_opened"].every((n) => names.has(n)), "PostHog events fired");
  check(ev.filter((e) => e[0] === "partnership_demo_tab_viewed").every((e) => TABS.includes(e[1].tab) && /desktop|phone/.test(e[1].device)), "tab_viewed carries {tab, device}");
  const real = errors.filter((e) => !/Failed to load resource: the server responded with a status of 403/.test(e));
  check(real.length === 0, `no console errors${real.length ? ": " + real.slice(0, 5).join(" | ") : ""}`);
  await page.close();
}

async function buyAttempt(page, frame, tab, device) {
  const cart = await frame.evaluate(() => localStorage.getItem("odor_cart") + "|" + sessionStorage.getItem("odor_buynow"));
  const btn = await frame.waitForSelector(".product__cart");
  const label = await btn.evaluate((b) => b.textContent.trim());
  check(label === "Demo: checkout disabled", `${tab}/${device}: buy button reads "${label}"`);
  await btn.evaluate((b) => b.scrollIntoView({ block: "center" }));
  await sleep(200);
  await realClick(page, btn);
  await sleep(300);
  const after = await frame.evaluate(() => ({
    cart: localStorage.getItem("odor_cart") + "|" + sessionStorage.getItem("odor_buynow"),
    toast: !!document.querySelector(".fa-demo-toast.is-on"),
    drawer: !!document.querySelector(".cart-drawer.open, .cart-drawer.is-open, .cart-drawer.active"),
  }));
  check(after.cart === cart && after.toast && !after.drawer, `${tab}/${device}: buy click does nothing but say so`);
  const api = await frame.evaluate(async () => (await fetch("/api/checkout/stripe/create-intent", { method: "POST" })).status);
  check(api === 403, `${tab}/${device}: /api/checkout blocked in page (${api})`);
}

async function normal(browser) {
  console.log("\nnon-demo product page + checkout");
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  await page.setExtraHTTPHeaders({ "x-forwarded-proto": "https" });
  await page.goto(BASE + "/program/elena-cho-strength-size-peak", { waitUntil: "networkidle0" });
  const html = await page.evaluate(() => ({ demo: document.documentElement.dataset.demo || "", robots: !!document.querySelector('meta[name="robots"][content="noindex"]'), script: !!document.querySelector('script[src*="demo-mode"]') }));
  check(!html.demo && !html.robots && !html.script, "no demo markup without ?demo=1");
  const btn = await page.waitForSelector(".product__cart");
  check(/Add to Bag/.test(await btn.evaluate((b) => b.textContent)), "Add to Bag label intact");
  await page.evaluate(() => localStorage.removeItem("odor_cart"));
  await btn.click();
  await sleep(400);
  const cart = JSON.parse((await page.evaluate(() => localStorage.getItem("odor_cart"))) || "[]");
  check(cart.length === 1, "Add to Bag adds the product to the cart");
  const res = await page.goto(BASE + "/checkout", { waitUntil: "networkidle0" });
  const items = await page.$$eval("#checkoutOrderList > *", (n) => n.length).catch(() => 0);
  check(res.status() === 200 && items > 0, `checkout renders with the item (${res.status()}, ${items} line)`);
  await page.evaluate(() => localStorage.removeItem("odor_cart"));
  await page.close();
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: findChrome(), args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  try {
    for (const vp of VIEWPORTS) await run(browser, vp);
    await normal(browser);
  } finally {
    await browser.close();
  }
  console.log(failures ? `\n${failures} check(s) failed` : "\nall checks passed");
  process.exit(failures ? 1 : 0);
})();
