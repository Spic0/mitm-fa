// Public contact/partnership enquiries from the Contact wizard.
//
// Anonymous by design, so it is deliberately outside CSRF scope (see
// middleware/csrf.js — a request with no session carries no ambient authority
// to steal) and leans on the rate limiter instead.
//
// The wizard's qualifying answers (who you are, what you want, audience size)
// are carried as free-form strings but validated against fixed allowlists
// here rather than trusted, so a hand-rolled POST cannot inject arbitrary
// text into the notification email.
const express = require("express");
const { apiLimiter } = require("../middleware/rateLimit");
const { sendContactNotificationEmail, sendContactAcknowledgementEmail } = require("../lib/email");
const { logEvent } = require("../lib/adminLog");

const router = express.Router();

const CONTACT_INBOX = process.env.CONTACT_INBOX || "office@fitness.agency";

// Kept in sync with the wizard's steps in assets/js/contact-wizard.js. Any
// value outside these is stored as "Other" rather than rejected outright —
// a mismatch after a copy change should not lose a real lead.
const ROLES = ["Athlete", "Coach", "Influencer", "Gym", "Nutritionist", "Brand"];
const GOALS = [
  "Sell training plans",
  "Sell nutrition plans",
  "Grow audience",
  "Content creation",
  "Platform migration",
  "Other",
];
const AUDIENCES = ["Under 5k", "5k-25k", "25k-100k", "100k+"];

function pick(value, allowed) {
  const v = String(value == null ? "" : value).trim();
  return allowed.includes(v) ? v : "Other";
}

function clean(value, max) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

// Deliberately permissive: the goal is to catch typos, not to police valid
// addresses. Anything that round-trips to a real inbox should get through.
function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

router.post("/", apiLimiter, async (req, res) => {
  const body = req.body || {};

  const name = clean(body.name, 120);
  const email = clean(body.email, 200);
  const instagram = clean(body.instagram, 120);
  const message = clean(body.message, 4000);

  if (!name) return res.status(400).json({ error: "Please tell us your name" });
  if (!looksLikeEmail(email)) return res.status(400).json({ error: "Please enter a valid email address" });

  const role = pick(body.role, ROLES);
  const goal = pick(body.goal, GOALS);
  const audience = pick(body.audience, AUDIENCES);

  const summary = [
    `Role: ${role}`,
    `Goal: ${goal}`,
    `Audience: ${audience}`,
    "",
    `Name: ${name}`,
    `Email: ${email}`,
    instagram ? `Instagram: ${instagram}` : null,
    "",
    message || "(no message)",
  ].filter((line) => line !== null);

  try {
    const result = await sendContactNotificationEmail(CONTACT_INBOX, {
      name,
      email,
      lines: summary,
    });
    // Resend resolves with an { error } object instead of rejecting, so
    // awaiting is not enough — without this check a misconfigured or expired
    // API key would return "Thanks, we've got it" to the sender while the
    // enquiry went nowhere.
    if (result && result.error) {
      throw new Error(result.error.message || "Email provider rejected the message");
    }
  } catch (err) {
    // The lead still gets recorded below even if delivery fails, so a mail
    // outage doesn't silently drop it. Surfaced as a 502 so the wizard can
    // offer the mailto fallback rather than claiming success.
    await logEvent({
      category: "contact",
      message: `Contact enquiry from ${email} FAILED to send: ${err.message}`,
    }).catch(() => {});
    return res.status(502).json({ error: "We couldn't send that just now — please email us directly." });
  }

  // Acknowledgement to the enquirer. Deliberately after the 502 branch above
  // and deliberately non-fatal: the notification reaching the office is what
  // makes the enquiry "received", so a failed courtesy copy must not turn a
  // successfully delivered lead into an error for the sender.
  sendContactAcknowledgementEmail(email, { name }).catch((err) => {
    logEvent({
      category: "contact",
      message: `Contact acknowledgement to ${email} failed: ${err.message}`,
    }).catch(() => {});
  });

  await logEvent({
    category: "contact",
    message: `Contact enquiry from ${name} <${email}> — ${role} / ${goal} / ${audience}`,
  }).catch(() => {});

  res.json({ ok: true });
});

module.exports = router;
