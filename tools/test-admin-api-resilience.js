// Proves the admin panel degrades to a readable message instead of a
// TypeError when a response is not what the caller assumed.
//
// The Products page reported "Cannot read properties of undefined (reading
// 'length')" after a long spell on the loading skeleton. The cause was in
// assets/js/admin/api.js, not on the Products page: `res.json()` had a
// `.catch(() => ({}))`, and the ok/not-ok check only threw when `!res.ok`. So
// a 2xx whose body was empty, truncated, or not JSON was returned to the
// caller AS SUCCESS — an empty object — and every admin table then did
// `data.<key>.length` on it and died on `undefined`.
//
// The message was the worst part: it named neither the request nor the reason,
// so a transport problem looked like a bug on whatever page happened to be
// open. Nine admin panels shared the pattern; Products is simply the one that
// got hit.
//
// Each scenario below is a way a 200 can arrive with a body fetch cannot use.
// The happy-path cases are here for the same reason as the failures: a guard
// that also breaks the normal render is not a fix.
//
//   cd tools && npm install && node test-admin-api-resilience.js
const fs = require("fs"), path = require("path"), http = require("http");
const puppeteer = require("puppeteer-core");

const ROOT = path.join(__dirname, "..");
const CHROME = process.env.CHROME_PATH || (function () {
  const base = path.join(process.env.HOME || "/root", ".cache/puppeteer/chrome");
  const dirs = fs.existsSync(base) ? fs.readdirSync(base).sort() : [];
  if (!dirs.length) throw new Error("No Chrome in " + base + " — set CHROME_PATH.");
  return path.join(base, dirs[dirs.length - 1], "chrome-linux64", "chrome");
})();

function product(id, name, status) {
  return { id: id, slug: id, name: name, priceCents: 4900, status: status,
    taxonomyPaths: [], seoTags: [], faqs: [], resources: [], wizardProgress: {},
    createdAt: new Date().toISOString() };
}

// name -> { serve, expect }  — `expect` is a substring of what the table must
// end up showing. "rows" asserts a rendered row count instead.
const SCENARIOS = [
  { name: "truncated mid-JSON (connection cut after headers)",
    serve: (res) => { res.writeHead(200, { "Content-Type": "application/json" });
      res.write('{"products":[{"id":"a","name":"A"'); res.destroy(); },
    // The browser itself rejects this one before any of our code sees it.
    expect: "Failed to fetch" },

  { name: "empty body with 200",
    serve: (res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end(""); },
    expect: "incomplete response" },

  { name: "HTML error page served as 200",
    serve: (res) => { res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<html><body>502 Bad Gateway</body></html>"); },
    expect: "incomplete response" },

  { name: "valid JSON but the products key is missing",
    serve: (res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"ok":true}'); },
    expect: "unexpected response" },

  { name: "products is not an array",
    serve: (res) => { res.writeHead(200, { "Content-Type": "application/json" }); res.end('{"products":{}}'); },
    expect: "unexpected response" },

  { name: "401 reads as an expired session, not a parse failure",
    serve: (res) => { res.writeHead(401, { "Content-Type": "application/json" });
      res.end('{"error":"Unauthorized"}'); },
    expect: "Unauthorized" },

  { name: "500 with a non-JSON body still names the status",
    serve: (res) => { res.writeHead(500, { "Content-Type": "text/html" }); res.end("<html>oops</html>"); },
    expect: "HTTP 500" },

  { name: "HAPPY PATH: a normal response renders its rows",
    serve: (res) => { res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ products: [product("p1", "Strength Program", "published"),
                                          product("p2", "Hypertrophy Block", "draft")] })); },
    rows: 2 },

  { name: "HAPPY PATH: an empty list is an empty state, not an error",
    serve: (res) => { res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ products: [] })); },
    expect: "No products match your filters" },
];

let current = null;

const PAGE = `<!doctype html><html><body>
<div id="root">
  <input id="productSearch"><select id="statusFilter"><option value=""></option></select>
  <button id="createProductBtn"></button>
  <table><tbody id="productsTableBody"></tbody></table>
</div>
<script>
  // Enough of AdminUI for the Products panel to render; this test is about
  // api.js and the panel's response handling, not about the UI helpers.
  window.AdminUI = {
    skeletonRows: function(){ return '<tr class="skeleton"><td>loading</td></tr>'; },
    emptyState: function(icon,msg){ return '<div class="empty">'+msg+'</div>'; },
    toast: function(){}, confirmDialog: function(){ return Promise.resolve(false); },
    escapeHtml: function(v){ return String(v==null?"":v).replace(/[&<>"']/g,function(c){
      return {"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]; }); },
    formatCents: function(c){ return "$"+((c||0)/100).toFixed(2); },
    formatDate: function(d){ return String(d).slice(0,10); },
    animateRowsIn: function(){}, animateRowRemoval: function(){}, flashRow: function(){},
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

const server = http.createServer((req, res) => {
  const u = req.url.split("?")[0];
  if (u.startsWith("/api/admin/products")) return current.serve(res);
  const local = path.join(ROOT, u);
  if (u !== "/" && fs.existsSync(local)) {
    res.writeHead(200, { "Content-Type": "text/javascript" });
    return res.end(fs.readFileSync(local));
  }
  res.writeHead(200, { "Content-Type": "text/html" });
  res.end(PAGE);
});

(async () => {
  await new Promise((r) => server.listen(3403, r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true,
    args: ["--no-sandbox", "--disable-dev-shm-usage"] });

  let failed = 0;
  for (const sc of SCENARIOS) {
    current = sc;
    const page = await browser.newPage();
    const pageErrors = [];
    page.on("pageerror", (e) => pageErrors.push(e.message));
    await page.goto("http://localhost:3403/", { waitUntil: "domcontentloaded" });
    await new Promise((r) => setTimeout(r, 700));

    const state = await page.evaluate(() => ({
      text: document.getElementById("productsTableBody").textContent,
      html: document.getElementById("productsTableBody").innerHTML,
      rows: document.querySelectorAll("#productsTableBody tr").length,
      errors: window.__errors,
    }));
    await page.close();

    const problems = [];
    const uncaught = pageErrors.concat(state.errors);
    if (uncaught.length) problems.push("uncaught: " + JSON.stringify(uncaught));
    // The original defect, in the words it actually appeared in:
    if (/Cannot read properties of undefined/.test(state.text)) problems.push("undefined-property TypeError surfaced to the user");
    if (/skeleton/.test(state.html)) problems.push("stuck on the loading skeleton");
    if (sc.expect && state.text.indexOf(sc.expect) === -1) problems.push('expected to see "' + sc.expect + '", got: ' + JSON.stringify(state.text.trim().slice(0, 110)));
    if (sc.rows != null && state.rows !== sc.rows) problems.push("expected " + sc.rows + " rows, got " + state.rows);

    if (problems.length) { failed++; console.log("  FAIL  " + sc.name); problems.forEach((p) => console.log("        " + p)); }
    else console.log("  PASS  " + sc.name);
  }

  await browser.close(); server.close();
  console.log(failed ? "\n" + failed + " FAILED" : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
