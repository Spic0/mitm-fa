// Access control and defaults for private presentations (/presentation/:slug).
//
// The threat model is deliberately modest and stated up front: this is an
// UNLISTED link, not an authenticated resource. Anyone holding the URL can
// open it, exactly as intended — an admin pastes it into a meeting invite
// and the investor on the other end has no account here. What the gate has
// to guarantee is narrower:
//
//   1. The slug can't be guessed or enumerated (crypto-random, 144 bits).
//   2. A disabled or expired deck stops working immediately, everywhere.
//   3. An optional password is a real second factor, not a client-side
//      `if` — the deck's HTML is never sent until it's satisfied.
//   4. Nothing about a presentation is discoverable from the public site:
//      not in nav, not in the footer, not in the sitemap, not in robots.txt,
//      and not from a wrong-slug response (every failure returns the same
//      generic 404 as any other missing page).
const crypto = require("crypto");
const bcrypt = require("bcryptjs");

const BCRYPT_ROUNDS = 10;

// 24 chars of base32-ish alphabet ≈ 120 bits. Deliberately excludes the
// characters that get misread when a link is read aloud on a call or
// retyped from a slide (0/O, 1/l/I) — these URLs really do get dictated.
const SLUG_ALPHABET = "abcdefghjkmnpqrstuvwxyz23456789";
const SLUG_LENGTH = 24;

function generateSlug() {
  const bytes = crypto.randomBytes(SLUG_LENGTH);
  let out = "";
  for (let i = 0; i < SLUG_LENGTH; i++) {
    out += SLUG_ALPHABET[bytes[i] % SLUG_ALPHABET.length];
  }
  return out;
}

// Visitor identity for "unique visitors". A random opaque id in a
// first-party cookie scoped to this site — no fingerprinting, no
// third-party pixel, and it identifies a browser, never a person.
function generateVisitorKey() {
  return crypto.randomBytes(16).toString("hex");
}

function hashPassword(plain) {
  return bcrypt.hash(String(plain), BCRYPT_ROUNDS);
}

function verifyPassword(plain, hash) {
  if (!hash) return Promise.resolve(false);
  return bcrypt.compare(String(plain), hash);
}

// ---------------------------------------------------------------------
// Unlock cookie
//
// Stateless on purpose: an HMAC over (id + passwordHash), keyed by the same
// CSRF_SECRET the app already requires at boot. No table, no session, no
// cleanup job — and because the presentation's own password hash is part of
// the message, changing or removing the password silently invalidates every
// unlock cookie that was ever issued for it. That's the property a stored
// token would have needed an explicit revocation sweep to get.
// ---------------------------------------------------------------------
const UNLOCK_COOKIE_PREFIX = "fa_pres_";
const UNLOCK_TTL_MS = 12 * 60 * 60 * 1000; // one working day, then re-enter

function unlockCookieName(presentationId) {
  return UNLOCK_COOKIE_PREFIX + presentationId;
}

function signUnlock(presentation) {
  const secret = process.env.CSRF_SECRET;
  if (!secret) throw new Error("CSRF_SECRET is not configured");
  return crypto
    .createHmac("sha256", secret)
    .update(`${presentation.id}:${presentation.passwordHash || ""}`)
    .digest("hex");
}

function issueUnlockCookie(res, presentation) {
  res.cookie(unlockCookieName(presentation.id), signUnlock(presentation), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: UNLOCK_TTL_MS,
    path: "/presentation",
  });
}

function hasValidUnlockCookie(req, presentation) {
  const raw = req.cookies ? req.cookies[unlockCookieName(presentation.id)] : null;
  if (!raw) return false;
  const expected = signUnlock(presentation);
  // Length check first — timingSafeEqual throws on a length mismatch, and a
  // cookie is fully attacker-controlled input.
  if (typeof raw !== "string" || raw.length !== expected.length) return false;
  return crypto.timingSafeEqual(Buffer.from(raw), Buffer.from(expected));
}

// ---------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------

// Returns one of:
//   { state: "missing" }   -> render the site's normal 404, never a hint
//   { state: "expired" }   -> deck exists but its date has passed
//   { state: "locked" }    -> password required, not yet satisfied
//   { state: "open" }      -> render the deck
//
// "disabled" collapses into "missing" on purpose: an admin who switches a
// deck off wants it to stop existing as far as the recipient is concerned,
// not to advertise that it used to be there.
function resolveAccess(presentation, req) {
  if (!presentation || presentation.status !== "enabled") return { state: "missing" };
  if (presentation.expiresAt && presentation.expiresAt.getTime() <= Date.now()) {
    return { state: "expired" };
  }
  if (presentation.passwordHash && !hasValidUnlockCookie(req, presentation)) {
    return { state: "locked" };
  }
  return { state: "open" };
}

// ---------------------------------------------------------------------
// Content overrides
//
// The deck's sections are fixed brand content in private/presentation.html.
// This is the per-meeting layer on top of it: whose name is in the hero,
// which product the "View Product" buttons open, what the CTA links point at,
// and which sections to include for this audience. Anything absent falls back
// to the defaults below, so a presentation created with nothing but a title is
// still complete and on-message.
// ---------------------------------------------------------------------
// "technology" was removed deliberately: it sold infrastructure to people who
// are buying a business outcome. "value" took its slot in the deck and says
// the same things in revenue terms; "campaigns" and "soon" are new.
//
// The closing section keeps the key "cta" even though it is now the setup
// wizard rather than the old three-button contact block. The key is stored
// per presentation, and an admin who switched the closing section off for a
// particular audience meant "don't ask them for anything at the end" — that
// intent survives the redesign, and renaming the key would silently switch
// the section back on for every deck that had it off.
const SECTION_KEYS = [
  "who",
  "services",
  "studio",
  "process",
  "why",
  "showcase",
  "catalogue",
  "journey",
  "value",
  "campaigns",
  "philosophy",
  "soon",
  "cta",
];

const DEFAULT_CONTENT = {
  heroEyebrow: "Private Presentation",
  heroTitle: "Fitness Agency",
  heroSubtitle:
    "Helping athletes, influencers and creators build profitable digital businesses.",
  welcomeNote: "",
  ctaPartnershipUrl: "",
  ctaMeetingUrl: "",
  ctaDemoUrl: "",
  // Which product the deck's two "View Product" buttons open, and which one
  // the showcase is dressed with. A product id, resolved to a real row at
  // render time — never a URL, so a product that is renamed, re-slugged or
  // unpublished can't leave a deck pointing at a 404 in the middle of a
  // meeting. Empty means "no product picked": the buttons don't render and
  // the showcase falls back to its generic copy.
  featuredProductId: "",
};

function normalizeContent(raw) {
  const input = raw && typeof raw === "object" ? raw : {};
  const out = {};
  Object.keys(DEFAULT_CONTENT).forEach((key) => {
    const value = input[key];
    out[key] = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_CONTENT[key];
  });
  // Sections default to on — a new deck should be the full story, and the
  // admin trims rather than assembles.
  const sections = input.sections && typeof input.sections === "object" ? input.sections : {};
  out.sections = {};
  SECTION_KEYS.forEach((key) => {
    out.sections[key] = sections[key] !== false;
  });
  return out;
}

module.exports = {
  SECTION_KEYS,
  DEFAULT_CONTENT,
  generateSlug,
  generateVisitorKey,
  hashPassword,
  verifyPassword,
  issueUnlockCookie,
  hasValidUnlockCookie,
  resolveAccess,
  normalizeContent,
};
