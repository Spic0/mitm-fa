// Guards the free-access / unlisted product path.
//
// Two gates decide whether a prospect sees a program: GET /program/:id and
// GET /media/:id/:file. They call the SAME hasEntitlement, which is why this
// runs the real router and the real entitlements module together against a
// fake database — stubbing hasEntitlement would test nothing, since the whole
// design is that one function answers for both gates.
//
// What must stay true forever:
//
//   A FLAGGED PRODUCT IS READABLE LOGGED OUT. NOTHING ELSE IS.
//
//   cd tools && node test-free-access.js
const path = require("path");
const http = require("http");
const fs = require("fs");
const SERVER = path.join(__dirname, "..", "server");
const req = (rel) => require(path.join(SERVER, "src", "routes", rel));
const dep = (m) => require(require.resolve(m, { paths: [path.join(SERVER, "src", "routes")] }));
const express = dep("express");

const FREE_ID = "prod-free-id";
const FREE_SLUG = "elena-cho-strength-size-peak";
const PAID_ID = "prod-paid-id";
const MEDIA_DIR = path.join(SERVER, "storage", "media", FREE_ID);
const PAID_MEDIA_DIR = path.join(SERVER, "storage", "media", PAID_ID);

// One fake row store. `freeAccess` is the only thing that differs between the
// two products — same shape, same everything else — so a difference in outcome
// can only have come from the flag.
const PRODUCTS = [
  { id: FREE_ID, slug: FREE_SLUG, name: "Free", status: "unlisted", freeAccess: true },
  { id: PAID_ID, slug: "paid-product", name: "Paid", status: "published", freeAccess: false },
];

function matches(where, p) {
  if (where.freeAccess !== undefined && p.freeAccess !== where.freeAccess) return false;
  if (where.id !== undefined && p.id !== where.id) return false;
  if (where.OR) {
    const any = where.OR.some((c) => (c.id && c.id === p.id) || (c.slug && c.slug === p.slug));
    if (!any) return false;
  }
  return true;
}

const prisma = {
  product: {
    findFirst: async ({ where }) => {
      const hit = PRODUCTS.find((p) => matches(where, p));
      return hit ? { ...hit, faqs: [], resources: [], media: [], taxonomies: [], createdAt: new Date() } : null;
    },
  },
  // No orders exist at all, so every pass below is the flag's doing and never
  // a purchase's.
  orderItem: { findFirst: async () => null },
  programProgress: { findUnique: async () => null, upsert: () => ({ catch: () => {} }) },
};

function stub(rel, exports, fromDir) {
  const p = require.resolve(rel, { paths: [fromDir] });
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
const ROUTES_DIR = path.join(SERVER, "src", "routes");
const LIB_DIR = path.join(SERVER, "src", "lib");

stub("../db", { prisma }, ROUTES_DIR);
stub("../db", { prisma }, LIB_DIR);
// The REAL requireAuth semantics: 401 unless a session was attached.
stub("../middleware/auth", {
  requireAuth: (rq, rs, next) => (rq.user ? next() : rs.status(401).json({ error: "Not authenticated" })),
}, ROUTES_DIR);
stub("../middleware/rateLimit", { apiLimiter: (_rq, _rs, next) => next() }, ROUTES_DIR);
stub("../lib/adminLog", { logEvent: () => {} }, ROUTES_DIR);

// Mirror production, where the flag is on.
process.env.MEDIA_X_ACCEL = "true";

const router = req("./library.js");
const app = express();
// `session` drives who the caller is: null = logged out prospect.
let session = null;
app.use((rq, _rs, next) => { if (session) rq.user = session; next(); });
app.use("/api/library", router);

function call(port, method, url) {
  return new Promise((resolve) => {
    const r = http.request({ port, path: url, method }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.end();
  });
}

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

(async () => {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.mkdirSync(PAID_MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(MEDIA_DIR, "demo.gif"), "GIF89a-free");
  fs.writeFileSync(path.join(PAID_MEDIA_DIR, "demo.gif"), "GIF89a-paid");

  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = server.address().port;

  // ---------------- logged out, the flagged product ----------------
  session = null;
  const prog = await call(port, "GET", `/api/library/program/${FREE_SLUG}`);
  check("guest: program payload loads with NO order", prog.status === 200, prog.status);
  let parsed = {};
  try { parsed = JSON.parse(prog.body); } catch (e) { /* reported by the check above */ }
  check("guest: NOT flagged as admin preview (sees it as a customer does)",
    parsed.preview === false, parsed.preview);
  check("guest: no purchase date invented", parsed.purchasedAt === null, parsed.purchasedAt);
  check("guest: progress is the empty shape, not null",
    !!parsed.progress && Array.isArray(parsed.progress.completedKeys), parsed.progress);

  const media = await call(port, "GET", `/api/library/media/${FREE_ID}/demo.gif`);
  check("guest: media for the flagged product is authorized",
    media.status === 200 && !!media.headers["x-accel-redirect"],
    { status: media.status, accel: media.headers["x-accel-redirect"] });

  // ---------------- logged out, ANY other product ----------------
  // The scope test. Same guest, same session, one character different in the
  // URL — this is what stops the flag becoming a skeleton key.
  const otherMedia = await call(port, "GET", `/api/library/media/${PAID_ID}/demo.gif`);
  check("guest: media for a DIFFERENT paid product is refused",
    otherMedia.status === 401, otherMedia.status);
  const otherProg = await call(port, "GET", `/api/library/program/${PAID_ID}`);
  check("guest: program for a DIFFERENT paid product is refused",
    otherProg.status === 401, otherProg.status);

  // ---------------- logged out, everything else in the router ----------------
  const list = await call(port, "GET", "/api/library/");
  check("guest: the library listing is still refused", list.status === 401, list.status);
  const orders = await call(port, "GET", "/api/library/orders");
  check("guest: the orders list is still refused", orders.status === 401, orders.status);
  const write = await call(port, "POST", `/api/library/program/${FREE_ID}/progress`);
  check("guest: progress WRITES are refused even on the flagged product",
    write.status === 401, write.status);
  // Requirement: the signed short-lived token path is untouched.
  const token = await call(port, "GET", "/api/library/download/media/some.token.value");
  check("guest: the signed token download path is untouched and still refused",
    token.status === 401, token.status);
  const resource = await call(port, "GET", `/api/library/resource/anything`);
  check("guest: resource downloads are still refused", resource.status === 401, resource.status);

  // ---------------- a real logged-in customer who owns nothing ----------------
  session = { id: "u1", role: "customer" };
  const userFree = await call(port, "GET", `/api/library/program/${FREE_SLUG}`);
  check("customer with no order: flagged product loads", userFree.status === 200, userFree.status);
  const userPaid = await call(port, "GET", `/api/library/program/${PAID_ID}`);
  check("customer with no order: paid product still 403", userPaid.status === 403, userPaid.status);
  const userPaidMedia = await call(port, "GET", `/api/library/media/${PAID_ID}/demo.gif`);
  check("customer with no order: paid product MEDIA still 403",
    userPaidMedia.status === 403, userPaidMedia.status);

  server.close();
  fs.rmSync(MEDIA_DIR, { recursive: true, force: true });
  fs.rmSync(PAID_MEDIA_DIR, { recursive: true, force: true });

  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    if (!r.pass) console.log("        got:", JSON.stringify(r.detail));
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})();
