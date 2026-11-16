import "server-only";

import type { Json } from "@/lib/database.types";
import { messageArrivesAt, resolveFlow, resolveItems, type FlowEvent, type FlowState } from "@/lib/engine/server/flow";
import {
  renderAttemptForCandidate,
  renderFlowForCandidate,
  stepAvailableAtMinute,
  stepSequenceInfo,
  type SequencePosition,
} from "@/lib/engine/server/render";
import type { ServerScenario } from "@/lib/engine/server/scenario";
import { parseAnswerForStep, recordSequenceItem, scoreAttempt } from "@/lib/engine/server/score";
import type { SequenceState } from "@/lib/engine/sequence";
import type { AttemptScore, PublicMessage, PublicStep } from "@/lib/engine/types";
import { closeDowntimeAtEnd } from "@/lib/proctoring/flags";
import { createServiceClient } from "@/lib/supabase/service";
import { CLIENT_EVENT_KINDS, type ClientEventKind } from "./config";
import { ATTEMPT_COLUMNS, type AttemptRow } from "./invite";
import { loadScenario } from "./scenario";
import { scheduleShadowScoring } from "./shadow-score";
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

  // timeLimitMinutes already includes any extra time set on the invite (D9),
  // so the server-enforced deadline carries it; the browser only displays it.
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
  if (data.length) {
    const { extraTimePercent, waiveCamera, waiveScreen, waiveFullscreen, waiveMicrophone } = session.invite.accommodations;
    await addEvent(attempt, "started_attempt", {
      deadlineAt: deadline.toISOString(),
      timeLimitMinutes: session.invite.timeLimitMinutes,
      ...(extraTimePercent || waiveCamera || waiveScreen || waiveFullscreen || waiveMicrophone
        ? { accommodations: { extraTimePercent, waiveCamera, waiveScreen, waiveFullscreen, waiveMicrophone } }
        : {}),
    });
  }
  return { ok: true };
}

/** Timed sections as the browser sees them (ISO times; display only). Null for a scenario without sections. */
export interface FlowView {
  done: boolean;
  section?: { id: string; title: string; index: number; count: number; startedAt: string; endsAt: string; oneAtATime: boolean };
  screen?: { stepId: string; index: number; count: number; startedAt: string; endsAt: string };
}

export interface WorkspaceView {
  title: string;
  intro: string;
  messages: PublicMessage[];
  steps: PublicStep[];
  answers: Record<string, unknown>;
  deadlineAt: string;
  serverNow: string;
  flow: FlowView | null;
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

/** Server-written events that drive timed sections and rapid items. Never accepted from the browser. */
const FLOW_EVENT_KINDS = ["advanced_section", "advanced_screen", "answered_item"] as const;
/** A rapid item answer that lands this long after its deadline (network delay) still counts. */
const ITEM_GRACE_MS = 1_500;

const iso = (ms: number) => new Date(ms).toISOString();

/** Section advances and answered rapid items for the attempt, from action_events (times from the payload). */
async function loadFlowEvents(attempt: Pick<AttemptRow, "id" | "org_id">) {
  const { data, error } = await createServiceClient()
    .from("action_events")
    .select("kind, payload")
    .eq("attempt_id", attempt.id)
    .eq("org_id", attempt.org_id)
    .in("kind", [...FLOW_EVENT_KINDS]);
  if (error) throw new Error(`loading flow events failed: ${error.message}`);
  const flow: FlowEvent[] = [];
  const answered = new Map<string, Record<number, number>>();
  for (const row of data) {
    const p = (row.payload ?? {}) as { sectionId?: unknown; stepId?: unknown; index?: unknown; at?: unknown };
    const at = typeof p.at === "string" ? Date.parse(p.at) : NaN;
    if (!Number.isFinite(at)) continue;
    if (row.kind === "advanced_section" && typeof p.sectionId === "string") flow.push({ kind: "advanced_section", sectionId: p.sectionId, at });
    else if (row.kind === "advanced_screen" && typeof p.stepId === "string") flow.push({ kind: "advanced_screen", stepId: p.stepId, at });
    else if (row.kind === "answered_item" && typeof p.stepId === "string" && typeof p.index === "number") {
      const byIndex = answered.get(p.stepId) ?? {};
      byIndex[p.index] = Math.min(byIndex[p.index] ?? Infinity, at);
      answered.set(p.stepId, byIndex);
    }
  }
  return { flow, answered };
}

/** Where the attempt stands at `now`, from the server clock and server-written events. */
interface AttemptState {
  scenario: ServerScenario;
  seed: string;
  startedAt: number;
  deadlineAt: number;
  extraTimePercent: number;
  /** Null without sections: every step that has arrived is open (the original behaviour). */
  flow: FlowState | null;
  answered: Map<string, Record<number, number>>;
  /** Steps open now, in scenario order. */
  openStepIds: string[];
  /** Arrived messages with their arrival in minutes after the attempt start. */
  messages: { id: string; arriveAtMinute: number }[];
}

async function loadState(session: CandidateSession, attempt: AttemptRow, now: Date): Promise<AttemptState> {
  const [scenario, seed, events] = await Promise.all([loadScenario(attempt.scenario_id), getSeed(attempt), loadFlowEvents(attempt)]);
  const startedAt = attempt.started_at ? new Date(attempt.started_at).getTime() : now.getTime();
  const deadlineAt = attempt.deadline_at ? new Date(attempt.deadline_at).getTime() : startedAt;
  const extraTimePercent = session.invite.accommodations.extraTimePercent ?? 0;
  const def = scenario.definition;
  const base = { scenario, seed, startedAt, deadlineAt, extraTimePercent, answered: events.answered };

  if (!def.sections?.length) {
    const elapsed = elapsedMinutes(attempt, now);
    return {
      ...base,
      flow: null,
      openStepIds: def.steps.filter((s) => stepAvailableAtMinute(scenario, s.id) <= elapsed).map((s) => s.id),
      messages: def.messages
        .filter((m) => (m.arriveAtMinute ?? 0) <= elapsed)
        .map((m) => ({ id: m.id, arriveAtMinute: m.arriveAtMinute ?? 0 })),
    };
  }

  const flow = resolveFlow(def, { startedAt, now: now.getTime(), extraTimePercent, events: events.flow });
  const messages = def.messages.flatMap((m) => {
    const at = messageArrivesAt(def, flow, m, startedAt);
    return at !== undefined && at <= now.getTime() ? [{ id: m.id, arriveAtMinute: (at - startedAt) / 60_000 }] : [];
  });
  const arrived = new Set(messages.map((m) => m.id));
  // A step delivered by a message opens when that message arrives (relative to its section).
  const visible = new Set(flow.visibleStepIds);
  const openStepIds = def.steps
    .filter((s) => visible.has(s.id))
    .filter((s) => {
      const linked = def.messages.filter((m) => m.stepId === s.id);
      return linked.length === 0 || linked.some((m) => arrived.has(m.id));
    })
    .map((s) => s.id);
  return { ...base, flow, openStepIds, messages };
}

/** The open item of a sequence step (rapid_round) at `now`, or null when the step isn't a sequence. */
function itemPosition(state: AttemptState, stepId: string, now: number): SequenceState | null {
  const info = stepSequenceInfo(state.scenario, stepId);
  if (!info) return null;
  const { flow } = state;
  const [start, end] =
    flow?.screen?.stepId === stepId
      ? [flow.screen.startedAt, flow.screen.endsAt]
      : flow?.section
        ? [flow.section.startedAt, flow.section.endsAt]
        : [state.startedAt, state.deadlineAt];
  return resolveItems({
    stepStartedAt: start,
    stepEndsAt: end,
    count: info.count,
    secondsPerItem: info.secondsPerItem,
    extraTimePercent: state.extraTimePercent,
    answeredAt: state.answered.get(stepId) ?? {},
    now,
  });
}

function flowView({ flow, scenario }: AttemptState): FlowView | null {
  if (!flow) return null;
  const section = flow.section;
  const oneAtATime = !!scenario.definition.sections?.find((s) => s.id === section?.id)?.oneAtATime;
  return {
    done: flow.done,
    ...(section ? { section: { ...section, startedAt: iso(section.startedAt), endsAt: iso(section.endsAt), oneAtATime } } : {}),
    ...(flow.screen ? { screen: { ...flow.screen, startedAt: iso(flow.screen.startedAt), endsAt: iso(flow.screen.endsAt) } } : {}),
  };
}

/**
 * What the candidate sees right now: messages and steps that are open by the
 * server clock, plus their saved answers. With sections, only the current
 * section's steps (or its current screen) are open. A sequence step carries
 * only its open item. Null unless in progress.
 */
export async function getWorkspaceView(session: CandidateSession, now = new Date()): Promise<WorkspaceView | null> {
  const attempt = await settleAttempt(session, now);
  if (attempt.status !== "in_progress" || !attempt.deadline_at) return null;

  const [state, answers] = await Promise.all([loadState(session, attempt, now), loadAnswers(attempt)]);
  const sequences: Record<string, SequencePosition> = {};
  for (const stepId of state.openStepIds) {
    const pos = itemPosition(state, stepId, now.getTime());
    if (!pos) continue;
    sequences[stepId] = pos.done
      ? { done: true }
      : { index: pos.index, count: stepSequenceInfo(state.scenario, stepId)!.count, endsAt: iso(pos.endsAt) };
  }
  const view = renderFlowForCandidate(
    state.scenario,
    state.seed,
    { stepIds: state.openStepIds, messages: state.messages, sequences },
    { name: session.invite.candidateName },
  );
  const visible = new Set(view.steps.map((s) => s.id));

  return {
    title: state.scenario.title,
    intro: view.intro,
    messages: view.messages,
    steps: view.steps,
    answers: Object.fromEntries(Object.entries(answers).filter(([id]) => visible.has(id))),
    deadlineAt: attempt.deadline_at,
    serverNow: now.toISOString(),
    flow: flowView(state),
  };
}

export type AdvanceResult = { ok: true } | { ok: false; error: "not_current" | "not_started" | "submitted" };

/**
 * "Finish section" / "Next screen": ends the current section or screen now
 * and starts the next one. Only the current one can be advanced, so a stale
 * or repeated request changes nothing. Recorded as a server action event;
 * there's no way back. The overall deadline is unaffected (D4).
 */
export async function advanceFlow(
  session: CandidateSession,
  target: { kind: "section" | "screen"; id: string },
  now = new Date(),
): Promise<AdvanceResult> {
  const attempt = await settleAttempt(session, now);
  if (attempt.status === "not_started") return { ok: false, error: "not_started" };
  if (attempt.status !== "in_progress") return { ok: false, error: "submitted" };
  const { flow } = await loadState(session, attempt, now);
  const at = now.toISOString();
  if (target.kind === "section" && flow?.section?.id === target.id) {
    await addEvent(attempt, "advanced_section", { sectionId: target.id, at });
    return { ok: true };
  }
  if (target.kind === "screen" && flow?.screen?.stepId === target.id) {
    await addEvent(attempt, "advanced_screen", { stepId: target.id, at });
    return { ok: true };
  }
  return { ok: false, error: "not_current" };
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
  const view = renderAttemptForCandidate(scenario, seed, 0, { name: session.invite.candidateName });
  return { title: scenario.title, intro: view.intro, stepCount: scenario.definition.steps.length };
}

export type SaveResult =
  | { ok: true; savedAt: string }
  | {
      ok: false;
      error: "time_up" | "not_started" | "submitted" | "unknown_step" | "invalid_answer" | "locked" | "item_closed";
    };

async function loadAnswer(attempt: Pick<AttemptRow, "id" | "org_id">, stepId: string): Promise<unknown> {
  const { data, error } = await createServiceClient()
    .from("step_responses")
    .select("answer")
    .eq("attempt_id", attempt.id)
    .eq("org_id", attempt.org_id)
    .eq("step_id", stepId)
    .maybeSingle();
  if (error) throw new Error(`loading answer failed: ${error.message}`);
  return data?.answer ?? undefined;
}

/**
 * Autosave of one step's answer. Rejected after the deadline, which also
 * submits the attempt. With sections, a step outside the current section (or
 * screen) is "locked". A sequence step (rapid_round) takes one item at a time
 * as `{ index, values }`: only the open item, or one that closed less than
 * ITEM_GRACE_MS ago, is accepted ("item_closed" otherwise), and its response
 * time is measured here.
 */
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

  const state = await loadState(session, attempt, now);
  const { scenario } = state;
  if (!scenario.definition.steps.some((s) => s.id === stepId)) return { ok: false, error: "unknown_step" };
  // Without sections, a step that hasn't arrived yet is treated as unknown, so its existence doesn't leak.
  if (!state.openStepIds.includes(stepId)) return { ok: false, error: state.flow ? "locked" : "unknown_step" };

  const savedAt = now.toISOString();
  let answer: unknown;
  let itemIndex: number | null = null;
  const position = itemPosition(state, stepId, now.getTime());
  if (position) {
    const index = (raw as { index?: unknown } | null)?.index;
    if (typeof index !== "number" || !Number.isInteger(index)) return { ok: false, error: "invalid_answer" };
    const answered = state.answered.get(stepId) ?? {};
    let item = !position.done && position.index === index ? position : null;
    if (!item && answered[index] === undefined) {
      const late = itemPosition(state, stepId, now.getTime() - ITEM_GRACE_MS)!;
      if (!late.done && late.index === index && now.getTime() <= late.endsAt + ITEM_GRACE_MS) item = late;
    }
    if (!item) return { ok: false, error: "item_closed" };
    try {
      const prev = await loadAnswer(attempt, stepId);
      answer = recordSequenceItem(scenario, stepId, prev, index, raw, now.getTime() - item.startedAt);
    } catch {
      return { ok: false, error: "invalid_answer" };
    }
    itemIndex = index;
  } else {
    try {
      answer = parseAnswerForStep(scenario, stepId, raw);
    } catch {
      return { ok: false, error: "invalid_answer" };
    }
  }

  const { error } = await createServiceClient()
    .from("step_responses")
    .upsert(
      { attempt_id: attempt.id, org_id: attempt.org_id, step_id: stepId, answer: answer as Json, updated_at: savedAt },
      { onConflict: "attempt_id,step_id" },
    );
  if (error) throw new Error(`saving answer failed: ${error.message}`);
  if (itemIndex !== null) await addEvent(attempt, "answered_item", { stepId, index: itemIndex, at: savedAt });
  else await addEvent(attempt, "saved_step", { stepId });
  return { ok: true, savedAt };
}

/**
 * Browser-reported actions (opened a message, started a step). Ignored unless
 * in progress. Only CLIENT_EVENT_KINDS pass; flow events (advanced_section,
 * advanced_screen, answered_item) are written by the server alone.
 */
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
  type: string;
  answered: boolean;
  /** Can still be worked on now (false for a step in a finished section). */
  open: boolean;
}

/**
 * Steps for the review page and whether each has a non-empty saved answer:
 * the steps that have arrived or, with sections, every step of every section
 * that has started (steps of finished sections are listed but not open).
 */
export async function getReview(session: CandidateSession, now = new Date()): Promise<ReviewItem[] | null> {
  const attempt = await settleAttempt(session, now);
  if (attempt.status !== "in_progress" || !attempt.deadline_at) return null;
  const [state, answers] = await Promise.all([loadState(session, attempt, now), loadAnswers(attempt)]);
  const { flow, scenario } = state;
  const listed = flow
    ? new Set((scenario.definition.sections ?? []).filter((sec) => flow.startedSectionIds.includes(sec.id)).flatMap((sec) => sec.stepIds))
    : new Set(state.openStepIds);
  const view = renderFlowForCandidate(
    scenario,
    state.seed,
    { stepIds: scenario.definition.steps.filter((s) => listed.has(s.id)).map((s) => s.id), messages: [] },
    { name: session.invite.candidateName },
  );
  const open = new Set(state.openStepIds);
  return view.steps.map((s) => ({ stepId: s.id, title: s.title, type: s.type, answered: isAnswered(answers[s.id]), open: open.has(s.id) }));
}

function isAnswered(answer: unknown): boolean {
  if (answer === undefined || answer === null) return false;
  if (typeof answer !== "object") return true;
  if ("value" in answer) return (answer as { value: unknown }).value !== null;
  if ("items" in answer) {
    const items = (answer as { items: unknown }).items;
    return !!items && typeof items === "object" && Object.keys(items).length > 0;
  }
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
  // D8 shadow mode: AI rubric scores, stored server-side only, after the response.
  // Only schedules work; never throws or delays the submit.
  scheduleShadowScoring(attempt);
  // A camera / screen gap still open (tab closed, never reconnected) ends here (D4).
  await closeDowntimeAtEnd(
    attempt,
    session.invite.assessmentId,
    { at: submittedAt, closedBy: reason === "timeout" ? "deadline" : "submitted" },
    session.invite.accommodations,
  );
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
