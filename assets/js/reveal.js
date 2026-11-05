// Scroll reveals for server-rendered pages: every [data-reveal] element fades
// and rises into place once, when it enters the viewport. Elements that enter
// together stagger by 80ms. Nothing is hidden until this runs (no JS, nothing
// hidden), anything already on screen is shown at once so nothing flashes,
// and prefers-reduced-motion skips all of it. Styles: html.reveal-on rules in
// the page's stylesheet (see assets/css/partnership.css).
(function () {
  var els = document.querySelectorAll("[data-reveal]");
  if (!els.length || !("IntersectionObserver" in window)) return;
  if (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

  // Items inside a sideways scroller are clipped by it, so they never count
  // as "in view" until swiped. They reveal together when the scroller does.
  function scrollerOf(el) {
    for (var p = el.parentElement; p && p !== document.body; p = p.parentElement) {
      var o = getComputedStyle(p).overflowX;
      if (o === "auto" || o === "scroll") return p;
    }
    return null;
  }

  var vh = window.innerHeight;
  var watch = [];
  var groups = new Map();
  Array.prototype.forEach.call(els, function (el) {
    var r = el.getBoundingClientRect();
    if (r.top < vh && r.bottom > 0) { el.classList.add("is-revealed"); return; } // on screen now: no hide, no flash
    var s = scrollerOf(el);
    if (!s) { watch.push(el); return; }
    if (!groups.has(s)) { groups.set(s, []); watch.push(s); }
    groups.get(s).push(el);
  });
  document.documentElement.classList.add("reveal-on");

  var io = new IntersectionObserver(
    function (entries) {
      var n = 0;
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        io.unobserve(e.target);
        (groups.get(e.target) || [e.target]).forEach(function (el) {
          el.style.transitionDelay = Math.min(n++, 6) * 80 + "ms";
          el.classList.add("is-revealed");
        });
      });
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.01 }
  );
  watch.forEach(function (el) { io.observe(el); });
})();
