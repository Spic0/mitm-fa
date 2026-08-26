// Guards the public /demo sneak peek against leaking the paid program it
// previews.
//
// The demo opens ONE new door in an otherwise entitlement-gated router: the
// posters of the two exercises it shows become fetchable without a session.
// This test is the fence around that door. It runs the real library router,
// the real lib/demo.js slice and the real entitlements module against a fake
// database, because the whole design is that ONE slice function decides both
// what is serialized and what becomes fetchable — stubbing either side would
// test nothing.
//
// What must stay true forever:
//
//   THE ONLY THINGS AN ANONYMOUS VISITOR GAINS ARE THE STILLS OF THE
//   EXERCISES THE SERVER ITSELF CHOSE TO SHOW. NOT THE ANIMATIONS BEHIND
//   THEM, NOT THE ORIGINALS, NOT A THIRD EXERCISE, NOT ANOTHER PRODUCT,
//   AND NOT THE PROGRAM PAYLOAD.
//
//   cd tools && node test-demo-preview.js
const path = require("path");
const http = require("http");
const fs = require("fs");

const SERVER = path.join(__dirname, "..", "server");
const req = (rel) => require(path.join(SERVER, "src", "routes", rel));
const dep = (m) => require(require.resolve(m, { paths: [path.join(SERVER, "src", "routes")] }));
const express = dep("express");

const DEMO_ID = "demo-product-id";
const DEMO_SLUG = "demo-slug";
const OTHER_ID = "other-product-id";
const MEDIA_DIR = path.join(SERVER, "storage", "media", DEMO_ID);
const OTHER_MEDIA_DIR = path.join(SERVER, "storage", "media", OTHER_ID);

// Four exercises with media, of which the slice takes the first two. That gap
// is the point: EX3/EX4 exist, are in the same day of the same product, and
// must still 401.
const EX = ["ex1.gif", "ex2.gif", "ex3.gif", "ex4.gif"];

function exercise(i) {
  return {
    id: "ex" + i,
    name: "Exercise " + (i + 1),
    reps: "4x10",
    sets: "",
    notes: "Cue " + (i + 1),
    substitutions: "Alt " + (i + 1),
    mediaUrl: "/api/library/media/" + DEMO_ID + "/" + EX[i],
  };
}

const DEMO_PRODUCT = {
  id: DEMO_ID,
  slug: DEMO_SLUG,
  name: "Demo Program",
  status: "published",
  freeAccess: false,
  priceCents: 4999,
  creator: "A Creator",
  difficulty: "advanced",
  durationWeeks: 4,
  imageUrl: null,
  overview: "First paragraph.\n\nSecond paragraph that must not be sent.",
  nutritionContent: { meals: [{ id: "m1" }] },
  media: [],
  taxonomies: [],
  faqs: [],
  resources: [],
  trainingContent: {
    weeks: [
      {
        id: "w1",
        title: "Week 1",
        days: [
          { id: "d1", title: "Day 1", notes: "Day one brief", exercises: [exercise(0), exercise(1), exercise(2), exercise(3)] },
          { id: "d2", title: "Day 2", notes: "Day two brief", exercises: [exercise(0)] },
        ],
      },
      { id: "w2", title: "Week 2", days: [{ id: "d3", title: "Day 3", exercises: [exercise(0)] }] },
    ],
  },
};

// ---- Fake database -------------------------------------------------------
const prisma = {
  setting: { findUnique: async () => null },
  product: {
    findFirst: async ({ where }) => {
      const slug = where && where.slug;
      const or = where && where.OR;
      // isFreeAccess() filters on freeAccess:true. Honouring that here is what
      // makes this fixture a PAID product — an earlier version of this fake
      // ignored the flag, every gate answered "entitled", and the test passed
      // the things it exists to catch.
      if (where && where.freeAccess === true && !DEMO_PRODUCT.freeAccess) return null;
      if (slug) return slug === DEMO_SLUG && where.status === "published" ? DEMO_PRODUCT : null;
      if (or) {
        const wanted = or.map((c) => c.id || c.slug);
        if (wanted.includes(DEMO_ID) || wanted.includes(DEMO_SLUG)) return DEMO_PRODUCT;
      }
      return null;
    },
    findMany: async () => [DEMO_PRODUCT],
  },
  orderItem: { findFirst: async () => null },
  programProgress: { findUnique: async () => null, upsert: async () => ({}) },
};

require.cache[require.resolve(path.join(SERVER, "src", "db"))] = {
  id: "db", filename: "db", loaded: true, exports: { prisma },
};

// ---- Fixture files -------------------------------------------------------
// Real bytes on disk, because the media route stats the filesystem to decide
// whether a variant exists.
function writeFixtures() {
  fs.mkdirSync(MEDIA_DIR, { recursive: true });
  fs.mkdirSync(OTHER_MEDIA_DIR, { recursive: true });
  EX.forEach((f) => {
    const base = f.replace(/\.gif$/, "");
    fs.writeFileSync(path.join(MEDIA_DIR, f), "ORIGINAL-GIF-BYTES");
    fs.writeFileSync(path.join(MEDIA_DIR, base + "-poster.webp"), "POSTER");
    fs.writeFileSync(path.join(MEDIA_DIR, base + "-thumb.webp"), "THUMB");
    fs.writeFileSync(path.join(MEDIA_DIR, base + "-anim.webp"), "ANIM");
    fs.writeFileSync(path.join(MEDIA_DIR, base + ".json"), JSON.stringify({ animated: true, poster: true, thumb: true, anim: true }));
  });
  fs.writeFileSync(path.join(OTHER_MEDIA_DIR, "secret.gif"), "OTHER-PRODUCT-BYTES");
}
function cleanFixtures() {
  fs.rmSync(MEDIA_DIR, { recursive: true, force: true });
  fs.rmSync(OTHER_MEDIA_DIR, { recursive: true, force: true });
}

// ---- Server --------------------------------------------------------------
function boot() {
  const app = express();
  app.use((r, _res, next) => { r.user = null; next(); });
  app.use("/api/library", req("library"));
  app.use("/api/demo", req("demo"));
  return new Promise((resolve) => {
    const server = app.listen(0, () => resolve({ server, port: server.address().port }));
  });
}

function get(port, url) {
  return new Promise((resolve) => {
    http.get({ port, path: url }, (res) => {
      let body = "";
      res.on("data", (c) => { body += c; });
      res.on("end", () => resolve({ status: res.statusCode, body }));
    });
  });
}

let failures = 0;
function check(label, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures += 1;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${label}  (got ${actual}, expected ${expected})`);
}

(async () => {
  writeFixtures();
  const { server, port } = await boot();
  const M = (file, variant) =>
    `/api/library/media/${DEMO_ID}/${file}` + (variant ? `?variant=${variant}` : "");

  console.log("GET /api/demo — the payload itself");
  const demo = await get(port, "/api/demo");
  check("responds 200", demo.status, 200);
  const body = JSON.parse(demo.body);
  check("sends exactly 2 exercises", body.preview.exercises.length, 2);
  check("no trainingContent key anywhere", /trainingContent/.test(demo.body), false);
  check("no nutritionContent key anywhere", /nutritionContent/.test(demo.body), false);
  // The exercises that were NOT sliced must not appear under any key. This is
  // the check that catches "we filtered it in the renderer" regressions.
  check("exercise 3 absent from payload", /Exercise 3/.test(demo.body), false);
  check("exercise 4 absent from payload", /Exercise 4/.test(demo.body), false);
  check("second overview paragraph withheld", /must not be sent/.test(demo.body), false);
  check("locked counts reported", body.locked.exercisesInThisDay, 2);

  console.log("\nMedia — what the demo opens");
  check("sliced ex1 poster", (await get(port, M(EX[0], "poster"))).status, 200);
  check("sliced ex2 poster", (await get(port, M(EX[1], "poster"))).status, 200);
  check("sliced ex1 thumb", (await get(port, M(EX[0], "thumb"))).status, 200);

  console.log("\nMedia — what it must NOT open");
  check("sliced file, anim rendition", (await get(port, M(EX[0], "anim"))).status, 401);
  check("sliced file, no variant (original)", (await get(port, M(EX[0]))).status, 401);
  check("exercise 3 poster (same day)", (await get(port, M(EX[2], "poster"))).status, 401);
  check("exercise 4 poster (same day)", (await get(port, M(EX[3], "poster"))).status, 401);
  check("another product's media", (await get(port, `/api/library/media/${OTHER_ID}/secret.gif?variant=poster`)).status, 401);
  // Rejected, not "rejected with a particular code": the traversal attempt
  // fails the allowlist first and so never reaches the route's own basename
  // guard, which would have answered 400. Both are refusals; asserting the
  // 400 specifically would make this test fail if the outer gate got STRICTER.
  const traversal = await get(port, `/api/library/media/${DEMO_ID}/..%2F..%2Fsecret?variant=poster`);
  check("path traversal out of the media dir is refused", traversal.status >= 400, true);

  console.log("\nGET /api/demo/handbook — the viewer-shaped preview");
  const hb = await get(port, "/api/demo/handbook");
  check("responds 200", hb.status, 200);
  const hbBody = JSON.parse(hb.body);
  const weeks = hbBody.product.trainingContent.weeks;
  check("one week only", weeks.length, 1);
  check("one day only", weeks[0].days.length, 1);
  check("two exercises only", weeks[0].days[0].exercises.length, 2);
  check("exercise 3 absent from handbook payload", /Exercise 3/.test(hb.body), false);
  check("Week 2 absent from handbook payload", /Week 2/.test(hb.body), false);
  // "Day 2" IS allowed to appear — as a locked day TITLE, the same deliberate
  // teaser /api/demo sends. Its CONTENT must not.
  check("day 2's brief absent from handbook payload", /Day two brief/.test(hb.body), false);
  check("no nutritionContent in handbook payload", /nutritionContent/.test(hb.body), false);
  check("no anim/video renditions referenced", /variant=(anim|mp4|webm)/.test(hb.body), false);
  // The exercise media the payload references must be exactly the two stills
  // the /api/demo gate already opens — the handbook must not widen the
  // allowlist by a single file.
  const urls = (hb.body.match(/\/api\/library\/media\/[^"]+/g) || []);
  check("every referenced media url is a poster", urls.every((u) => /variant=poster$/.test(u)), true);
  check("no media beyond the sliced exercises is referenced", new Set(urls).size <= 2, true);
  check("locked counts ride along", hbBody.product.preview.locked.weeks, 1);
  check("preview CTA points at the product page", hbBody.product.preview.href, "/program/" + DEMO_SLUG);

  console.log("\nThe gated router is otherwise untouched");
  check("full program payload", (await get(port, `/api/library/program/${DEMO_SLUG}`)).status, 401);
  check("library listing", (await get(port, "/api/library/")).status, 401);
  check("orders", (await get(port, "/api/library/orders")).status, 401);

  server.close();
  cleanFixtures();
  console.log(failures ? `\n${failures} FAILED` : "\nAll demo-preview boundary checks passed");
  process.exit(failures ? 1 : 0);
})();
