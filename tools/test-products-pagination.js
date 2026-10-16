// Browser test for the Products table's pagination.
//
// The table used to fetch the ENTIRE catalogue on every load and render every
// row, and the response carried each product's trainingContent — 83KB for one
// real program — so drawing 23 rows moved ~150KB and a few hundred products
// would have moved tens of megabytes. The server now returns a list shape
// without those blobs and this asks for one page of it.
//
// What is actually easy to get wrong here is not the Prev/Next wiring, it is
// the interaction between paging and the table's local single-row mutations:
// a delete leaves the page one row short and the row that should replace it
// was never fetched, and a create sorts to the top of page 1 rather than to
// wherever the admin happens to be standing. Those are the assertions worth
// having.
//
// Stub API, so the catalogue size is fixed and this needs no database.
//
//   cd tools && npm install && node test-products-pagination.js
const fs = require("fs"), path = require("path"), http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const CHROME = process.env.CHROME_PATH || (function () {
  const base = path.join(process.env.HOME || "/root", ".cache/puppeteer/chrome");
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).sort() : [];
  if (!dirs.length) throw new Error("No Chrome in " + base + " — set CHROME_PATH.");
  return path.join(base, dirs[dirs.length - 1], "chrome-linux64", "chrome");
})();

const TOTAL = 136;
const STATUSES = ["published", "draft", "archived", "private"];
let catalogue = [];
function reset() {
  catalogue = [];
  for (let i = 0; i < TOTAL; i++) {
    catalogue.push({
      id: "p" + String(i).padStart(3, "0"),
      slug: "page-test-" + String(i).padStart(3, "0"),
      name: "Page Test " + String(i).padStart(3, "0"),
      status: STATUSES[i % STATUSES.length],
      creator: "Creator " + (i % 7),
      priceCents: 1000 + i,
      featured: false,
      taxonomyPaths: [],
      createdAt: new Date(Date.now() - i * 60000).toISOString(),
    });
  }
}
reset();

const requests = [];

const server = http.createServer((req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname === "/api/admin/products") {
    if (req.method === "DELETE") { res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" }); return res.end("{}"); }
    const limit = parseInt(url.searchParams.get("limit"), 10) || 0;
    const offset = parseInt(url.searchParams.get("offset"), 10) || 0;
    const search = (url.searchParams.get("search") || "").toLowerCase();
    const status = url.searchParams.get("status") || "";
    requests.push({ limit: limit, offset: offset, search: search, status: status });

    let all = catalogue;
    if (status) all = all.filter((p) => p.status === status);
    if (search) all = all.filter((p) =>
      p.name.toLowerCase().includes(search) || (p.creator || "").toLowerCase().includes(search) ||
      p.slug.includes(search) || p.id === search);

    const products = limit ? all.slice(offset, offset + limit) : all;
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    return res.end(JSON.stringify(limit
      ? { products: products, total: all.length, offset: offset, truncated: all.length > offset + products.length }
      : { products: products }));
  }
  if (url.pathname.startsWith("/api/admin/products/")) {
    const id = url.pathname.split("/")[4];
    if (req.method === "DELETE") {
      catalogue = catalogue.filter((p) => p.id !== id);
      res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      return res.end('{"ok":true}');
    }
  }
  const local = path.join(ROOT, url.pathname);
  if (url.pathname !== "/" && fs.existsSync(local)) {
    res.writeHead(200, { "Content-Type": "text/javascript; charset=utf-8" });
    return res.end(fs.readFileSync(local));
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(PAGE);
});

const PAGE = `<!doctype html><html><body>
<div id="root">
  <input id="productSearch"><select id="statusFilter">
    <option value=""></option><option value="published">published</option>
    <option value="draft">draft</option><option value="archived">archived</option>
    <option value="private">private</option></select>
  <button id="createProductBtn"></button>
  <table><tbody id="productsTableBody"></tbody></table>
  <div class="a-pager u-hidden" id="productsPager">
    <span id="productsPagerCount"></span>
    <select id="productsPageSize">
      <option value="25">25</option><option value="50">50</option><option value="100">100</option>
    </select>
    <button id="productsPrev" type="button">Prev</button>
    <span id="productsPagerPage"></span>
    <button id="productsNext" type="button">Next</button>
  </div>
</div>
<script>
  window.AdminUI = {
    skeletonRows: function(){ return '<tr class="skeleton"><td>loading</td></tr>'; },
    emptyState: function(icon,msg){ return '<div class="empty">'+msg+'</div>'; },
    toast: function(){},
    // Auto-confirm: this suite is about what happens AFTER a delete.
    confirmDialog: function(){ return Promise.resolve(true); },
    escapeHtml: function(v){ return String(v==null?"":v).replace(/[&<>"']/g,function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); },
    formatCents: function(c){ return "$"+((c||0)/100).toFixed(2); },
    formatDate: function(d){ return String(d).slice(0,10); },
    animateRowsIn: function(){}, flashRow: function(){},
    animateRowRemoval: function(){ return Promise.resolve(); },
  };
  window.AdminProductBuilder = { open: function(){} };
  window.__errors = [];
  window.addEventListener("error", function(e){ window.__errors.push(String(e.message)); });
  window.addEventListener("unhandledrejection", function(e){
    window.__errors.push("UNHANDLED: "+String(e.reason && e.reason.message || e.reason)); });
</script>
<script src="/assets/js/admin/api.js"></script>
<script src="/assets/js/admin/products.js"></script>
<script>window.AdminPanels.products.mount(document.getElementById("root"));</script>
</body></html>`;

const results = [];
const check = (n, p, d) => results.push({ n: n, p: p, d: d });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  await new Promise((r) => server.listen(3405, r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"] });
  const page = await browser.newPage();
  await page.setViewport({ width: 1400, height: 1000 });
  await page.goto("http://localhost:3405/", { waitUntil: "domcontentloaded" });
  await sleep(800);

  const state = () => page.evaluate(() => ({
    rows: document.querySelectorAll("#productsTableBody tr[data-row-key]").length,
    ids: Array.from(document.querySelectorAll("#productsTableBody tr[data-row-key]")).map((t) => t.dataset.rowKey),
    count: document.getElementById("productsPagerCount").textContent,
    label: document.getElementById("productsPagerPage").textContent,
    hidden: document.getElementById("productsPager").classList.contains("u-hidden"),
    prevOff: document.getElementById("productsPrev").disabled,
    nextOff: document.getElementById("productsNext").disabled,
  }));

  let s = await state();
  check("the first request is bounded, never the whole catalogue",
    requests.length > 0 && requests[0].limit === 25 && requests[0].offset === 0, requests[0]);
  check("renders exactly one page", s.rows === 25, s.rows);
  check("pager visible when there is more than one page", !s.hidden, s);
  check("count reads 1-25 of " + TOTAL, /1[–-]25 of 136/.test(s.count), s.count);
  check("Prev disabled on the first page", s.prevOff && !s.nextOff, s);
  const page1 = s.ids.slice();

  await page.click("#productsNext"); await sleep(500);
  s = await state();
  check("Next advances a page", /Page 2 of 6/.test(s.label), s.label);
  check("page 2 shares no rows with page 1", s.ids.every((id) => page1.indexOf(id) === -1), s.ids.slice(0, 3));

  // Walk to the end, collecting every id: the pages must tile the catalogue
  // exactly — no repeats, nothing skipped.
  let seen = page1.concat(s.ids);
  for (let i = 0; i < 4; i++) { await page.click("#productsNext"); await sleep(450); seen = seen.concat((await state()).ids); }
  s = await state();
  check("reaches the final page", /Page 6 of 6/.test(s.label), s.label);
  check("final page holds the remainder", s.rows === TOTAL - 125, s.rows);
  check("Next disabled on the final page", s.nextOff, s);
  check("paging tiles the catalogue with no gaps or repeats",
    seen.length === TOTAL && new Set(seen).size === TOTAL, { walked: seen.length, unique: new Set(seen).size });

  await page.click("#productsPrev"); await sleep(500);
  check("Prev steps back", /Page 5 of 6/.test((await state()).label));

  await page.select("#productsPageSize", "50"); await sleep(600);
  s = await state();
  check("page size change resets to page 1", /Page 1 of 3/.test(s.label), s.label);
  check("page size change is honoured", s.rows === 50, s.rows);
  await page.select("#productsPageSize", "25"); await sleep(600);

  // Searching from a deep page must not leave the offset stranded.
  await page.click("#productsNext"); await sleep(450);
  await page.type("#productSearch", "Page Test 01", { delay: 15 });
  await sleep(900);
  s = await state();
  check("searching resets to page 1", /Page 1 of/.test(s.label), s.label);
  check("a one-page result hides the pager", s.hidden, s);
  check("search reached the server, not a local filter",
    requests[requests.length - 1].search === "page test 01", requests[requests.length - 1]);

  await page.evaluate(() => { document.getElementById("productSearch").value = ""; });
  await page.type("#productSearch", "Creator 3", { delay: 15 });
  await sleep(900);
  check("search matches creator", (await state()).rows > 0, (await state()).count);

  await page.evaluate(() => { document.getElementById("productSearch").value = ""; });
  await page.type("#productSearch", "x", { delay: 10 });
  await page.evaluate(() => { document.getElementById("productSearch").value = ""; });
  await sleep(900);
  await page.select("#statusFilter", "archived"); await sleep(800);
  s = await state();
  check("status filter resets to page 1", /Page 1 of/.test(s.label), s.label);
  check("status filter reaches the server", requests[requests.length - 1].status === "archived",
    requests[requests.length - 1]);
  await page.select("#statusFilter", ""); await sleep(800);

  // The mutation that paging makes genuinely hard.
  const before = await state();
  await page.evaluate(() => document.querySelector("#productsTableBody tr[data-row-key] [data-delete]").click());
  await sleep(1400);
  const after = await state();
  check("delete keeps the page full by backfilling from the next page",
    after.rows === before.rows, { before: before.rows, after: after.rows });
  check("delete decrements the reported total", /of 135/.test(after.count), after.count);
  check("the backfilled row was not previously on screen",
    after.ids.some((id) => before.ids.indexOf(id) === -1),
    { added: after.ids.filter((i) => before.ids.indexOf(i) === -1) });
  check("the deleted row is gone", after.ids.indexOf(before.ids[0]) === -1, before.ids[0]);

  check("no console errors", (await page.evaluate(() => window.__errors)).length === 0,
    await page.evaluate(() => window.__errors));
  check("no request ever asked for an unbounded list",
    requests.every((r) => r.limit > 0), requests.filter((r) => !r.limit));

  let fails = 0;
  results.forEach((r) => { if (!r.p) fails++;
    console.log((r.p ? "  PASS  " : "  FAIL  ") + r.n + (r.p ? "" : "\n         -> " + JSON.stringify(r.d))); });
  console.log(fails ? "\n" + fails + " FAILED" : "\nALL PASSED");
  await browser.close(); server.close();
  process.exit(fails ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
