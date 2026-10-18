import { defineConfig, devices } from "@playwright/test";

// Visual regression (issue #697): reference screenshots of the main screens, in
// light and dark, compared pixel-wise against committed baselines.
//
//   pnpm visual            compare against e2e/visual/__screenshots__
//   pnpm visual:update     rewrite the baselines (Linux only — see e2e/README.md)
//
// A SEPARATE config from playwright.config.ts for the same reason the media
// capture has one: the e2e suite answers "does it work?", this answers "does it
// still look the same?", and the second question only has one answer per
// platform. Fonts are the reason: --font-ui resolves to Segoe UI on Windows and
// to DejaVu/Liberation on the CI runner, so the same pixels never match across
// operating systems. The baselines are generated and compared on ONE platform,
// the Linux CI container, and the spec skips elsewhere.
const PORT = Number(process.env.QUAERO_E2E_PORT ?? 4173);

export default defineConfig({
  testDir: "./e2e/visual",
  globalSetup: "./e2e/global-setup.ts",
  workers: 1,
  fullyParallel: false,
  // Same stance as the e2e suite: a retry hides a flaky capture instead of fixing
  // whatever is non-deterministic about it.
  retries: 0,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  // Baselines sit next to the spec, one PNG per screen and theme. No {platform}
  // in the name: only Linux ever writes here, so a suffix would only suggest
  // that a Windows set could coexist, and it cannot (fonts, above).
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",

  expect: {
    toHaveScreenshot: {
      // threshold is the per-pixel YIQ colour distance (0–1) under which two
      // pixels count as equal; 0.2 (Playwright's default) absorbs anti-aliasing
      // and sub-pixel text rendering noise while a changed colour token, which
      // moves every pixel of a surface by far more, still counts.
      threshold: 0.2,
      // maxDiffPixelRatio is the share of pixels allowed to differ. 1% of a
      // 1280×800 capture is ~10k pixels: a few relabelled controls fit under it,
      // a shifted panel, a missing border or a reflowed grid do not.
      maxDiffPixelRatio: 0.01,
      // Both are Playwright's defaults, spelled out because the comparison
      // depends on them: a mid-transition frame or a blinking caret would differ
      // from the baseline for no reason anyone cares about.
      animations: "disabled",
      caret: "hide",
      scale: "css",
    },
  },

  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    ...devices["Desktop Chrome"],
    // Fixed geometry: a pixel comparison is meaningless across sizes.
    viewport: { width: 1280, height: 800 },
    deviceScaleFactor: 1,
    // The interface prints clock times (status bar tooltip, run toast) and the
    // spec freezes Date, so the zone has to be fixed too or the same instant
    // prints differently per machine.
    timezoneId: "America/Hermosillo",
    locale: "es-MX",
    // styles.css honours prefers-reduced-motion by zeroing every transition, so
    // this removes motion at the source rather than hoping the capture misses it.
    contextOptions: { reducedMotion: "reduce" },
    trace: "retain-on-failure",
    actionTimeout: 10_000,
    navigationTimeout: 15_000,
  },

  projects: [{ name: "chromium" }],

  webServer: {
    command: `pnpm build && pnpm preview --port ${PORT} --strictPort --host 127.0.0.1`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
