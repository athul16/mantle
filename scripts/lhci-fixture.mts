/**
 * Creates a company, job and invite in the local test database and writes the
 * candidate landing URL to .lighthouseci/fixture.json, so lighthouserc.cjs can
 * audit /a/<token>. Opening the landing page uses nothing up, so Lighthouse can
 * load it repeatedly. Local database only (guarded); `pnpm db:test:reset`
 * clears the rows.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { createTestData } from "../tests/helpers/factories";
import { publishDemoScenarios } from "../tests/helpers/scenarios";
import { requireDbEnv } from "../tests/helpers/env";

requireDbEnv();
publishDemoScenarios();
const data = createTestData("lhci");
const { invite } = await data.hiringSetup();
mkdirSync(".lighthouseci", { recursive: true });
writeFileSync(".lighthouseci/fixture.json", JSON.stringify({ candidateLandingPath: invite.link }));
console.log("wrote .lighthouseci/fixture.json");
