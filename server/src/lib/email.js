const { Resend } = require("resend");
const { prisma } = require("../db");
const { getSettings, getStoreName } = require("./settings");
const {
  renderLayout, orderTable, productCard, metaRows,
  button, buttonPair, panel, esc, money,
} = require("./emailLayout");
const { emailCoverPath } = require("./emailImage");

const resend = new Resend(process.env.RESEND_API_KEY);

// Where customers are told to write for help. Falls back to the contact
// wizard's inbox so there is never a template with a blank support address.
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || process.env.CONTACT_INBOX || "info@fitness.agency";

// RESEND_FROM_EMAIL is an operator-controlled override; otherwise the from
// name follows the configured store name so it stays in sync with Settings.
async function getFrom() {
  if (process.env.RESEND_FROM_EMAIL) return process.env.RESEND_FROM_EMAIL;
  const storeName = await getStoreName();
  return `${storeName} <onboarding@resend.dev>`;
}

// Collects everything the shared layout needs in one settings read, so a
// template render is one DB round-trip rather than one per brand value.
// The official mark, rastered for email by tools/build-email-assets.js. This
// is a code default rather than a Settings value on purpose: Settings.logoUrl
// is empty on this install, and an empty one used to fall through to a styled
// text wordmark, so every email went out with type standing in for the brand.
// An admin-set logoUrl still wins, but the floor is the real logo.
const BRAND_LOGO_PATH = "/assets/images/logo/fa-logo-email.png";

async function brandContext() {
  const settings = await getSettings();
  return {
    storeName: settings.storeName,
    logoUrl: absoluteUrl(settings.logoUrl || BRAND_LOGO_PATH),
    appUrl: (process.env.APP_URL || "").replace(/\/$/, ""),
    supportEmail: SUPPORT_EMAIL,
  };
}

// "August 17, 2026" — the same form the confirmation page shows, so the
// receipt and the site agree.
function formatDate(value) {
  const d = value ? new Date(value) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric", timeZone: "UTC" });
}

// The customer-facing order number, matching assets/js/order-success.js so a
// customer comparing the email to the site sees one reference, not two.
function orderRef(orderId) {
  return orderId ? `#${String(orderId).slice(-8).toUpperCase()}` : "";
}

function firstName(name) {
  const first = String(name || "").trim().split(/\s+/)[0];
  return first || "";
}

// Email clients cannot resolve "/assets/images/logo.svg" — a logo has to be
// an absolute URL or it renders as a broken image everywhere.
function absoluteUrl(pathOrUrl) {
  if (/^https?:\/\//i.test(pathOrUrl)) return pathOrUrl;
  const base = (process.env.APP_URL || "").replace(/\/$/, "");
  return base ? `${base}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}` : pathOrUrl;
}

// Resend's SDK resolves with { data, error } rather than throwing on
// API-level failures — logging both outcomes here doesn't change that
// existing non-throwing behavior for callers (fulfillOrder.js relies on
// email failures never blocking order fulfillment).
async function sendAndLog({ to, subject, html }) {
  const from = await getFrom();
  const result = await resend.emails.send({ from, to, subject, html });
  try {
    await prisma.emailLog.create({
      data: {
        recipient: to,
        subject,
        status: result && result.error ? "failed" : "sent",
        providerResponse: JSON.stringify((result && (result.error || result.data)) || {}),
      },
    });
  } catch (err) {
    console.error("Failed to write EmailLog:", err);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Sign-in link (also the account-verification and password-recovery path)
// ---------------------------------------------------------------------------
// This platform authenticates by magic link, with a password as an optional
// convenience set from account settings (auth.js -> /set-password). There is
// therefore no separate "verify your address" token: possession of the
// mailbox IS the verification, proven every time this link is used. The
// `intent` argument only changes the wording, never the mechanism — a single
// well-tested token path is worth more than three near-identical ones.
async function magicLinkEmail(link, intent = "signin") {
  const brand = await brandContext();
  const copy = {
    signin: {
      subject: `Your ${brand.storeName} access link`,
      preheader: "Your access link is ready. It expires in 15 minutes.",
      eyebrow: "Secure sign in",
      heading: `Your ${brand.storeName} access is ready.`,
      lead: "No password needed.",
      cta: "Open my Fitness Agency account",
    },
    verify: {
      subject: `Confirm your email for ${brand.storeName}`,
      preheader: "Confirm your address to finish setting up your account.",
      eyebrow: "One step left",
      heading: "Confirm your email address.",
      lead: "One tap and your account is set up.",
      cta: "Confirm my email",
    },
    reset: {
      subject: `Reset your ${brand.storeName} password`,
      preheader: "Use this secure link to set a new password.",
      eyebrow: "Password reset",
      heading: "Reset your password.",
      lead: "Sign in below, then set a new password under My Profile.",
      cta: "Reset my password",
    },
  }[intent] || {};

  const html = renderLayout({
    ...brand,
    preheader: copy.preheader,
    eyebrow: copy.eyebrow,
    heading: copy.heading,
    // The token lives in the button's href and nowhere else. Printing the URL
    // as visible text puts a working credential into forwarded mail, quoted
    // replies and screenshots, and the button covers every client that can
    // open a link at all.
    bodyHtml: `
      <p style="margin:0 0 20px;">${esc(copy.lead)}</p>
      ${button(copy.cta, link)}
      ${panel(
        `Expires in 15 minutes and works once. Didn't ask for this? Ignore it.`
      )}`,
  });

  return { subject: copy.subject, html };
}

async function sendMagicLinkEmail(email, link, intent = "signin") {
  const { subject, html } = await magicLinkEmail(link, intent);
  return sendAndLog({ to: email, subject, html });
}

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------
async function welcomeEmail({ name } = {}) {
  const brand = await brandContext();
  const first = firstName(name);
  const html = renderLayout({
    ...brand,
    preheader: "Your account is ready.",
    eyebrow: "Account ready",
    heading: first ? `Welcome to ${brand.storeName}, ${first}.` : `Welcome to ${brand.storeName}.`,
    bodyHtml: `
      <p style="margin:0 0 6px;">Everything you buy lands in your library and stays there for good.</p>
      ${button("Open my library", `${brand.appUrl}/my-library`)}
      <p style="margin:14px 0 0;font-size:14px;color:#9c9993;">No password to remember. We email you a link whenever you sign in.</p>`,
  });
  return { subject: `Welcome to ${brand.storeName}`, html };
}

async function sendWelcomeEmail(email, opts = {}) {
  const { subject, html } = await welcomeEmail(opts);
  return sendAndLog({ to: email, subject, html });
}

// ---------------------------------------------------------------------------
// Purchase receipt / order confirmation
// ---------------------------------------------------------------------------
// One email deliberately covers order confirmation, payment confirmation, the
// itemised receipt, product access and support contact: they all describe the
// same event, and splitting them into four messages for one purchase is how
// transactional mail ends up in spam folders.
async function purchaseReceiptEmail(
  { orderItems, totalCents, magicLink, orderId, discountCents = 0, customerName, provider, orderDate }
) {
  const brand = await brandContext();
  const settings = await getSettings();
  const currency = settings.currency || "USD";
  const count = orderItems.length;
  const first = firstName(customerName);

  // A single purchase gets the product itself: cover, title, creator. Several
  // at once get the itemised table, because four covers stacked in a receipt
  // is a catalogue, not a confirmation.
  const single = count === 1 ? orderItems[0] : null;
  const singleProduct = single && single.product;
  let heroHtml = "";
  if (singleProduct) {
    const coverPath = await emailCoverPath(singleProduct.thumbnailUrl || singleProduct.imageUrl);
    heroHtml = productCard({
      name: singleProduct.name,
      creator: singleProduct.creator,
      imageUrl: coverPath ? absoluteUrl(coverPath) : "",
      priceLabel: money(single.priceCents, currency),
    });
  } else {
    heroHtml = orderTable({ orderItems, totalCents, discountCents, currency });
  }

  // "Open my program" only when there is exactly one thing to open and we
  // know its address. Otherwise the library is the honest destination.
  const programHref = singleProduct && singleProduct.slug
    ? `${brand.appUrl}/program/${encodeURIComponent(singleProduct.slug)}`
    : "";
  const libraryHref = `${brand.appUrl}/my-library`;

  const html = renderLayout({
    ...brand,
    preheader: single
      ? `${singleProduct ? singleProduct.name : "Your program"} is ready.`
      : `${count} programs are ready in your library.`,
    eyebrow: "Purchase confirmed",
    heading: first ? `You're in, ${first}.` : "You're in.",
    bodyHtml: `
      <p style="margin:0 0 4px;">${count === 1 ? "Your program is" : "Your programs are"} ready in your library.</p>

      ${heroHtml}

      ${count === 1
        ? `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:16px 0 0;">
             <tr>
               <td style="padding:14px 0 0;border-top:1px solid #e8e7e4;font-family:'Montserrat',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:15px;font-weight:700;color:#1a1a1a;">Total paid</td>
               <td align="right" style="padding:14px 0 0;border-top:1px solid #e8e7e4;font-family:'Montserrat',-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:19px;font-weight:700;color:#1a1a1a;white-space:nowrap;">${money(totalCents, currency)}</td>
             </tr>
           </table>`
        : ""}

      ${metaRows([
        { label: "Order", value: orderRef(orderId) },
        { label: "Date", value: formatDate(orderDate) },
        { label: "Payment", value: provider ? (provider === "paypal" ? "PayPal" : "Card") : "" },
      ])}

      ${programHref
        ? buttonPair(
            { label: "Open my program", href: programHref },
            { label: "Open my library", href: libraryHref }
          )
        : button("Open my library", libraryHref)}

      ${panel(
        `Keep this as your receipt. Your access never expires.` +
        (magicLink
          ? ` On another device, <a href="${esc(magicLink)}" style="color:#1a1a1a;font-weight:600;text-decoration:underline;">sign in with a one time link</a>.`
          : "")
      )}`,
  });

  return {
    subject: `Your ${brand.storeName} order is confirmed${orderId ? ` (${orderRef(orderId).replace("#", "")})` : ""}`,
    html,
  };
}

async function sendPurchaseReceiptEmail(email, opts) {
  const { subject, html } = await purchaseReceiptEmail(opts);
  return sendAndLog({ to: email, subject, html });
}

// ---------------------------------------------------------------------------
// Contact form
// ---------------------------------------------------------------------------
// Two messages: the notification to the office inbox, and an acknowledgement
// to the person who wrote in. The notification sets replyTo to the enquirer so
// hitting Reply in the inbox goes to them rather than to the sender identity.
async function contactNotificationEmail({ name, email, lines }) {
  const brand = await brandContext();
  const html = renderLayout({
    ...brand,
    preheader: `New enquiry from ${name}`,
    eyebrow: "Contact form",
    heading: "New enquiry",
    bodyHtml: `
      ${panel(lines.map((l) => esc(l)).join("<br>"))}
      <p style="margin:16px 0 0;font-size:14px;">Reply to answer
      <a href="mailto:${esc(email)}" style="color:#1a1a1a;font-weight:600;text-decoration:underline;">${esc(email)}</a>.</p>`,
  });

  return { subject: `New enquiry from ${name}`, html };
}

// The office copy. replyTo is the enquirer, so hitting Reply in the inbox
// answers them rather than the sender identity — which is why this one does
// not go through sendAndLog.
async function sendContactNotificationEmail(inbox, { name, email, lines }) {
  const { subject, html } = await contactNotificationEmail({ name, email, lines });
  const from = await getFrom();
  const result = await resend.emails.send({ from, to: inbox, replyTo: email, subject, html });
  try {
    await prisma.emailLog.create({
      data: {
        recipient: inbox,
        subject,
        status: result && result.error ? "failed" : "sent",
        providerResponse: JSON.stringify((result && (result.error || result.data)) || {}),
      },
    });
  } catch (err) {
    console.error("Failed to write EmailLog:", err);
  }
  return result;
}

async function contactAcknowledgementEmail({ name } = {}) {
  const brand = await brandContext();
  const first = firstName(name);
  const html = renderLayout({
    ...brand,
    preheader: "We have your message.",
    eyebrow: "Message received",
    heading: "Thanks for getting in touch.",
    bodyHtml: `
      <p style="margin:0;">${first ? `Hi ${esc(first)}, we` : "We"} have your message and will reply within
      a working day. Need it sooner? Just reply to this email.</p>`,
  });
  return { subject: `We have your message, ${brand.storeName}`, html };
}

async function sendContactAcknowledgementEmail(email, opts = {}) {
  const { subject, html } = await contactAcknowledgementEmail(opts);
  return sendAndLog({ to: email, subject, html });
}

// ---------------------------------------------------------------------------
// Ad hoc email composed by an admin from the Customers page.
// ---------------------------------------------------------------------------
// Returns the provider result so callers that need to know whether delivery
// actually succeeded can check `result.error`. Resend's SDK resolves with an
// { error } object rather than rejecting, so awaiting alone is NOT enough to
// detect a failed send.
async function adminEmail({ subject, body }) {
  const brand = await brandContext();
  const html = renderLayout({
    ...brand,
    preheader: subject,
    heading: subject,
    bodyHtml: `<p style="margin:0;">${esc(body).replace(/\n/g, "<br>")}</p>`,
  });
  return { subject, html };
}

async function sendAdminEmail(email, opts) {
  const rendered = await adminEmail(opts);
  return sendAndLog({ to: email, subject: rendered.subject, html: rendered.html });
}

module.exports = {
  // Pure renderers: return { subject, html } and send nothing. tools/
  // send-test-emails.js uses these to preview every template without a
  // provider call, which is what makes email QA possible without mailing a
  // real customer.
  magicLinkEmail,
  welcomeEmail,
  purchaseReceiptEmail,
  contactAcknowledgementEmail,
  contactNotificationEmail,
  adminEmail,

  sendMagicLinkEmail,
  sendWelcomeEmail,
  sendPurchaseReceiptEmail,
  sendContactNotificationEmail,
  sendContactAcknowledgementEmail,
  sendAdminEmail,
  SUPPORT_EMAIL,
};
