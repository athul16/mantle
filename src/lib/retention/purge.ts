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

export type PurgeCounts = { checked: number; purged: number; failed: number; objectsRemoved: number };
export type PurgeSummary = { media: PurgeCounts; results: PurgeCounts };

type Clock = { list: string; purge: string; idArg: string; idOf: (row: Record<string, string>) => string; label: string };

/** Media clock: an attempt's snapshot rows and files, nothing else. */
const MEDIA: Clock = {
  list: "list_media_past_retention",
  purge: "purge_media_for_retention",
  idArg: "p_attempt_id",
  idOf: (r) => r.attempt_id,
  label: "media",
};
/** Results clock: the whole candidate (invite, attempt, answers, flags, notes) and any files left. */
const RESULTS: Clock = {
  list: "list_candidates_past_retention",
  purge: "purge_candidate_for_retention",
  idArg: "p_invite_id",
  idOf: (r) => r.invite_id,
  label: "candidate",
};

async function runClock(client: PurgeClient, clock: Clock, now: string, limit: number): Promise<PurgeCounts> {
  const listed = await client.rpc(clock.list, { p_now: now, p_limit: limit });
  if (listed.error) throw new Error(`listing ${clock.label} past retention failed: ${listed.error.message}`);
  const rows = (listed.data ?? []) as (Record<string, string> & { org_id: string })[];

  const counts: PurgeCounts = { checked: rows.length, purged: 0, failed: 0, objectsRemoved: 0 };
  for (const row of rows) {
    try {
      const purged = await client.rpc(clock.purge, { [clock.idArg]: clock.idOf(row), p_now: now });
      if (purged.error) throw new Error(purged.error.message);
      counts.purged++;
      counts.objectsRemoved += await removeCandidateObjects(client, row.org_id, (purged.data ?? []) as string[]);
    } catch (err) {
      counts.failed++;
      console.error(`retention purge failed for one ${clock.label}`, err instanceof Error ? err.message : err);
    }
  }
  return counts;
}

/**
 * The daily purge, one clock after the other, oldest first, in batches. Media
 * first: snapshots past the org's media period go while the results stay. Then
 * every candidate past the results period goes entirely. One failure doesn't
 * stop the rest; the summary holds counts only (no ids or emails), so it is
 * safe to log and return.
 */
export async function runRetentionPurge(client: PurgeClient, opts: { now?: Date; limit?: number } = {}): Promise<PurgeSummary> {
  const now = (opts.now ?? new Date()).toISOString();
  const limit = opts.limit ?? 200;
  const media = await runClock(client, MEDIA, now, limit);
  const results = await runClock(client, RESULTS, now, limit);
  return { media, results };
}
