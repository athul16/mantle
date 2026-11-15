/**
 * Results table, candidate report and their actions against the local test
 * database. Queries and server actions run for real; `createClient()` from
 * `@/lib/supabase/server` returns a supabase-js client signed in as whichever
 * test user is "acting", so requireMembership, RLS and review_rubric_step all
 * see that user.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestData, type TestCompany } from "../helpers/factories";
import { MINI_CLOSE, MINI_CLOSE_ANSWERS, RUBRIC, REPLY_BODY, miniCloseJob, miniCloseScore, scoredAttempt } from "../helpers/results";
import { must, serviceClient, signedInClient, type Db } from "../helpers/supabase";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting }));

const { getScenario } = await import("@/lib/engine/scenarios");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { listJobResults, getCandidateReport } = await import("@/lib/results/queries");
const actions = await import("@/app/app/[orgSlug]/candidates/actions");

const data = createTestData("results");
let acting: Db;
let co: TestCompany;
let other: TestCompany;
const clients: Partial<Record<"admin" | "recruiter" | "viewer" | "otherAdmin", Db>> = {};
let jobId = "";
let scenarioId = "";
let scored: Awaited<ReturnType<typeof scoredAttempt>>;
let pendingInviteId = "";

const as = (who: keyof typeof clients) => {
  acting = clients[who]!;
};

function form(entries: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(entries)) fd.append(k, v);
  return fd;
}

beforeAll(async () => {
  co = await data.company();
  other = await data.company();
  for (const role of ["admin", "recruiter", "viewer"] as const) clients[role] = await signedInClient(co.users[role].email, co.users[role].password);
  clients.otherAdmin = await signedInClient(other.users.admin.email, other.users.admin.password);

  ({ jobId, scenarioId } = await miniCloseJob(data, co.orgId));
  scored = await scoredAttempt(data, { orgId: co.orgId, jobId, scenarioId, candidateName: "Riley Chen", minutes: 14 });
  pendingInviteId = (await data.invite({ orgId: co.orgId, jobId })).inviteId;
});

afterAll(() => data.cleanup());

describe("test fixture", () => {
  it("matches what the engine stores for demo-mini-close (same steps, items and maxima)", () => {
    const real = scoreAttempt(getScenario(MINI_CLOSE, 1), "any-seed", MINI_CLOSE_ANSWERS);
    const shape = (s: { maxPoints: number; steps: Record<string, { maxPoints: number; needsReview?: boolean; items: { id: string; max: number }[] }> }) => ({
      maxPoints: s.maxPoints,
      steps: Object.fromEntries(
        Object.entries(s.steps).map(([id, st]) => [id, { max: st.maxPoints, review: !!st.needsReview, items: st.items.map((i) => [i.id, i.max]) }]),
      ),
    });
    expect(shape(miniCloseScore())).toEqual(shape(real));
  });
});

describe("listJobResults", () => {
  it("lists every invite of the job with score, time taken and needs-review", async () => {
    as("viewer");
    const rows = await listJobResults(co.orgId, jobId);
    expect(rows).toHaveLength(2);
    const done = rows.find((r) => r.inviteId === scored.inviteId)!;
    expect(done).toMatchObject({
      candidateName: "Riley Chen",
      status: "completed",
      needsReview: true,
      points: 8,
      maxPoints: 19,
      percent: 42.1,
      timeTakenSeconds: 14 * 60,
      submittedAt: expect.any(String),
    });
    expect(rows.find((r) => r.inviteId === pendingInviteId)).toMatchObject({ status: "invited", percent: null, timeTakenSeconds: null });
  });

  it("returns nothing for another company's job", async () => {
    as("otherAdmin");
    expect(await listJobResults(co.orgId, jobId)).toEqual([]);
    expect(await listJobResults(other.orgId, jobId)).toEqual([]);
  });
});

describe("getCandidateReport", () => {
  it("shows each step's answer next to the expected answer rebuilt from the seed", async () => {
    as("viewer");
    const report = (await getCandidateReport(co.orgId, scored.inviteId))!;
    expect(report.attempt).toMatchObject({ status: "scored", timeTakenSeconds: 14 * 60, needsReview: ["client-reply"] });
    expect(report.steps.map((s) => s.id)).toEqual(["bank-rec", "adjusted-balance", "client-reply"]);

    const variant = getScenario(MINI_CLOSE, 1).generate(`results-seed-${scored.inviteId}`);
    const key = variant.keys["adjusted-balance"] as { value: number };
    const numeric = report.steps[1];
    expect(numeric.rows).toEqual([
      expect.objectContaining({ label: "Value", answer: "$10,400.00", expected: "$" + key.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), earned: 2, max: 2 }),
    ]);

    const sheet = report.steps[0];
    expect(sheet.rows.map((r) => r.label)).toEqual([
      "Deposits in transit",
      "Outstanding checks",
      "Adjusted bank balance",
      "Bank service fee",
      "Adjusted book balance",
    ]);
    const sheetKey = variant.keys["bank-rec"] as { cells: Record<string, { value: number }> };
    expect(sheet.rows[4]).toMatchObject({
      answer: "10,000.00",
      expected: sheetKey.cells.adj_book.value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      earned: 0,
      max: 2,
    });

    const reply = report.steps[2];
    expect(reply.answerText).toBe(REPLY_BODY);
    expect(reply.score?.needsReview).toBe(true);
    expect(reply.rows.map((r) => [r.id, r.max])).toEqual(RUBRIC.map((c) => [c.id, c.max]));
    // Guidance is filled with this candidate's numbers (the fee amount).
    expect(reply.rows[1].expected).toMatch(/Mentions the \$[\d,]+\.\d\d bank service fee/);
  });

  it("builds a readable timeline", async () => {
    as("viewer");
    const report = (await getCandidateReport(co.orgId, scored.inviteId))!;
    expect(report.timeline.map((t) => `${t.offset} ${t.text}`)).toEqual([
      "+0:00 Started the assessment",
      expect.stringMatching(/^\+0:30 Opened message ".+"$/),
      '+1:00 Started "October bank reconciliation"',
      '+4:00 Saved "October bank reconciliation" (2 times)',
      "+14:00 Submitted the assessment",
    ]);
  });

  it("has no steps or keys for an invite that was never started", async () => {
    as("recruiter");
    const report = (await getCandidateReport(co.orgId, pendingInviteId))!;
    expect(report).toMatchObject({ status: "invited", attempt: null, steps: [], timeline: [], notes: [] });
  });

  it("does not show another company's candidate", async () => {
    as("otherAdmin");
    expect(await getCandidateReport(co.orgId, scored.inviteId)).toBeNull();
    expect(await getCandidateReport(other.orgId, scored.inviteId)).toBeNull();
  });
});

describe("reviewRubricStep", () => {
  const review = (scores: Record<string, string>) =>
    actions.reviewRubricStep(
      undefined,
      form({ orgId: co.orgId, attemptId: scored.attemptId, stepId: "client-reply", ...Object.fromEntries(Object.entries(scores).map(([k, v]) => [`score:${k}`, v])) }),
    );
  const stored = async () => must(await serviceClient().from("attempts").select("score").eq("id", scored.attemptId).single()).score as ReturnType<typeof miniCloseScore>;

  it("refuses viewers and other companies, and changes nothing", async () => {
    as("viewer");
    expect(await review({ timing: "3", fee: "2", balance: "2", tone: "2" })).toEqual({ error: "You don't have permission to do that." });
    as("otherAdmin");
    expect(await review({ timing: "3", fee: "2", balance: "2", tone: "2" })).toEqual({ error: "You don't have permission to do that." });
    // Straight to the database as the viewer: the function refuses too.
    const direct = await clients.viewer!.rpc("review_rubric_step", { p_attempt_id: scored.attemptId, p_step_id: "client-reply", p_scores: { timing: 3, fee: 2, balance: 2, tone: 2 } });
    expect(direct.error?.code).toBe("42501");
    expect((await stored()).points).toBe(8);
  });

  it("rejects points outside a criterion's range", async () => {
    as("recruiter");
    const res = await review({ timing: "4", fee: "2", balance: "2", tone: "2" });
    expect(res?.error).toMatch(/must be between 0 and 3/);
    expect((await stored()).steps["client-reply"].needsReview).toBe(true);
  });

  it("lets a recruiter score the rubric, which updates the final score", async () => {
    as("recruiter");
    expect(await review({ timing: "3", fee: "1.5", balance: "2", tone: "1" })).toEqual({ message: "Review saved. The final score is updated." });
    const score = await stored();
    expect(score.points).toBe(15.5);
    expect(score.steps["client-reply"]).toMatchObject({ points: 7.5, review: { by: co.users.recruiter.id } });
    expect(score.steps["client-reply"].needsReview).toBeUndefined();

    // The automatic score stays as computed at submit (D11).
    const auto = must(await serviceClient().from("attempts").select("auto_score").eq("id", scored.attemptId).single()).auto_score as ReturnType<typeof miniCloseScore>;
    expect(auto.points).toBe(8);
    expect(auto.steps["client-reply"]).toMatchObject({ points: 0, needsReview: true });

    as("viewer");
    const report = (await getCandidateReport(co.orgId, scored.inviteId))!;
    expect(report.attempt).toMatchObject({ score: { points: 15.5 }, autoScore: { points: 8 } });
    expect(report.steps.find((s) => s.id === "client-reply")).toMatchObject({ score: { points: 7.5 }, autoScore: { points: 0 } });

    const rows = await listJobResults(co.orgId, jobId);
    expect(rows.find((r) => r.inviteId === scored.inviteId)).toMatchObject({ needsReview: false, points: 15.5, percent: 81.6 });
  });

  it("lets an admin override a reviewed step", async () => {
    as("admin");
    expect(await review({ timing: "2", fee: "2", balance: "2", tone: "2" })).toMatchObject({ message: expect.any(String) });
    expect((await stored()).points).toBe(16);
  });
});

describe("notes", () => {
  it("lets every member, viewers included, add a note and vote", async () => {
    as("viewer");
    expect(await actions.addNote(undefined, form({ orgId: co.orgId, attemptId: scored.attemptId, body: "Clear reply", vote: "hire" }))).toEqual({
      message: "Note added.",
    });
    as("recruiter");
    expect(await actions.addNote(undefined, form({ orgId: co.orgId, attemptId: scored.attemptId, body: "", vote: "unsure" }))).toEqual({
      message: "Note added.",
    });
    const report = (await getCandidateReport(co.orgId, scored.inviteId))!;
    expect(report.notes.map((n) => [n.authorEmail, n.body, n.vote])).toEqual([
      [co.users.viewer.email, "Clear reply", "hire"],
      [co.users.recruiter.email, "", "unsure"],
    ]);
  });

  it("validates input and refuses other companies", async () => {
    as("viewer");
    expect(await actions.addNote(undefined, form({ orgId: co.orgId, attemptId: scored.attemptId, body: " ", vote: "" }))).toEqual({
      fieldErrors: { body: ["Write a note or pick a vote."] },
    });
    as("otherAdmin");
    expect(await actions.addNote(undefined, form({ orgId: co.orgId, attemptId: scored.attemptId, body: "x", vote: "" }))).toEqual({
      error: "You don't have permission to do that.",
    });
  });

  it("only the author can delete a note", async () => {
    as("viewer");
    const report = (await getCandidateReport(co.orgId, scored.inviteId))!;
    const recruiterNote = report.notes.find((n) => n.authorId === co.users.recruiter.id)!;
    const viewerNote = report.notes.find((n) => n.authorId === co.users.viewer.id)!;
    expect(await actions.deleteNote(undefined, form({ orgId: co.orgId, noteId: recruiterNote.id }))).toEqual({ error: "Could not delete the note." });
    expect(await actions.deleteNote(undefined, form({ orgId: co.orgId, noteId: viewerNote.id }))).toEqual({ message: "Note deleted." });
    expect((await getCandidateReport(co.orgId, scored.inviteId))!.notes.map((n) => n.id)).toEqual([recruiterNote.id]);
  });
});
