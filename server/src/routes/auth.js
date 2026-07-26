const express = require("express");
const bcrypt = require("bcryptjs");
const { prisma } = require("../db");
const { requireAuth } = require("../middleware/auth");
const { createMagicLinkToken, buildMagicLinkUrl, consumeMagicLinkToken } = require("../lib/magicLink");
const { sendMagicLinkEmail, sendWelcomeEmail } = require("../lib/email");
const { createSession, setSessionCookie, clearSessionCookie, SESSION_COOKIE, revokeSession } = require("../lib/session");
const { logEvent } = require("../lib/adminLog");
const { authLimiter, magicLinkLimiter } = require("../middleware/rateLimit");
const loginAttempts = require("../lib/loginAttempts");

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
  res.redirect(user.role === "admin" ? "/admin/manage/dashboard" : "/my-library");
});

router.post("/logout", async (req, res) => {
  await revokeSession(req.cookies ? req.cookies[SESSION_COOKIE] : null);
  clearSessionCookie(res);
  res.json({ ok: true });
});

router.get("/me", (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      role: req.user.role,
      hasPassword: !!req.user.passwordHash,
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
  if (password.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }
  if (req.user.passwordHash) {
    const currentPassword = String(req.body.currentPassword || "");
    if (!(await bcrypt.compare(currentPassword, req.user.passwordHash))) {
      return res.status(401).json({ error: "Current password is incorrect" });
    }
  }
  const passwordHash = await bcrypt.hash(password, 12);
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
  if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
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
