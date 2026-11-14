/** Pure helpers for the job candidates table: percentile, score display, extra filters and the CSV export. */
import { describe, expect, it } from "vitest";
import { buildCsv, filterExtra, formatScore, ordinal, percentiles, type CandidateRow } from "@/lib/results/candidate-table";

const row = (over: Partial<CandidateRow> & Pick<CandidateRow, "inviteId">): CandidateRow => ({
  email: `${over.inviteId}@example.test`,
  candidateName: null,
  status: "completed",
  needsReview: false,
  points: null,
  maxPoints: null,
  percent: null,
  timeTakenSeconds: null,
  submittedAt: null,
  invitedAt: "2026-11-01T00:00:00Z",
  startedAt: null,
  expiresAt: "2026-11-30T00:00:00Z",
  integrity: null,
  flagCount: 0,
  hireVotes: 0,
  noHireVotes: 0,
  tasks: [],
  replyToScore: false,
  percentile: null,
  ...over,
});

describe("percentiles", () => {
  it("ranks scored rows by the share scoring lower, ties as half, clamped to 1–99", () => {
    const p = percentiles([
      { inviteId: "a", percent: 90 },
      { inviteId: "b", percent: 70 },
      { inviteId: "c", percent: 70 },
      { inviteId: "d", percent: 50 },
      { inviteId: "e", percent: null },
    ]);
    expect(Object.fromEntries(p)).toEqual({ a: 99, b: 50, c: 50, d: 1 });
  });

  it("needs at least two scored candidates", () => {
    expect(percentiles([{ inviteId: "a", percent: 80 }, { inviteId: "b", percent: null }]).size).toBe(0);
  });
});

describe("formatting", () => {
  it("writes ordinals and scores", () => {
    expect([1, 2, 3, 4, 11, 12, 13, 21, 22, 90].map(ordinal)).toEqual(["1st", "2nd", "3rd", "4th", "11th", "12th", "13th", "21st", "22nd", "90th"]);
    expect(formatScore(88)).toBe("88");
    expect(formatScore(42.1)).toBe("42.1");
    expect(formatScore(null)).toBe("—");
  });
});

describe("filterExtra", () => {
  const rows = [row({ inviteId: "a", percent: 92, integrity: "clear" }), row({ inviteId: "b", percent: 65, integrity: "review" }), row({ inviteId: "c", status: "invited" })];
  const ids = (r: CandidateRow[]) => r.map((x) => x.inviteId);

  it("filters by score range and pass mark; unscored rows only pass 'any'", () => {
    expect(ids(filterExtra(rows, "any", "any", 60))).toEqual(["a", "b", "c"]);
    expect(ids(filterExtra(rows, "pass", "any", 70))).toEqual(["a"]);
    expect(ids(filterExtra(rows, "pass", "any", null))).toEqual([]);
    expect(ids(filterExtra(rows, "90", "any", null))).toEqual(["a"]);
    expect(ids(filterExtra(rows, "below70", "any", null))).toEqual(["b"]);
  });

  it("filters by integrity label", () => {
    expect(ids(filterExtra(rows, "any", "review", null))).toEqual(["b"]);
  });
});

describe("buildCsv", () => {
  it("writes one row per candidate with the chosen columns, quoting and defusing formulas", () => {
    const csv = buildCsv(
      [
        row({
          inviteId: "a",
          candidateName: '=HYPERLINK("x")',
          email: "a@example.test",
          percent: 80,
          points: 16,
          maxPoints: 20,
          percentile: 75,
          timeTakenSeconds: 1200,
          submittedAt: "2026-11-02T10:00:00Z",
          integrity: "review",
          flagCount: 1,
          hireVotes: 2,
          tasks: [{ stepId: "rec", title: "Bank rec, October", points: 8, maxPoints: 8 }],
        }),
        row({ inviteId: "b", status: "invited" }),
      ],
      { scores: true, integrity: true, votes: false },
    );
    const lines = csv.trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      'Candidate,Email,Status,Time taken,Submitted,Score (of 100),Points,Max points,Percentile,Needs review,"Bank rec, October",Integrity,Flags',
    );
    expect(lines[1]).toBe(`"'=HYPERLINK(""x"")",a@example.test,completed,20 min,2026-11-02T10:00:00Z,80,16,20,75,no,8/8,review,1`);
    expect(lines[2]).toBe("b@example.test,b@example.test,invited,,,,,,,,,,");
  });
});
