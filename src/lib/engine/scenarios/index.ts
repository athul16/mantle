import "server-only";

import type { ServerScenario } from "../server/scenario";
import { demoPettyCash } from "./demo-petty-cash";

/** Code-defined scenarios, keyed by `slug@vN` (matches scenarios.slug + version). */
const scenarios: Record<string, ServerScenario> = {
  [`${demoPettyCash.slug}@v${demoPettyCash.version}`]: demoPettyCash,
};

export function getScenario(slug: string, version: number): ServerScenario {
  const scenario = scenarios[`${slug}@v${version}`];
  if (!scenario) throw new Error(`unknown scenario ${slug}@v${version}`);
  return scenario;
}

export function listScenarios(): ServerScenario[] {
  return Object.values(scenarios);
}
