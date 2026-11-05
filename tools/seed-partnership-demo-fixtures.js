// Fixtures for test-partnership-demo.js: the demo routes the /partnership
// viewer frames (server/src/lib/partnership.js DEMO_TABS) do not exist in
// builder_test, so this creates them there: a fictional partner at
// /partners/elena-cho, the program at /program/elena-cho-strength-size-peak
// with a small training slice, and Setting.demoProductSlug so /demo previews it.
// Refuses anything but builder_test. Rows are found again by slug/key.
//
//   node seed-partnership-demo-fixtures.js
//   node seed-partnership-demo-fixtures.js --clean
const path = require("path");
if (!/schema=builder_test/.test(process.env.DATABASE_URL || "")) {
  console.error("refusing: DATABASE_URL is not ?schema=builder_test");
  process.exit(1);
}
const { prisma } = require(path.join(__dirname, "..", "server", "src", "db.js"));
const PSLUG = "elena-cho";
const SLUG = "elena-cho-strength-size-peak";

async function clean() {
  await prisma.partner.deleteMany({ where: { slug: PSLUG } });
  await prisma.product.deleteMany({ where: { slug: SLUG } });
  await prisma.setting.deleteMany({ where: { key: "demoProductSlug" } });
}

function ex(i) {
  return { id: "ex" + i, name: ["Back Squat", "Romanian Deadlift", "Bench Press"][i], reps: "4x8", sets: "", notes: "Controlled tempo.", substitutions: "" };
}

(async () => {
  await clean();
  if (process.argv.includes("--clean")) return console.log("cleaned");
  const product = await prisma.product.create({
    data: {
      slug: SLUG,
      name: "Strength & Size Peak",
      priceCents: 4999,
      status: "published",
      creator: "Elena Cho",
      difficulty: "advanced",
      durationWeeks: 10,
      overview: "A ten-week strength and size block.\n\nSecond paragraph.",
      trainingContent: {
        weeks: [
          { id: "w1", title: "Week 1", days: [{ id: "d1", title: "Day 1", notes: "Lower body", exercises: [ex(0), ex(1), ex(2)] }] },
          { id: "w2", title: "Week 2", days: [{ id: "d2", title: "Day 1", notes: "Upper body", exercises: [ex(2)] }] },
        ],
      },
    },
  });
  await prisma.setting.create({ data: { key: "demoProductSlug", value: SLUG } });
  const others = await prisma.product.findMany({ where: { status: "published", NOT: { slug: SLUG } }, select: { id: true }, take: 2 });
  await prisma.partner.create({
    data: {
      slug: PSLUG,
      displayName: "Elena Cho",
      handle: "elenacho",
      partnerType: "athlete",
      bio: "Fictional demo creator (test fixture).",
      status: "published",
      publishedAt: new Date(),
      accent: "brand",
      layout: "stack",
      ctaLabel: "Get the program",
      links: { create: [{ title: "Shop all training programs", url: "/shop", featured: true, icon: "cart", position: 0 }] },
      products: { create: [product, ...others].map((p, i) => ({ productId: p.id, featured: i === 0, position: i })) },
    },
  });
  console.log("seeded", PSLUG, SLUG);
})()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
