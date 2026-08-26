// The service catalogue behind /services and /services/:slug.
//
// WHERE THIS CONTENT COMES FROM — this matters more than the shape of the
// file. Every service, and nearly every sentence, is taken from what Fitness
// Agency already says about itself in the private partner deck
// (private/presentation.html): its "Everything we handle" section (the eleven
// platform systems), its "Creative studio" section (the eight production
// services), its six-step "How it works" process, its four named audiences,
// and its benefits belt. Nothing here is an invented service, an invented
// capability, or an invented claim.
//
// So: no pricing, no client counts, no testimonials, no awards, no
// turnaround-time guarantees, no "trusted by" — none of that exists in the
// platform, and a service page is exactly the kind of surface where inventing
// it is tempting and wrong.
//
// Each service is deliberately NOT the same page with the nouns swapped. The
// section mix varies by what is genuinely true of that service (only some
// have a process worth showing, only some have a real product example in the
// catalogue), and the search intent behind each is different — which is the
// whole reason these are separate URLs.

// One shared, real fact set, used for Organization structured data and the
// closing CTA. Sourced from the deck's "Who we are": a complete digital
// commerce platform headquartered in Winnipeg, Canada.
const ORGANIZATION = {
  name: "Fitness Agency",
  description:
    "A complete digital commerce platform for athletes, influencers, creators and coaches: storefront, products, payments, production and support as one system.",
  addressLocality: "Winnipeg",
  addressCountry: "CA",
  contactPath: "/contact",
};

// The four audiences the deck names, reused verbatim across pages so the
// "who is this for" answer is consistent site-wide.
const AUDIENCES = {
  athletes: "Competitive and professional athletes turning a career's worth of method into products.",
  influencers: "Established audiences that have outgrown link-in-bio tools and one-off launches.",
  creators: "Content-first brands that need a commercial engine behind the publishing schedule.",
  coaches: "Practitioners packaging structured programs, plans and ongoing client support.",
};

// The deck's six-step engagement, shown on the services that are genuinely
// delivered through it.
const ENGAGEMENT_PROCESS = [
  { title: "Apply", body: "We review every application against one question: is there an audience here that would buy something we can build well? Fit matters more than size." },
  { title: "Strategy call", body: "A working session, not a pitch. We map the audience, the offer and the pricing, and leave with a product roadmap and an agreed launch date." },
  { title: "Content preparation", body: "Our studio produces what the launch needs: filming, editing, photography, design and copy. Production becomes our problem." },
  { title: "Product publishing", body: "Programs, plans and downloads are built inside the platform, priced and proofed. Checkout, delivery and accounts are wired up and tested before anyone sees them." },
  { title: "Launch", body: "The storefront goes live with the campaign already loaded: assets scheduled, emails queued, discounts configured. We monitor the first days closely." },
  { title: "Sales & growth", body: "The platform keeps selling after the launch window. We read the analytics, expand the catalogue, run promotions and support every customer." },
];

// ---------------------------------------------------------------------
// The services
// ---------------------------------------------------------------------
//
// Field notes:
//   slug          public URL segment (/services/<slug>)
//   name          H1 subject
//   navLabel      short label for cards and internal links
//   title         <title>, unique per page
//   metaTitle     og:title / twitter:title when it should differ from title
//   description   meta description, unique per page, <= ~160 chars
//   heroKicker    the "for whom" line above the H1
//   heroLead      one short paragraph — the hero must not be a wall of text
//   valueProp     the single-sentence "why Fitness Agency"
//   includes      [{ title, body }] — what the service includes
//   approach      { heading, body[] } — how Fitness Agency handles it
//   audience      [key] into AUDIENCES
//   benefits      [string] — outcomes, taken from the deck's benefits belt
//   process       optional [{ title, body }]
//   related       [slug] — internal linking
//   productHint   optional: a taxonomy/goal path this service naturally leads
//                 into, so the page links into the real catalogue
const SERVICES = [
  {
    slug: "platform",
    name: "The Fitness Agency Platform",
    navLabel: "Digital platform",
    title: "Digital Platform for Athletes & Creators",
    description:
      "A branded storefront, checkout, member area and admin, hosted, maintained and updated by Fitness Agency. Eleven systems running as one product.",
    heroKicker: "For athletes, creators and coaches selling their own programs",
    heroLead:
      "Eleven separate systems a creator would otherwise have to buy, integrate and maintain themselves. Here they are one product.",
    valueProp:
      "You keep the audience, the method and the name on the door. We take the platform, the products, the payments and the person emailing at midnight asking where their download went.",
    includes: [
      { title: "Digital platform", body: "A branded storefront and member area, hosted, maintained and updated by us." },
      { title: "Product publishing", body: "Programs, plans and bundles built, priced and published without touching code." },
      { title: "Digital downloads", body: "Guides, templates and assets released through expiring, signed download links." },
      { title: "Memberships", body: "Recurring access with entitlements resolved per customer, per product." },
      { title: "Checkout", body: "A conversion-tuned checkout with saved details, discounts and one clear action." },
      { title: "Payments", body: "Card and wallet payments, refunds and reconciliation, handled end to end." },
      { title: "Customer accounts", body: "Accounts created automatically at purchase, with passwordless sign-in." },
      { title: "Analytics", body: "Revenue, orders, products and customer behaviour in one live dashboard." },
      { title: "Customer support", body: "Buyer questions, access issues and refunds answered by our team, not yours." },
    ],
    approach: {
      heading: "How we handle it",
      body: [
        "The storefront, the checkout and the member area already exist. There is no build phase to fund before the first sale; your products go into a system that is already running.",
        "Hosting, certificates, backups and uptime are ours to worry about. So is every support ticket: lost access, receipts, card failures and refunds reach our inbox, never yours.",
      ],
    },
    audience: ["athletes", "influencers", "creators", "coaches"],
    benefits: [
      "You are selling immediately, with no six-month website project",
      "The product lands in the customer's library the second payment clears",
      "Cards, wallets, refunds and receipts settle without a message to you",
      "The thousandth sale costs exactly what the first one did",
      "Most of your audience buys on a phone, so every screen starts there",
    ],
    process: ENGAGEMENT_PROCESS,
    related: ["partner-services", "training-programs", "nutrition-programs"],
    productHint: { label: "Browse the programs already selling on the platform", path: "/shop" },
  },
  {
    slug: "video-editing",
    name: "Video Editing",
    navLabel: "Video editing",
    title: "Video Editing for Fitness Creators & Athletes",
    description:
      "Full post-production on launch films, program trailers and campaign cuts, produced in-house by the Fitness Agency studio.",
    heroKicker: "For creators who film more than they can edit",
    heroLead:
      "Full post-production on launch films, program trailers and campaign cuts, so the only job left is the one that cannot be delegated.",
    valueProp:
      "Production is part of the platform, not a separate vendor. The team cutting your launch film is the team publishing the product it sells.",
    includes: [
      { title: "Launch films", body: "The centrepiece film a product launch is built around, cut to carry the offer." },
      { title: "Program trailers", body: "Short pieces that show what a program actually is before someone buys it." },
      { title: "Campaign cuts", body: "Variants sized and paced for each placement, from one shoot." },
      { title: "Long-form content", body: "Episodes, documentaries and deep-dive pieces that carry the brand story." },
    ],
    approach: {
      heading: "How we handle it",
      body: [
        "Our in-house studio produces both the thing to sell and the thing to say. Creators stay on the one job that cannot be delegated while our team handles everything downstream of it.",
        "Edits are cut from footage that already exists wherever possible, so a launch does not have to wait on a new shoot to have something to run.",
      ],
    },
    audience: ["creators", "influencers", "athletes"],
    benefits: [
      "Our studio films, edits and designs every asset a launch needs",
      "Assets arrive on the launch schedule, not after it",
      "One production team across film, design and copy, not three vendors to brief",
    ],
    related: ["social-media-content", "graphic-design", "platform"],
  },
  {
    slug: "social-media-content",
    name: "Social Media Content",
    navLabel: "Social content",
    title: "Social Media Content & Optimization",
    description:
      "Vertical short-form edits built for reach, plus formats, captions, cadence and testing tuned to each platform.",
    heroKicker: "For audiences that already exist and need something to buy",
    heroLead:
      "Vertical edits built for reach, cut from footage you have already shot, with the formats, captions and cadence to place them well.",
    valueProp:
      "Short-form is a distribution problem, not just an editing one. We handle both halves, against a storefront that can actually convert the traffic.",
    includes: [
      { title: "Short-form content", body: "Vertical edits built for reach, cut from footage that already exists." },
      { title: "Social media optimization", body: "Formats, captions, cadence and testing tuned to each platform." },
      { title: "Campaign assets", body: "Launch collateral sized per placement and scheduled against the launch date." },
      { title: "Partner profiles", body: "A single Fitness Agency profile link carrying your bio, socials and products." },
    ],
    approach: {
      heading: "How we handle it",
      body: [
        "The commercial system only works if there is something to sell and something to say. Our studio produces both, so the publishing rhythm never has to pause for a launch.",
        "Every short-form piece points somewhere real: a product page, a program, or a partner profile that carries all of them at once.",
      ],
    },
    audience: ["influencers", "creators"],
    benefits: [
      "Vertical edits cut from footage that already exists",
      "One profile link that carries every product and destination",
      "Traffic lands on a storefront tuned to convert it, not a link list",
    ],
    related: ["video-editing", "partner-services", "graphic-design"],
  },
  {
    slug: "graphic-design",
    name: "Graphic Design",
    navLabel: "Graphic design",
    title: "Graphic Design & Brand Identity",
    description:
      "Covers, layouts and program artwork kept consistent across the catalogue, plus identity, type, palette and voice defined once and applied everywhere.",
    heroKicker: "For catalogues that need to look like one catalogue",
    heroLead:
      "Covers, layouts and program artwork, consistent across everything you sell, plus the identity system underneath them.",
    valueProp:
      "Design defined once and applied everywhere, by the same team that publishes the products it dresses.",
    includes: [
      { title: "Program artwork", body: "Covers, layouts and artwork, consistent across the catalogue." },
      { title: "Branding", body: "Identity, type, palette and voice. Defined once, applied everywhere." },
      { title: "Marketing assets", body: "Ad creative, email art direction and launch collateral on schedule." },
      { title: "Merch design", body: "Apparel and physical product design ready for production runs." },
    ],
    approach: {
      heading: "How we handle it",
      body: [
        "Artwork is produced against the same catalogue it will live in, so a cover is designed for the card, the product page and the profile it has to work on, not just for a portfolio.",
        "Identity work is done once and then applied by the team that runs the storefront, which is what keeps a catalogue from drifting apart product by product.",
      ],
    },
    audience: ["athletes", "creators", "coaches"],
    benefits: [
      "One consistent look across every product in the catalogue",
      "Launch collateral delivered on schedule, not after launch",
      "Design and publishing handled by the same team",
    ],
    related: ["merchandise", "video-editing", "platform"],
  },
  {
    slug: "training-programs",
    name: "Training Programs",
    navLabel: "Training programs",
    title: "Training Program Development & Publishing",
    description:
      "Structured week-by-week programming with sets, reps, notes and substitutions, built, priced and published inside the Fitness Agency platform.",
    heroKicker: "For coaches and athletes with a method worth packaging",
    heroLead:
      "Structured week-by-week programming with sets, reps, notes and substitutions, built into a product customers actually train from.",
    valueProp:
      "Your programming becomes a product inside the platform, not a PDF someone loses, but a program with progress tracking, delivered the second payment clears.",
    includes: [
      { title: "Week-by-week structure", body: "Programming laid out by week and day, with sets, reps, notes and substitutions." },
      { title: "In-platform delivery", body: "Customers train from the program inside their library, not from a downloaded file." },
      { title: "Exercise demos", body: "Demonstration media attached to the movements that need it." },
      { title: "Bonus resources", body: "Guides and templates released alongside the program through signed links." },
    ],
    approach: {
      heading: "How we handle it",
      body: [
        "Programs are built, priced, proofed and staged behind the scenes. Checkout, delivery and accounts are wired up and tested before anyone sees them.",
        "Once live, the catalogue keeps growing: we read the analytics, expand it and run promotions, so revenue compounds instead of spiking once.",
      ],
    },
    audience: ["athletes", "coaches", "creators"],
    benefits: [
      "Programs published without touching code",
      "Access granted the second a payment clears",
      "Progress tracked in-platform, so customers finish what they bought",
    ],
    process: ENGAGEMENT_PROCESS,
    related: ["nutrition-programs", "platform", "partner-services"],
    productHint: { label: "See training programs on the storefront", path: "/goal/strength" },
  },
  {
    slug: "nutrition-programs",
    name: "Nutrition Programs",
    navLabel: "Nutrition programs",
    title: "Nutrition Program Development & Publishing",
    description:
      "Meal frameworks, macros and sample plans delivered alongside the training, built and published inside the Fitness Agency platform.",
    heroKicker: "For nutrition coaches and practitioners packaging their method",
    heroLead:
      "Meal frameworks, macros and sample plans, delivered alongside the training rather than as a separate file.",
    valueProp:
      "Nutrition sits in the same product as the training, in the same library, on the same account, which is how customers actually use it.",
    includes: [
      { title: "Meal frameworks", body: "Structured approaches rather than one rigid menu." },
      { title: "Macros", body: "Targets that travel with the program they belong to." },
      { title: "Sample plans", body: "Worked examples showing how the framework is applied." },
      { title: "Bundled delivery", body: "Delivered alongside training in one purchase, one library, one account." },
    ],
    approach: {
      heading: "How we handle it",
      body: [
        "Nutrition content is authored into the same product as the training it supports, so a customer buys one thing and gets a complete method.",
        "Everything is published, priced and proofed by our team; the practitioner supplies the method, not the production.",
      ],
    },
    audience: ["coaches", "athletes", "creators"],
    benefits: [
      "One purchase delivers both training and nutrition",
      "No separate file to distribute, chase or version",
      "Published and supported by our team",
    ],
    related: ["training-programs", "platform", "partner-services"],
    productHint: { label: "See nutrition plans on the storefront", path: "/goal/nutrition" },
  },
  {
    slug: "merchandise",
    name: "Merchandise Design",
    navLabel: "Merchandise",
    title: "Merchandise & Apparel Design",
    description:
      "Apparel and physical product design ready for production runs, designed against the same identity as the rest of the catalogue.",
    heroKicker: "For brands extending past digital products",
    heroLead:
      "Apparel and physical product design, ready for production runs and consistent with everything else carrying your name.",
    valueProp:
      "Merch designed by the team that already owns your identity system, so it looks like the rest of the brand rather than a side project.",
    includes: [
      { title: "Apparel design", body: "Garment artwork and placement prepared for production." },
      { title: "Physical product design", body: "Accessories and equipment designed to the same identity." },
      { title: "Production-ready files", body: "Artwork handed over in the formats a production run needs." },
      { title: "Brand consistency", body: "Designed against the identity already applied across the catalogue." },
    ],
    approach: {
      heading: "How we handle it",
      body: [
        "Merch design runs out of the same studio as covers, campaign art and identity work, so there is no separate briefing process and no drift between physical and digital.",
      ],
    },
    audience: ["athletes", "influencers", "creators"],
    benefits: [
      "Apparel that matches the rest of the brand",
      "Production-ready artwork, not mock-ups",
      "One studio across digital and physical",
    ],
    related: ["graphic-design", "partner-services", "platform"],
  },
  {
    slug: "partner-services",
    name: "Partner Services",
    navLabel: "Partner services",
    title: "Partnership for Athletes, Creators & Coaches",
    description:
      "How Fitness Agency works with athletes, influencers, creators and coaches, from application and strategy call through launch and ongoing growth.",
    heroKicker: "For athletes, influencers, creators and coaches",
    heroLead:
      "Every operational job, lifted off your desk. You keep the audience, the method and the name on the door.",
    valueProp:
      "We take on a small number of partners at a time, and fit matters more than size. The question is whether there is an audience here that would buy something we can build well.",
    includes: [
      { title: "A dedicated storefront", body: "A branded storefront and member area, hosted and maintained by us." },
      { title: "Product development", body: "Programs, plans and bundles built, priced and published on your behalf." },
      { title: "Creative production", body: "Filming, editing, photography, design and copy from our in-house studio." },
      { title: "A partner profile", body: "One public profile link carrying your bio, socials, products and calls to action." },
      { title: "Campaigns and promotions", body: "Discounts, launch emails and campaign assets configured and scheduled." },
      { title: "Support and operations", body: "Buyer questions, access issues, refunds and reconciliation handled by our team." },
    ],
    approach: {
      heading: "How the partnership works",
      body: [
        "Six steps from first conversation to compounding revenue. We take a small number of partners at a time, so the process is a working relationship rather than an onboarding queue.",
        "After launch, the platform keeps selling: we read the analytics, expand the catalogue, run promotions and support every customer.",
      ],
    },
    audience: ["athletes", "influencers", "creators", "coaches"],
    benefits: [
      "Every operational job lifted off your desk",
      "One team across platform, production and support",
      "Revenue that compounds instead of spiking once",
    ],
    process: ENGAGEMENT_PROCESS,
    related: ["platform", "social-media-content", "training-programs"],
  },
];

const BY_SLUG = new Map(SERVICES.map((s) => [s.slug, s]));

function getService(slug) {
  return BY_SLUG.get(String(slug || "").toLowerCase()) || null;
}

function listServices() {
  return SERVICES;
}

function relatedServices(service) {
  return (service.related || []).map((slug) => BY_SLUG.get(slug)).filter(Boolean);
}

function audienceEntries(service) {
  return (service.audience || [])
    .map((key) => ({ key, text: AUDIENCES[key] }))
    .filter((a) => a.text);
}

module.exports = {
  ORGANIZATION,
  AUDIENCES,
  ENGAGEMENT_PROCESS,
  SERVICES,
  getService,
  listServices,
  relatedServices,
  audienceEntries,
};
