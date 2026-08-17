// Fixtures for test-presentation-partner.js.
//
// Creates one partner profile and the four presentations that cover every
// valid combination of the two Content references, plus the two failure
// states that must degrade rather than break:
//
//   A  product only          — the pre-existing shape; must be untouched
//   B  partner only
//   C  product + partner
//   D  neither
//   E  partner selected but the profile is a DRAFT   -> section omitted
//   F  partner selected but the profile is DELETED   -> section omitted
//
// Idempotent, and scoped by a fixed slug prefix so cleanup can find its own
// rows and nothing else. Run against a throwaway schema — the house one is
// `?schema=builder_test`, never `public`.
//
//   node seed-presentation-partner-fixtures.js
//   node seed-presentation-partner-fixtures.js --clean
const path = require("path");
const SERVER = path.join(__dirname, "..", "server");
const { prisma } = require(path.join(SERVER, "src", "db.js"));

const PREFIX = "zztest-pp-";
const PARTNER_SLUG = PREFIX + "profile";
const DRAFT_PARTNER_SLUG = PREFIX + "draft";

const CASES = {
  A: PREFIX + "product-only",
  B: PREFIX + "partner-only",
  C: PREFIX + "both",
  D: PREFIX + "neither",
  E: PREFIX + "draft-partner",
  F: PREFIX + "dangling-partner",
};

async function clean() {
  await prisma.privatePresentation.deleteMany({ where: { slug: { startsWith: PREFIX } } });
  // Partner children cascade on delete (see schema.prisma).
  await prisma.partner.deleteMany({ where: { slug: { startsWith: PREFIX } } });
}

async function seed() {
  await clean();

  // Real, published catalog products — referenced by id, never copied. Any
  // three will do; the test asserts on what the live rows say, not on
  // hardcoded names.
  const products = await prisma.product.findMany({
    where: { status: "published" },
    select: { id: true, slug: true, name: true },
    orderBy: { createdAt: "asc" },
    take: 3,
  });
  if (products.length < 2) throw new Error("Need at least 2 published products in this schema");

  const partner = await prisma.partner.create({
    data: {
      slug: PARTNER_SLUG,
      displayName: "Fixture Partner",
      handle: "fixture_partner",
      partnerType: "athlete",
      bio: "Fixture profile used by test-presentation-partner.js.",
      status: "published",
      publishedAt: new Date(),
      accent: "brand",
      layout: "stack",
      ctaLabel: "Get the program",
      socials: {
        create: [
          { platform: "instagram", url: "https://www.instagram.com/fixture_partner", position: 0 },
          { platform: "youtube", url: "https://www.youtube.com/@fixture_partner", position: 1 },
        ],
      },
      links: {
        create: [
          { title: "Shop all training programs", url: "/shop", featured: true, icon: "cart", position: 0 },
          { title: "About Fitness Agency", url: "/about", featured: false, icon: "link", position: 1 },
        ],
      },
      products: {
        create: products.map((p, i) => ({ productId: p.id, featured: i === 0, position: i })),
      },
    },
  });

  const draftPartner = await prisma.partner.create({
    data: {
      slug: DRAFT_PARTNER_SLUG,
      displayName: "Fixture Draft Partner",
      partnerType: "coach",
      bio: "Unpublished on purpose.",
      status: "draft",
      links: { create: [{ title: "Secret draft link", url: "/shop", featured: true, icon: "link", position: 0 }] },
    },
  });

  function content(extra) {
    return {
      heroEyebrow: "Private Presentation",
      heroTitle: "Fitness Agency",
      heroSubtitle: "Fixture deck.",
      welcomeNote: "",
      featuredProductId: "",
      partnerProfileId: "",
      ctaPartnershipUrl: "",
      ctaMeetingUrl: "",
      ctaDemoUrl: "",
      ...extra,
    };
  }

  const rows = [
    [CASES.A, "A product only", content({ featuredProductId: products[0].id })],
    [CASES.B, "B partner only", content({ partnerProfileId: partner.id })],
    [CASES.C, "C both", content({ featuredProductId: products[0].id, partnerProfileId: partner.id })],
    [CASES.D, "D neither", content({})],
    [CASES.E, "E draft partner", content({ partnerProfileId: draftPartner.id })],
    // A partner id that does not resolve — the state left behind when a
    // partner is deleted after being attached.
    [CASES.F, "F dangling partner", content({ partnerProfileId: "cxxxxxxxxxxxxxxxxxxxxxxxx" })],
  ];

  for (const [slug, title, c] of rows) {
    await prisma.privatePresentation.create({
      data: { slug, title, status: "enabled", content: c },
    });
  }

  return {
    partnerId: partner.id,
    partnerSlug: partner.slug,
    draftPartnerId: draftPartner.id,
    productId: products[0].id,
    productName: products[0].name,
    cases: CASES,
  };
}

// Exported so the two tests can seed and tear down their own fixtures and
// therefore run unattended as part of `npm test`, rather than depending on a
// separate manual step having been run first against the right schema.
module.exports = { seed, clean, PREFIX, CASES };

if (require.main === module) {
  (async () => {
    if (process.argv.includes("--clean")) {
      await clean();
      console.log("fixtures removed");
      return;
    }
    console.log(JSON.stringify(await seed(), null, 2));
  })()
    .catch((err) => { console.error(err); process.exitCode = 1; })
    .finally(() => prisma.$disconnect());
}
