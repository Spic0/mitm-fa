const crypto = require("crypto");
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient();

// Products replaced from the old 6 (shared $49 price, generic copy, no
// category/featured set) with 10 real, varied products used throughout the
// storefront, checkout, library, and analytics.
const PRODUCTS = [
  {
    slug: "12-week-strength-foundations",
    name: "12-Week Strength Foundations",
    priceCents: 5900,
    category: "Strength Training",
    creator: "Marcus Reyes",
    platform: "youtube",
    sport: "football",
    featured: true,
    imageUrl: "assets/images/product/demo/12-week-strength-foundations.svg",
    description: "A 12-week strength program built around the big compound lifts, with clear progression targets each week so you always know exactly how much weight to load.",
    pdfSections: [
      {
        heading: "Overview",
        paragraphs: [
          "This program is built for lifters who want a straightforward path to getting stronger on the squat, bench press, deadlift, and overhead press. Each of the 12 weeks has a specific volume and intensity target, so there's no guesswork about what to do in the gym.",
        ],
      },
      {
        heading: "Weekly Schedule",
        paragraphs: [
          "Training runs 4 days per week on an upper/lower split. Weeks 1-4 focus on building a base of work capacity, weeks 5-8 shift toward heavier top sets, and weeks 9-12 taper volume while intensity peaks toward new personal records.",
        ],
      },
      {
        heading: "Getting Started",
        paragraphs: [
          "Before week 1, test your current 5-rep max on each main lift so the program's percentages are calibrated to you. Track every session in the included log and adjust down slightly on any week where the prescribed weight feels like more than an RPE 8.",
        ],
      },
    ],
  },
  {
    slug: "fat-loss-accelerator-pro",
    name: "Fat Loss Accelerator",
    priceCents: 4900,
    category: "Fat Loss",
    creator: "Elena Cho",
    platform: "instagram",
    sport: "mma",
    featured: true,
    imageUrl: "assets/images/product/demo/fat-loss-accelerator-pro.svg",
    description: "A high-intensity training and nutrition plan designed to accelerate fat loss while preserving as much muscle as possible.",
    pdfSections: [
      {
        heading: "Overview",
        paragraphs: [
          "Fat Loss Accelerator pairs metabolic conditioning workouts with a structured calorie deficit so you lose fat quickly without your strength collapsing. It's built for people who already have some training experience and want a focused 8-week block.",
        ],
      },
      {
        heading: "Weekly Schedule",
        paragraphs: [
          "Five sessions per week: three full-body strength days to protect muscle mass, plus two shorter conditioning days combining intervals and circuits. Rest days include a short mobility routine to keep recovery on track.",
        ],
      },
      {
        heading: "Getting Started",
        paragraphs: [
          "Start by calculating your daily calorie target using the formula in Chapter 1, then log your weight three times a week and adjust intake if the average trend stalls for more than 10 days.",
        ],
      },
    ],
  },
  {
    slug: "lean-bulk-blueprint",
    name: "Lean Bulk Blueprint",
    priceCents: 5900,
    category: "Muscle Building",
    creator: "Derrick Owens",
    platform: "youtube",
    sport: "basketball",
    featured: false,
    imageUrl: "assets/images/product/demo/lean-bulk-blueprint.svg",
    description: "A structured lean-bulking program pairing progressive overload with a calorie-surplus meal plan built to add muscle without excess fat.",
    pdfSections: [
      {
        heading: "Overview",
        paragraphs: [
          "Lean Bulk Blueprint is a 16-week hypertrophy-focused program for lifters who want to add real muscle while keeping fat gain to a minimum. Training volume is built up gradually block by block.",
        ],
      },
      {
        heading: "Weekly Schedule",
        paragraphs: [
          "A 5-day push/pull/legs split with an extra arm-focused accessory day. Each 4-week block increases either sets or load, never both at once, so recovery stays manageable.",
        ],
      },
      {
        heading: "Getting Started",
        paragraphs: [
          "Set your surplus at roughly 10% above maintenance calories using the worksheet provided, and re-check your maintenance number every 4 weeks as your weight increases.",
        ],
      },
    ],
  },
  {
    slug: "30-day-nutrition-reset",
    name: "30-Day Nutrition Reset",
    priceCents: 3900,
    category: "Nutrition & Diet",
    creator: "Priya Nair",
    platform: "instagram",
    sport: "boxing",
    featured: false,
    imageUrl: "assets/images/product/demo/30-day-nutrition-reset.svg",
    description: "A 30-day nutrition reset with daily meal plans and simple habit checklists to build sustainable healthy-eating patterns.",
    pdfSections: [
      {
        heading: "Overview",
        paragraphs: [
          "This guide is meant to reset your relationship with food over 30 days using real meal plans, not restrictive rules. Each week introduces one new habit on top of the last.",
        ],
      },
      {
        heading: "Weekly Schedule",
        paragraphs: [
          "Week 1 focuses on consistent meal timing, week 2 on protein at every meal, week 3 on vegetable intake, and week 4 on building your own meals from the included templates.",
        ],
      },
      {
        heading: "Getting Started",
        paragraphs: [
          "Print the daily checklist from the appendix and place it somewhere visible. Each morning, plan your three main meals from the week's template before the day gets busy.",
        ],
      },
    ],
  },
  {
    slug: "advanced-powerlifting-peak",
    name: "Advanced Powerlifting Peak",
    priceCents: 7900,
    category: "Powerlifting",
    creator: "Big Sam Coleman",
    platform: "youtube",
    sport: "boxing",
    featured: false,
    imageUrl: "assets/images/product/demo/advanced-powerlifting-peak.svg",
    description: "An advanced squat/bench/deadlift peaking program for experienced lifters preparing to hit new competition or gym maxes.",
    pdfSections: [
      {
        heading: "Overview",
        paragraphs: [
          "Peak is a 10-week block for lifters who already squat, bench, and deadlift with solid technique and want to convert a training max into a true 1-rep max, meet-ready or not.",
        ],
      },
      {
        heading: "Weekly Schedule",
        paragraphs: [
          "Training is 4 days a week with one competition-lift focus per session. Volume drops steadily from week to week while intensity climbs toward two final testing weeks.",
        ],
      },
      {
        heading: "Getting Started",
        paragraphs: [
          "Enter your current true 1-rep maxes into the calculator in Chapter 1 before starting - the entire program's loading is calculated as a percentage of those numbers, so accuracy here matters more than anywhere else in the plan.",
        ],
      },
    ],
  },
  {
    slug: "keto-macros-playbook",
    name: "Keto Macros Playbook",
    priceCents: 3900,
    category: "Nutrition & Diet",
    creator: "Nadia Fischer",
    platform: "tiktok",
    sport: "boxing",
    featured: true,
    imageUrl: "assets/images/product/demo/keto-macros-playbook.svg",
    description: "A complete ketogenic nutrition guide with macro targets, meal templates, and a 4-week grocery list.",
    pdfSections: [
      {
        heading: "Overview",
        paragraphs: [
          "This playbook walks you through setting up a ketogenic diet correctly from day one: how to calculate your fat, protein, and carb targets, which foods to prioritize, and how to get through the first-week adjustment period.",
        ],
      },
      {
        heading: "Weekly Schedule",
        paragraphs: [
          "Weeks 1-2 use fixed meal templates to remove decision fatigue while your body adapts. Weeks 3-4 introduce a rotating list of approved meals so you can start building your own combinations.",
        ],
      },
      {
        heading: "Getting Started",
        paragraphs: [
          "Use the macro calculator in Chapter 1 to set your daily fat, protein, and net-carb targets, then follow the Week 1 grocery list exactly as written for the smoothest transition into ketosis.",
        ],
      },
    ],
  },
  {
    slug: "beginner-full-body-kickstart",
    name: "Beginner Full-Body Kickstart",
    priceCents: 2900,
    category: "Beginner",
    creator: "Jordan Blake",
    platform: "tiktok",
    sport: "football",
    featured: true,
    imageUrl: "assets/images/product/demo/beginner-full-body-kickstart.svg",
    description: "A simple, no-nonsense full-body program for anyone starting strength training for the first time.",
    pdfSections: [
      {
        heading: "Overview",
        paragraphs: [
          "Full-Body Kickstart is built for complete beginners. Every exercise includes a plain-language explanation of proper form, and the program deliberately avoids anything overly technical for the first 8 weeks.",
        ],
      },
      {
        heading: "Weekly Schedule",
        paragraphs: [
          "Three full-body sessions per week with a day of rest between each. Every session uses the same core movements so you can focus on getting the technique right before adding complexity.",
        ],
      },
      {
        heading: "Getting Started",
        paragraphs: [
          "Start with the lightest weight that lets you complete every rep with good form - the program's job for the first two weeks is to teach movement patterns, not to test your limits.",
        ],
      },
    ],
  },
  {
    slug: "bodyweight-mastery",
    name: "Bodyweight Mastery",
    priceCents: 3900,
    category: "Bodyweight & Mobility",
    creator: "Amara Chen",
    platform: "instagram",
    sport: "basketball",
    featured: false,
    imageUrl: "assets/images/product/demo/bodyweight-mastery.svg",
    description: "A progressive bodyweight training program that builds strength and control with zero equipment required.",
    pdfSections: [
      {
        heading: "Overview",
        paragraphs: [
          "Bodyweight Mastery takes you from basic push-ups and squats through to advanced skills like pistol squats and pull-up progressions, using a structured progression model instead of guessing when you're ready to advance.",
        ],
      },
      {
        heading: "Weekly Schedule",
        paragraphs: [
          "Four sessions per week alternating between push-focused, pull-focused, leg-focused, and full-body/mobility days. Each exercise has 3-4 progression levels so you always have a next step.",
        ],
      },
      {
        heading: "Getting Started",
        paragraphs: [
          "Complete the assessment in Chapter 1 for each movement category to find your correct starting progression level - starting too advanced is the most common reason bodyweight programs stall.",
        ],
      },
    ],
  },
  {
    slug: "marathon-ready-runners-plan",
    name: "Marathon-Ready Runner's Plan",
    priceCents: 4900,
    category: "Endurance",
    creator: "Tom Whitfield",
    platform: "youtube",
    sport: "football",
    featured: false,
    imageUrl: "assets/images/product/demo/marathon-ready-runners-plan.svg",
    description: "A 16-week marathon training plan covering base building, speed work, and taper, for runners targeting their first or fastest marathon.",
    pdfSections: [
      {
        heading: "Overview",
        paragraphs: [
          "This plan takes a runner with an existing base of at least 15 miles per week through a full 16-week marathon build, balancing easy mileage, tempo runs, and long runs so fitness builds without injury.",
        ],
      },
      {
        heading: "Weekly Schedule",
        paragraphs: [
          "Four to five runs per week: one long run, one tempo or interval session, and the rest as easy recovery mileage. Long runs build steadily every week with a shorter recovery week every fourth week.",
        ],
      },
      {
        heading: "Getting Started",
        paragraphs: [
          "Confirm you can comfortably run 15 miles per week before starting week 1, and always run your easy days genuinely easy - most runners' biggest limiter is running recovery runs too fast.",
        ],
      },
    ],
  },
  {
    slug: "post-injury-mobility-recovery",
    name: "Post-Injury Mobility & Recovery",
    priceCents: 3900,
    category: "Mobility & Recovery",
    creator: "Dr. Lisa Moreno",
    platform: "instagram",
    sport: "mma",
    featured: false,
    imageUrl: "assets/images/product/demo/post-injury-mobility-recovery.svg",
    description: "A gentle mobility and recovery program designed to help you rebuild movement quality and confidence after time off from training.",
    pdfSections: [
      {
        heading: "Overview",
        paragraphs: [
          "This program is for anyone returning to training after an injury, illness, or extended break. It prioritizes restoring full pain-free range of motion before reintroducing any real training load.",
        ],
      },
      {
        heading: "Weekly Schedule",
        paragraphs: [
          "Daily 20-30 minute sessions combining mobility drills, light activation work, and gradually increasing bodyweight movement. Intensity increases only every two weeks, not every session.",
        ],
      },
      {
        heading: "Getting Started",
        paragraphs: [
          "Read the guidance in Chapter 1 on when it's appropriate to start this program, and check with a medical professional first if you're returning from a diagnosed injury rather than general deconditioning.",
        ],
      },
    ],
  },
];

// The 6 previous placeholder products. They already have real demo Order
// history against them (seeded by seedDemo.js) and OrderItem->Product has no
// cascade delete, so they're archived (hidden from the storefront, which
// already filters to status:"published") rather than deleted, keeping
// existing order/analytics history intact.
const OLD_SLUGS = [
  "12-week-strength-builder",
  "fat-loss-accelerator",
  "clean-bulk-program",
  "30-day-kickstart-diet",
  "advanced-powerlifting-plan",
  "keto-nutrition-guide",
];

function sectionText(product, heading) {
  const section = product.pdfSections.find((s) => s.heading === heading);
  return section ? section.paragraphs.join("\n\n") : null;
}

function isNutritionCategory(category) {
  return /nutrition|diet/i.test(category || "");
}

// ---- Taxonomy seeding -----------------------------------------------------
// Replaces the old free-text category/tags/goals with three admin-manageable
// trees. Mapping below only exists to translate this file's legacy demo
// fields (category/creator/sport) into taxonomy assignments — it is not a
// runtime concept, just how seed data is authored.

const SPORT_LABELS = { football: "Football", basketball: "Basketball", mma: "MMA", boxing: "Boxing" };

const GOAL_BY_CATEGORY = {
  "Strength Training": "Strength",
  "Fat Loss": "Lose Fat",
  "Muscle Building": "Gain Muscle",
  "Nutrition & Diet": "Nutrition",
  "Powerlifting": "Strength",
  "Beginner": "Beginner Friendly",
  "Bodyweight & Mobility": "Mobility",
  "Endurance": "Endurance",
  "Mobility & Recovery": "Mobility",
};

const CREATOR_CATEGORIES = {
  Fitness: ["Marcus Reyes", "Jordan Blake", "Amara Chen", "Tom Whitfield", "Dr. Lisa Moreno", "Elena Cho"],
  Nutrition: ["Priya Nair", "Nadia Fischer"],
  Powerlifting: ["Big Sam Coleman"],
  Bodybuilding: ["Derrick Owens"],
};
const CREATOR_CATEGORY_BY_NAME = {};
for (const [category, names] of Object.entries(CREATOR_CATEGORIES)) {
  for (const name of names) CREATOR_CATEGORY_BY_NAME[name] = category;
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

// Prisma's compound-unique `where` shorthand rejects an explicit null for a
// nullable field in the key (parentId here), so root-level nodes can't use
// .upsert() directly — find-then-create/update instead.
async function upsertNode(taxonomyId, parentId, name, order) {
  parentId = parentId ?? null;
  const slug = slugify(name);
  const existing = await prisma.taxonomyNode.findFirst({ where: { taxonomyId, parentId, slug } });
  if (existing) {
    return prisma.taxonomyNode.update({ where: { id: existing.id }, data: { name, order } });
  }
  return prisma.taxonomyNode.create({ data: { taxonomyId, parentId, name, slug, order } });
}

// Seeds the 3 taxonomy trees and returns a lookup of leaf node ids keyed the
// way callers below reference them: goals by their own name, athletes/
// creators by "Category/Leaf Name".
async function seedTaxonomies() {
  const defs = [
    { key: "goals", label: "Shop by Goal", route: "/shop/goals", order: 0, hasSubcategories: false },
    { key: "athletes", label: "Browse Athletes", route: "/shop/athletes", order: 1, hasSubcategories: true },
    { key: "creators", label: "Browse Creators", route: "/shop/creators", order: 2, hasSubcategories: true },
  ];
  const taxonomies = {};
  for (const def of defs) {
    taxonomies[def.key] = await prisma.taxonomy.upsert({
      where: { key: def.key },
      update: { label: def.label, route: def.route, order: def.order, hasSubcategories: def.hasSubcategories },
      create: def,
    });
  }

  const nodeIds = { goals: {}, athletes: {}, creators: {} };

  const goalNames = ["Lose Fat", "Gain Muscle", "Strength", "Mobility", "Nutrition", "Endurance", "Beginner Friendly"];
  for (let i = 0; i < goalNames.length; i++) {
    const node = await upsertNode(taxonomies.goals.id, null, goalNames[i], i);
    nodeIds.goals[goalNames[i]] = node.id;
  }

  async function seedTwoLevel(key, structure) {
    const categories = Object.keys(structure);
    for (let ci = 0; ci < categories.length; ci++) {
      const catName = categories[ci];
      const catNode = await upsertNode(taxonomies[key].id, null, catName, ci);
      const leaves = structure[catName];
      for (let li = 0; li < leaves.length; li++) {
        const leafNode = await upsertNode(taxonomies[key].id, catNode.id, leaves[li], li);
        nodeIds[key][`${catName}/${leaves[li]}`] = leafNode.id;
      }
    }
  }

  await seedTwoLevel("athletes", {
    Football: ["Marcus Reyes", "Jordan Blake", "Tom Whitfield"],
    Basketball: ["Derrick Owens", "Amara Chen"],
    MMA: ["Elena Cho", "Dr. Lisa Moreno"],
    Boxing: ["Priya Nair", "Big Sam Coleman", "Nadia Fischer"],
  });

  await seedTwoLevel("creators", CREATOR_CATEGORIES);

  return nodeIds;
}

// Replaces a product's full taxonomy assignment set in one go — mirrors how
// the admin "assign taxonomy" endpoint treats it as one replaceable slice.
async function assignProductTaxonomy(productId, nodeIds) {
  await prisma.productTaxonomy.deleteMany({ where: { productId } });
  const ids = nodeIds.filter(Boolean);
  if (!ids.length) return;
  await prisma.productTaxonomy.createMany({
    data: ids.map((taxonomyNodeId) => ({ productId, taxonomyNodeId })),
    skipDuplicates: true,
  });
}

function difficultyFromCategory(category, name) {
  const text = `${category} ${name}`.toLowerCase();
  if (/beginner/.test(text)) return "beginner";
  if (/advanced/.test(text)) return "advanced";
  return "intermediate";
}

function durationWeeksFromName(name) {
  const match = name.match(/(\d+)[\s-](?:week|day)/i);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return /day/i.test(match[0]) ? Math.round(n / 7) : n;
}

// Turns a product's old pdfSections prose into the structured content the
// platform now renders directly instead of baking it into a PDF: the
// "Weekly Schedule" text becomes the single seeded week's notes, and
// "Getting Started" becomes the program's practical kickoff notes. Real
// per-day/per-exercise breakdowns are then something admins build out
// further in the wizard, not something seed data invents wholesale.
function buildStructuredContent(product) {
  const overview = sectionText(product, "Overview");
  const schedule = sectionText(product, "Weekly Schedule");
  const gettingStarted = sectionText(product, "Getting Started");

  const week = {
    id: crypto.randomUUID(),
    title: "Full Program",
    days: [
      {
        id: crypto.randomUUID(),
        title: "Weekly Schedule",
        notes: schedule,
        exercises: [],
      },
    ],
  };

  const nutrition = isNutritionCategory(product.category);
  return {
    overview,
    trainingContent: nutrition ? null : { notes: gettingStarted, weeks: [week] },
    nutritionContent: nutrition ? { notes: gettingStarted, meals: [] } : null,
  };
}

// Grants the admin role to whatever emails are configured in ADMIN_EMAILS,
// creating the accounts if they don't exist yet. Initially just the two
// business owners; safe to re-run and safe to extend with more emails later.
async function seedAdmins() {
  const emails = String(process.env.ADMIN_EMAILS || "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  for (const email of emails) {
    await prisma.user.upsert({
      where: { email },
      update: { role: "admin" },
      create: { email, role: "admin" },
    });
    console.log(`Seeded admin: ${email}`);
  }
}

async function main() {
  const nodeIds = await seedTaxonomies();
  console.log("Seeded taxonomy trees: goals, athletes, creators");

  for (const p of PRODUCTS) {
    const { overview, trainingContent, nutritionContent } = buildStructuredContent(p);

    const data = {
      name: p.name,
      priceCents: p.priceCents,
      creator: p.creator || null,
      featured: p.featured,
      imageUrl: p.imageUrl,
      description: p.description,
      status: "published",
      difficulty: difficultyFromCategory(p.category, p.name),
      durationWeeks: durationWeeksFromName(p.name),
      overview,
      trainingContent,
      nutritionContent,
    };

    const product = await prisma.product.upsert({
      where: { slug: p.slug },
      update: data,
      create: { slug: p.slug, ...data },
    });

    const sportLabel = SPORT_LABELS[p.sport];
    const creatorCategory = CREATOR_CATEGORY_BY_NAME[p.creator];
    await assignProductTaxonomy(product.id, [
      nodeIds.goals[GOAL_BY_CATEGORY[p.category]],
      sportLabel ? nodeIds.athletes[`${sportLabel}/${p.creator}`] : null,
      creatorCategory ? nodeIds.creators[`${creatorCategory}/${p.creator}`] : null,
    ]);

    console.log(`Seeded product: ${p.name}`);
  }

  const archived = await prisma.product.updateMany({
    where: { slug: { in: OLD_SLUGS } },
    data: { status: "archived" },
  });
  if (archived.count) console.log(`Archived ${archived.count} legacy placeholder product(s)`);

  await seedAdmins();
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
