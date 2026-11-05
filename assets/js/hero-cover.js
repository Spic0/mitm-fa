// Homepage hero: pinned while the product showcase slides up over it (see
// .hero-stack in home-dynamic.css). CSS cannot know the hero's height (it is
// sized by its content), so this measures it, and its page offset, into
// --hero-h / --hero-top for the scroll-driven animation's range: once at
// start and again only when the hero resizes, never in the scroll path.
// Browsers without scroll-driven animations get the same motion from one
// passive scroll listener writing --hero-p (0..1) at most once per frame, and
// only while the stack is on screen. Reduced motion: nothing moves.
(function () {
  var hero = document.querySelector(".hero-stack > .hero");
  var title = hero && hero.querySelector(".hero__title");
  if (!title) return;
  // Whichever of these the CSS moves at this width reads --hero-p.
  var movers = [title, hero.querySelector(".hero__sub"), hero.querySelector(".hero__copy")].filter(Boolean);
  var stack = hero.parentNode;
  var top = 0;
  var height = 1;
  function measure() {
    top = stack.getBoundingClientRect().top + window.scrollY;
    height = hero.offsetHeight || 1;
    stack.style.setProperty("--hero-top", Math.round(top) + "px");
    stack.style.setProperty("--hero-h", height + "px");
  }
  measure();
  if ("ResizeObserver" in window) new ResizeObserver(measure).observe(hero);
  else window.addEventListener("resize", measure);

  var reduce = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var native = window.CSS && CSS.supports && CSS.supports("animation-timeline: scroll()");
  if (reduce || native) return;

  var visible = true;
  var queued = false;
  var last = -1;
  function apply() {
    queued = false;
    var p = Math.min(1, Math.max(0, (window.scrollY - top) / height));
    if (p === last) return;
    last = p;
    var v = p.toFixed(4);
    movers.forEach(function (m) { m.style.setProperty("--hero-p", v); });
  }
  function onScroll() {
    if (!visible || queued) return;
    queued = true;
    requestAnimationFrame(apply);
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  if ("IntersectionObserver" in window) {
    new IntersectionObserver(function (entries) {
      visible = entries[entries.length - 1].isIntersecting;
      if (visible) onScroll();
    }).observe(stack);
  }
  apply();
})();
