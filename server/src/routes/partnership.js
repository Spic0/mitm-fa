// Business offers from the /partnership form. Same delivery as the contact
// wizard (routes/contact.js): an email to the office inbox (logged in
// EmailLog), a courtesy acknowledgement, and an admin activity log entry.
// Anonymous, so outside CSRF scope unless a session exists (middleware/csrf.js).
const express = require("express");
const { offerLimiter } = require("../middleware/rateLimit");
const { sendContactNotificationEmail, sendContactAcknowledgementEmail } = require("../lib/email");
const { logEvent } = require("../lib/adminLog");
const { OFFER_TYPES, AUDIENCE_RANGES, COUNTRIES, BUDGET_RANGES } = require("../lib/partnership");

const router = express.Router();
const CONTACT_INBOX = process.env.CONTACT_INBOX || "info@fitness.agency";

const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const oneOf = (v, list) => list.find((o) => (o.value || o) === clean(v, 60));
const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

// Pure, so it can be tested without HTTP: returns { error } or { offer }.
function validateOffer(body) {
  const b = body || {};
  const type = oneOf(b.offerType, OFFER_TYPES);
  const name = clean(b.name, 120);
  const email = clean(b.email, 200);
  const country = oneOf(b.country, COUNTRIES);
  const message = clean(b.message, 4000);
  if (!type) return { error: "Please choose what kind of offer this is" };
  if (!name) return { error: "Please tell us your name" };
  if (!looksLikeEmail(email)) return { error: "Please enter a valid email address" };
  if (!country) return { error: "Please choose your country" };
  const audience = type.value === "creator" ? oneOf(b.audience, AUDIENCE_RANGES) : null;
  if (type.value === "creator" && !audience) return { error: "Please choose your audience size" };
  if (message.length < 10) return { error: "Please describe your offer" };
  return {
    offer: {
      type,
      name,
      email,
      country,
      message,
      audience,
      company: clean(b.company, 160),
      links: clean(b.links, 300),
      // Optional and brand-only; an unknown value is dropped, not rejected.
      budget: type.value === "brand" ? oneOf(b.budget, BUDGET_RANGES) || null : null,
    },
  };
}

router.post("/", offerLimiter, async (req, res) => {
  // Honeypot: hidden from people, filled in by bots. Pretend it worked.
  if (clean(req.body && req.body.hp_url, 10)) return res.json({ ok: true });

  const { error, offer } = validateOffer(req.body);
  if (error) return res.status(400).json({ error });
  const o = offer;

  const lines = [
    `Business offer: ${o.type.label}`,
    o.company ? `Company: ${o.company}` : null,
    o.links ? `Website / socials: ${o.links}` : null,
    o.audience ? `Audience: ${o.audience}` : null,
    o.budget ? `Budget: ${o.budget}` : null,
    `Country: ${o.country.label}`,
    "",
    `Name: ${o.name}`,
    `Email: ${o.email}`,
    "",
    o.message,
  ].filter((line) => line !== null);

  try {
    const result = await sendContactNotificationEmail(CONTACT_INBOX, { name: o.name, email: o.email, lines });
    // Resend resolves with { error } instead of rejecting.
    if (result && result.error) throw new Error(result.error.message || "Email provider rejected the message");
  } catch (err) {
    await logEvent({ category: "partnership", message: `Business offer from ${o.email} FAILED to send: ${err.message}` }).catch(() => {});
    return res.status(502).json({ error: "We couldn't send that just now. Please email us directly." });
  }

  sendContactAcknowledgementEmail(o.email, { name: o.name }).catch((err) => {
    logEvent({ category: "partnership", message: `Offer acknowledgement to ${o.email} failed: ${err.message}` }).catch(() => {});
  });
  await logEvent({
    category: "partnership",
    message: `Business offer (${o.type.label}) from ${o.name} <${o.email}>${o.company ? `, ${o.company}` : ""}`,
  }).catch(() => {});

  res.json({ ok: true });
});

module.exports = router;
module.exports.validateOffer = validateOffer;
