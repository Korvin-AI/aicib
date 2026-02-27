import { defineConfig, devices } from "@playwright/test";

/**
 * Playwright configuration for AICIB UI smoke tests.
 *
 * Scope: Chromium-only, lightweight smoke coverage.
 * See https://playwright.dev/docs/test-configuration
 */
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results",

  /* Fail the build on CI if you accidentally left test.only in the source. */
  forbidOnly: !!process.env.CI,

  /* Retry once on CI to catch flakes; no retries locally by default. */
  retries: process.env.CI ? 1 : 0,

  /* Limit parallel workers on CI to avoid resource contention. */
  workers: process.env.CI ? 1 : undefined,

  /* Reporter: concise in terminal, HTML report for deeper investigation. */
  reporter: [["list"], ["html", { open: "never" }]],

  /* Shared settings for all projects. */
  use: {
    baseURL: "http://localhost:3000",

    /* Capture screenshot on failure for debugging. */
    screenshot: "only-on-failure",

    /* Collect trace on first retry so we can debug flakes. */
    trace: "on-first-retry",

    /* Reasonable timeout for page actions. */
    actionTimeout: 10_000,
  },

  /* Single project: Chromium only (smoke scope). */
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],

  /* Auto-start the Next.js dev server if nothing is already listening. */
  webServer: {
    command: "npm run dev",
    port: 3000,
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
