const crypto = require("crypto");

const CSRF_COOKIE = "profit_csrf";
const CSRF_HEADER = "x-csrf-token";

// The token is not random/stored — it's an HMAC of the session's own raw
// token, keyed by a server-only secret. That makes it a "signed double
// submit cookie": the value that ends up in the (non-HttpOnly, JS-readable)
// CSRF cookie is worthless to forge without CSRF_SECRET, and worthless to
// predict without also holding the real (HttpOnly) session cookie — so it
// needs no database row of its own, and it automatically rotates whenever
// the session it's derived from rotates (new login = new session token =
// new CSRF token, with zero extra code).
function deriveCsrfToken(sessionRawToken) {
  const secret = process.env.CSRF_SECRET;
  if (!secret) throw new Error("CSRF_SECRET is not configured");
  return crypto.createHmac("sha256", secret).update(sessionRawToken).digest("hex");
}

function tokensMatch(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

module.exports = { CSRF_COOKIE, CSRF_HEADER, deriveCsrfToken, tokensMatch };
