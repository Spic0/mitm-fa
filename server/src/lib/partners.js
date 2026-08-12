// Shared domain rules for Partner Profiles, used by BOTH the admin CRUD API
// (routes/admin/partners.js) and the public page renderer (routes/pages.js).
//
// Everything a partner profile is allowed to contain is defined here as an
// allowlist rather than validated by pattern-matching for bad input. That
// direction matters: a profile is admin-authored content rendered on a public
// page, so the question is never "is this string dangerous" (unanswerable)
// but "is this one of the finitely many values we render" (decidable).
//
// Nothing in here escapes HTML. Escaping is the renderer's job and happens at
// the point of interpolation in routes/pages.js — a value that is escaped
// on the way INTO the database is double-escaped the moment it is also shown
// in an admin <input>, which is how "Sam &amp; Co" ends up in a text field.

// ---------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------

// Every validation failure below is a BAD REQUEST with a message written for
// the admin who typed it ("That Instagram link doesn't point at
// instagram.com"). Thrown as a plain Error, the central handler in
// src/index.js sees no `status`, defaults to 500, and — because it only
// forwards `err.message` for statuses under 500 — replaces all of that with
// "Something went wrong. Please try again." So the one useful sentence is
// dropped exactly when it matters most.
//
// Tagging the error with status 400 is what makes the real message reach the
// UI. It is the only HTTP concept in this file, and it earns its place.
class ValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = "ValidationError";
    this.status = 400;
  }
}

function fail(message) {
  throw new ValidationError(message);
}

// ---------------------------------------------------------------------
// Vocabularies
// ---------------------------------------------------------------------

// Partner types mirror the four audiences the platform actually names in its
// own materials (the "Who we are" section of the private deck: athletes,
// fitness influencers, sports creators, nutrition coaches), plus the broader
// "personality" the brief asks for. Not invented categories.
const PARTNER_TYPES = new Map([
  ["athlete", "Athlete"],
  ["creator", "Creator"],
  ["coach", "Coach"],
  ["influencer", "Influencer"],
  ["personality", "Sports Personality"],
]);

// Publishing states, deliberately the same three words Product already uses
// so an admin reading either table means the same thing by them.
const STATUSES = new Set(["draft", "published", "archived"]);

// Controlled appearance. The brief is explicit that admins must NOT get
// unrestricted colour/font control, so these are keys the stylesheet knows
// about — there is no code path anywhere that turns partner input into a CSS
// value.
const ACCENTS = new Set(["brand", "mono"]);
const LAYOUTS = new Set(["stack", "grid"]);

// Social platforms. `hosts` is the load-bearing field: a row claiming to be
// Instagram must actually point at Instagram, or the icon is a lie and the
// profile becomes a way to launder a link through a trusted-looking badge.
const SOCIAL_PLATFORMS = new Map([
  ["instagram", { label: "Instagram", icon: "fa-instagram", hosts: ["instagram.com", "instagr.am"] }],
  ["tiktok", { label: "TikTok", icon: "fa-tiktok", hosts: ["tiktok.com"] }],
  ["youtube", { label: "YouTube", icon: "fa-youtube", hosts: ["youtube.com", "youtu.be"] }],
  // The platform is X, but this project ships Font Awesome Pro 6.0.0, which
  // predates the dedicated X glyph (added upstream in 6.4.2) — referencing
  // that name renders an empty box. The bird mark below is what actually
  // exists in the bundled set, and is already what the site footer uses.
  //
  // (Deliberately not writing the newer icon's literal class name anywhere:
  // tools/fontawesome-inventory.js scans .js sources for fa-* tokens and does
  // NOT strip line comments, so naming it here would put a nonexistent icon
  // into the subsetter's inventory and fail the verifier forever.)
  ["x", { label: "X", icon: "fa-twitter", hosts: ["x.com", "twitter.com"] }],
  ["facebook", { label: "Facebook", icon: "fa-facebook-f", hosts: ["facebook.com", "fb.com"] }],
  ["twitch", { label: "Twitch", icon: "fa-twitch", hosts: ["twitch.tv"] }],
  ["spotify", { label: "Spotify", icon: "fa-spotify", hosts: ["spotify.com"] }],
  ["linkedin", { label: "LinkedIn", icon: "fa-linkedin-in", hosts: ["linkedin.com"] }],
]);

// Icons an admin may attach to a custom link. A fixed list of Font Awesome
// keys already loaded by the site — never a class string from the client,
// which would be arbitrary CSS-class injection into the rendered page.
const LINK_ICONS = new Map([
  ["link", "fa-link"],
  ["cart", "fa-cart-shopping"],
  ["dumbbell", "fa-dumbbell"],
  ["apple", "fa-apple-whole"],
  ["play", "fa-circle-play"],
  ["calendar", "fa-calendar-days"],
  ["envelope", "fa-envelope"],
  ["star", "fa-star"],
  ["download", "fa-download"],
  ["ticket", "fa-ticket"],
]);

// Field limits. Enforced server-side on write so the public page's layout can
// be designed against a known worst case instead of hoping.
const LIMITS = {
  displayName: 80,
  handle: 40,
  bio: 300,
  slug: 60,
  ctaLabel: 32,
  metaDescription: 200,
  linkTitle: 60,
  linkDescription: 120,
  url: 500,
};

// Slugs that must never become a profile URL. /partners/new and
// /partners/preview are admin-facing paths under the same prefix, and the
// rest are words we may want as real sub-routes later — cheaper to reserve
// now than to migrate a published partner's URL after the fact.
const RESERVED_SLUGS = new Set([
  "new", "edit", "preview", "admin", "api", "assets", "all", "index",
  "search", "directory", "partners", "partner", "login", "signup",
]);

// ---------------------------------------------------------------------
// Slugs
// ---------------------------------------------------------------------

function slugify(input) {
  return String(input || "")
    .normalize("NFKD")
    // Strip combining marks so "Renée" becomes "renee" rather than losing the
    // whole character to the alphanumeric filter below.
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, LIMITS.slug)
    // A trailing hyphen can reappear after the slice.
    .replace(/-+$/g, "");
}

// Validates a slug an admin typed by hand, as opposed to one derived from a
// name. Returns the cleaned slug or throws with a message meant for the UI.
function validateSlug(input) {
  const slug = slugify(input);
  if (!slug) fail("Profile URL must contain at least one letter or number");
  if (slug.length < 2) fail("Profile URL must be at least 2 characters");
  if (RESERVED_SLUGS.has(slug)) fail(`"${slug}" is reserved — choose a different profile URL`);
  return slug;
}

// Collision handling. Appends -2, -3, ... until free. `excludeId` lets an
// existing partner keep its own slug on update instead of colliding with
// itself and drifting to "sam-sulek-2" on every save.
async function uniqueSlug(prisma, desired, excludeId) {
  const base = validateSlug(desired);
  let candidate = base;
  for (let n = 2; n < 200; n++) {
    const clash = await prisma.partner.findUnique({ where: { slug: candidate }, select: { id: true } });
    if (!clash || clash.id === excludeId) return candidate;
    // Keep the suffix inside the column's own limit rather than letting a long
    // name push it past LIMITS.slug.
    const suffix = `-${n}`;
    candidate = base.slice(0, LIMITS.slug - suffix.length) + suffix;
  }
  fail("Could not find a free profile URL — set one manually");
}

// ---------------------------------------------------------------------
// URLs
// ---------------------------------------------------------------------

// The only two schemes a profile may link out with. Everything else —
// javascript:, data:, vbscript:, file: — is rejected outright rather than
// filtered, because these values are written into an href on a public page.
function validateUrl(input, { field = "Link" } = {}) {
  const raw = String(input || "").trim();
  if (!raw) fail(`${field} URL is required`);
  if (raw.length > LIMITS.url) fail(`${field} URL is too long (max ${LIMITS.url} characters)`);

  // A bare "instagram.com/x" is what an admin will actually paste, so accept
  // it and normalize rather than rejecting a URL that is obviously fine.
  const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;

  let url;
  try {
    url = new URL(withScheme);
  } catch {
    fail(`${field} URL is not a valid web address`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    fail(`${field} URL must start with http:// or https://`);
  }
  if (!url.hostname || !url.hostname.includes(".")) {
    fail(`${field} URL is not a valid web address`);
  }
  return url.toString();
}

// Relative in-platform destinations ("/shop", "/program/x") are a legitimate
// and desirable thing for a custom link to point at — that is the internal
// linking the brief asks for. They are allowed only in this exact shape: a
// single leading slash, no scheme, and no "//" that would make it
// protocol-relative and therefore off-site.
function validateLinkTarget(input, { field = "Link" } = {}) {
  const raw = String(input || "").trim();
  if (raw.startsWith("/") && !raw.startsWith("//")) {
    if (raw.length > LIMITS.url) fail(`${field} URL is too long`);
    if (/[\s<>"']/.test(raw)) fail(`${field} URL contains invalid characters`);
    return raw;
  }
  return validateUrl(raw, { field });
}

// A social row's URL must actually belong to the platform whose icon it will
// wear. Subdomains count (www.instagram.com, m.youtube.com) but a suffix
// match must not — "notinstagram.com" and "instagram.com.evil.test" both fail
// a naive endsWith, so the host is compared segment-wise.
function validateSocialUrl(platform, input) {
  const meta = SOCIAL_PLATFORMS.get(platform);
  if (!meta) fail(`"${platform}" is not a supported social platform`);

  const normalized = validateUrl(input, { field: meta.label });
  const host = new URL(normalized).hostname.toLowerCase().replace(/^www\./, "");
  const ok = meta.hosts.some((h) => host === h || host.endsWith(`.${h}`));
  if (!ok) {
    fail(`That ${meta.label} link doesn't point at ${meta.hosts[0]} — check the URL`);
  }
  return normalized;
}

// ---------------------------------------------------------------------
// Text
// ---------------------------------------------------------------------

// Trim, collapse newlines, cap length. Control characters are stripped
// because they are never intentional in these fields and can be used to
// disguise the real content of a string in an admin table.
function cleanText(input, max, { field = "Value", required = false } = {}) {
  let value = String(input == null ? "" : input)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!value) {
    if (required) fail(`${field} is required`);
    return null;
  }
  if (value.length > max) value = value.slice(0, max).trim();
  return value;
}

// A handle is a label, never a link. Stored without the "@" so the renderer
// owns the prefix and two partners can't disagree about whether it's there.
function cleanHandle(input) {
  const value = cleanText(input, LIMITS.handle + 1, { field: "Handle" });
  if (!value) return null;
  const stripped = value.replace(/^@+/, "").replace(/[^A-Za-z0-9._-]/g, "");
  return stripped ? stripped.slice(0, LIMITS.handle) : null;
}

// ---------------------------------------------------------------------
// Public serialization
// ---------------------------------------------------------------------

function typeLabel(key) {
  return PARTNER_TYPES.get(key) || PARTNER_TYPES.get("creator");
}

function socialMeta(platform) {
  return SOCIAL_PLATFORMS.get(platform) || null;
}

function linkIconClass(key) {
  return LINK_ICONS.get(key) || LINK_ICONS.get("link");
}

// Everything the public profile page needs, with the ordering already
// resolved and anything unrenderable dropped.
//
// Products are read THROUGH the relation, so name/price/cover always come
// from the live Product row — the profile stores none of it. A product that
// has since been unpublished or archived is filtered out here rather than
// shown as a dead card, which is the same rule every other public surface on
// the site applies (`status: "published"`).
function buildPublicProfile(partner) {
  const products = (partner.products || [])
    .filter((pp) => pp.product && pp.product.status === "published")
    .sort((a, b) => Number(b.featured) - Number(a.featured) || a.position - b.position);

  const links = (partner.links || []).slice().sort(
    (a, b) => Number(b.featured) - Number(a.featured) || a.position - b.position
  );

  const socials = (partner.socials || [])
    .filter((s) => SOCIAL_PLATFORMS.has(s.platform))
    .sort((a, b) => a.position - b.position);

  return {
    id: partner.id,
    slug: partner.slug,
    displayName: partner.displayName,
    handle: partner.handle,
    partnerType: partner.partnerType,
    typeLabel: typeLabel(partner.partnerType),
    bio: partner.bio,
    avatarUrl: partner.avatarUrl,
    websiteUrl: partner.websiteUrl,
    accent: ACCENTS.has(partner.accent) ? partner.accent : "brand",
    layout: LAYOUTS.has(partner.layout) ? partner.layout : "stack",
    ctaLabel: partner.ctaLabel,
    status: partner.status,
    metaDescription: partner.metaDescription,
    socials: socials.map((s) => ({
      platform: s.platform,
      url: s.url,
      label: socialMeta(s.platform).label,
      icon: socialMeta(s.platform).icon,
    })),
    links: links.map((l) => ({
      id: l.id,
      title: l.title,
      url: l.url,
      description: l.description,
      icon: linkIconClass(l.icon),
      featured: l.featured,
    })),
    products: products.map((pp) => ({
      id: pp.product.id,
      slug: pp.product.slug,
      name: pp.product.name,
      creator: pp.product.creator,
      priceCents: pp.product.priceCents,
      imageUrl: pp.product.imageUrl,
      description: pp.product.description,
      durationWeeks: pp.product.durationWeeks,
      difficulty: pp.product.difficulty,
      featured: pp.featured,
    })),
  };
}

// The meta description used when an admin hasn't written one. Derived from
// real fields only — it never asserts anything about the partner that isn't
// already stored.
function defaultMetaDescription(profile) {
  if (profile.bio) {
    return profile.bio.length > LIMITS.metaDescription
      ? `${profile.bio.slice(0, LIMITS.metaDescription - 3).trim()}...`
      : profile.bio;
  }
  const count = profile.products.length;
  const productPart = count
    ? ` Browse ${count} training ${count === 1 ? "program" : "programs"} and every official link in one place.`
    : " Every official link in one place.";
  return `${profile.displayName} on Fitness Agency.${productPart}`;
}

// The Prisma `include` every read of a partner needs to produce a complete
// profile. Defined once so the admin API and the public page cannot drift
// into fetching different shapes — and so the product SELECT stays narrow
// (a profile never needs trainingContent/nutritionContent, which are large
// JSON blobs).
const PROFILE_INCLUDE = {
  socials: true,
  links: true,
  products: {
    include: {
      product: {
        select: {
          id: true,
          slug: true,
          name: true,
          creator: true,
          priceCents: true,
          imageUrl: true,
          description: true,
          durationWeeks: true,
          difficulty: true,
          status: true,
        },
      },
    },
  },
};

module.exports = {
  ValidationError,
  fail,
  PARTNER_TYPES,
  STATUSES,
  ACCENTS,
  LAYOUTS,
  SOCIAL_PLATFORMS,
  LINK_ICONS,
  LIMITS,
  RESERVED_SLUGS,
  PROFILE_INCLUDE,
  slugify,
  validateSlug,
  uniqueSlug,
  validateUrl,
  validateLinkTarget,
  validateSocialUrl,
  cleanText,
  cleanHandle,
  typeLabel,
  socialMeta,
  linkIconClass,
  buildPublicProfile,
  defaultMetaDescription,
};
