import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

// Output is committed: production deploys by git merge, with no build step.
export default defineConfig({
  plugins: [react()],
  base: "/assets/islands/",
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  build: {
    outDir: path.resolve(__dirname, "../../assets/islands"),
    emptyOutDir: true,
    target: "es2020",
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      input: path.resolve(__dirname, "src/main.ts"),
      output: {
        entryFileNames: "landing.js",
        chunkFileNames: "[name]-[hash].js",
        assetFileNames: (a) => (a.name && a.name.endsWith(".css") ? "landing.css" : "[name]-[hash][extname]"),
      },
    },
  },
});
