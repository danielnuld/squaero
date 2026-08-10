import { defineConfig, devices } from "@playwright/test";

// End-to-end suite: the shipped frontend driven against the real C core, the real
// driver plugins and real databases. See e2e/README.md.
const PORT = Number(process.env.QUAERO_E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",

  // ponytail: serial. The engines share one fixture table, so two workers mutating
  // it would race. If the wall clock starts to hurt, give each worker its own table
  // suffix per engine.
  workers: 1,
  fullyParallel: false,

  // A retry hides flakiness instead of fixing it, and a suite nobody trusts is
  // worse than none: it teaches people to ignore red.
  retries: 0,
  forbidOnly: !!process.env.CI,

  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    // No implicit waiting on time anywhere: every wait is for a condition.
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],

  // Serves the same single-file dist/index.html that gets embedded into the
  // binary, so the suite tests the artifact that ships rather than a dev variant.
  // While writing tests, run `pnpm preview --port 4173` yourself and this reuses it.
  // --host 127.0.0.1 is not decoration: vite preview otherwise binds to
  // "localhost", which on Windows resolves to ::1 first, and then nothing answers
  // on 127.0.0.1. Pinning the family keeps the URL above honest.
  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
