import { createRoot } from "react-dom/client";
import BlurText from "@/components/ui/react-bits/BlurText";

// Reveal for section headings. Animation only: the heading element, its class
// and so its font family, size, weight and spacing are untouched.
export function mount(el: HTMLElement) {
  const text = (el.textContent || "").trim();
  if (!text) return;
  createRoot(el).render(<BlurText text={text} animateBy="words" direction="bottom" delay={60} className="lb-blur" />);
}
