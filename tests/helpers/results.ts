/**
 * Arranges submitted, scored attempts for results/report tests (Vitest and
 * Playwright). No engine imports (they're server-only), so the stored score
 * is written by hand in the shape scoreAttempt produces for demo-mini-close:
 * a spreadsheet (8 pts), a numeric (2 pts) and an inbox_reply that needs
 * review (9 pts). The report rebuilds the expected answers from the seed.
 */
import type { Json } from "../../src/lib/database.types";
import type { TestData } from "./factories";
import { must, serviceClient } from "./supabase";

export const MINI_CLOSE = "demo-mini-close";

export const RUBRIC = [
  { id: "timing", label: "Explains timing differences", max: 3 },
  { id: "fee", label: "Mentions the bank fee", max: 2 },
  { id: "balance", label: "States the correct balance", max: 2 },
  { id: "tone", label: "Plain, professional tone", max: 2 },
] as const;

export const REPLY_BODY = "Hi Marcus, the two balances differ because of timing. The bank fee will be recorded in the books.";

/** The stored score: 6/8 + 2/2 + 0/9 (needs review) = 8/19. */
export function miniCloseScore() {
  const sheetItems = [
    { id: "dit", label: "Deposits in transit", earned: 1, max: 1, note: "Correct (1,200.00)." },
    { id: "oc_total", label: "Outstanding checks", earned: 2, max: 2, note: "Correct (800.00)." },
    { id: "adj_bank", label: "Adjusted bank balance", earned: 2, max: 2, note: "Correct (10,400.00)." },
    { id: "fee", label: "Bank service fee", earned: 1, max: 1, note: "Correct (25.00)." },
    { id: "adj_book", label: "Adjusted book balance", earned: 0, max: 2, note: "Answered 10,000.00, expected 10,400.00." },
  ];
  return {
    points: 8,
    maxPoints: 19,
    steps: {
      "bank-rec": { points: 6, maxPoints: 8, items: sheetItems },
      "adjusted-balance": { points: 2, maxPoints: 2, items: [{ id: "value", label: "Value", earned: 2, max: 2, note: "Correct (10400.00)." }] },
      "client-reply": {
        points: 0,
        maxPoints: 9,
        needsReview: true,
        items: RUBRIC.map((c) => ({ id: c.id, label: c.label, earned: 0, max: c.max, note: "Needs review." })),
      },
    },
  };
}

export const MINI_CLOSE_ANSWERS: Record<string, Json> = {
  "bank-rec": { cells: { dit: 1200, oc_total: 800, adj_bank: 10400, fee: 25, adj_book: 10000 } },
  "adjusted-balance": { value: 10400 },
  "client-reply": { body: REPLY_BODY },
};

/** A job on demo-mini-close (passing score 60%). */
export async function miniCloseJob(data: TestData, orgId: string, title = "Staff accountant") {
  const scenarioId = await data.libraryScenario(MINI_CLOSE);
  const { assessmentId } = await data.assessment({ orgId, scenarioId, title: "Mini close", timeLimitMinutes: 20, passScore: 60 });
  const { jobId } = await data.job({ orgId, assessmentId, title });
  return { jobId, assessmentId, scenarioId };
}

/**
 * A completed invite with a scored attempt (submitted `minutes` after it
 * started), its answers, per-step scores and a few action events.
 */
export async function scoredAttempt(
  data: TestData,
  opts: {
    orgId: string;
    jobId: string;
    scenarioId: string;
    candidateName?: string;
    minutes?: number;
    submittedAt?: Date;
    score?: { points: number; maxPoints: number; steps: Record<string, unknown> };
  },
) {
  const db = serviceClient();
  const inv = await data.invite({ orgId: opts.orgId, jobId: opts.jobId, status: "completed" });
  if (opts.candidateName) must(await db.from("invites").update({ candidate_name: opts.candidateName }).eq("id", inv.inviteId));

  const submittedAt = opts.submittedAt ?? new Date(Date.now() - 60_000);
  const startedAt = new Date(submittedAt.getTime() - (opts.minutes ?? 12) * 60_000);
  const { attemptId } = await data.attempt({
    orgId: opts.orgId,
    inviteId: inv.inviteId,
    scenarioId: opts.scenarioId,
    status: "scored",
    startedAt,
    timeLimitMinutes: 20,
    seed: `results-seed-${inv.inviteId}`,
  });
  const score: { points: number; maxPoints: number; steps: Record<string, unknown> } = opts.score ?? miniCloseScore();
  must(
    await db
      .from("attempts")
      .update({ submitted_at: submittedAt.toISOString(), submit_reason: "candidate", score: score as unknown as Json, auto_score: score as unknown as Json })
      .eq("id", attemptId),
  );
  must(
    await db.from("step_responses").insert(
      Object.entries(MINI_CLOSE_ANSWERS).map(([stepId, answer]) => ({
        attempt_id: attemptId,
        org_id: opts.orgId,
        step_id: stepId,
        answer,
        score: (score.steps[stepId] ?? null) as Json,
        auto_score: (score.steps[stepId] ?? null) as Json,
      })),
    ),
  );
  const at = (min: number) => new Date(startedAt.getTime() + min * 60_000).toISOString();
  must(
    await db.from("action_events").insert([
      { attempt_id: attemptId, org_id: opts.orgId, at: at(0), kind: "started_attempt", payload: {} },
      { attempt_id: attemptId, org_id: opts.orgId, at: at(0.5), kind: "opened_message", payload: { messageId: "m1" } },
      { attempt_id: attemptId, org_id: opts.orgId, at: at(1), kind: "started_step", payload: { stepId: "bank-rec" } },
      { attempt_id: attemptId, org_id: opts.orgId, at: at(4), kind: "saved_step", payload: { stepId: "bank-rec" } },
      { attempt_id: attemptId, org_id: opts.orgId, at: at(5), kind: "saved_step", payload: { stepId: "bank-rec" } },
      { attempt_id: attemptId, org_id: opts.orgId, at: at(opts.minutes ?? 12), kind: "submitted_attempt", payload: { reason: "candidate" } },
    ]),
  );
  return { ...inv, attemptId, startedAt, submittedAt };
}

export const TIMED_CLOSE = "demo-timed-close";

/** A job on demo-timed-close: a rapid round, two numeric screens and a reply. */
export async function timedCloseJob(data: TestData, orgId: string, title = "AP clerk") {
  const scenarioId = await data.libraryScenario(TIMED_CLOSE);
  const { assessmentId } = await data.assessment({ orgId, scenarioId, title: "Timed close", timeLimitMinutes: 12 });
  const { jobId } = await data.job({ orgId, assessmentId, title });
  return { jobId, assessmentId, scenarioId };
}

/** The rapid items' saved answers, in item order, with response times. */
export const RAPID_ANSWERS = {
  "jef-rent": { values: { debit: "rent_expense", credit: "cash" }, ms: 4_200 },
  "jef-supplies": { values: { debit: "supplies", credit: "accounts_payable" }, ms: 3_100 },
  "ap-check": { values: { decision: "pay", reason: "all_match" }, ms: 9_000 },
  "dep-calc": { values: { amount: 123.45 }, ms: 15_000 },
} as const;

/**
 * Stored score in the shape scoreAttempt produces for demo-timed-close: rapid
 * round 3/4 (75%), the two numeric screens 0/1 each (0%) and a reply waiting
 * for review (left out of the comparison).
 */
export function timedCloseScore() {
  return {
    points: 3,
    maxPoints: 10,
    steps: {
      quick: {
        points: 3,
        maxPoints: 4,
        items: [
          { id: "jef-rent", label: "Item 1", earned: 1, max: 1, note: "Correct in 4.2s." },
          { id: "jef-supplies", label: "Item 2", earned: 1, max: 1, note: "Correct in 3.1s." },
          { id: "ap-check", label: "Item 3", earned: 0, max: 1, note: "0 of 2 right in 9.0s. Decision: expected Hold; Reason: expected Billed more than the PO." },
          { id: "dep-calc", label: "Item 4", earned: 1, max: 1, note: "Correct in 15.0s." },
          { id: "timing", label: "Response time", earned: 0, max: 0, note: "Median response 6.6s over 4 answered; 0 with no answer." },
        ],
      },
      "screen-1": { points: 0, maxPoints: 1, items: [{ id: "value", label: "Value", earned: 0, max: 1, note: "Not answered." }] },
      "screen-2": { points: 0, maxPoints: 1, items: [{ id: "value", label: "Value", earned: 0, max: 1, note: "Not answered." }] },
      reply: {
        points: 0,
        maxPoints: 4,
        needsReview: true,
        items: [
          { id: "prepaid", label: "Explains prepaid insurance", earned: 0, max: 2, note: "Needs review." },
          { id: "amount", label: "Gives the monthly amount", earned: 0, max: 1, note: "Needs review." },
          { id: "tone", label: "Plain, friendly tone", earned: 0, max: 1, note: "Needs review." },
        ],
      },
    },
  };
}

/**
 * A scored demo-timed-close attempt with rapid answers, their server-written
 * `answered_item` events and browser signals: the candidate left the window
 * twice. Item 3 is answered 1.5 s after the first return; item 4 is answered
 * 3 s after the second return (outside the 2 s window).
 */
export async function timedCloseAttempt(data: TestData, opts: { orgId: string; jobId: string; scenarioId: string; candidateName?: string }) {
  const db = serviceClient();
  const inv = await data.invite({ orgId: opts.orgId, jobId: opts.jobId, status: "completed" });
  if (opts.candidateName) must(await db.from("invites").update({ candidate_name: opts.candidateName }).eq("id", inv.inviteId));
  const submittedAt = new Date(Date.now() - 60_000);
  const startedAt = new Date(submittedAt.getTime() - 10 * 60_000);
  const seed = `rapid-seed-${inv.inviteId}`;
  const { attemptId } = await data.attempt({
    orgId: opts.orgId,
    inviteId: inv.inviteId,
    scenarioId: opts.scenarioId,
    status: "scored",
    startedAt,
    timeLimitMinutes: 12,
    seed,
  });
  const score = timedCloseScore();
  must(
    await db
      .from("attempts")
      .update({ submitted_at: submittedAt.toISOString(), submit_reason: "candidate", score: score as unknown as Json, auto_score: score as unknown as Json })
      .eq("id", attemptId),
  );
  must(
    await db.from("step_responses").insert(
      [{ stepId: "quick", answer: { items: RAPID_ANSWERS } as unknown as Json }].map(({ stepId, answer }) => ({
        attempt_id: attemptId,
        org_id: opts.orgId,
        step_id: stepId,
        answer,
        score: score.steps.quick as unknown as Json,
        auto_score: score.steps.quick as unknown as Json,
      })),
    ),
  );
  const at = (seconds: number) => new Date(startedAt.getTime() + seconds * 1000).toISOString();
  const answered = [4.2, 7.3, 17, 32];
  must(
    await db.from("action_events").insert([
      { attempt_id: attemptId, org_id: opts.orgId, at: at(0), kind: "started_attempt", payload: {} },
      ...answered.map((s, index) => ({
        attempt_id: attemptId,
        org_id: opts.orgId,
        at: at(s),
        kind: "answered_item",
        payload: { stepId: "quick", index, at: at(s) },
      })),
      { attempt_id: attemptId, org_id: opts.orgId, at: at(600), kind: "submitted_attempt", payload: { reason: "candidate" } },
    ]),
  );
  must(
    await db.from("integrity_events").insert([
      { attempt_id: attemptId, org_id: opts.orgId, at: at(9), kind: "left_window", payload: {} },
      { attempt_id: attemptId, org_id: opts.orgId, at: at(15.5), kind: "returned_to_window", payload: { awayMs: 6_500 } },
      { attempt_id: attemptId, org_id: opts.orgId, at: at(25), kind: "left_window", payload: {} },
      { attempt_id: attemptId, org_id: opts.orgId, at: at(29), kind: "returned_to_window", payload: { awayMs: 4_000 } },
    ]),
  );
  return { ...inv, attemptId, startedAt, submittedAt, seed, answeredAt: answered.map(at), returnedAt: [at(15.5), at(29)] };
}
