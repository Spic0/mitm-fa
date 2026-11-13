import { createRoot } from "react-dom/client";
import { MarketsGlobe, type GlobeMarket } from "@/components/ui/markets-globe";

// The four markets are read from the server-rendered list, so the copy has one
// source (index.html) and the page is complete without this island.
function readMarkets(el: HTMLElement): GlobeMarket[] {
  return Array.from(el.querySelectorAll<HTMLLIElement>("li[data-code]")).map((li) => ({
    id: (li.dataset.code || "").toLowerCase(),
    code: li.dataset.code || "",
    name: li.querySelector("h3")?.textContent?.trim() || "",
    city: li.querySelector(".lb-globe__city")?.textContent?.trim() || "",
    blurb: li.querySelector("p")?.textContent?.trim() || "",
    lat: Number(li.dataset.lat),
    lng: Number(li.dataset.lng),
    flag: li.dataset.flag || "",
  }));
}

export function mount(el: HTMLElement) {
  const items = readMarkets(el).filter((m) => m.name && Number.isFinite(m.lat) && Number.isFinite(m.lng));
  if (items.length === 0) return; // keep the list
  const href = el.dataset.ctaHref || "";
  const label = el.dataset.ctaLabel || "";
  const headingId = el.closest("section")?.querySelector("h2")?.id || undefined;
  el.classList.add("lb-globe--live");
  // A lost WebGL context paints the browser's placeholder over the component's
  // own drawn fallback; hide that canvas until it is back. (No bubbling, hence capture.)
  const canvasOf = (e: Event) => (e.target instanceof HTMLCanvasElement ? e.target : null);
  el.addEventListener("webglcontextlost", (e) => canvasOf(e)?.style.setProperty("visibility", "hidden"), true);
  el.addEventListener("webglcontextrestored", (e) => canvasOf(e)?.style.removeProperty("visibility"), true);
  // The section's own server-rendered <h2> stays the heading (site typography),
  // so the component gets no eyebrow/heading of its own.
  createRoot(el).render(
    <MarketsGlobe
      items={items}
      autoplay
      interval={4500}
      aria-labelledby={headingId}
      aria-label={headingId ? undefined : "Markets"}
      labels={{ previous: "Previous market", next: "Next market", pin: "Show market" }}
      action={
        href && label ? (
          <a className="btn-two lb-globe__cta" href={href} target="_blank" rel="noopener">
            <span>{label}</span>
          </a>
        ) : undefined
      }
    />
  );
}
