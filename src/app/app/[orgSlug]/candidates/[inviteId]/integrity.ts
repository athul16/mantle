import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";

type Db = SupabaseClient<Database>;

/** How many times each browser signal was recorded during the attempt (integrity_events, read through RLS). */
export type SignalCounts = Record<string, number>;

export async function getSignalCounts(db: Db, orgId: string, attemptId: string): Promise<SignalCounts> {
  const { data, error } = await db
    .from("integrity_events")
    .select("kind")
    .eq("org_id", orgId)
    .eq("attempt_id", attemptId)
    .limit(5000);
  if (error) throw error;
  const counts: SignalCounts = {};
  for (const row of data ?? []) counts[row.kind] = (counts[row.kind] ?? 0) + 1;
  return counts;
}
