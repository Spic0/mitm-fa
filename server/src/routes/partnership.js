// Enquiries from the setup wizard on /partnership (served inside the
// /partnership/offer frame). Same wizard, same request body and same
// destination as a private deck's POST /api/presentation/:slug/contact, minus
// the deck: an email to CONTACT_INBOX (logged in EmailLog) and an admin
// activity log entry. Anonymous, so outside CSRF scope unless a session
// exists (middleware/csrf.js).
const express = require("express");
const { offerLimiter } = require("../middleware/rateLimit");
const { sendContactNotificationEmail } = require("../lib/email");
const { logEvent } = require("../lib/adminLog");

const router = express.Router();
const CONTACT_INBOX = process.env.CONTACT_INBOX || "info@fitness.agency";

const clean = (v, max) => String(v == null ? "" : v).trim().slice(0, max);
const looksLikeEmail = (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

// Pure, so it can be tested without HTTP: returns { error } or { enquiry }.
// Same clamps and checks as the deck endpoint.
function validateEnquiry(body) {
  const b = body || {};
  const name = clean(b.name, 120);
  const email = clean(b.email, 200);
  if (!name) return { error: "Please tell us your name" };
  if (!looksLikeEmail(email)) return { error: "Please enter a valid email address" };
  return {
    enquiry: {
      name,
      email,
      company: clean(b.company, 160),
      message: clean(b.message, 4000),
      intent: clean(b.intent, 60) || "Partnership estimate",
    },
  };
}

router.post("/", offerLimiter, async (req, res) => {
  // Honeypot: a field no person fills in. Pretend it worked.
  if (clean(req.body && req.body.hp_url, 10)) return res.json({ ok: true });

  const { error, enquiry: e } = validateEnquiry(req.body);
  if (error) return res.status(400).json({ error });

  const lines = [
    "Source: /partnership setup wizard",
    `Intent: ${e.intent}`,
    "",
    `Name: ${e.name}`,
    `Email: ${e.email}`,
    e.company ? `Company: ${e.company}` : null,
    "",
    e.message || "(no message)",
  ].filter((line) => line !== null);

  try {
    const result = await sendContactNotificationEmail(CONTACT_INBOX, { name: e.name, email: e.email, lines });
    // Resend resolves with { error } instead of rejecting.
    if (result && result.error) throw new Error(result.error.message || "Email provider rejected the message");
  } catch (err) {
    await logEvent({ category: "partnership", message: `Partnership enquiry from ${e.email} FAILED to send: ${err.message}` }).catch(() => {});
    return res.status(502).json({ error: "We couldn't send that just now. Please email us directly." });
  }

  await logEvent({ category: "partnership", message: `Partnership enquiry from ${e.name} <${e.email}> (${e.intent})` }).catch(() => {});
  res.json({ ok: true });
});

module.exports = router;
module.exports.validateEnquiry = validateEnquiry;
