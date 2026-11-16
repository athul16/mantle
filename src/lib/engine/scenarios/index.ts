import "server-only";

import type { ServerScenario } from "../server/scenario";
import { corporateApRidgeway } from "./corporate-ap-ridgeway";
import { demoEntriesReview } from "./demo-entries-review";
import { demoMiniClose } from "./demo-mini-close";
import { demoPettyCash } from "./demo-petty-cash";
import { harborLaneBankRec } from "./harbor-lane-bank-rec";

/** Code-defined scenarios, keyed by `slug@vN` (matches scenarios.slug + version). */
const scenarios: Record<string, ServerScenario> = {
  [`${demoPettyCash.slug}@v${demoPettyCash.version}`]: demoPettyCash,
  [`${demoMiniClose.slug}@v${demoMiniClose.version}`]: demoMiniClose,
  [`${demoEntriesReview.slug}@v${demoEntriesReview.version}`]: demoEntriesReview,
  [`${harborLaneBankRec.slug}@v${harborLaneBankRec.version}`]: harborLaneBankRec,
  [`${corporateApRidgeway.slug}@v${corporateApRidgeway.version}`]: corporateApRidgeway,
};

export function getScenario(slug: string, version: number): ServerScenario {
  const scenario = scenarios[`${slug}@v${version}`];
  if (!scenario) throw new Error(`unknown scenario ${slug}@v${version}`);
  return scenario;
}

export function listScenarios(): ServerScenario[] {
  return Object.values(scenarios);
}
