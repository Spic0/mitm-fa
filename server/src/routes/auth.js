const express = require("express");
const { prisma } = require("../db");
const { hashPassword, verifyPassword, passwordPolicyError } = require("../lib/password");
const { requireAuth } = require("../middleware/auth");
const { createMagicLinkToken, buildMagicLinkUrl, consumeMagicLinkToken } = require("../lib/magicLink");
const { sendMagicLinkEmail, sendWelcomeEmail } = require("../lib/email");
const { createSession, setSessionCookie, clearSessionCookie, SESSION_COOKIE, revokeSession } = require("../lib/session");
const { logEvent } = require("../lib/adminLog");
const { authLimiter, magicLinkLimiter } = require("../middleware/rateLimit");
const loginAttempts = require("../lib/loginAttempts");
const { greetingName, initials } = require("../lib/customerProfile");
const { normalizeImageUrl } = require("../lib/media");

const router = express.Router();

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Requesting a magic link both logs in existing users and silently creates new
// accounts for first-time visitors — there is no separate "sign up" step.
router.post("/magic-link", magicLinkLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address" });
  }

  let user = await prisma.user.findUnique({ where: { email } });
  let isNewUser = false;
  if (!user) {
    user = await prisma.user.create({ data: { email } });
    isNewUser = true;
    await logEvent({ category: "user", message: `New user registered: ${email}`, actorId: user.id });
  }

  // "verify" for a brand-new address (this link is what proves the mailbox),
  // "reset" when the caller is coming from a forgotten-password prompt, plain
  // "signin" otherwise. Same single-use token in every case — only the wording
  // differs, so there's one token path to get right rather than three.
  const intent = isNewUser ? "verify" : req.body.intent === "reset" ? "reset" : "signin";
  const rawToken = await createMagicLinkToken(user.id);
  await sendMagicLinkEmail(email, buildMagicLinkUrl(rawToken), intent);

  // Welcome goes out alongside the very first verification link, so a new
  // account gets both "confirm this address" and "here's how the account
  // works" without waiting for a purchase.
  if (isNewUser) {
    sendWelcomeEmail(email).catch((err) => console.error("Failed to send welcome email:", err));
  }

  res.json({ ok: true, message: "Check your email for a sign-in link." });
});

router.get("/verify", authLimiter, async (req, res) => {
  const token = String(req.query.token || "");
  const user = await consumeMagicLinkToken(token);
  if (!user) {
    return res.redirect("/login?error=expired");
  }
  if (user.status === "suspended") {
    return res.redirect("/login?error=suspended");
  }
  const sessionToken = await createSession(user.id);
  setSessionCookie(res, sessionToken);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await logEvent({
    category: "auth",
    message: `${user.role === "admin" ? "Admin login" : "Login"}: ${user.email} (magic link)`,
    actorId: user.id,
  });
  if (user.role === "admin") return res.redirect("/admin/manage/dashboard");
  res.redirect((await needsSetup(user)) ? "/welcome" : "/my-library");
});

// Where a customer lands after a magic link: the onboarding wizard the first
// time, their library every time after.
//
// "First time" is derived, not stored — there is no setup-complete flag to
// keep in sync. Two conditions, both of which have to hold:
//
//   no passwordHash   the wizard's job is to set one, so an account that has
//                     one has already been through it (or the customer set a
//                     password some other way, which is the same thing).
//   a paid order      this is the POST-PURCHASE claim flow. Someone who
//                     requested a sign-in link to browse has bought nothing
//                     to be onboarded to, and sending them through "your
//                     program is ready" would be a lie.
//
// Deliberately a redirect and not a page the token lands on: the magic-link
// token has already been consumed by the time this runs (single-use, see
// consumeMagicLinkToken), the session cookie is already set, and the
// redirect is what gets the token out of the address bar before the customer
// sees any UI. The wizard itself is an ordinary authenticated page with no
// token of its own to leak, reuse or expire.
async function needsSetup(user) {
  if (user.passwordHash) return false;
  const paid = await prisma.order.findFirst({
    where: { userId: user.id, status: "paid" },
    select: { id: true },
  });
  return !!paid;
}

router.post("/logout", async (req, res) => {
  await revokeSession(req.cookies ? req.cookies[SESSION_COOKIE] : null);
  clearSessionCookie(res);
  res.json({ ok: true });
});

// Called by the header wiring on literally every page load, so it carries
// the handful of presentation fields the customer surfaces need for their
// first paint — the greeting name and the avatar. Adding them here rather
// than making My Library open with a second round trip for a string it
// needs above the fold. Nothing sensitive: the caller is the account owner
// and every field is one they typed themselves.
router.get("/me", (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      hasPassword: !!req.user.passwordHash,
      displayName: req.user.displayName || "",
      greetingName: greetingName(req.user),
      avatarUrl: req.user.avatarUrl ? normalizeImageUrl(req.user.avatarUrl) : null,
      initials: initials(req.user),
    },
  });
});

// Optional convenience for users who choose to set a password from account
// settings. Setting a *new* password (no existing hash) only needs the
// current session, same as before. Changing an *existing* password requires
// re-entering the current one — otherwise a hijacked session cookie could be
// used to plant a permanent password and retain access after the real owner
// signs out or their session expires.
router.post("/set-password", requireAuth, async (req, res) => {
  const password = String(req.body.password || "");
  const policyError = passwordPolicyError(password);
  if (policyError) {
    return res.status(400).json({ error: policyError });
  }
  if (req.user.passwordHash) {
    const currentPassword = String(req.body.currentPassword || "");
    if (!(await verifyPassword(currentPassword, req.user.passwordHash))) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
  }
  const passwordHash = await hashPassword(password);
  await prisma.user.update({ where: { id: req.user.id }, data: { passwordHash } });
  await logEvent({ category: "auth", message: `Password changed: ${req.user.email}`, actorId: req.user.id });
  res.json({ ok: true });
});

router.post("/login-password", authLimiter, async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");

  if (loginAttempts.isLocked(email)) {
    await logEvent({ category: "auth", message: `Login blocked (too many failed attempts): ${email}` });
    return res.status(429).json({ error: "Too many failed attempts. Please wait a few minutes and try again." });
  }

  const user = await prisma.user.findUnique({ where: { email } });
  if (!user || !user.passwordHash || !(await verifyPassword(password, user.passwordHash))) {
    loginAttempts.recordFailure(email);
    await logEvent({ category: "auth", message: `Failed login attempt: ${email}` });
    return res.status(401).json({ error: "Invalid email or password" });
  }
  if (user.status === "suspended") {
    // Deliberately the same generic message as a bad password — confirming
    // "this account exists but is suspended" to an unauthenticated caller is
    // its own account-enumeration leak.
    loginAttempts.recordFailure(email);
    await logEvent({ category: "auth", message: `Login blocked (suspended account): ${email}`, actorId: user.id });
    return res.status(401).json({ error: "Invalid email or password" });
  }
  loginAttempts.recordSuccess(email);
  const sessionToken = await createSession(user.id);
  setSessionCookie(res, sessionToken);
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
  await logEvent({
    category: "auth",
    message: `${user.role === "admin" ? "Admin login" : "Login"}: ${user.email} (password)`,
    actorId: user.id,
  });
  res.json({ ok: true });
});

module.exports = router;
