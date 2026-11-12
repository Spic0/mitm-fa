/** Tailwind is scoped to the islands only: no preflight, and every utility is
 *  emitted under [data-island], so the site's own CSS and typography are
 *  untouched. The shadcn-style tokens resolve to the site's palette in
 *  src/styles.css. No font-family/size tokens are defined on purpose. */
export default {
  content: ["./src/**/*.{ts,tsx}"],
  important: "[data-island]",
  // `container` is off as well: it is emitted unscoped and collided with the
  // site's own Bootstrap .container (it narrowed the header at 1440).
  corePlugins: { preflight: false, container: false },
  theme: {
    extend: {
      colors: {
        background: "var(--background)", foreground: "var(--foreground)",
        card: { DEFAULT: "var(--card)", foreground: "var(--card-foreground)" },
        muted: { DEFAULT: "var(--muted)", foreground: "var(--muted-foreground)" },
        border: "var(--border)",
        primary: { DEFAULT: "var(--primary)", foreground: "var(--primary-foreground)" },
        chart: { 1: "var(--chart-1)", 2: "var(--chart-2)", 3: "var(--chart-3)", 4: "var(--chart-4)", 5: "var(--chart-5)" },
      },
    },
  },
  plugins: [],
};
