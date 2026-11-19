import { defineConfig } from "vitest/config";

// Its own config, so tests never load vite.config.ts — whose landing-site
// plugin builds apps/landing whenever a Vite server starts.
export default defineConfig({
  test: { include: ["src/**/*.test.ts"] },
});
