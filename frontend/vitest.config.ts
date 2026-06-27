import { defineConfig } from "vitest/config";
import solid from "vite-plugin-solid";

// A dedicated vitest config does not merge vite.config.ts, so the Solid/JSX
// transform must be declared here too — otherwise component tests (M2) would
// silently lack it. The Solid plugin runs tests under jsdom (see .rules/testing.md).
export default defineConfig({
  plugins: [solid()],
  test: {
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
  },
});
