import "server-only";

import { getScenario } from "@/lib/engine/scenarios";
import type { ScenarioDefinition } from "@/lib/engine/types";
import { displayStatus, type InviteStatus } from "@/lib/jobs/status";
import { getEmails } from "@/lib/profiles";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { describeStep, type StepDetail } from "./answer-key";
import { answersSoonAfterReturn, rapidGap, type TimingReport } from "./timing";
import {
  buildTimeline,
  durationSeconds,
  readAttemptScore,
  scorePercent,
  stepsNeedingReview,
  type ResultRow,
  type StoredAttemptScore,
  type StoredStepScore,
  type TimelineEntry,
} from "./summary";

// Reads for the results table and candidate report. Everything goes through
// the signed-in user's client (RLS limits it to their company) and also
// filters by org_id. The service client is used for exactly two things, both
// after the attempt was read through RLS: the attempt's variant seed (to
// rebuild the answer key on the server) and teammates' emails (auth admin).

type AttemptRow = {
  id: string;
  status: string;
  started_at: string | null;
  submitted_at: string | null;
  submit_reason: string | null;
  score: unknown;
  auto_score?: unknown;
};

// attempts.invite_id is unique, but PostgREST may still embed it as an array.
function one<T>(x: T | T[] | null | undefined): T | null {
  if (Array.isArray(x)) return x[0] ?? null;
  return x ?? null;
}

export async function listJobResults(orgId: string, jobId: string): Promise<ResultRow[]> {
  const db = await createClient();
  const { data, error } = await db
    .from("invites")
    .select("id, email, candidate_name, status, created_at, expires_at, attempts(id, status, started_at, submitted_at, submit_reason, score)")
    .eq("org_id", orgId)
    .eq("job_id", jobId)
    .order("created_at", { ascending: false })
    .order("email");
  if (error) throw error;

  const now = Date.now();
  return data.map((i) => {
    const attempt = one<AttemptRow>(i.attempts as AttemptRow | AttemptRow[] | null);
    const score = attempt?.status === "scored" ? readAttemptScore(attempt.score) : null;
    return {
      inviteId: i.id,
      email: i.email,
      candidateName: i.candidate_name,
      status: displayStatus(i.status, i.expires_at, now),
      needsReview: stepsNeedingReview(score).length > 0,
      points: score?.points ?? null,
      maxPoints: score?.maxPoints ?? null,
      percent: score ? scorePercent(score.points, score.maxPoints) : null,
      timeTakenSeconds: durationSeconds(attempt?.started_at ?? null, attempt?.submitted_at ?? null),
      submittedAt: attempt?.submitted_at ?? null,
      invitedAt: i.created_at,
    };
  });
}

export type ReportNote = {
  id: string;
  authorId: string;
  authorEmail: string;
  body: string;
  vote: "hire" | "no_hire" | "unsure" | null;
  createdAt: string;
};

export type CandidateReport = {
  inviteId: string;
  email: string;
  candidateName: string | null;
  status: InviteStatus;
  invitedAt: string;
  job: { id: string; title: string };
  assessment: { title: string; timeLimitMinutes: number; passScore: number | null } | null;
  attempt: {
    id: string;
    status: string;
    startedAt: string | null;
    submittedAt: string | null;
    submitReason: string | null;
    timeTakenSeconds: number | null;
    score: StoredAttemptScore | null;
    /** The score as computed at submit, before any reviewer marks (D11). */
    autoScore: StoredAttemptScore | null;
    needsReview: string[];
  } | null;
  steps: (StepDetail & { autoScore: StoredStepScore | null })[];
  timeline: TimelineEntry[];
  /** Timing evidence rows when the assessment has a rapid round (docs/06); null otherwise. Never changes the label. */
  timing: TimingReport | null;
  notes: ReportNote[];
};

export async function getCandidateReport(orgId: string, inviteId: string): Promise<CandidateReport | null> {
  const db = await createClient();
  const { data: invite, error } = await db
    .from("invites")
    .select(
      "id, email, candidate_name, status, created_at, expires_at, jobs(id, title, assessments(title, time_limit_minutes, pass_score)), attempts(id, status, started_at, submitted_at, submit_reason, score, auto_score, scenario_id)",
    )
    .eq("org_id", orgId)
    .eq("id", inviteId)
    .maybeSingle();
  if (error) throw error;
  if (!invite || !invite.jobs) return null;

  const job = invite.jobs;
  const assessment = one(job.assessments);
  const attempt = one(invite.attempts as (AttemptRow & { scenario_id: string }) | (AttemptRow & { scenario_id: string })[] | null);

  const base: CandidateReport = {
    inviteId: invite.id,
    email: invite.email,
    candidateName: invite.candidate_name,
    status: displayStatus(invite.status, invite.expires_at),
    invitedAt: invite.created_at,
    job: { id: job.id, title: job.title },
    assessment: assessment
      ? { title: assessment.title, timeLimitMinutes: assessment.time_limit_minutes, passScore: assessment.pass_score }
      : null,
    attempt: null,
    steps: [],
    timeline: [],
    timing: null,
    notes: [],
  };
  if (!attempt) return base;

  const [scenarioRow, responses, events, notes, signals] = await Promise.all([
    db.from("scenarios").select("slug, version, definition").eq("id", attempt.scenario_id).maybeSingle(),
    db.from("step_responses").select("step_id, answer").eq("org_id", orgId).eq("attempt_id", attempt.id),
    db.from("action_events").select("at, kind, payload").eq("org_id", orgId).eq("attempt_id", attempt.id).order("at").order("id"),
    db
      .from("notes")
      .select("id, author_id, body, vote, created_at")
      .eq("org_id", orgId)
      .eq("attempt_id", attempt.id)
      .order("created_at", { ascending: true }),
    db
      .from("integrity_events")
      .select("at, kind, payload")
      .eq("org_id", orgId)
      .eq("attempt_id", attempt.id)
      .eq("kind", "returned_to_window")
      .order("at")
      .limit(5000),
  ]);
  for (const r of [scenarioRow, responses, events, notes, signals]) if (r.error) throw r.error;

  const score = attempt.status === "scored" ? readAttemptScore(attempt.score) : null;
  const autoScore = attempt.status === "scored" ? readAttemptScore(attempt.auto_score) : null;
  const definition = (scenarioRow.data?.definition ?? null) as ScenarioDefinition | null;
  const answers = Object.fromEntries((responses.data ?? []).map((r) => [r.step_id, r.answer as unknown]));

  // Answer keys only for submitted attempts; never while the candidate is still working.
  let steps: CandidateReport["steps"] = [];
  if (scenarioRow.data && (attempt.status === "submitted" || attempt.status === "scored")) {
    const seed = await attemptSeed(orgId, attempt.id);
    const scenario = getScenario(scenarioRow.data.slug, scenarioRow.data.version);
    const variant = seed ? scenario.generate(seed) : null;
    steps = scenario.definition.steps.map((step) => ({
      ...describeStep(step, variant, answers[step.id], score?.steps[step.id] ?? null),
      autoScore: autoScore?.steps[step.id] ?? null,
    }));
  }

  const stepTitles = Object.fromEntries((definition?.steps ?? []).map((s) => [s.id, s.title]));
  const hasRapid = (definition?.steps ?? []).some((s) => s.type === "rapid_round");
  const timing: TimingReport | null = hasRapid
    ? {
        quickAfterReturn: answersSoonAfterReturn(events.data ?? [], signals.data ?? [], stepTitles),
        rapidGap: rapidGap((definition?.steps ?? []).map((s) => ({ type: s.type, score: score?.steps[s.id] ?? null }))),
      }
    : null;
  const messageSubjects = Object.fromEntries((definition?.messages ?? []).map((m) => [m.id, m.subject]));

  return {
    ...base,
    attempt: {
      id: attempt.id,
      status: attempt.status,
      startedAt: attempt.started_at,
      submittedAt: attempt.submitted_at,
      submitReason: attempt.submit_reason,
      timeTakenSeconds: durationSeconds(attempt.started_at, attempt.submitted_at),
      score,
      autoScore,
      needsReview: stepsNeedingReview(score),
    },
    steps,
    timing,
    timeline: buildTimeline(events.data ?? [], { startedAt: attempt.started_at, stepTitles, messageSubjects }),
    notes: await withAuthorEmails(db, notes.data ?? []),
  };
}

/** The attempt's variant seed. Server only; the caller already read the attempt through RLS. */
async function attemptSeed(orgId: string, attemptId: string): Promise<string | null> {
  const { data, error } = await createServiceClient()
    .from("attempt_secrets")
    .select("seed")
    .eq("org_id", orgId)
    .eq("attempt_id", attemptId)
    .maybeSingle();
  if (error) throw error;
  return data?.seed ?? null;
}

async function withAuthorEmails(
  db: Awaited<ReturnType<typeof createClient>>,
  rows: { id: string; author_id: string; body: string; vote: string | null; created_at: string }[],
): Promise<ReportNote[]> {
  // Authors who have left the company no longer share it with the reader, so RLS hides their profile.
  const emails = await getEmails(db, rows.map((r) => r.author_id));
  return rows.map((r) => ({
    id: r.id,
    authorId: r.author_id,
    authorEmail: emails.get(r.author_id) ?? "(former teammate)",
    body: r.body,
    vote: r.vote === "hire" || r.vote === "no_hire" || r.vote === "unsure" ? r.vote : null,
    createdAt: r.created_at,
  }));
}
