import "server-only";

import type { ServerScenario } from "../server/scenario";
import { advisoryKestrelP2p } from "./advisory-kestrel-p2p";
import { auditCalderBluestem } from "./audit-calder-bluestem";
import { forensicMarlowExpenses } from "./forensic-marlow-expenses";
import { corporateApRidgeway } from "./corporate-ap-ridgeway";
import { corporateHalyardRobotics } from "./corporate-halyard-robotics";
import { demoEntriesReview } from "./demo-entries-review";
import { demoMiniClose } from "./demo-mini-close";
import { demoPettyCash } from "./demo-petty-cash";
import { demoTimedClose } from "./demo-timed-close";
import { ediscoveryLarchReview } from "./ediscovery-larch-review";
import { harborLaneBankRec } from "./harbor-lane-bank-rec";
import { immigrationH1bPacket } from "./immigration-h1b-packet";
import { litigationMorrowTidewater } from "./litigation-morrow-tidewater";
import { piDiazDemand } from "./pi-diaz-demand";
import { realestateAlderClosing } from "./realestate-alder-closing";
import { taxHollisScheduleC } from "./tax-hollis-schedule-c";

/** Code-defined scenarios, keyed by `slug@vN` (matches scenarios.slug + version). */
const scenarios: Record<string, ServerScenario> = {
  [`${demoPettyCash.slug}@v${demoPettyCash.version}`]: demoPettyCash,
  [`${demoMiniClose.slug}@v${demoMiniClose.version}`]: demoMiniClose,
  [`${demoEntriesReview.slug}@v${demoEntriesReview.version}`]: demoEntriesReview,
  [`${demoTimedClose.slug}@v${demoTimedClose.version}`]: demoTimedClose,
  [`${harborLaneBankRec.slug}@v${harborLaneBankRec.version}`]: harborLaneBankRec,
  [`${auditCalderBluestem.slug}@v${auditCalderBluestem.version}`]: auditCalderBluestem,
  [`${corporateApRidgeway.slug}@v${corporateApRidgeway.version}`]: corporateApRidgeway,
  [`${forensicMarlowExpenses.slug}@v${forensicMarlowExpenses.version}`]: forensicMarlowExpenses,
  [`${ediscoveryLarchReview.slug}@v${ediscoveryLarchReview.version}`]: ediscoveryLarchReview,
  [`${litigationMorrowTidewater.slug}@v${litigationMorrowTidewater.version}`]: litigationMorrowTidewater,
  [`${piDiazDemand.slug}@v${piDiazDemand.version}`]: piDiazDemand,
  [`${corporateHalyardRobotics.slug}@v${corporateHalyardRobotics.version}`]: corporateHalyardRobotics,
  [`${realestateAlderClosing.slug}@v${realestateAlderClosing.version}`]: realestateAlderClosing,
  [`${immigrationH1bPacket.slug}@v${immigrationH1bPacket.version}`]: immigrationH1bPacket,
  [`${taxHollisScheduleC.slug}@v${taxHollisScheduleC.version}`]: taxHollisScheduleC,
  [`${advisoryKestrelP2p.slug}@v${advisoryKestrelP2p.version}`]: advisoryKestrelP2p,
};

export function getScenario(slug: string, version: number): ServerScenario {
  const scenario = scenarios[`${slug}@v${version}`];
  if (!scenario) throw new Error(`unknown scenario ${slug}@v${version}`);
  return scenario;
}

export function listScenarios(): ServerScenario[] {
  return Object.values(scenarios);
}
