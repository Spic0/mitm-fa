// Homepage (B2B landing) copy that the server has to read twice: the FAQ is
// rendered into index.html (<!--HOME_FAQ-->) and emitted as FAQPage JSON-LD,
// and both come from this one list.
//
// Facts used, and where they come from:
//   15-30% of net profit, depends on services, written agreement
//                                   lib/partnership.js (FAQ), the owner's brief
//   you keep the audience, the method and the name
//                                   lib/partnership.js / lib/services.js
//   fit matters more than size      lib/services.js (ENGAGEMENT_PROCESS)
//   markets: US, Canada, EU, UAE    the owner's brief (2026-11-12)
// No fee, contract length or payout schedule is stated anywhere, so none is
// given here. Answers stay at two sentences or fewer.
const FAQ = [
  { q: "What does Fitness Agency do?", a: "We build and run the digital product business behind a fitness creator: products, store, marketing and support. You stay the face and the voice." },
  { q: "How does the revenue share work?", a: "We take a revenue share of 15-30% of net profit, depending on the services you use. Final terms are confirmed in a written agreement." },
  { q: "What do I have to do myself?", a: "Create content and be yourself. We handle the build, the launch and the day to day." },
  { q: "Who owns my content and my brand?", a: "You keep the audience, the method and the name on the door. Ownership is set out in the agreement." },
  { q: "Is there a contract?", a: "Yes. Every partnership is confirmed in a written agreement before any work starts." },
  { q: "How are payouts handled?", a: "Sales run through our checkout and our team reconciles them. The payout schedule is in your agreement." },
  { q: "Which markets do you work in?", a: "The United States, Canada, the European Union and the United Arab Emirates." },
  { q: "Do I need a large audience?", a: "No. Fit matters more than size." },
];

const TITLE = "We Build and Run Your Fitness Business | Fitness Agency";
const DESCRIPTION =
  "Fitness Agency builds and runs digital products for fitness influencers, athletes and coaches: training plans, apps, coaching, store and marketing, for a 15-30% share of net profit.";

module.exports = { FAQ, TITLE, DESCRIPTION };
