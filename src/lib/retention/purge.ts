import "server-only";

import { PROCTORING_BUCKET } from "@/lib/proctoring/config";

/**
 * Deleting candidate data (docs/02 Compliance). The database purge
 * (private.purge_candidate, reached through delete_candidate_data or
 * purge_candidate_for_retention) removes the rows and returns the snapshot
 * paths; these helpers then remove the files with the service client, since
 * SQL can't delete storage objects.
 */

type RpcResult = PromiseLike<{ data: unknown; error: { message: string } | null }>;

/** The parts of a Supabase client the purge needs (a service client in practice). */
export type PurgeClient = {
  rpc: (fn: string, args: Record<string, unknown>) => RpcResult;
  storage: {
    from: (bucket: string) => { remove: (paths: string[]) => PromiseLike<{ data: unknown; error: { message: string } | null }> };
  };
};

const REMOVE_BATCH = 100;

/** Removes snapshot files, only inside the org's own folder. Returns how many paths were sent for removal. */
export async function removeCandidateObjects(client: PurgeClient, orgId: string, paths: string[]): Promise<number> {
  const prefix = `${orgId}/`;
  const own = [...new Set(paths)].filter((p) => p.startsWith(prefix) && !p.split("/").includes(".."));
  for (let i = 0; i < own.length; i += REMOVE_BATCH) {
    const { error } = await client.storage.from(PROCTORING_BUCKET).remove(own.slice(i, i + REMOVE_BATCH));
    if (error) throw new Error(`removing snapshots failed: ${error.message}`);
  }
  return own.length;
}

export type PurgeSummary = { checked: number; purged: number; failed: number; objectsRemoved: number };

/**
 * The daily purge: every candidate past their org's retention, oldest first,
 * in batches. One failure doesn't stop the rest; the summary holds counts only
 * (no ids or emails), so it is safe to log and return.
 */
export async function runRetentionPurge(client: PurgeClient, opts: { now?: Date; limit?: number } = {}): Promise<PurgeSummary> {
  const now = (opts.now ?? new Date()).toISOString();
  const listed = await client.rpc("list_candidates_past_retention", { p_now: now, p_limit: opts.limit ?? 200 });
  if (listed.error) throw new Error(`listing candidates past retention failed: ${listed.error.message}`);
  const rows = (listed.data ?? []) as { invite_id: string; org_id: string }[];

  const summary: PurgeSummary = { checked: rows.length, purged: 0, failed: 0, objectsRemoved: 0 };
  for (const row of rows) {
    try {
      const purged = await client.rpc("purge_candidate_for_retention", { p_invite_id: row.invite_id, p_now: now });
      if (purged.error) throw new Error(purged.error.message);
      summary.purged++;
      summary.objectsRemoved += await removeCandidateObjects(client, row.org_id, (purged.data ?? []) as string[]);
    } catch (err) {
      summary.failed++;
      console.error("retention purge failed for one candidate", err instanceof Error ? err.message : err);
    }
  }
  return summary;
}
