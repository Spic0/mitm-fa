const { rateLimit, ipKeyGenerator } = require("express-rate-limit");

// In-memory store (express-rate-limit's default) is sufficient for the
// current single-instance deployment. If this app is ever run behind a
// load balancer with multiple Node processes, swap in a shared store (e.g.
// rate-limit-redis) or these limits become per-instance instead of global.

// Credential-guessing surface: login, magic-link request, magic-link
// consumption. Keyed by IP; deliberately tight since a legitimate user
// rarely needs more than a couple of attempts per minute.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

// Magic-link request specifically also needs a per-email cap independent of
// IP, so an attacker can't email-bomb one inbox from many source IPs/NAT.
const magicLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => {
    const email = String(req.body?.email || "").trim().toLowerCase();
    return email || ipKeyGenerator(req.ip);
  },
  message: { error: "Too many sign-in links requested for this address. Please wait a few minutes." },
});

// Looser general-purpose limiter for expensive/abusable non-auth endpoints
// (checkout intent creation, uploads).
const apiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 100,
  standardHeaders: true,
  legacyHeaders: false,
});

// Promo code guessing surface: /api/promotions/validate lets an anonymous
// caller test arbitrary strings against real codes. apiLimiter's 100/15min
// is far too loose to slow down enumeration of short alphanumeric codes —
// this mirrors authLimiter's tightness instead.
const promoValidateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: "Too many promo code attempts. Please wait a few minutes and try again." },
});

// Private-presentation password entry. Same reasoning as promoValidateLimiter:
// an anonymous caller holding the link can test passwords against it, and
// apiLimiter's 100/15min would barely slow a dictionary run. Tight, and keyed
// by IP since there is no account to key on.
const presentationUnlockLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => ipKeyGenerator(req.ip),
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

// Presentation engagement heartbeats. Deliberately far looser than apiLimiter:
// a real 45-minute meeting on one deck legitimately sends a heartbeat every
// 30s from a single IP, which apiLimiter's 100/15min would cut off mid-pitch —
// and the write it guards is a single bounded UPDATE on one row.
const presentationTrackLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 400,
  standardHeaders: true,
  legacyHeaders: false,
});

// The authenticated admin API. This used to run on apiLimiter, which was fine
// while the admin panel was request-light — the old product wizard saved once
// per step. The Product Builder autosaves continuously, so a creator building
// a 12-week program blows past 100 requests in a few minutes and autosave
// starts failing, which is the one thing it must never do. Everything behind
// here is already past requireAuth, so this is a runaway-client backstop
// rather than an abuse control: keyed per admin so one busy builder session
// can't lock a colleague out from the same office IP.
const adminLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 1500,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => (req.user ? `admin:${req.user.id}` : ipKeyGenerator(req.ip)),
  message: { error: "Too many requests. Give it a moment and try again." },
});

module.exports = {
  authLimiter,
  magicLinkLimiter,
  apiLimiter,
  adminLimiter,
  promoValidateLimiter,
  presentationUnlockLimiter,
  presentationTrackLimiter,
};
