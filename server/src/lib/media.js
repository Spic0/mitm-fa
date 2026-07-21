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

module.exports = { normalizeImageUrl };
