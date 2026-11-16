import "server-only";

import type { ServerScenario } from "../server/scenario";
import { auditCalderBluestem } from "./audit-calder-bluestem";
import { corporateApRidgeway } from "./corporate-ap-ridgeway";
import { demoEntriesReview } from "./demo-entries-review";
import { demoMiniClose } from "./demo-mini-close";
import { demoPettyCash } from "./demo-petty-cash";
import { demoTimedClose } from "./demo-timed-close";
import { ediscoveryLarchReview } from "./ediscovery-larch-review";
import { harborLaneBankRec } from "./harbor-lane-bank-rec";

/** Code-defined scenarios, keyed by `slug@vN` (matches scenarios.slug + version). */
const scenarios: Record<string, ServerScenario> = {
  [`${demoPettyCash.slug}@v${demoPettyCash.version}`]: demoPettyCash,
  [`${demoMiniClose.slug}@v${demoMiniClose.version}`]: demoMiniClose,
  [`${demoEntriesReview.slug}@v${demoEntriesReview.version}`]: demoEntriesReview,
  [`${demoTimedClose.slug}@v${demoTimedClose.version}`]: demoTimedClose,
  [`${harborLaneBankRec.slug}@v${harborLaneBankRec.version}`]: harborLaneBankRec,
  [`${auditCalderBluestem.slug}@v${auditCalderBluestem.version}`]: auditCalderBluestem,
  [`${corporateApRidgeway.slug}@v${corporateApRidgeway.version}`]: corporateApRidgeway,
  [`${ediscoveryLarchReview.slug}@v${ediscoveryLarchReview.version}`]: ediscoveryLarchReview,
};

export function getScenario(slug: string, version: number): ServerScenario {
  const scenario = scenarios[`${slug}@v${version}`];
  if (!scenario) throw new Error(`unknown scenario ${slug}@v${version}`);
  return scenario;
}

export function listScenarios(): ServerScenario[] {
  return Object.values(scenarios);
}
