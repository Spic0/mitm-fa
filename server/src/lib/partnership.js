// /partnership: business offers and partnership proposals. Copy lives here
// so the page renderer (routes/pages.js) and the FAQPage JSON-LD read the
// same strings.
//
// Facts used, and where they come from:
//   revenue share 15-30% of net profit   the owner's brief (2026-11-05). The
//                                         private deck's estimator starts at
//                                         10%, so the owner must confirm.
//   "you keep the audience, the method"  lib/services.js (creator-platform)
//   "fit matters more than size"         lib/services.js (ENGAGEMENT_PROCESS)
//   terms confirmed in writing           private/presentation.html disclaimer
//   US and Canada, based in Winnipeg     the owner's brief + ORGANIZATION
// No response time on this page: nobody has confirmed one.

const CALENDLY_URL = "https://calendly.com/mitmfitnessagency/30min";
// The demo creator storefront (fictional partner, demo content).
const DEMO_URL = "/partners/elena-cho";
// The "See a demo" viewer: real pages, framed with ?demo=1 (lib/demo-mode.js).
// The product is the homepage's pinned demo program (Setting.demoProductSlug),
// the same one /demo previews, so the plan viewer shows that product's slice.
const DEMO_PRODUCT = "/program/elena-cho-strength-size-peak";
const DEMO_TABS = [
  { key: "storefront", label: "Creator storefront", path: DEMO_URL },
  { key: "product", label: "Product page", path: DEMO_PRODUCT },
  { key: "plan", label: "Plan viewer", path: "/demo" },
  { key: "checkout", label: "Checkout preview", path: DEMO_PRODUCT, hash: "#buy" },
];

const PAGE = {
  title: "Fitness Business Partnerships and Offers",
  description:
    "Send Fitness Agency a business offer. We build and run program businesses for fitness creators, coaches and athletes, and partner with brands and sponsors.",
  h1: "Business Partnerships with Fitness Agency",
  sub: "We build, sell and run your fitness business. You keep your brand.",
};

// icon: a key into ICONS in routes/pages.js. Card text stays under 15 words.
const WHAT_WE_DO = [
  { icon: "globe", title: "Custom branded site", body: "Your name and brand, built and hosted by us." },
  { icon: "dumbbell", title: "Programs and meal plans", body: "Your method, turned into products people buy." },
  { icon: "card", title: "Checkout and delivery", body: "Payments, accounts and instant access, handled." },
  { icon: "megaphone", title: "Marketing", body: "Launches, emails and campaigns, planned and scheduled." },
  { icon: "headset", title: "Operations", body: "Support, refunds and reconciliation, run by our team." },
  { icon: "map", title: "US and Canada", body: "Built for creators selling in the United States and Canada." },
];

// "What you get": the partnership cycle (assets/js/pt-process.js animates it).
// Titles <= 4 words, captions <= 8, and only what this page already says:
// the 15-30% of net profit and the written agreement (FAQ / model band), and
// the WHAT_WE_DO cards. No payout schedule, timeline or count is stated
// anywhere, so none is given here. After step 8 the cycle returns to step 5.
const PROCESS = [
  { title: "Book a call", body: "Or send an offer in five questions." },
  { title: "Estimate and agreement", body: "15-30% of net profit, in writing." },
  { title: "We build your site", body: "Your name and brand, built and hosted." },
  { title: "Your method, as products", body: "Programs and meal plans people buy." },
  { title: "Launch and marketing", body: "Launches, emails and campaigns, planned and scheduled." },
  { title: "Checkout and delivery", body: "Payments, accounts and instant access, handled." },
  { title: "Support and operations", body: "Support, refunds and reconciliation, run by us." },
  { title: "Your share, paid out", body: "Net profit shared as agreed in writing." },
];
const PROCESS_LOOP = "Grow: new products and campaigns";

const STEPS = [
  { title: "Book a call or send an offer", body: "Pick a time, or answer five quick questions." },
  { title: "We review the fit", body: "Fit matters more than audience size." },
  { title: "We plan it together", body: "Offer, pricing and launch, mapped on one call." },
  { title: "Written agreement", body: "Terms in writing before any work starts." },
];

const BRAND_OFFERS = [
  { icon: "spark", title: "Sponsorships", body: "Reach the audiences our creators have built." },
  { icon: "users", title: "Creator collaborations", body: "Campaigns and content with our athletes and coaches." },
  { icon: "layers", title: "Co-branded programs", body: "Programs built together, sold under both names." },
];
const PARTNER_TYPES = ["Gyms", "Supplement brands", "Apparel", "Media", "Investors"];

// Answers stay at two sentences or fewer; FAQPage JSON-LD uses these verbatim.
const FAQ = [
  { q: "How does the creator partnership model work?", a: "We take a revenue share of 15-30% of net profit, depending on the services you use. Final terms are confirmed in a written agreement." },
  { q: "Who owns my content and my brand?", a: "You keep the audience, the method and the name on the door. Ownership is set out in the agreement." },
  { q: "Is there a contract?", a: "Yes. Every partnership is confirmed in a written agreement before any work starts." },
  { q: "How are payouts handled?", a: "Sales run through our checkout and our team reconciles them. The payout schedule is in your agreement." },
  { q: "Which markets do you work in?", a: "We focus on the United States and Canada. We are based in Winnipeg, Canada." },
  { q: "Do I need a large audience?", a: "No. Fit matters more than size." },
  { q: "Can brands work with your creators?", a: "Yes: sponsorships, creator collaborations and co-branded programs. Book a call or send an offer to start." },
];

module.exports = { CALENDLY_URL, DEMO_URL, DEMO_TABS, PAGE, WHAT_WE_DO, PROCESS, PROCESS_LOOP, STEPS, BRAND_OFFERS, PARTNER_TYPES, FAQ };
