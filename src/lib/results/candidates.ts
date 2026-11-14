import "server-only";

import type { ScenarioDefinition } from "@/lib/engine/types";
import { createClient } from "@/lib/supabase/server";
import { percentiles, type CandidateRow, type IntegrityLabel, type TaskScore } from "./candidate-table";
import { listJobResults } from "./queries";
import { readAttemptScore, stepsNeedingReview } from "./summary";

// The job candidates table: listJobResults plus what the prototype's columns
// need (integrity label and flag count, team votes, per-task scores,
// percentile). Every read goes through the signed-in user's client, so RLS
// limits it to their company, and filters by org_id too.

type AttemptExtra = { id: string; invite_id: string; started_at: string | null; integrity_label: string | null; scenario_id: string; score: unknown; status: string };

export async function listJobCandidates(orgId: string, jobId: string): Promise<CandidateRow[]> {
  const db = await createClient();
  const [base, invites] = await Promise.all([
    listJobResults(orgId, jobId),
    db.from("invites").select("id, expires_at, attempts(id, invite_id, started_at, integrity_label, scenario_id, score, status)").eq("org_id", orgId).eq("job_id", jobId),
  ]);
  if (invites.error) throw invites.error;

  const expires = new Map<string, string>();
  const attempts = new Map<string, AttemptExtra>();
  for (const i of invites.data) {
    expires.set(i.id, i.expires_at);
    const a = (Array.isArray(i.attempts) ? i.attempts[0] : i.attempts) as AttemptExtra | null | undefined;
    if (a) attempts.set(i.id, a);
  }

  const attemptIds = [...attempts.values()].map((a) => a.id);
  const scenarioIds = [...new Set([...attempts.values()].map((a) => a.scenario_id))];
  const [flags, notes, scenarios] = await Promise.all([
    attemptIds.length ? db.from("flags").select("attempt_id").eq("org_id", orgId).in("attempt_id", attemptIds) : Promise.resolve({ data: [], error: null }),
    attemptIds.length ? db.from("notes").select("attempt_id, vote").eq("org_id", orgId).in("attempt_id", attemptIds) : Promise.resolve({ data: [], error: null }),
    scenarioIds.length ? db.from("scenarios").select("id, definition").in("id", scenarioIds) : Promise.resolve({ data: [], error: null }),
  ]);
  for (const r of [flags, notes, scenarios]) if (r.error) throw r.error;

  const flagCount = new Map<string, number>();
  for (const f of flags.data ?? []) flagCount.set(f.attempt_id, (flagCount.get(f.attempt_id) ?? 0) + 1);
  const votes = new Map<string, { hire: number; noHire: number }>();
  for (const n of notes.data ?? []) {
    const v = votes.get(n.attempt_id) ?? { hire: 0, noHire: 0 };
    if (n.vote === "hire") v.hire++;
    if (n.vote === "no_hire") v.noHire++;
    votes.set(n.attempt_id, v);
  }
  const steps = new Map<string, ScenarioDefinition["steps"]>();
  for (const s of scenarios.data ?? []) steps.set(s.id, ((s.definition ?? null) as ScenarioDefinition | null)?.steps ?? []);

  const pct = percentiles(base);
  return base.map((r) => {
    const a = attempts.get(r.inviteId);
    const score = a?.status === "scored" ? readAttemptScore(a.score) : null;
    const scenarioSteps = (a && steps.get(a.scenario_id)) ?? [];
    const tasks: TaskScore[] = score
      ? scenarioSteps
          .filter((s) => score.steps[s.id])
          .map((s) => ({ stepId: s.id, title: s.title, points: score.steps[s.id].points, maxPoints: score.steps[s.id].maxPoints }))
      : [];
    const review = stepsNeedingReview(score);
    const label = a?.integrity_label;
    return {
      ...r,
      startedAt: a?.started_at ?? null,
      expiresAt: expires.get(r.inviteId) ?? r.invitedAt,
      integrity: label === "clear" || label === "review" || label === "suspicious" ? (label as IntegrityLabel) : null,
      flagCount: a ? (flagCount.get(a.id) ?? 0) : 0,
      hireVotes: a ? (votes.get(a.id)?.hire ?? 0) : 0,
      noHireVotes: a ? (votes.get(a.id)?.noHire ?? 0) : 0,
      tasks,
      replyToScore: review.length > 0 && review.every((id) => scenarioSteps.find((s) => s.id === id)?.type === "inbox_reply"),
      percentile: pct.get(r.inviteId) ?? null,
    };
  });
}
