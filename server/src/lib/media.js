// Uploaded product images are stored (and always have been) as a bare
// relative path like "assets/images/product/demo/x.svg" — no leading
// slash. That resolved fine when every page lived at the site root
// (/shop-single.html), because a browser resolves a relative <img src>
// against the current page URL. Now that nested clean routes exist
// (/creator/:slug, /program/:slug, ...), the exact same value would
// resolve against the wrong base (e.g. /creator/assets/... — 404) unless
// normalized to root-relative first. Every API response that serializes a
// product's imageUrl goes through this, so every consumer (client JS,
// server-rendered SEO/OG tags) gets an already-correct value.
function normalizeImageUrl(url) {
  if (!url) return url;
  if (/^https?:\/\//.test(url) || url.startsWith("/")) return url;
  return "/" + url;
}

const path = require("path");
const { mediaPayload } = require("./mediaDerivatives");

const SITE_ROOT = path.join(__dirname, "..", "..", "..");

// Resolves a stored image URL to the responsive payload the storefront needs
// (srcset per format, intrinsic size, fit mode, placeholder) by reading the
// sidecar manifest written at upload time. See lib/mediaDerivatives.js for why
// this is a sidecar rather than a database column.
//
// Returns null for anything without a manifest — images uploaded before this
// existed, or external/absolute URLs. Callers must treat null as "just use
// imageUrl", which is exactly what the storefront did before, so an
// un-backfilled product degrades to the old behaviour instead of breaking.
function coverMedia(url) {
  if (!url || /^https?:\/\//.test(url)) return null;

  const rel = url.replace(/^\/+/, "");
  // The stored value is admin-controlled, not visitor-controlled, but it is
  // still concatenated into a filesystem path — so confine it to SITE_ROOT
  // rather than trusting it.
  const abs = path.resolve(SITE_ROOT, rel);
  if (!abs.startsWith(SITE_ROOT + path.sep)) return null;

  const payload = mediaPayload(abs);
  if (!payload) return null;
  return { ...payload, src: normalizeImageUrl(url) };
}

module.exports = { normalizeImageUrl, coverMedia };
