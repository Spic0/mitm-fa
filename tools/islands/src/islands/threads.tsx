import { createRoot } from "react-dom/client";
import Threads from "@/components/ui/react-bits/Threads";

// Quiet background for the closing call to action.
export function mount(el: HTMLElement) {
  // A lost WebGL context paints the browser's placeholder; hide the layer until it is back.
  // (The events do not bubble, hence capture.)
  el.addEventListener("webglcontextlost", () => (el.style.visibility = "hidden"), true);
  el.addEventListener("webglcontextrestored", () => (el.style.visibility = ""), true);
  createRoot(el).render(
    <Threads color="#1a1a1a" accentColor="#c08a2e" amplitude={0.7} distance={0.2} enableMouseInteraction={false} opacity={0.5} className="lb-threads" />
  );
}
