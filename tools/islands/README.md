# Landing islands

React/TypeScript islands that enhance the server-rendered homepage (`index.html`).
The page is complete without them; each `[data-island]` node is mounted lazily.

    npm install        # once, in this folder
    npm run check      # eslint + tsc + vite build

Output goes to `/assets/islands/` and IS COMMITTED: production deploys by git
merge with no build step. Rebuild and commit after any change here.

- `src/islands/hero-diagram.ts`: hero scene, plain `three` (fiber + drei measured 265 KB gz, over the 250 KB budget).
- `src/components/ui/react-bits/`: copied from github.com/DavidHDev/react-bits (TS + Tailwind variants), licence in `LICENSE`.
- Tailwind is scoped to `[data-island]`, with `preflight` and `container` off, so site CSS and typography are untouched.
- WebGL islands are skipped on software renderers (`src/lib/gpu.ts`); the static markup stays.
