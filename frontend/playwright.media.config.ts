import { defineConfig, devices } from "@playwright/test";

// Screenshot capture for the README and the site. Deliberately a SEPARATE config
// from playwright.config.ts: this is a release chore, not a test, and the test suite
// should neither run it nor report it as skipped.
//
//   pnpm media        (needs the MySQL container: docker start quaero-my-test)
//
// The viewport is the size the published images already are, so replacing them does
// not reflow the README or the site's cards.
const PORT = Number(process.env.QUAERO_E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "./e2e/media",
  workers: 1,
  retries: 0,
  reporter: [["list"]],
  timeout: 120_000,

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices["Desktop Chrome"],
    viewport: { width: 1360, height: 860 },
    // A fixed scale keeps the images the same pixel size on any machine.
    deviceScaleFactor: 1,
  },

  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: true,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
