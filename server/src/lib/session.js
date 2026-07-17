const crypto = require("crypto");
const { prisma } = require("../db");
const { CSRF_COOKIE, deriveCsrfToken, tokensMatch } = require("./csrf");

const SESSION_COOKIE = "profit_session";
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(rawToken).digest("hex");
}

async function createSession(userId) {
  const rawToken = crypto.randomBytes(32).toString("hex");
  await prisma.session.create({
    data: {
      userId,
      tokenHash: hashToken(rawToken),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });
  return rawToken;
}

async function getUserBySessionToken(rawToken) {
  if (!rawToken) return null;
  const session = await prisma.session.findUnique({
    where: { tokenHash: hashToken(rawToken) },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) return null;
  if (session.user.status === "suspended") return null;
  return session.user;
}

async function revokeSession(rawToken) {
  if (!rawToken) return;
  await prisma.session.deleteMany({ where: { tokenHash: hashToken(rawToken) } });
}

function setSessionCookie(res, rawToken) {
  res.cookie(SESSION_COOKIE, rawToken, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
  // Deliberately NOT httpOnly — the frontend JS must be able to read this
  // and echo it back as a header on mutating requests (see assets/js/api.js
  // and assets/js/admin/api.js). It carries no authority on its own (it's
  // useless without the HttpOnly session cookie to derive it from), so
  // exposing it to JS doesn't weaken anything.
  res.cookie(CSRF_COOKIE, deriveCsrfToken(rawToken), {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: "/" });
  res.clearCookie(CSRF_COOKIE, { path: "/" });
}

// Sessions that existed before CSRF protection was added (or any session
// whose CSRF cookie was lost/cleared client-side without the session itself
// being lost) won't have a matching CSRF cookie yet. Rather than locking
// every already-logged-in user out of every mutating action until they log
// out and back in, silently top up the CSRF cookie on any authenticated
// request that's missing (or has a stale) one — safe request methods like
// GET happen constantly and naturally heal this before the user ever
// attempts a mutating request.
function ensureCsrfCookie(req, res, sessionRawToken) {
  const expected = deriveCsrfToken(sessionRawToken);
  if (tokensMatch(req.cookies && req.cookies[CSRF_COOKIE], expected)) return;
  res.cookie(CSRF_COOKIE, expected, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS,
    path: "/",
  });
}

module.exports = {
  SESSION_COOKIE,
  createSession,
  getUserBySessionToken,
  revokeSession,
  setSessionCookie,
  clearSessionCookie,
  ensureCsrfCookie,
};
