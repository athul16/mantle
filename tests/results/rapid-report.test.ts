/**
 * Company report for a rapid round, against the local test database: each
 * item's prompt, values, the expected values rebuilt from the seed and the
 * response time, plus the timing evidence rows (answers right after returning
 * to the window, rapid round vs the other tasks). Read as company users
 * through RLS; the rows are evidence only and never touch the integrity label.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { createTestData, type TestCompany } from "../helpers/factories";
import { RAPID_ANSWERS, timedCloseAttempt, timedCloseJob } from "../helpers/results";
import { must, serviceClient, signedInClient, type Db } from "../helpers/supabase";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => acting }));

const { getScenario } = await import("@/lib/engine/scenarios");
const { getCandidateReport } = await import("@/lib/results/queries");

const data = createTestData("rapid-report");
let acting: Db;
let co: TestCompany;
let other: TestCompany;
const clients: Partial<Record<"recruiter" | "viewer" | "otherAdmin", Db>> = {};
let attempt: Awaited<ReturnType<typeof timedCloseAttempt>>;

beforeAll(async () => {
  co = await data.company();
  other = await data.company();
  clients.recruiter = await signedInClient(co.users.recruiter.email, co.users.recruiter.password);
  clients.viewer = await signedInClient(co.users.viewer.email, co.users.viewer.password);
  clients.otherAdmin = await signedInClient(other.users.admin.email, other.users.admin.password);
  const { jobId, scenarioId } = await timedCloseJob(data, co.orgId);
  attempt = await timedCloseAttempt(data, { orgId: co.orgId, jobId, scenarioId, candidateName: "Jordan Lee" });
});

afterAll(() => data.cleanup());

describe("rapid round in the candidate report", () => {
  it("shows each item's prompt, the candidate's values, the expected values from the seed and the response time", async () => {
    acting = clients.recruiter!;
    const report = (await getCandidateReport(co.orgId, attempt.inviteId))!;
    const quick = report.steps.find((s) => s.id === "quick")!;
    expect(quick.type).toBe("rapid_round");
    expect(quick.rows.map((r) => r.id)).toEqual(["jef-rent", "jef-supplies", "ap-check", "dep-calc", "timing"]);

    const variant = getScenario("demo-timed-close", 1).generate(attempt.seed);
    const money = (cents: number) => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}`;
    const rent = quick.rows[0];
    expect(rent).toMatchObject({
      label: "Item 1",
      prompt: `Paid this month's store rent of ${money(variant.values.rent as number)} by check.`,
      answer: "Debit: Rent expense; Credit: Cash",
      expected: "Debit: Rent expense; Credit: Cash",
      responseMs: RAPID_ANSWERS["jef-rent"].ms,
      earned: 1,
      max: 1,
    });

    const dep = quick.rows[3];
    const key = (variant.keys.quick as { items: Record<string, Record<string, { value?: number }>> }).items["dep-calc"].amount.value!;
    expect(dep.answer).toBe("Monthly depreciation: $123.45");
    expect(dep.expected).toBe(`Monthly depreciation: $${key.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (± 0.01)`);
    expect(dep.responseMs).toBe(15_000);
    expect(quick.rows[4]).toMatchObject({ label: "Response time", answer: expect.stringMatching(/^Median response/) });
  });

  it("joins answered items with returns to the window by time: only answers within 2 s count", async () => {
    acting = clients.recruiter!;
    const { timing } = (await getCandidateReport(co.orgId, attempt.inviteId))!;
    expect(timing?.quickAfterReturn).toEqual([
      {
        stepId: "quick",
        stepTitle: "Rapid checks",
        index: 2,
        answeredAt: attempt.answeredAt[2],
        returnedAt: attempt.returnedAt[0],
        afterMs: 1_500,
        awayMs: 6_500,
      },
    ]);
  });

  it("compares the rapid round's score with the other tasks', leaving out replies waiting for review", async () => {
    acting = clients.recruiter!;
    const { timing } = (await getCandidateReport(co.orgId, attempt.inviteId))!;
    expect(timing?.rapidGap).toEqual({ rapidPercent: 75, otherPercent: 0, gap: 75, large: true });
  });

  it("viewers see the same evidence; another company sees nothing", async () => {
    acting = clients.viewer!;
    const report = (await getCandidateReport(co.orgId, attempt.inviteId))!;
    expect(report.timing?.quickAfterReturn).toHaveLength(1);
    expect(report.steps.find((s) => s.id === "quick")?.rows[0].expected).toBe("Debit: Rent expense; Credit: Cash");

    acting = clients.otherAdmin!;
    expect(await getCandidateReport(co.orgId, attempt.inviteId)).toBeNull();
    expect(await getCandidateReport(other.orgId, attempt.inviteId)).toBeNull();
  });

  it("reading the report doesn't change the integrity label or add flags", async () => {
    const db = serviceClient();
    const before = must(await db.from("attempts").select("integrity_label").eq("id", attempt.attemptId).single());
    const flagsBefore = must(await db.from("flags").select("id").eq("attempt_id", attempt.attemptId));
    acting = clients.recruiter!;
    await getCandidateReport(co.orgId, attempt.inviteId);
    expect(must(await db.from("attempts").select("integrity_label").eq("id", attempt.attemptId).single())).toEqual(before);
    expect(must(await db.from("flags").select("id").eq("attempt_id", attempt.attemptId))).toEqual(flagsBefore);
  });
});

describe("a report without a rapid round", () => {
  it("has no timing evidence", async () => {
    const { miniCloseJob, scoredAttempt } = await import("../helpers/results");
    const { jobId, scenarioId } = await miniCloseJob(data, co.orgId);
    const plain = await scoredAttempt(data, { orgId: co.orgId, jobId, scenarioId });
    acting = clients.recruiter!;
    expect((await getCandidateReport(co.orgId, plain.inviteId))?.timing).toBeNull();
  });
});
