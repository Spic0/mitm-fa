import { createRoot } from "react-dom/client";
import CountUp from "@/components/ui/react-bits/CountUp";

// Only counts to numbers already printed in the server HTML (15, 30, 4).
export function mount(el: HTMLElement) {
  const to = Number(el.dataset.to);
  if (!Number.isFinite(to)) return;
  createRoot(el).render(<CountUp to={to} from={0} duration={1.2} />);
}
