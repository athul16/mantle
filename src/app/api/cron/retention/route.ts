import { isAuthorizedCron } from "@/lib/retention/cron-auth";
import { runRetentionPurge, type PurgeClient } from "@/lib/retention/purge";
import { createServiceClient } from "@/lib/supabase/service";

// Daily retention purge (vercel.json crons). Vercel calls it with
// `Authorization: Bearer ${CRON_SECRET}`; anything else gets 401. Deletes the
// snapshots past their org's media period, then the candidates past its results
// period, and returns counts only.
export const maxDuration = 300;

export async function GET(request: Request) {
  if (!isAuthorizedCron(request.headers.get("authorization"), process.env.CRON_SECRET)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const summary = await runRetentionPurge(createServiceClient() as unknown as PurgeClient);
    return Response.json(summary);
  } catch (err) {
    console.error("retention purge failed", err instanceof Error ? err.message : err);
    return Response.json({ error: "purge_failed" }, { status: 500 });
  }
}
