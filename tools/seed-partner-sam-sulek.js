// Seeds the Sam Sulek partner profile used to exercise the Partner Profiles
// feature end to end.
//
// EVERY value below comes from data already in this platform:
//   - the display name and partner type come from Product.creator on
//     "Sam Sulek Strength & Size Peak" (slug sulek-strength-size-peak);
//   - the bio is written strictly from that product's own description
//     (high-volume style, progressive overload, structured recovery) and
//     asserts nothing else about him;
//   - the products are real published catalog rows, referenced BY ID through
//     PartnerProduct — no product data is copied onto the profile;
//   - the custom links point only at routes this site actually serves.
//
// Social links are deliberately EMPTY. No social URL for this person exists
// anywhere in the codebase, the database or the settings table, and guessing
// a real person's handles onto a published page is not something to do on a
// hunch. The feature supports them fully; this profile just has none until a
// human supplies them.
//
// Idempotent: re-running updates the same profile rather than creating a
// second one.
// tools/ has its own package.json and does NOT depend on @prisma/client
// directly — the client lives in server/node_modules. Going through the
// server's own db.js also picks up its dotenv config, so this script talks to
// exactly the same database the app does with no duplicated connection setup.
const path = require("path");
const SERVER = path.join(__dirname, "..", "server");
const { prisma } = require(path.join(SERVER, "src", "db.js"));

const SLUG = "sam-sulek";

// Featured first, then supporting programs. Referenced by SLUG here purely so
// this script is readable — each is resolved to a real Product id below and
// stored as a foreign key.
const FEATURED_PRODUCT_SLUG = "sulek-strength-size-peak";
const SUPPORTING_PRODUCT_SLUGS = ["advanced-powerlifting-peak", "lean-bulk-blueprint"];

const LINKS = [
  {
    title: "Shop all training programs",
    url: "/shop",
    description: "Every plan on Fitness Agency",
    icon: "cart",
    featured: true,
  },
  {
    title: "Gain Muscle plans",
    url: "/goal/gain-muscle",
    description: "Hypertrophy-focused programming",
    icon: "dumbbell",
    featured: false,
  },
  {
    title: "Strength plans",
    url: "/goal/strength",
    description: "Build maximal strength",
    icon: "dumbbell",
    featured: false,
  },
  {
    title: "Partner with Fitness Agency",
    url: "/services/partner-services",
    description: "How we work with athletes and creators",
    icon: "star",
    featured: false,
  },
  {
    title: "About Fitness Agency",
    url: "/about",
    description: "Who we are and how the platform works",
    icon: "link",
    featured: false,
  },
];

async function main() {
  const featured = await prisma.product.findUnique({
    where: { slug: FEATURED_PRODUCT_SLUG },
    select: { id: true, name: true, status: true, imageUrl: true },
  });
  if (!featured) throw new Error(`Featured product "${FEATURED_PRODUCT_SLUG}" not found`);
  if (featured.status !== "published") {
    throw new Error(`Featured product "${FEATURED_PRODUCT_SLUG}" is ${featured.status}, not published`);
  }

  const supporting = [];
  for (const slug of SUPPORTING_PRODUCT_SLUGS) {
    const p = await prisma.product.findUnique({
      where: { slug },
      select: { id: true, name: true, status: true },
    });
    if (!p) {
      console.warn(`  ! supporting product "${slug}" not found — skipping`);
      continue;
    }
    if (p.status !== "published") {
      console.warn(`  ! supporting product "${slug}" is ${p.status} — skipping`);
      continue;
    }
    supporting.push(p);
  }

  const core = {
    displayName: "Sam Sulek",
    handle: "samsulek",
    partnerType: "athlete",
    // Derived only from the product description already stored on the
    // platform. No achievements, follower counts, titles or claims.
    bio:
      "High-volume training built on progressive overload and structured recovery. " +
      "Sam's 10-week advanced strength and hypertrophy program is available on Fitness Agency.",
    // No profile image. There is no cleared photograph of this person in the
    // platform, and the program cover is a 3:4 poster — circle-cropped into a
    // 96px avatar it shows a slice of title text and reads as a broken image
    // rather than a portrait. The profile falls back to initials on a brand
    // surface, which is a deliberate-looking mark. Upload a real headshot in
    // Admin -> Partner Profiles -> Basic Information to replace it.
    avatarUrl: null,
    websiteUrl: null,
    ctaLabel: "Get the program",
    accent: "brand",
    layout: "stack",
    metaDescription:
      "Sam Sulek on Fitness Agency — the 10-week advanced strength and hypertrophy program, plus every official link in one place.",
  };

  const existing = await prisma.partner.findUnique({ where: { slug: SLUG } });

  const partner = existing
    ? await prisma.partner.update({ where: { id: existing.id }, data: core })
    : await prisma.partner.create({ data: { ...core, slug: SLUG, status: "draft" } });

  // Replace child collections wholesale, exactly like the admin API does.
  await prisma.$transaction(async (tx) => {
    await tx.partnerProduct.deleteMany({ where: { partnerId: partner.id } });
    await tx.partnerLink.deleteMany({ where: { partnerId: partner.id } });
    // Socials intentionally left empty — see the header note.
    await tx.partnerSocial.deleteMany({ where: { partnerId: partner.id } });

    await tx.partnerProduct.create({
      data: { partnerId: partner.id, productId: featured.id, featured: true, position: 0 },
    });
    for (let i = 0; i < supporting.length; i++) {
      await tx.partnerProduct.create({
        data: { partnerId: partner.id, productId: supporting[i].id, featured: false, position: i + 1 },
      });
    }

    for (let i = 0; i < LINKS.length; i++) {
      const l = LINKS[i];
      await tx.partnerLink.create({
        data: {
          partnerId: partner.id,
          title: l.title,
          url: l.url,
          description: l.description,
          icon: l.icon,
          featured: l.featured,
          position: i,
        },
      });
    }
  });

  // Publish last, so the profile is never briefly live in a half-built state.
  const published = await prisma.partner.update({
    where: { id: partner.id },
    data: { status: "published", publishedAt: partner.publishedAt || new Date() },
  });

  console.log(`${existing ? "Updated" : "Created"} partner profile:`);
  console.log(`  name      : ${published.displayName}`);
  console.log(`  status    : ${published.status}`);
  console.log(`  public URL: /partners/${published.slug}`);
  console.log(`  featured  : ${featured.name}`);
  supporting.forEach((p) => console.log(`  product   : ${p.name}`));
  console.log(`  links     : ${LINKS.length}`);
  console.log(`  socials   : 0 (none exist in the platform — supply real URLs in the admin)`);
}

main()
  .catch((err) => {
    console.error(err.message);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
