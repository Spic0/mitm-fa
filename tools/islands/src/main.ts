// Island loader. The page is complete, crawlable HTML without this file; each
// [data-island] node is only ENHANCED, and only once it is near the viewport.
// Nothing here runs before first paint: the script is a deferred module and
// the first import waits for an idle callback.
import "./styles.css";
import { hasHardwareWebGL } from "./lib/gpu";

type Mount = (el: HTMLElement) => void | Promise<void>;
const loaders: Record<string, () => Promise<{ mount: Mount }>> = {
  "hero-diagram": () => import("./islands/hero-diagram"),
  "markets-globe": () => import("./islands/markets-globe"),
  "spotlight-card": () => import("./islands/spotlight-card"),
  "logo-loop": () => import("./islands/logo-loop"),
  "blur-text": () => import("./islands/blur-text"),
  "count-up": () => import("./islands/count-up"),
  threads: () => import("./islands/threads"),
};

const WEBGL = new Set(["hero-diagram", "markets-globe", "threads"]);

function boot(el: HTMLElement) {
  const load = loaders[el.dataset.island || ""];
  if (!load || el.dataset.islandState) return;
  // WebGL islands are not even downloaded without a real GPU: the markup stays.
  if (WEBGL.has(el.dataset.island || "") && !hasHardwareWebGL()) {
    el.dataset.islandState = "static";
    return;
  }
  el.dataset.islandState = "loading";
  load()
    .then((m) => m.mount(el))
    .then(() => (el.dataset.islandState = "ready"))
    .catch(() => (el.dataset.islandState = "failed")); // server HTML stays as the fallback
}

function start() {
  reveals();
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-island]"));
  if (!("IntersectionObserver" in window)) return nodes.forEach(boot);
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        io.unobserve(e.target);
        boot(e.target as HTMLElement);
      }
    },
    { rootMargin: "300px 0px" }
  );
  nodes.forEach((n) => io.observe(n));
}

// Scroll reveals for [data-lb-reveal] (icons, timeline rail). CSS does the
// motion; this only flags "armed" (hidden start state, set while the block is
// still below the fold, so nothing visible ever jumps), "is-in" and "is-off"
// (off-screen: idle loops pause). No JS or reduced motion: nothing is armed.
function reveals() {
  const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-lb-reveal]"));
  if (!nodes.length || !("IntersectionObserver" in window)) return;
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  for (const n of nodes) if (n.getBoundingClientRect().top > window.innerHeight) n.classList.add("lb-armed");
  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const n = e.target as HTMLElement;
        n.classList.toggle("is-off", !e.isIntersecting);
        if (e.isIntersecting) n.classList.add("is-in");
      }
    },
    { rootMargin: "0px 0px -12% 0px" }
  );
  nodes.forEach((n) => io.observe(n));
}

const idle: (cb: () => void) => void =
  "requestIdleCallback" in window ? (cb) => window.requestIdleCallback(cb, { timeout: 2500 }) : (cb) => window.setTimeout(cb, 600);
if (document.readyState === "complete") idle(start);
else window.addEventListener("load", () => idle(start), { once: true });
