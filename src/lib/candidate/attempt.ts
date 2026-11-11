import "server-only";

import type { Json } from "@/lib/database.types";
import { renderAttemptForCandidate, stepAvailableAtMinute } from "@/lib/engine/server/render";
import { parseAnswerForStep, scoreAttempt } from "@/lib/engine/server/score";
import type { AttemptScore, PublicMessage, PublicStep } from "@/lib/engine/types";
import { createServiceClient } from "@/lib/supabase/service";
import { CLIENT_EVENT_KINDS, type ClientEventKind } from "./config";
import { ATTEMPT_COLUMNS, type AttemptRow } from "./invite";
import { loadScenario } from "./scenario";
import type { CandidateSession } from "./session";

/**
 * The attempt lifecycle: start the timer, show the workspace, autosave,
 * submit, and score. The clock is always the server's: started_at and
 * deadline_at are set here, and the browser's countdown is display only.
 */

async function reloadAttempt(attempt: Pick<AttemptRow, "id" | "org_id">): Promise<AttemptRow> {
  const { data, error } = await createServiceClient()
    .from("attempts")
    .select(ATTEMPT_COLUMNS)
    .eq("id", attempt.id)
    .eq("org_id", attempt.org_id)
    .single();
  if (error) throw new Error(`attempt reload failed: ${error.message}`);
  return data as AttemptRow;
}

async function getSeed(attempt: Pick<AttemptRow, "id" | "org_id">): Promise<string> {
  const { data, error } = await createServiceClient()
    .from("attempt_secrets")
    .select("seed")
    .eq("attempt_id", attempt.id)
    .eq("org_id", attempt.org_id)
    .single();
  if (error) throw new Error(`seed lookup failed: ${error.message}`);
  return data.seed;
}

async function addEvent(attempt: Pick<AttemptRow, "id" | "org_id">, kind: string, payload: Json = {}) {
  const { error } = await createServiceClient()
    .from("action_events")
    .insert({ attempt_id: attempt.id, org_id: attempt.org_id, kind, payload });
  if (error) throw new Error(`recording ${kind} failed: ${error.message}`);
}

function isPastDeadline(attempt: AttemptRow, now: Date): boolean {
  return attempt.status === "in_progress" && attempt.deadline_at !== null && now > new Date(attempt.deadline_at);
}

/**
 * Brings the attempt up to date for this request: an in-progress attempt
 * past its deadline is submitted as a timeout, and a submitted attempt whose
 * scoring didn't finish is scored. Call at the top of every candidate request.
 */
export async function settleAttempt(session: CandidateSession, now = new Date()): Promise<AttemptRow> {
  if (isPastDeadline(session.attempt, now)) {
    await finalizeAttempt(session, "timeout", now);
    return reloadAttempt(session.attempt);
  }
  if (session.attempt.status === "submitted") {
    await scoreAndStore(session);
    return reloadAttempt(session.attempt);
  }
  return session.attempt;
}

export type StartResult = { ok: true } | { ok: false; error: "expired" | "already_submitted" };

/** Starts the timer (instructions page "Start"). Idempotent: a started attempt keeps its deadline. */
export async function startAttempt(session: CandidateSession, now = new Date()): Promise<StartResult> {
  const attempt = await settleAttempt(session, now);
  if (attempt.status === "in_progress") return { ok: true };
  if (attempt.status !== "not_started") return { ok: false, error: "already_submitted" };
  if (now > session.invite.startBy) return { ok: false, error: "expired" };

  const deadline = new Date(now.getTime() + session.invite.timeLimitMinutes * 60_000);
  const { data, error } = await createServiceClient()
    .from("attempts")
    .update({ status: "in_progress", started_at: now.toISOString(), deadline_at: deadline.toISOString() })
    .eq("id", attempt.id)
    .eq("org_id", attempt.org_id)
    .eq("status", "not_started")
    .select("id");
  if (error) throw new Error(`starting attempt failed: ${error.message}`);
  // Zero rows: a parallel request started it first, which is fine.
  if (data.length) await addEvent(attempt, "started_attempt", { deadlineAt: deadline.toISOString() });
  return { ok: true };
}

export interface WorkspaceView {
  title: string;
  intro: string;
  messages: PublicMessage[];
  steps: PublicStep[];
  answers: Record<string, unknown>;
  deadlineAt: string;
  serverNow: string;
}

function elapsedMinutes(attempt: AttemptRow, now: Date): number {
  if (!attempt.started_at) return 0;
  return Math.max(0, (now.getTime() - new Date(attempt.started_at).getTime()) / 60_000);
}

/** Saved answers for the attempt, keyed by step id. */
async function loadAnswers(attempt: Pick<AttemptRow, "id" | "org_id">): Promise<Record<string, unknown>> {
  const { data, error } = await createServiceClient()
    .from("step_responses")
    .select("step_id, answer")
    .eq("attempt_id", attempt.id)
    .eq("org_id", attempt.org_id);
  if (error) throw new Error(`loading answers failed: ${error.message}`);
  return Object.fromEntries(data.map((r) => [r.step_id, r.answer]));
}

/**
 * What the candidate sees right now: messages and steps that have arrived
 * by the server clock, plus their saved answers. Null unless in progress.
 */
export async function getWorkspaceView(session: CandidateSession, now = new Date()): Promise<WorkspaceView | null> {
  const attempt = await settleAttempt(session, now);
  if (attempt.status !== "in_progress" || !attempt.deadline_at) return null;

  const [scenario, seed, answers] = await Promise.all([
    loadScenario(attempt.scenario_id),
    getSeed(attempt),
    loadAnswers(attempt),
  ]);
  const view = renderAttemptForCandidate(scenario, seed, elapsedMinutes(attempt, now));
  const visible = new Set(view.steps.map((s) => s.id));

  return {
    title: scenario.title,
    intro: view.intro,
    messages: view.messages,
    steps: view.steps,
    answers: Object.fromEntries(Object.entries(answers).filter(([id]) => visible.has(id))),
    deadlineAt: attempt.deadline_at,
    serverNow: now.toISOString(),
  };
}

/**
 * Messages the candidate has already opened in this attempt, from the
 * `opened_message` action events, so read state survives a reload or a
 * second device.
 */
export async function getOpenedMessageIds(attempt: Pick<AttemptRow, "id" | "org_id">): Promise<string[]> {
  const { data, error } = await createServiceClient()
    .from("action_events")
    .select("payload")
    .eq("attempt_id", attempt.id)
    .eq("org_id", attempt.org_id)
    .eq("kind", "opened_message" satisfies ClientEventKind);
  if (error) throw new Error(`loading opened messages failed: ${error.message}`);
  const ids = data.map((r) => (r.payload as { messageId?: unknown } | null)?.messageId).filter((id): id is string => typeof id === "string");
  return [...new Set(ids)];
}

/** Scenario intro for the instructions page (no variant-specific keys involved). */
export async function getIntro(session: CandidateSession): Promise<{ title: string; intro: string; stepCount: number }> {
  const [scenario, seed] = await Promise.all([loadScenario(session.attempt.scenario_id), getSeed(session.attempt)]);
  const view = renderAttemptForCandidate(scenario, seed, 0);
  return { title: scenario.title, intro: view.intro, stepCount: scenario.definition.steps.length };
}

export type SaveResult =
  | { ok: true; savedAt: string }
  | { ok: false; error: "time_up" | "not_started" | "submitted" | "unknown_step" | "invalid_answer" };

/** Autosave of one step's answer. Rejected after the deadline, which also submits the attempt. */
export async function saveAnswer(
  session: CandidateSession,
  stepId: string,
  raw: unknown,
  now = new Date(),
): Promise<SaveResult> {
  const attempt = await settleAttempt(session, now);
  if (attempt.status === "not_started") return { ok: false, error: "not_started" };
  if (attempt.status !== "in_progress") {
    return { ok: false, error: attempt.submit_reason === "timeout" ? "time_up" : "submitted" };
  }

  const scenario = await loadScenario(attempt.scenario_id);
  const step = scenario.definition.steps.find((s) => s.id === stepId);
  // A step that hasn't arrived yet is treated as unknown, so its existence doesn't leak.
  if (!step || stepAvailableAtMinute(scenario, stepId) > elapsedMinutes(attempt, now)) {
    return { ok: false, error: "unknown_step" };
  }

  let answer: unknown;
  try {
    answer = parseAnswerForStep(scenario, stepId, raw);
  } catch {
    return { ok: false, error: "invalid_answer" };
  }

  const savedAt = now.toISOString();
  const { error } = await createServiceClient()
    .from("step_responses")
    .upsert(
      { attempt_id: attempt.id, org_id: attempt.org_id, step_id: stepId, answer: answer as Json, updated_at: savedAt },
      { onConflict: "attempt_id,step_id" },
    );
  if (error) throw new Error(`saving answer failed: ${error.message}`);
  await addEvent(attempt, "saved_step", { stepId });
  return { ok: true, savedAt };
}

/** Browser-reported actions (opened a message, started a step). Ignored unless in progress. */
export async function recordClientEvent(
  session: CandidateSession,
  kind: string,
  payload: { messageId?: unknown; stepId?: unknown },
  now = new Date(),
): Promise<boolean> {
  if (!(CLIENT_EVENT_KINDS as readonly string[]).includes(kind)) return false;
  const attempt = await settleAttempt(session, now);
  if (attempt.status !== "in_progress") return false;

  const id = (v: unknown) => (typeof v === "string" && /^[A-Za-z0-9_-]{1,100}$/.test(v) ? v : undefined);
  const clean = kind === ("opened_message" satisfies ClientEventKind) ? { messageId: id(payload.messageId) } : { stepId: id(payload.stepId) };
  if (!Object.values(clean)[0]) return false;
  await addEvent(attempt, kind, clean);
  return true;
}

export interface ReviewItem {
  stepId: string;
  title: string;
  answered: boolean;
}

/** Arrived steps and whether each has a non-empty saved answer. */
export async function getReview(session: CandidateSession, now = new Date()): Promise<ReviewItem[] | null> {
  const view = await getWorkspaceView(session, now);
  if (!view) return null;
  return view.steps.map((s) => ({ stepId: s.id, title: s.title, answered: isAnswered(view.answers[s.id]) }));
}

function isAnswered(answer: unknown): boolean {
  if (answer === undefined || answer === null) return false;
  if (typeof answer === "object" && answer !== null && "value" in answer) return (answer as { value: unknown }).value !== null;
  return true;
}

export type SubmitResult = { ok: true; reason: "candidate" | "timeout" } | { ok: false; error: "not_started" };

/** Final submit. After the deadline it's recorded as a timeout, not as the candidate's submit. */
export async function submitAttempt(session: CandidateSession, now = new Date()): Promise<SubmitResult> {
  const attempt = await settleAttempt(session, now);
  if (attempt.status === "not_started") return { ok: false, error: "not_started" };
  if (attempt.status === "in_progress") {
    await finalizeAttempt({ ...session, attempt }, "candidate", now);
    return { ok: true, reason: "candidate" };
  }
  return { ok: true, reason: attempt.submit_reason === "timeout" ? "timeout" : "candidate" };
}

/**
 * Marks the attempt submitted (only one request can), then scores it. A
 * timeout is stamped at the deadline, not at whenever the next request came.
 */
async function finalizeAttempt(session: CandidateSession, reason: "candidate" | "timeout", now: Date) {
  const { attempt } = session;
  const submittedAt = reason === "timeout" && attempt.deadline_at ? attempt.deadline_at : now.toISOString();
  const db = createServiceClient();
  const { data, error } = await db
    .from("attempts")
    .update({ status: "submitted", submitted_at: submittedAt, submit_reason: reason })
    .eq("id", attempt.id)
    .eq("org_id", attempt.org_id)
    .eq("status", "in_progress")
    .select("id");
  if (error) throw new Error(`submitting attempt failed: ${error.message}`);
  if (!data.length) return; // another request submitted it

  await addEvent(attempt, "submitted_attempt", { reason });
  await scoreAndStore(session);
}

/**
 * Scores every step on the server and stores per-step scores on
 * step_responses and the total on attempts, twice: as `score` (the final
 * score, which reviewers may change later) and as `auto_score` (kept as
 * computed; a trigger refuses to change it). Safe to re-run: a crash between
 * "submitted" and "scored" is finished by the next request, and scoring is
 * deterministic, so auto_score gets the same value again.
 */
async function scoreAndStore(session: CandidateSession): Promise<AttemptScore> {
  const { attempt, invite } = session;
  const [scenario, seed, answers] = await Promise.all([
    loadScenario(attempt.scenario_id),
    getSeed(attempt),
    loadAnswers(attempt),
  ]);
  const score = scoreAttempt(scenario, seed, answers);
  const db = createServiceClient();

  const stepUpdates = await Promise.all(
    Object.keys(answers).map((stepId) =>
      db
        .from("step_responses")
        .update({ score: (score.steps[stepId] ?? null) as unknown as Json, auto_score: (score.steps[stepId] ?? null) as unknown as Json })
        .eq("attempt_id", attempt.id)
        .eq("org_id", attempt.org_id)
        .eq("step_id", stepId),
    ),
  );
  for (const r of stepUpdates) if (r.error) throw new Error(`storing step score failed: ${r.error.message}`);

  const [attemptUpdate, inviteUpdate] = await Promise.all([
    db
      .from("attempts")
      .update({ score: score as unknown as Json, auto_score: score as unknown as Json, status: "scored" })
      .eq("id", attempt.id)
      .eq("org_id", attempt.org_id)
      .in("status", ["submitted", "scored"]),
    db.from("invites").update({ status: "completed" }).eq("id", invite.inviteId).eq("org_id", invite.orgId),
  ]);
  if (attemptUpdate.error) throw new Error(`storing score failed: ${attemptUpdate.error.message}`);
  if (inviteUpdate.error) throw new Error(`completing invite failed: ${inviteUpdate.error.message}`);
  return score;
}
