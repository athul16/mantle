/**
 * Browser tests (docs/11-testing.md). The app is built and started against the
 * local throwaway Supabase from .env.test; the config refuses to run against a
 * non-local Supabase.
 *
 *   pnpm db:test:start   # once: local Supabase + .env.test
 *   pnpm test:e2e        # builds, starts on :3210, runs chromium/firefox/webkit
 *   pnpm test:e2e --project=chromium e2e/smoke.spec.ts
 *
 * E2E_PREBUILT=1 skips `next build` (CI builds in its own step).
 */
import { defineConfig, devices } from "@playwright/test";
import { assertLocalSupabase, loadTestEnv } from "./tests/helpers/env";

loadTestEnv();
assertLocalSupabase();

const CI = !!process.env.CI;
const PORT = process.env.E2E_PORT ?? "3210";
const baseURL = `http://localhost:${PORT}`;
// A stable viewport for every browser so screenshots are comparable.
const viewport = { width: 1280, height: 800 };

export default defineConfig({
  testDir: "e2e",
  outputDir: "test-results",
  // Baselines are generated on Linux in CI only; {platform} keeps a stray macOS run from overwriting them.
  snapshotPathTemplate: "{testDir}/__screenshots__/{testFilePath}/{arg}-{projectName}-{platform}{ext}",
  fullyParallel: true,
  forbidOnly: CI,
  retries: CI ? 2 : 0,
  workers: CI ? 2 : undefined,
  timeout: 60_000,
  reporter: CI ? [["list"], ["github"], ["html", { open: "never" }]] : [["list"], ["html", { open: "never" }]],
  globalSetup: "./e2e/global-setup.ts",
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      // Anti-aliasing noise tolerance; real layout changes are well above this.
      threshold: 0.2,
      maxDiffPixelRatio: 0.01,
    },
  },
  use: {
    baseURL,
    viewport,
    locale: "en-US",
    timezoneId: "UTC",
    colorScheme: "light",
    trace: "on-first-retry",
    video: "retain-on-failure",
    screenshot: "only-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"], viewport } },
    { name: "firefox", use: { ...devices["Desktop Firefox"], viewport } },
    { name: "webkit", use: { ...devices["Desktop Safari"], viewport } },
  ],
  webServer: {
    command: process.env.E2E_PREBUILT ? `pnpm start -p ${PORT}` : `pnpm build && pnpm start -p ${PORT}`,
    url: `${baseURL}/login`,
    reuseExistingServer: !CI,
    timeout: 300_000,
    stdout: "pipe",
    stderr: "pipe",
    env: {
      NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
      SUPABASE_SECRET_KEY: process.env.SUPABASE_SECRET_KEY ?? "",
      NEXT_PUBLIC_APP_URL: baseURL,
      // Empty wins over .env.local, so emails go to .dev-outbox.
      RESEND_API_KEY: "",
    },
  },
});
