/**
 * Lighthouse CI for the public pages (docs/11-testing.md). Warn-only budgets
 * for now. Runs against a production build started on :3210 with the local
 * test database; `pnpm test:lhci` creates the fixture invite first.
 */
const { existsSync, readFileSync } = require("node:fs");
const { chromium } = require("@playwright/test");

const PORT = process.env.E2E_PORT || "3210";
const base = `http://localhost:${PORT}`;

const urls = [`${base}/login`, `${base}/signup`];
if (existsSync(".lighthouseci/fixture.json")) {
  const { candidateLandingPath } = JSON.parse(readFileSync(".lighthouseci/fixture.json", "utf8"));
  urls.push(`${base}${candidateLandingPath}`);
}

module.exports = {
  ci: {
    collect: {
      url: urls,
      numberOfRuns: 3,
      startServerCommand: `pnpm start -p ${PORT}`,
      startServerReadyPattern: "Ready in",
      startServerReadyTimeout: 60000,
      chromePath: process.env.LHCI_CHROME_PATH || chromium.executablePath(),
      settings: {
        preset: "desktop",
        chromeFlags: "--no-sandbox --headless=new",
      },
    },
    assert: {
      assertions: {
        "categories:performance": ["warn", { minScore: 0.9 }],
        "categories:accessibility": ["warn", { minScore: 0.95 }],
        "categories:best-practices": ["warn", { minScore: 0.9 }],
        "cumulative-layout-shift": ["warn", { maxNumericValue: 0.1 }],
        "largest-contentful-paint": ["warn", { maxNumericValue: 2500 }],
        "total-blocking-time": ["warn", { maxNumericValue: 300 }],
      },
    },
    upload: {
      // Reports stay local / as CI artifacts; nothing is published.
      target: "filesystem",
      outputDir: ".lighthouseci/reports",
    },
  },
};
