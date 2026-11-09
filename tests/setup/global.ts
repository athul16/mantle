/**
 * Vitest global setup (once per run). With a test database configured, checks
 * it is local and publishes the demo scenarios into it. Without one (unit and
 * component runs, e.g. the CI `checks` job) it does nothing; database tests
 * then fail with "run pnpm db:test:start".
 */
import { assertLocalSupabase, loadTestEnv } from "../helpers/env";
import { publishDemoScenarios } from "../helpers/scenarios";

export default function setup() {
  loadTestEnv();
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.SUPABASE_SECRET_KEY) return;
  assertLocalSupabase();
  if (process.env.SKIP_SCENARIO_PUBLISH === "1") return;
  publishDemoScenarios();
}
