// Non-critical CSS (carousel/lightbox/select-widget styling — nothing
// needed for first paint) is marked up as rel="preload" instead of
// rel="stylesheet" so it can't block rendering; this flips each one over to
// a real stylesheet once the DOM is parsed. No onload race to worry about:
// the browser already started fetching these at high priority the moment
// the preload link was parsed, and flipping `rel` doesn't require waiting —
// the browser applies the stylesheet whenever that same underlying fetch
// completes, whether that's already happened or not by the time this runs.
// A one-line inline onload="" attribute on the link itself would do this
// too, but this site's CSP has no 'unsafe-inline' for scripts (a deliberate
// prior hardening pass — see CHANGELOG.md), so this runs as a normal
// external deferred script instead.
document.querySelectorAll("link[data-preload-style]").forEach(function (link) {
  link.rel = "stylesheet";
});
