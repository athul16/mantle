/**
 * Publishes every code-defined scenario version into the platform library.
 * Safe to re-run: versions already published are left as they are.
 *
 *   pnpm scenarios:publish
 *
 * Reads .env.local when present (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY);
 * otherwise uses the environment as is.
 */
import { existsSync } from "node:fs";

import { listScenarios } from "@/lib/engine/scenarios";
import { publishScenario } from "@/lib/scenarios/publish";

if (existsSync(".env.local")) process.loadEnvFile(".env.local");

async function main() {
  for (const { slug, version } of listScenarios()) {
    const id = await publishScenario(slug, version);
    console.log(`${slug}@v${version} -> ${id}`);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
