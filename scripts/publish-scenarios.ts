/**
 * Publishes the reviewed code-defined scenario versions into the platform
 * library. Only versions on the allowlist in src/lib/scenarios/publishable.ts
 * are published; drafts are listed and skipped. Safe to re-run: versions
 * already published are left as they are.
 *
 *   pnpm scenarios:publish
 *   pnpm scenarios:publish --include-drafts   (local Supabase only; used by test setup)
 *
 * Reads .env.local when present (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY);
 * otherwise uses the environment as is.
 */
import { existsSync } from "node:fs";

import { listScenarios } from "@/lib/engine/scenarios";
import { publishScenario } from "@/lib/scenarios/publish";
import { assertDraftsAllowed, splitPublishable } from "@/lib/scenarios/publishable";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  const includeDrafts = process.argv.includes("--include-drafts");
  if (includeDrafts) assertDraftsAllowed(process.env.NEXT_PUBLIC_SUPABASE_URL);

  const { publish, drafts } = splitPublishable(listScenarios());
  for (const { slug, version } of includeDrafts ? [...publish, ...drafts] : publish) {
    const id = await publishScenario(slug, version);
    console.log(`${slug}@v${version} -> ${id}`);
  }
  if (!includeDrafts) {
    for (const { slug, version } of drafts) console.log(`${slug}@v${version} skipped (draft)`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
