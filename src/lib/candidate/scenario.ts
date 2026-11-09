import "server-only";

import { getScenario } from "@/lib/engine/scenarios";
import type { ServerScenario } from "@/lib/engine/server/scenario";
import { createServiceClient } from "@/lib/supabase/service";

/**
 * An attempt's scenario: attempts.scenario_id -> scenarios row (slug, version)
 * -> code-defined scenario (decision Q6). The row is a frozen copy, so the
 * candidate keeps the version they started on even if a newer one ships.
 */
export async function loadScenario(scenarioId: string): Promise<ServerScenario> {
  const { data, error } = await createServiceClient()
    .from("scenarios")
    .select("slug, version")
    .eq("id", scenarioId)
    .single();
  if (error) throw new Error(`scenario ${scenarioId} lookup failed: ${error.message}`);
  return getScenario(data.slug, data.version);
}
