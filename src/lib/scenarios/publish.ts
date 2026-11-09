import "server-only";

import type { Json } from "@/lib/database.types";
import { getScenario } from "@/lib/engine/scenarios";
import { createServiceClient } from "@/lib/supabase/service";

const UNIQUE_VIOLATION = "23505";

/**
 * Freezes one code-defined scenario version into the platform library
 * (scenarios row with org_id null) and returns the row id. Code is the source
 * of truth; the row is an immutable copy that attempts point at (decision Q6).
 * Idempotent: if the row already exists its id is returned unchanged. A
 * published row is never edited; changing a scenario means a new version.
 */
export async function publishScenario(slug: string, version: number): Promise<string> {
  const scenario = getScenario(slug, version);
  const supabase = createServiceClient();

  const existing = await findLibraryRow(slug, version);
  if (existing) return existing;

  const { data, error } = await supabase
    .from("scenarios")
    .insert({
      org_id: null,
      slug: scenario.slug,
      version: scenario.version,
      title: scenario.title,
      role_family: scenario.roleFamily,
      // ScenarioDefinition is public content only; generators and keys stay in code.
      definition: scenario.definition as unknown as Json,
      published_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    // Another process published the same version first.
    if (error.code === UNIQUE_VIOLATION) {
      const raced = await findLibraryRow(slug, version);
      if (raced) return raced;
    }
    throw new Error(`publishing ${slug}@v${version} failed: ${error.message}`);
  }
  return data.id;
}

async function findLibraryRow(slug: string, version: number): Promise<string | null> {
  const { data, error } = await createServiceClient()
    .from("scenarios")
    .select("id")
    .is("org_id", null)
    .eq("slug", slug)
    .eq("version", version)
    .maybeSingle();
  if (error) throw new Error(`looking up ${slug}@v${version} failed: ${error.message}`);
  return data?.id ?? null;
}
