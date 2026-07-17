const { SESSION_COOKIE } = require("../lib/session");
const { CSRF_HEADER, deriveCsrfToken, tokensMatch } = require("../lib/csrf");

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

// Scope: CSRF only matters where a request relies on an ambient,
// browser-attached credential (the session cookie) to act as a specific
// user — that's the entire attack this defends against (a cross-site page
// making the victim's browser submit a request that rides their cookie).
// Requests with no session (req.user unset — anonymous checkout, magic-link
// request, login itself) carry no ambient authority to steal, so they're
// intentionally out of scope here; they're covered instead by the rate
// limiting added in middleware/rateLimit.js. The Stripe webhook is exempt by
// construction — it's mounted before cookieParser/attachUser in index.js, so
// it never reaches this middleware and is authenticated by Stripe's request
// signature instead, not by a cookie at all.
function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (!req.user) return next();

  const sessionToken = req.cookies ? req.cookies[SESSION_COOKIE] : null;
  const header = req.get(CSRF_HEADER);
  if (!sessionToken || !header || !tokensMatch(header, deriveCsrfToken(sessionToken))) {
    return res.status(403).json({ error: "Invalid or missing CSRF token" });
  }
  next();
}

module.exports = { csrfProtection };
