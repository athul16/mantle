/** Playwright global setup: check the database is local and publish the demo scenarios into it. */
import { publishDemoScenarios } from "../tests/helpers/scenarios";
import { requireDbEnv } from "../tests/helpers/env";

export default function globalSetup() {
  requireDbEnv();
  publishDemoScenarios();
}
