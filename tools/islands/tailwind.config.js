/** Tailwind is scoped to the islands only: no preflight, and every utility is
 *  emitted under [data-island], so the site's own CSS and typography are
 *  untouched. The shadcn-style tokens resolve to the site's palette in
 *  src/styles.css. No font-family/size tokens are defined on purpose. */
const c = (v) => `color-mix(in srgb, var(${v}) calc(<alpha-value> * 100%), transparent)`;

export default {
  // The reference component is not shipped, so its classes are not scanned.
  content: ["./src/**/*.{ts,tsx}", "!./src/components/ui/testimonial-globe.tsx"],
  important: "[data-island]",
  // `container` is off as well: it is emitted unscoped and collided with the
  // site's own Bootstrap .container (it narrowed the header at 1440).
  corePlugins: { preflight: false, container: false },
  theme: {
    extend: {
      // color-mix keeps opacity modifiers (text-foreground/20) working on var() tokens.
      colors: {
        background: c("--background"), foreground: c("--foreground"),
        card: { DEFAULT: c("--card"), foreground: c("--card-foreground") },
        muted: { DEFAULT: c("--muted"), foreground: c("--muted-foreground") },
        border: c("--border"),
        primary: { DEFAULT: c("--primary"), foreground: c("--primary-foreground") },
        chart: { 1: c("--chart-1"), 2: c("--chart-2"), 3: c("--chart-3"), 4: c("--chart-4"), 5: c("--chart-5") },
      },
    },
  },
  plugins: [],
};
