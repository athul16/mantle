import "server-only";

import type { Json } from "@/lib/database.types";
import type { AttemptRow } from "@/lib/candidate/invite";
import { createServiceClient } from "@/lib/supabase/service";
import { DOWNTIME_SIGNAL, readProctoring, type Proctoring } from "./config";
import { downPeriods, evaluateRules, integrityLabel, type DownClosedBy, type DownPeriod, type MediaRef, type SignalEvent } from "./rules";

/**
 * Flags and down periods for one attempt, written with the service role
 * (candidates have no Supabase user). Kept apart from server.ts so the attempt
 * lifecycle (src/lib/candidate/attempt.ts) can call it at submit without an
 * import cycle.
 */

type AttemptKey = Pick<AttemptRow, "id" | "org_id">;

/**
 * Re-runs the rules over everything recorded for the attempt. New rules get a
 * flag; open flags get the latest reason and evidence; flags a recruiter has
 * already confirmed or cleared are left exactly as reviewed. Also sets the
 * attempt's integrity label.
 */
export async function refreshFlags(attempt: AttemptKey, settings: Proctoring): Promise<void> {
  const db = createServiceClient();
  const [events, media, existing] = await Promise.all([
    db.from("integrity_events").select("id, at, kind, payload").eq("attempt_id", attempt.id).eq("org_id", attempt.org_id).order("at").limit(5000),
    db.from("media").select("id, at, source").eq("attempt_id", attempt.id).eq("org_id", attempt.org_id).order("at").limit(5000),
    db.from("flags").select("id, rule, status").eq("attempt_id", attempt.id).eq("org_id", attempt.org_id).not("rule", "is", null),
  ]);
  for (const r of [events, media, existing]) if (r.error) throw new Error(`loading proctoring data failed: ${r.error.message}`);

  const drafts = evaluateRules((events.data ?? []) as SignalEvent[], (media.data ?? []) as MediaRef[], settings);
  const byRule = new Map((existing.data ?? []).map((f) => [f.rule!, f]));

  for (const d of drafts) {
    const current = byRule.get(d.rule);
    const evidence = d.evidence as unknown as Json;
    if (!current) {
      const { error } = await db
        .from("flags")
        .insert({ attempt_id: attempt.id, org_id: attempt.org_id, rule: d.rule, reason: d.reason, evidence });
      // 23505: a parallel batch raised the same rule first; the next batch updates it.
      if (error && error.code !== "23505") throw new Error(`raising flag failed: ${error.message}`);
    } else if (current.status === "open") {
      const { error } = await db.from("flags").update({ reason: d.reason, evidence }).eq("id", current.id).eq("status", "open");
      if (error) throw new Error(`updating flag failed: ${error.message}`);
    }
  }

  const { error } = await db
    .from("attempts")
    .update({ integrity_label: integrityLabel(drafts) })
    .eq("id", attempt.id)
    .eq("org_id", attempt.org_id);
  if (error) throw new Error(`setting integrity label failed: ${error.message}`);
}

const GAP_KINDS = ["camera_stopped", "camera_started", "screen_share_stopped", "screen_share_started", DOWNTIME_SIGNAL];

/**
 * Records each closed camera / screen-share down period as a DOWNTIME_SIGNAL
 * event (D4: the timer keeps running, the recruiter sees the gaps). Safe to
 * call on every signal batch: a period is written once per stop event. With
 * `end`, gaps still open (tab closed, never reconnected) are closed there.
 * Returns how many periods were written.
 */
export async function recordDownPeriods(
  attempt: AttemptKey,
  end?: { at: string; closedBy: Exclude<DownClosedBy, "reconnected"> },
): Promise<number> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("integrity_events")
    .select("id, at, kind, payload")
    .eq("attempt_id", attempt.id)
    .eq("org_id", attempt.org_id)
    .in("kind", GAP_KINDS)
    .order("at")
    .limit(5000);
  if (error) throw new Error(`loading monitoring events failed: ${error.message}`);
  const events = (data ?? []) as SignalEvent[];

  const recorded = new Set(
    events.filter((e) => e.kind === DOWNTIME_SIGNAL).map((e) => (e.payload as Partial<DownPeriod> | null)?.stopEventId),
  );
  const fresh = downPeriods(events, end).filter((p) => !recorded.has(p.stopEventId));
  if (!fresh.length) return 0;

  const { error: insertError } = await db.from("integrity_events").insert(
    fresh.map((p) => ({ attempt_id: attempt.id, org_id: attempt.org_id, kind: DOWNTIME_SIGNAL, at: p.from, payload: p as unknown as Json })),
  );
  if (insertError) throw new Error(`recording downtime failed: ${insertError.message}`);
  return fresh.length;
}

/**
 * At submit or timeout: closes any gap still open at the attempt's end and
 * refreshes its flags. Does nothing for an attempt without camera or screen.
 */
export async function closeDowntimeAtEnd(
  attempt: AttemptKey,
  assessmentId: string,
  end: { at: string; closedBy: "submitted" | "deadline" },
): Promise<void> {
  const { data, error } = await createServiceClient()
    .from("assessments")
    .select("proctoring")
    .eq("id", assessmentId)
    .eq("org_id", attempt.org_id)
    .single();
  if (error) throw new Error(`proctoring settings lookup failed: ${error.message}`);
  const settings = readProctoring(data.proctoring);
  if (!settings.camera && !settings.screen) return;
  if (await recordDownPeriods(attempt, end)) await refreshFlags(attempt, settings);
}
