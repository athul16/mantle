import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/database.types";
import { createServiceClient } from "@/lib/supabase/service";
import { removeCandidateObjects, type PurgeClient } from "./purge";

export type DeleteCandidateResult = { ok: true; objectsRemoved: number } | { ok: false; error: "forbidden" | "failed" };

/**
 * Delete on request (docs/02 Compliance). The rows go through the admin's own
 * client, so delete_candidate_data checks they are an admin of the invite's
 * org and writes the audit row. Only then are the snapshot files it returned
 * removed with the service client, limited to that org's folder.
 */
export async function deleteCandidateData(
  userDb: SupabaseClient<Database>,
  orgId: string,
  inviteId: string,
): Promise<DeleteCandidateResult> {
  const { data, error } = await userDb.rpc("delete_candidate_data", { p_invite_id: inviteId });
  if (error) return { ok: false, error: error.code === "42501" ? "forbidden" : "failed" };
  const objectsRemoved = await removeCandidateObjects(createServiceClient() as unknown as PurgeClient, orgId, data ?? []);
  return { ok: true, objectsRemoved };
}
