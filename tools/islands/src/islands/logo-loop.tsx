import { createRoot } from "react-dom/client";
import LogoLoop from "@/components/ui/react-bits/LogoLoop";

// Product types as a text marquee. Text only: these are things we build, not client logos.
export function mount(el: HTMLElement) {
  const items = Array.from(el.querySelectorAll("li")).map((li) => li.textContent || "");
  if (!items.length) return;
  createRoot(el).render(
    <LogoLoop
      logos={items.map((t) => ({ node: <span className="lb-loop__item">{t}</span>, title: t }))}
      speed={46}
      gap={44}
      logoHeight={20}
      pauseOnHover
      fadeOut
      fadeOutColor="var(--color-bg)"
      ariaLabel="What we build"
    />
  );
}
