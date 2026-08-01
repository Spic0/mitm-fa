// Proves the X-Accel-Redirect offload for gated program media hands the file
// to nginx WITHOUT weakening the entitlement check that made it safe to serve.
//
// The offload is the whole point of the change: a demo GIF used to cost two
// authenticated round trips (mint a token, then redeem it) and stream its
// bytes out of Node. With MEDIA_X_ACCEL=true the first request authorizes and
// then names an `internal` nginx location, so nginx serves the file directly.
//
// The risk that buys is obvious and worth a test: an accel response is an
// empty 200 whose only meaningful content is a header. Get the guard order
// wrong and it becomes an empty 200 that names a file the caller never earned
// — a paywall bypass that looks like a passing page in a browser, because the
// image still renders. So the cases below check both halves: that an entitled
// caller gets the header, and that every caller who would previously have been
// refused still is, before any header is written.
//
// Runs the REAL router with the DB, session and entitlement layers stubbed —
// there is no database in this test, only the routing and guard logic.
//
//   cd tools && npm install && node test-media-x-accel.js
const fs = require("fs"), path = require("path"), http = require("http");

// The flag-off case still mints a real signed token, which refuses to run
// without a secret. Any value works — nothing here verifies a signature.
process.env.CSRF_SECRET = process.env.CSRF_SECRET || "test-secret-for-x-accel-cases";

const SERVER = path.join(__dirname, "..", "server");
const req = (m) => require(require.resolve(m, { paths: [path.join(SERVER, "src", "routes")] }));
const express = req("express");

const PRODUCT = "test-accel-product";
const MEDIA_DIR = path.join(SERVER, "storage", "media", PRODUCT);

// Stub every module library.js pulls in that would otherwise need a database.
// `entitled` is flipped per-case to drive the authorization branches.
const state = { entitled: true, role: "customer" };
function stub(rel, exports) {
  const p = require.resolve(rel, { paths: [path.join(SERVER, "src", "routes")] });
  require.cache[p] = { id: p, filename: p, loaded: true, exports };
}
stub("../db", { prisma: {} });
stub("../middleware/auth", {
  requireAuth: (rq, _rs, next) => { rq.user = { id: "u1", role: state.role }; next(); },
});
stub("../middleware/rateLimit", { apiLimiter: (_rq, _rs, next) => next() });
stub("../lib/entitlements", { hasEntitlement: async () => state.entitled });
stub("../lib/adminLog", { logEvent: () => {} });

const router = req("./library.js");
const app = express();
app.use("/api/library", router);

function get(port, url) {
  return new Promise((resolve) => {
    http.get({ port, path: url }, (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
  });
}

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

(async () => {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.writeFileSync(path.join(MEDIA_DIR, "demo.gif"), "GIF89a-original-bytes");
  fs.writeFileSync(path.join(MEDIA_DIR, "demo-poster.webp"), "poster-bytes");
  fs.writeFileSync(path.join(MEDIA_DIR, "icon.svg"), "<svg/>");

  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const port = server.address().port;
  const base = `/api/library/media/${PRODUCT}`;

  // ---- flag OFF: the token path must be completely untouched ----
  const off = await get(port, `${base}/demo.gif`);
  check("flag off -> still 302 to the signed token path",
    off.status === 302 && /^\/api\/library\/download\/media\/.+/.test(off.headers.location || ""),
    { status: off.status, location: off.headers.location });
  check("flag off -> no accel header leaks out", !off.headers["x-accel-redirect"], off.headers);

  // ---- flag ON ----
  // The route reads the flag at module load, so re-require it in a fresh
  // cache rather than pretending a live toggle works.
  process.env.MEDIA_X_ACCEL = "true";
  for (const k of Object.keys(require.cache)) {
    if (k.endsWith(path.join("src", "routes", "library.js"))) delete require.cache[k];
  }
  const accelApp = express();
  accelApp.use("/api/library", req("./library.js"));
  const accelServer = accelApp.listen(0);
  await new Promise((r) => accelServer.once("listening", r));
  const ap = accelServer.address().port;

  const on = await get(ap, `${base}/demo.gif`);
  check("flag on -> 200 with X-Accel-Redirect", on.status === 200 &&
    on.headers["x-accel-redirect"] === `/internal-media/${PRODUCT}/demo.gif`,
    { status: on.status, accel: on.headers["x-accel-redirect"] });
  check("flag on -> Node sends NO media bytes", on.body.length === 0 && !on.body.includes("original"),
    { bodyLength: on.body.length });
  check("flag on -> no redirect hop at all", !on.headers.location, on.headers);
  check("flag on -> still privately cached", on.headers["cache-control"] === "private, max-age=60",
    on.headers["cache-control"]);

  // Variant resolution has to survive the offload: the poster is the entire
  // reason the page costs 12KB instead of 15MB.
  const poster = await get(ap, `${base}/demo.gif?variant=poster`);
  check("flag on -> ?variant=poster still resolves to the derivative",
    poster.headers["x-accel-redirect"] === `/internal-media/${PRODUCT}/demo-poster.webp`,
    poster.headers["x-accel-redirect"]);

  // A variant that was never generated must fall back, not 404.
  const anim = await get(ap, `${base}/demo.gif?variant=anim`);
  check("flag on -> missing variant falls back to the original",
    anim.headers["x-accel-redirect"] === `/internal-media/${PRODUCT}/demo.gif`,
    anim.headers["x-accel-redirect"]);

  // SVG stays sandboxed even though nginx, not Node, emits the bytes.
  const svg = await get(ap, `${base}/icon.svg`);
  check("flag on -> SVG keeps its CSP sandbox",
    /sandbox/.test(svg.headers["content-security-policy"] || "") &&
    svg.headers["x-content-type-options"] === "nosniff", svg.headers);

  // ---- the guards that must NOT be bypassed ----
  state.entitled = false;
  state.role = "customer";
  const forbidden = await get(ap, `${base}/demo.gif`);
  check("flag on -> unentitled user still 403", forbidden.status === 403, forbidden.status);
  check("flag on -> unentitled user gets NO accel header",
    !forbidden.headers["x-accel-redirect"], forbidden.headers);

  state.role = "admin";
  const admin = await get(ap, `${base}/demo.gif`);
  check("flag on -> admin without entitlement still previews",
    admin.status === 200 && !!admin.headers["x-accel-redirect"], admin.status);

  state.entitled = true;
  state.role = "customer";
  const traversal = await get(ap, `${base}/..%2f..%2f.env`);
  check("flag on -> path traversal still rejected",
    traversal.status === 400 && !traversal.headers["x-accel-redirect"],
    { status: traversal.status, accel: traversal.headers["x-accel-redirect"] });

  server.close(); accelServer.close();
  fs.rmSync(MEDIA_DIR, { recursive: true, force: true });

  let failed = 0;
  for (const r of results) {
    if (!r.pass) failed++;
    console.log(`  ${r.pass ? "PASS" : "FAIL"}  ${r.name}`);
    if (!r.pass) console.log("        ", JSON.stringify(r.detail));
  }
  console.log(failed ? `\n${failed} FAILED` : "\nALL PASSED");
  process.exit(failed ? 1 : 0);
})();
