// Shaping and validation for the customer's own account record.
//
// The counterpart to routes/admin/customers.js, and deliberately a different
// thing: that one is staff editing somebody else's record and may touch
// role, status and internal notes. This is the customer editing their own,
// so the field list here is the whole allow-list — anything not named in
// EDITABLE_FIELDS cannot be written through the account API no matter what
// the client posts.
const { normalizeImageUrl } = require("./media");

// Exactly the fields My Profile offers. Kept as data rather than a series of
// `if (body.x !== undefined)` branches so that "what can a customer change
// about themselves" is one readable list, and so adding a field to the form
// without adding it here fails closed.
//
// Notably ABSENT, each for a reason:
//   email        — changing it changes what the account IS (orders, magic
//                  links and receipts are all keyed to it) and needs a
//                  verify-new-address round trip this UI does not have. The
//                  profile page shows it read-only and points at support.
//   role/status  — privilege. Never customer-writable.
//   notes        — admin-only free text about the customer.
//   passwordHash — has its own endpoint with its own re-auth rule.
const EDITABLE_FIELDS = ["name", "displayName", "phone", "country"];

const LIMITS = { name: 120, displayName: 40, phone: 40, country: 2 };

class ProfileError extends Error {}

function fail(message) {
  throw new ProfileError(message);
}

function cleanText(value, max, field) {
  if (value == null) return null;
  if (typeof value !== "string") fail(`${field} must be text`);
  const trimmed = value.trim().replace(/\s+/g, " ");
  if (!trimmed) return null;
  if (trimmed.length > max) fail(`${field} must be ${max} characters or fewer`);
  return trimmed;
}

// ISO 3166-1 alpha-2, matching what the checkout stores. Anything else is
// rejected rather than coerced: a two-letter code is what every consumer of
// this field (tax display, the admin customer table) already assumes.
function cleanCountry(value) {
  if (value == null) return null;
  const raw = String(value).trim().toUpperCase();
  if (!raw) return null;
  if (!/^[A-Z]{2}$/.test(raw)) fail("Country must be a two-letter country code");
  return raw;
}

// Permissive on purpose. Phone numbers arrive from a checkout used
// internationally, and the only thing worth rejecting is input that clearly
// is not a phone number at all — a stricter pattern would reject valid
// numbers from countries nobody tested with, which is worse than storing a
// slightly odd string the support team can read.
function cleanPhone(value) {
  if (value == null) return null;
  const raw = String(value).trim();
  if (!raw) return null;
  if (raw.length > LIMITS.phone) fail("Phone number is too long");
  if (!/^[0-9+()\-.\s]{5,}$/.test(raw)) fail("Enter a valid phone number");
  return raw;
}

// Turns a PATCH body into the exact `data` object for prisma.user.update.
// Only keys actually present in the body are included, so a form that posts
// one section does not blank the fields it did not render.
function buildProfileUpdate(body) {
  const input = body && typeof body === "object" ? body : {};
  const data = {};
  for (const field of EDITABLE_FIELDS) {
    if (!(field in input)) continue;
    if (field === "country") data.country = cleanCountry(input.country);
    else if (field === "phone") data.phone = cleanPhone(input.phone);
    else data[field] = cleanText(input[field], LIMITS[field], field === "displayName" ? "Display name" : "Name");
  }
  return data;
}

// What the customer is called in greetings. Falls back down a chain rather
// than ever rendering an empty "Welcome back, ." — the email local part is
// the last resort and is always present.
function greetingName(user) {
  if (!user) return "";
  if (user.displayName) return user.displayName;
  if (user.name) return user.name.trim().split(/\s+/)[0];
  const local = String(user.email || "").split("@")[0];
  // "elena.cho" / "elena_cho" / "elena-cho" -> "Elena"
  const first = local.split(/[._-]/)[0] || local;
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : "";
}

// Initials for the avatar placeholder, matching what the partner profile
// draws when it has no image.
function initials(user) {
  const source = (user && (user.displayName || user.name)) || "";
  const parts = source.split(/\s+/).filter(Boolean).slice(0, 2);
  if (parts.length) return parts.map((w) => w[0]).join("").toUpperCase();
  const email = String((user && user.email) || "");
  return (email.charAt(0) || "?").toUpperCase();
}

// The single serialization every customer-facing surface uses, so the
// greeting on My Library and the header on My Profile can never disagree
// about what someone is called.
function toCustomerProfile(user) {
  return {
    id: user.id,
    email: user.email,
    name: user.name || "",
    displayName: user.displayName || "",
    phone: user.phone || "",
    country: user.country || "",
    avatarUrl: user.avatarUrl ? normalizeImageUrl(user.avatarUrl) : null,
    initials: initials(user),
    greetingName: greetingName(user),
    hasPassword: !!user.passwordHash,
    createdAt: user.createdAt,
  };
}

module.exports = {
  ProfileError,
  EDITABLE_FIELDS,
  LIMITS,
  buildProfileUpdate,
  toCustomerProfile,
  greetingName,
  initials,
};
