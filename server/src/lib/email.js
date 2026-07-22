const { Resend } = require("resend");
const { prisma } = require("../db");
const { getStoreName } = require("./settings");

const resend = new Resend(process.env.RESEND_API_KEY);

// RESEND_FROM_EMAIL is an operator-controlled override; otherwise the from
// name follows the configured store name so it stays in sync with Settings.
async function getFrom() {
  if (process.env.RESEND_FROM_EMAIL) return process.env.RESEND_FROM_EMAIL;
  const storeName = await getStoreName();
  return `${storeName} <onboarding@resend.dev>`;
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

async function sendMagicLinkEmail(email, link) {
  const storeName = await getStoreName();
  await sendAndLog({
    to: email,
    subject: `Your ${storeName} sign-in link`,
    html: `
      <p>Click the link below to sign in to ${storeName}. This link expires in 15 minutes and can only be used once.</p>
      <p><a href="${link}">${link}</a></p>
      <p>If you didn't request this, you can safely ignore this email.</p>
    `,
  });
}

async function sendPurchaseReceiptEmail(email, { orderItems, totalCents, magicLink }) {
  const storeName = await getStoreName();
  const itemsHtml = orderItems
    .map((item) => `<li>${item.product.name} — $${(item.priceCents / 100).toFixed(2)}</li>`)
    .join("");
  await sendAndLog({
    to: email,
    subject: `Your ${storeName} purchase is ready`,
    html: `
      <p>Thanks for your purchase! Your total was $${(totalCents / 100).toFixed(2)}.</p>
      <ul>${itemsHtml}</ul>
      <p>You're already signed in on this device. On a new device, use this link to access your library: <a href="${magicLink}">${magicLink}</a></p>
    `,
  });
}

// Ad hoc email composed by an admin from the Customers page.
// Returns the provider result so callers that need to know whether delivery
// actually succeeded can check `result.error`. Resend's SDK resolves with an
// { error } object rather than rejecting, so awaiting alone is NOT enough to
// detect a failed send — the contact route depends on this to avoid telling
// someone their enquiry was received when it was not. Existing callers that
// ignore the return value are unaffected.
async function sendAdminEmail(email, { subject, body }) {
  return sendAndLog({
    to: email,
    subject,
    html: `<p>${body.replace(/\n/g, "<br>")}</p>`,
  });
}

module.exports = { sendMagicLinkEmail, sendPurchaseReceiptEmail, sendAdminEmail };
