import { createRoot } from "react-dom/client";
import SpotlightCard from "@/components/ui/react-bits/SpotlightCard";

// Wraps a server-rendered card: its markup is kept verbatim as the content.
export function mount(el: HTMLElement) {
  const inner = el.querySelector(".lb-card__inner");
  if (!inner) return;
  const html = inner.innerHTML;
  createRoot(el).render(
    <SpotlightCard theme="light" spotlightColor="rgba(192, 138, 46, 0.22)" grain={0} className="lb-card__spot">
      <div className="lb-card__inner" dangerouslySetInnerHTML={{ __html: html }} />
    </SpotlightCard>
  );
}
