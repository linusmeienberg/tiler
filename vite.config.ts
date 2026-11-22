import { defineConfig } from "vite";

export default defineConfig({
  // Relative asset paths: the built dist/ works from any sub-path (e.g. GitHub Pages).
  base: "./",
  // three.js (~560 kB) is split off and loaded only when the orbifold view opens.
  build: { chunkSizeWarningLimit: 700 },
});
