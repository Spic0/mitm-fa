// Preview and test-send every transactional email the platform sends.
//
// Two modes, and the safe one is the default:
//
//   node send-test-emails.js                 # render only, writes HTML to disk
//   node send-test-emails.js --send          # also sends, to the allow-listed address
//   node send-test-emails.js --only magic,receipt
//
// SENDING IS ALLOW-LISTED IN CODE. There is deliberately no way to point this
// at a customer: the recipient is checked against ALLOWED below and the run
// aborts on anything else, so a mistyped --to cannot reach a real mailbox.
// The renderers it calls (lib/email.js's *Email functions) return the exact
// { subject, html } the senders would use, so a preview is the real message
// and not an approximation of one.
const fs = require("fs");
const path = require("path");

const SERVER = path.join(__dirname, "..", "server");
const templates = require(path.join(SERVER, "src", "lib", "email.js"));
const { prisma } = require(path.join(SERVER, "src", "db.js"));

// The ONLY address this tool may send to.
const ALLOWED = new Set(["alensucurovic20@gmail.com"]);

const arg = (name, fallback) => {
  const i = process.argv.indexOf(name);
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
};
const SEND = process.argv.includes("--send");
const TO = arg("--to", "alensucurovic20@gmail.com");
const ONLY = arg("--only", "");
const OUT = arg("--out", "/tmp/claude-0/-root/81bccab9-f66d-4016-9fb8-0989a4d859fd/scratchpad/emails");

if (SEND && !ALLOWED.has(TO)) {
  console.error(`REFUSED: ${TO} is not on the test allow-list.`);
  console.error(`Allowed: ${[...ALLOWED].join(", ")}`);
  process.exit(2);
}

// Fixtures. Real-shaped rather than realistic-looking: orderItems carry the
// same nested `product` the Prisma include produces, because that is what the
// receipt reads.
async function fixtures() {
  // Use a genuine published product when one exists, so the cover, creator
  // and price in the preview are the real thing rather than invented.
  const product = await prisma.product
    .findFirst({
      where: { status: "published", imageUrl: { not: null } },
      select: { name: true, slug: true, creator: true, imageUrl: true, thumbnailUrl: true, priceCents: true },
      orderBy: { createdAt: "asc" },
    })
    .catch(() => null);

  const one = product || {
    name: "12-Week Strength Foundations",
    slug: "12-week-strength-foundations",
    creator: "Marcus Reyes",
    imageUrl: null,
    thumbnailUrl: null,
    priceCents: 5900,
  };
  const two = { name: "Fat Loss Accelerator", slug: "fat-loss-accelerator", creator: "Elena Cho", priceCents: 4900 };

  const link = "https://fitness.agency/api/auth/verify?token=" + "a".repeat(64);
  return {
    magicLink: link,
    single: {
      orderItems: [{ product: one, priceCents: one.priceCents }],
      totalCents: one.priceCents,
      orderId: "cmf7k2p9x0001qwer9bf371hh",
      provider: "stripe",
      customerName: "Alen Sucurovic",
      magicLink: link,
      orderDate: new Date(),
    },
    multi: {
      orderItems: [
        { product: one, priceCents: one.priceCents },
        { product: two, priceCents: two.priceCents },
      ],
      totalCents: one.priceCents + two.priceCents - 1000,
      discountCents: 1000,
      orderId: "cmf7k2p9x0002qwer4kd220ab",
      provider: "paypal",
      customerName: "Alen Sucurovic",
      magicLink: link,
      orderDate: new Date(),
    },
  };
}

(async () => {
  const fx = await fixtures();

  const CASES = [
    { key: "magic-signin", label: "Magic login / access link", render: () => templates.magicLinkEmail(fx.magicLink, "signin") },
    { key: "magic-verify", label: "Email confirmation (new account)", render: () => templates.magicLinkEmail(fx.magicLink, "verify") },
    { key: "password-reset", label: "Password reset", render: () => templates.magicLinkEmail(fx.magicLink, "reset") },
    { key: "welcome", label: "Welcome / account ready", render: () => templates.welcomeEmail({ name: "Alen Sucurovic" }) },
    { key: "purchase-single", label: "Purchase confirmation (one program)", render: () => templates.purchaseReceiptEmail(fx.single) },
    { key: "purchase-multi", label: "Purchase confirmation (multiple, with discount)", render: () => templates.purchaseReceiptEmail(fx.multi) },
    { key: "contact-ack", label: "Contact form acknowledgement", render: () => templates.contactAcknowledgementEmail({ name: "Alen Sucurovic" }) },
    {
      key: "contact-notify", label: "Contact form notification (office inbox)",
      render: () => templates.contactNotificationEmail({
        name: "Alen Sucurovic", email: "alensucurovic20@gmail.com",
        lines: ["Name: Alen Sucurovic", "Email: alensucurovic20@gmail.com", "Subject: Program question", "", "Which program suits a beginner lifter?"],
      }),
    },
    {
      key: "admin-message", label: "Message from an admin",
      render: () => templates.adminEmail({
        subject: "About your recent order",
        body: "Hi Alen,\n\nYour program has been updated with a new week 6 session.\n\nFitness Agency",
      }),
    },
  ];

  const wanted = ONLY ? new Set(ONLY.split(",").map((s) => s.trim())) : null;
  const cases = CASES.filter((c) => !wanted || wanted.has(c.key));

  fs.mkdirSync(OUT, { recursive: true });
  console.log(`Rendering ${cases.length} template(s) -> ${OUT}`);
  if (SEND) console.log(`SENDING to ${TO} (allow-listed)\n`);
  else console.log("Render only. Pass --send to deliver.\n");

  const results = [];
  for (const c of cases) {
    const { subject, html } = await c.render();
    const file = path.join(OUT, `${c.key}.html`);
    fs.writeFileSync(file, html);

    let sent = null;
    if (SEND) sent = await sendVia(c.key, subject, html);
    results.push({ key: c.key, label: c.label, subject, bytes: html.length, file, sent });
    console.log(`${c.key.padEnd(17)} ${String(Math.round(html.length / 1024) + "KB").padStart(5)}  "${subject}"${sent ? `  -> ${sent.id || sent.error}` : ""}`);
  }

  fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(results, null, 2));
  await prisma.$disconnect();
  console.log(`\n${results.length} template(s) written.`);
  if (SEND) {
    const failed = results.filter((r) => r.sent && r.sent.error);
    console.log(failed.length ? `${failed.length} FAILED to send` : `All sent to ${TO}.`);
  }
})().catch(async (e) => {
  console.error(e);
  try { await prisma.$disconnect(); } catch (_) {}
  process.exit(1);
});

// Sends one already-rendered message through Resend, with the allow-list
// re-checked at the point of the actual call rather than only at startup.
async function sendVia(key, subject, html) {
  if (!ALLOWED.has(TO)) throw new Error(`refusing to send to ${TO}`);
  const { Resend } = require(path.join(SERVER, "node_modules", "resend"));
  const resend = new Resend(process.env.RESEND_API_KEY);
  const from = process.env.RESEND_FROM_EMAIL || "Fitness Agency <noreply@fitness.agency>";
  const result = await resend.emails.send({
    from,
    to: TO,
    subject: `[TEST ${key}] ${subject}`,
    html,
  });
  if (result && result.error) return { error: JSON.stringify(result.error) };
  return { id: result && result.data && result.data.id };
}
