const { Resend } = require("resend");
const { prisma } = require("../db");
const { getSettings, getStoreName } = require("./settings");
const { renderLayout, orderTable, button, panel, esc } = require("./emailLayout");

const resend = new Resend(process.env.RESEND_API_KEY);

// Where customers are told to write for help. Falls back to the contact
// wizard's inbox so there is never a template with a blank support address.
const SUPPORT_EMAIL = process.env.SUPPORT_EMAIL || process.env.CONTACT_INBOX || "office@fitness.agency";

// RESEND_FROM_EMAIL is an operator-controlled override; otherwise the from
// name follows the configured store name so it stays in sync with Settings.
async function getFrom() {
  if (process.env.RESEND_FROM_EMAIL) return process.env.RESEND_FROM_EMAIL;
  const storeName = await getStoreName();
  return `${storeName} <onboarding@resend.dev>`;
}

// Collects everything the shared layout needs in one settings read, so a
// template render is one DB round-trip rather than one per brand value.
async function brandContext() {
  const settings = await getSettings();
  return {
    storeName: settings.storeName,
    logoUrl: settings.logoUrl ? absoluteUrl(settings.logoUrl) : "",
    appUrl: process.env.APP_URL || "",
    supportEmail: SUPPORT_EMAIL,
  };
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
async function sendMagicLinkEmail(email, link, intent = "signin") {
  const brand = await brandContext();
  const copy = {
    signin: {
      subject: `Your ${brand.storeName} sign-in link`,
      preheader: "Your secure sign-in link — expires in 15 minutes.",
      heading: "Sign in to your account",
      lead: `Tap the button below to sign in to ${esc(brand.storeName)}. No password needed.`,
    },
    verify: {
      subject: `Confirm your email for ${brand.storeName}`,
      preheader: "Confirm your email address to activate your account.",
      heading: "Confirm your email",
      lead: "Tap the button below to confirm this address and finish setting up your account.",
    },
    reset: {
      subject: `Reset your ${brand.storeName} password`,
      preheader: "Use this secure link to get back into your account.",
      heading: "Reset your password",
      lead:
        "Tap the button below to sign in securely. Once you're in, you can set a new password " +
        "from your account settings.",
    },
  }[intent] || {};

  const html = renderLayout({
    ...brand,
    preheader: copy.preheader,
    heading: copy.heading,
    bodyHtml: `
      <p style="margin:0 0 4px;">${copy.lead}</p>
      ${button(intent === "reset" ? "Sign in securely" : "Sign in", link)}
      ${panel(
        `<strong style="color:#0f172a;">This link expires in 15 minutes and can only be used once.</strong><br>
         If you didn't request it, you can safely ignore this email — nothing will change.`
      )}
      <p style="margin:18px 0 0;font-size:13px;color:#94a3b8;word-break:break-all;">
        If the button doesn't work, paste this into your browser:<br>
        <a href="${esc(link)}" style="color:#475569;">${esc(link)}</a>
      </p>`,
  });

  await sendAndLog({ to: email, subject: copy.subject, html });
}

// ---------------------------------------------------------------------------
// Welcome
// ---------------------------------------------------------------------------
async function sendWelcomeEmail(email, { name } = {}) {
  const brand = await brandContext();
  const html = renderLayout({
    ...brand,
    preheader: `Welcome to ${brand.storeName} — here's how to get started.`,
    heading: name ? `Welcome, ${esc(String(name).split(" ")[0])}` : `Welcome to ${esc(brand.storeName)}`,
    bodyHtml: `
      <p style="margin:0 0 14px;">Your account is ready. Everything you buy lands in your library
      instantly and stays there for life — no subscription, no expiry.</p>
      ${button("Go to My Library", `${brand.appUrl}/my-library`)}
      ${panel(
        `<strong style="color:#0f172a;">Signing in later</strong><br>
         You don't need a password. Enter your email on the sign-in page and we'll send you a
         secure link. You can add a password from your account settings if you'd rather.`
      )}`,
  });
  return sendAndLog({ to: email, subject: `Welcome to ${brand.storeName}`, html });
}

// ---------------------------------------------------------------------------
// Purchase receipt / order confirmation
// ---------------------------------------------------------------------------
// One email deliberately covers order confirmation, payment confirmation, the
// itemised receipt, product access and support contact: they all describe the
// same event, and splitting them into four messages for one purchase is how
// transactional mail ends up in spam folders.
async function sendPurchaseReceiptEmail(
  email,
  { orderItems, totalCents, magicLink, orderId, discountCents = 0, customerName, provider }
) {
  const brand = await brandContext();
  const settings = await getSettings();
  const currency = settings.currency || "USD";
  const count = orderItems.length;

  const html = renderLayout({
    ...brand,
    preheader: `Payment confirmed — ${count} ${count === 1 ? "plan is" : "plans are"} ready in your library.`,
    heading: "Payment confirmed",
    bodyHtml: `
      <p style="margin:0 0 6px;">${customerName ? `Thanks, ${esc(String(customerName).split(" ")[0])}. ` : "Thanks for your purchase. "}
      Your payment went through and ${count === 1 ? "your plan is" : "all of your plans are"} unlocked and waiting in your library.</p>

      ${button("Open My Library", `${brand.appUrl}/my-library`)}

      <h2 style="margin:26px 0 2px;font-size:17px;font-weight:800;color:#0f172a;">Your order</h2>
      ${orderTable({ orderItems, totalCents, discountCents, currency })}

      ${panel(
        `${orderId ? `<strong style="color:#0f172a;">Order reference</strong><br>${esc(orderId)}<br><br>` : ""}
         ${provider ? `<strong style="color:#0f172a;">Paid with</strong><br>${esc(provider === "paypal" ? "PayPal" : "Card")}<br><br>` : ""}
         <strong style="color:#0f172a;">Keep this email</strong><br>
         It's your receipt. Lifetime access — re-download any time.`
      )}

      ${
        magicLink
          ? `<p style="margin:20px 0 0;font-size:13px;line-height:1.6;color:#94a3b8;">
               Opening this on a different device? Use this one-time link to sign in:<br>
               <a href="${esc(magicLink)}" style="color:#475569;word-break:break-all;">${esc(magicLink)}</a>
             </p>`
          : ""
      }`,
  });

  return sendAndLog({
    to: email,
    subject: `Your ${brand.storeName} order is ready${orderId ? ` (${String(orderId).slice(-8)})` : ""}`,
    html,
  });
}

// ---------------------------------------------------------------------------
// Contact form
// ---------------------------------------------------------------------------
// Two messages: the notification to the office inbox, and an acknowledgement
// to the person who wrote in. The notification sets replyTo to the enquirer so
// hitting Reply in the inbox goes to them rather than to the sender identity.
async function sendContactNotificationEmail(inbox, { name, email, lines }) {
  const brand = await brandContext();
  const html = renderLayout({
    ...brand,
    preheader: `New enquiry from ${name}`,
    heading: "New enquiry",
    bodyHtml: `
      ${panel(lines.map((l) => esc(l)).join("<br>"))}
      <p style="margin:16px 0 0;font-size:14px;">Reply directly to this email to answer
      <a href="mailto:${esc(email)}" style="color:#0f172a;font-weight:600;">${esc(email)}</a>.</p>`,
  });

  const from = await getFrom();
  const result = await resend.emails.send({
    from,
    to: inbox,
    replyTo: email,
    subject: `New enquiry — ${name}`,
    html,
  });
  try {
    await prisma.emailLog.create({
      data: {
        recipient: inbox,
        subject: `New enquiry — ${name}`,
        status: result && result.error ? "failed" : "sent",
        providerResponse: JSON.stringify((result && (result.error || result.data)) || {}),
      },
    });
  } catch (err) {
    console.error("Failed to write EmailLog:", err);
  }
  return result;
}

async function sendContactAcknowledgementEmail(email, { name } = {}) {
  const brand = await brandContext();
  const html = renderLayout({
    ...brand,
    preheader: "We've got your message and will be in touch shortly.",
    heading: "Thanks for getting in touch",
    bodyHtml: `
      <p style="margin:0 0 12px;">${name ? `Hi ${esc(String(name).split(" ")[0])}, ` : ""}we've received your
      message and someone will read it properly — expect a reply within one working day.</p>
      ${panel(`Need it sooner? Reply to this email or write to
        <a href="mailto:${esc(brand.supportEmail)}" style="color:#0f172a;font-weight:600;">${esc(brand.supportEmail)}</a>.`)}`,
  });
  return sendAndLog({ to: email, subject: `We've got your message — ${brand.storeName}`, html });
}

// ---------------------------------------------------------------------------
// Ad hoc email composed by an admin from the Customers page.
// ---------------------------------------------------------------------------
// Returns the provider result so callers that need to know whether delivery
// actually succeeded can check `result.error`. Resend's SDK resolves with an
// { error } object rather than rejecting, so awaiting alone is NOT enough to
// detect a failed send.
async function sendAdminEmail(email, { subject, body }) {
  const brand = await brandContext();
  const html = renderLayout({
    ...brand,
    preheader: subject,
    heading: subject,
    bodyHtml: `<p style="margin:0;">${esc(body).replace(/\n/g, "<br>")}</p>`,
  });
  return sendAndLog({ to: email, subject, html });
}

module.exports = {
  sendMagicLinkEmail,
  sendWelcomeEmail,
  sendPurchaseReceiptEmail,
  sendContactNotificationEmail,
  sendContactAcknowledgementEmail,
  sendAdminEmail,
  SUPPORT_EMAIL,
};
