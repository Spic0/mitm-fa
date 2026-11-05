// /partnership: the one place companies and people send Fitness Agency
// business offers. Copy and form options live here so the page renderer
// (routes/pages.js) and the validator (routes/partnership.js) share one list.
//
// Facts used, and where they come from:
//   revenue share 15-30% of net profit   the owner's brief (2026-11-05). The
//                                         private deck still says 10-30%, so
//                                         the owner must confirm which is right.
//   "you keep the audience, the method"  lib/services.js (creator-platform)
//   "fit matters more than size"         lib/services.js (ENGAGEMENT_PROCESS)
//   terms confirmed in writing           private/presentation.html disclaimer
//   US and Canada, based in Winnipeg     the owner's brief + ORGANIZATION
// No response time: nobody has confirmed one (see EMAIL_RESPONSE_TIME).

const OFFER_TYPES = [
  { value: "creator", label: "Creator/athlete partnership" },
  { value: "brand", label: "Brand collaboration/sponsorship" },
  { value: "other", label: "Other business offer" },
];
// Same buckets as the contact wizard (routes/contact.js AUDIENCES).
const AUDIENCE_RANGES = ["Under 5k", "5k-25k", "25k-100k", "100k+"];
const COUNTRIES = [
  { value: "US", label: "United States" },
  { value: "CA", label: "Canada" },
  { value: "Other", label: "Other" },
];
const BUDGET_RANGES = ["Under $5k", "$5k-$25k", "$25k-$100k", "$100k+", "Not sure yet"];

const PAGE = {
  title: "Fitness Business Partnerships and Offers",
  description:
    "Send Fitness Agency a business offer. We build and run program businesses for fitness creators, coaches and athletes, and partner with brands and sponsors.",
  h1: "Business Partnerships with Fitness Agency",
  lead:
    "This page is for business offers and partnership proposals. Creators, coaches and athletes who want us to build and run their business, brands proposing a collaboration, and companies with any other proposal all start here.",
};

const CREATOR_SERVICES = [
  { title: "Your own branded website", body: "A storefront on your name and brand, built and hosted by us." },
  { title: "Programs and meal plans as products", body: "Your method turned into training programs and meal plans people can buy." },
  { title: "Checkout and delivery", body: "Payments, accounts and instant access to what customers bought." },
  { title: "Marketing", body: "Launch campaigns, emails, discounts and creative, planned and scheduled." },
  { title: "Ongoing operations", body: "Customer support, access issues, refunds and reconciliation, handled by our team." },
];

const BRAND_OFFERS = [
  { title: "Sponsorships", body: "Put your brand in front of the audiences our creators have built." },
  { title: "Creator collaborations", body: "Work with the athletes and coaches we partner with on campaigns and content." },
  { title: "Co-branded programs", body: "Training programs or meal plans built together and sold under both names." },
];

const STEPS = [
  { title: "Send your offer", body: "Use the form below. Tell us who you are and what you are proposing." },
  { title: "We review it", body: "Our team reads every offer. Fit matters more than size." },
  { title: "We talk it through", body: "If there is a fit, we set up a call to work out the details." },
  { title: "Written agreement", body: "Terms are confirmed in writing before any work starts." },
];

const FAQ = [
  {
    q: "How does the creator partnership model work?",
    a: "We work on a revenue share of 15-30% of net profit. Where you land in that range depends on how many of our services you use. The final terms are confirmed in a written agreement.",
  },
  {
    q: "Who owns my content and my brand?",
    a: "You keep the audience, the method and the name on the door. We run the platform, products, payments and support around them, and the agreement sets out ownership in writing.",
  },
  {
    q: "Is there a contract?",
    a: "Yes. Nothing on this page is an offer by itself. Every partnership is confirmed in a written agreement that covers the services, the revenue share and payouts.",
  },
  {
    q: "How are payouts handled?",
    a: "Sales run through our checkout and our team reconciles them. The payout schedule is set out in your agreement.",
  },
  {
    q: "Which markets do you work in?",
    a: "We focus on the United States and Canada, and we are based in Winnipeg, Canada. If you are somewhere else, send your offer anyway and tell us where your audience is.",
  },
  {
    q: "Do I need a large audience?",
    a: "No. Fit matters more than size. We look at whether there is an audience that would buy something we can build well.",
  },
  {
    q: "Can brands work with your creators?",
    a: "Yes. Brands can propose sponsorships, collaborations with our creators and co-branded programs. Choose Brand collaboration/sponsorship in the form and tell us what you have in mind.",
  },
];

module.exports = { OFFER_TYPES, AUDIENCE_RANGES, COUNTRIES, BUDGET_RANGES, PAGE, CREATOR_SERVICES, BRAND_OFFERS, STEPS, FAQ };
