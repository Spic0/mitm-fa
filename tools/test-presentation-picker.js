// Browser test for the Presentation Builder's product picker.
//
// The picker used to be a <select> populated with
// `listProducts({ status: "presentation" })`, so a real catalogue product
// could not be found in it at all — which read as "the selector doesn't load
// all products" and was in fact a deliberate filter. The same rule then lived
// in two more places that disagreed with it: the save path accepted any id
// without validating it, and the deck renderer resolved a non-presentation id
// back to null. A deck could hold a valid product id and show no product.
//
// Every product is now listed whatever its status, search is server-side over
// name/creator/id/slug, and the picker states what the deck will DO with each
// one (link to storefront / link to showcase / no outbound link) at the moment
// of choosing.
//
// Uses a stub API with a fixed catalogue rather than the real database, so it
// stays deterministic and does not depend on what happens to be in production.
//
//   cd tools && npm install && node test-presentation-picker.js
const fs = require("fs"), path = require("path"), http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const CHROME = process.env.CHROME_PATH || (function () {
  const base = path.join(process.env.HOME || "/root", ".cache/puppeteer/chrome");
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).sort() : [];
  if (!dirs.length) throw new Error("No Chrome in " + base + " — set CHROME_PATH.");
  return path.join(base, dirs[dirs.length - 1], "chrome-linux64", "chrome");
})();

// One product per status, so "lists every product regardless of status" is
// actually exercised rather than asserted against a single-status fixture.
const CATALOGUE = [
  { id: "p-pub", slug: "peak", name: "Sulek Strength & Size Peak", status: "published", creator: "Sam Sulek" },
  { id: "p-show", slug: "platform-showcase", name: "Platform Showcase", status: "presentation", creator: "Fitness Agency" },
  { id: "p-draft", slug: "untitled", name: "Untitled Program", status: "draft", creator: "Sam Sulek" },
  { id: "p-priv", slug: "private-one", name: "Private Beta Block", status: "private", creator: "Alex Roe" },
  { id: "p-arch", slug: "old", name: "Retired 2024 Plan", status: "archived", creator: "Alex Roe" },
  { id: "p-sched", slug: "soon", name: "Scheduled Launch", status: "scheduled", creator: "Jo Kim" },
];

const requests = [];
let delayNext = 0;

function match(term) {
  const t = term.toLowerCase();
  return CATALOGUE.filter((p) =>
    p.name.toLowerCase().includes(t) || (p.creator || "").toLowerCase().includes(t) ||
    p.slug.includes(t) || p.id === term);
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/admin/products") {
    const search = url.searchParams.get("search") || "";
    const limit = parseInt(url.searchParams.get("limit"), 10) || 0;
    requests.push({ search: search, compact: url.searchParams.get("compact"), limit: limit });
    const all = search ? match(search) : CATALOGUE;
    const products = limit ? all.slice(0, limit) : all;
    const body = JSON.stringify({ products: products, total: all.length, truncated: all.length > products.length });
    const wait = delayNext; delayNext = 0;
    return setTimeout(() => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(body); }, wait);
  }
  if (url.pathname.startsWith("/api/admin/products/")) {
    const id = url.pathname.split("/").pop();
    const found = CATALOGUE.find((p) => p.id === id);
    res.writeHead(found ? 200 : 404, { "Content-Type": "application/json" });
    return res.end(JSON.stringify(found ? { product: found } : { error: "Not found" }));
  }
  const local = path.join(ROOT, url.pathname);
  if (url.pathname !== "/" && fs.existsSync(local)) {
    const ext = path.extname(local);
    res.writeHead(200, { "Content-Type": ext === ".css" ? "text/css" : "text/javascript" });
    return res.end(fs.readFileSync(local));
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(PAGE);
});

// Mounts only the picker, by calling the module's own populateProductPicker
// through the drawer markup it expects. Keeps the test on the unit that
// matters instead of booting the whole admin shell.
const PAGE = `<!doctype html><html><head>
<link rel="stylesheet" href="/assets/css/admin.css"></head><body>
<div id="drawer">
  <div class="pres-picker" data-product-picker>
    <input type="hidden" id="presFeaturedProduct" value="p-show">
    <div class="pres-picker__current" data-picker-current>Loading…</div>
    <input type="text" id="presProductSearch" class="pres-picker__search" role="combobox" aria-expanded="false" aria-controls="presProductList">
    <ul class="pres-picker__list" id="presProductList" role="listbox" hidden></ul>
    <p class="pres-picker__meta" data-picker-meta></p>
  </div>
</div>
<script>
  window.AdminUI = { escapeHtml: function(v){ return String(v==null?"":v).replace(/[&<>"']/g,function(c){
    return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); } };
  window.__errors = [];
  window.addEventListener("error", function(e){ window.__errors.push(String(e.message)); });
  window.addEventListener("unhandledrejection", function(e){
    window.__errors.push("UNHANDLED: "+String(e.reason && e.reason.message || e.reason)); });
</script>
<script src="/assets/js/admin/api.js"></script>
<script src="/assets/js/admin/presentations.js"></script>
<script>
  window.AdminPanels.presentations._populateProductPicker(document.getElementById("drawer"));
</script>
</body></html>`;

const results = [];
function check(name, pass, detail) { results.push({ name: name, pass: pass, detail: detail }); }
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(3404, r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1000, height: 800 });
  await page.goto("http://localhost:3404/", { waitUntil: "networkidle0" });
  await sleep(500);

  check("saved product resolves to a name, not a bare id",
    /Platform Showcase/.test(await page.$eval("[data-picker-current]", (e) => e.textContent)));

  await page.focus("#presProductSearch");
  await sleep(600);
  const opened = await page.evaluate(() => ({
    options: document.querySelectorAll("#presProductList [data-idx]").length,
    statuses: Array.from(document.querySelectorAll("#presProductList .pres-badge")).map((b) => b.textContent.trim()),
    meta: document.querySelector("[data-picker-meta]").textContent.trim(),
  }));
  check("lists every product regardless of status", opened.options === CATALOGUE.length + 1, opened);
  check("draft / private / archived / scheduled are all offered",
    ["draft", "private", "archived", "scheduled"].every((s) => opened.statuses.indexOf(s) !== -1), opened.statuses);
  check("shows the true total", /6/.test(opened.meta), opened.meta);
  check("asks the server for a compact payload", requests.every((r) => r.compact === "1"), requests);

  // Search is server-side: each of these must produce a request, not a local filter.
  const before = requests.length;
  await page.type("#presProductSearch", "Sam Sulek", { delay: 20 });
  await sleep(700);
  const byCreator = await page.$$eval("#presProductList [data-idx]", (els) => els.map((e) => e.textContent.trim()));
  check("search by creator hits the server", requests.length > before, { before: before, after: requests.length });
  check("search by creator returns that creator's products",
    byCreator.filter((t) => /Sulek|Untitled/.test(t)).length === 2, byCreator);

  await page.evaluate(() => { document.getElementById("presProductSearch").value = ""; });
  await page.type("#presProductSearch", "p-arch", { delay: 20 });
  await sleep(700);
  check("search by exact id finds an archived product",
    (await page.$$eval("#presProductList [data-idx]", (els) => els.map((e) => e.textContent))).some((t) => /Retired 2024/.test(t)));

  // Selecting a published product.
  await page.evaluate(() => { document.getElementById("presProductSearch").value = ""; });
  await page.type("#presProductSearch", "Peak", { delay: 20 });
  await sleep(700);
  await page.evaluate(() => {
    const li = Array.from(document.querySelectorAll("#presProductList [data-idx]"))
      .find((e) => /Sulek Strength/.test(e.textContent));
    li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await sleep(300);
  const sel = await page.evaluate(() => ({
    id: document.getElementById("presFeaturedProduct").value,
    current: document.querySelector("[data-picker-current]").textContent,
    listHidden: document.getElementById("presProductList").hidden,
  }));
  check("selecting sets the hidden id save() reads", sel.id === "p-pub", sel);
  check("a published product says it links to the storefront", /storefront/.test(sel.current), sel.current);
  check("list closes after choosing", sel.listHidden, sel);

  // An unreleased product must say it will have no outbound link.
  await page.type("#presProductSearch", "Untitled", { delay: 20 });
  await sleep(700);
  await page.evaluate(() => {
    const li = Array.from(document.querySelectorAll("#presProductList [data-idx]"))
      .find((e) => /Untitled/.test(e.textContent));
    li.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await sleep(300);
  check("a draft product warns it will have no outbound link",
    /no outbound link/.test(await page.$eval("[data-picker-current]", (e) => e.textContent)),
    await page.$eval("[data-picker-current]", (e) => e.textContent.trim()));

  // Clearing back to "No product".
  await page.focus("#presProductSearch");
  await sleep(600);
  await page.evaluate(() => {
    document.querySelector('#presProductList [data-idx="0"]').dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  });
  await sleep(300);
  check('"No product" clears the selection',
    (await page.$eval("#presFeaturedProduct", (e) => e.value)) === "");

  // Out-of-order responses: a slow early request must not overwrite a newer one.
  delayNext = 1200;
  await page.focus("#presProductSearch");
  await page.type("#presProductSearch", "Sulek", { delay: 10 });
  await sleep(400);
  await page.evaluate(() => { document.getElementById("presProductSearch").value = ""; });
  await page.type("#presProductSearch", "Retired", { delay: 10 });
  await sleep(2000);
  const final = await page.$$eval("#presProductList [data-idx]", (els) => els.map((e) => e.textContent));
  check("a slow earlier search cannot overwrite a newer one",
    final.some((t) => /Retired 2024/.test(t)) && !final.some((t) => /Sulek Strength/.test(t)), final);

  check("no console errors", (await page.evaluate(() => window.__errors)).length === 0,
    await page.evaluate(() => window.__errors));

  let bad = 0;
  results.forEach((r) => {
    if (!r.pass) bad++;
    console.log((r.pass ? "  PASS  " : "  FAIL  ") + r.name + (r.pass ? "" : "\n         -> " + JSON.stringify(r.detail)));
  });
  console.log(bad ? "\n" + bad + " FAILED" : "\nALL PASSED");
  await browser.close(); server.close();
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
