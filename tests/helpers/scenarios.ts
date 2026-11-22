/**
 * Publishes every code-defined scenario, drafts included, into the test database
 * by running `scripts/publish-scenarios.ts --include-drafts` (it needs the react-server condition because
 * publishScenario is server-only). Idempotent; called from Vitest and
 * Playwright global setup.
 */
import { execFileSync } from "node:child_process";
import { requireDbEnv } from "./env";

export function publishDemoScenarios(): void {
  requireDbEnv(); // guard before touching any database
  execFileSync("pnpm", ["exec", "tsx", "--conditions=react-server", "scripts/publish-scenarios.ts", "--include-drafts"], {
    stdio: ["ignore", "pipe", "inherit"],
    // process.env already holds .env.test, which wins over .env.local (loadEnvFile never overrides).
    env: process.env,
  });
}
