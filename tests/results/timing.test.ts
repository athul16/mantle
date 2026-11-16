/** Timing evidence for the company report: pure joins and comparisons, no database. */
import { describe, expect, it } from "vitest";
import { answersSoonAfterReturn, rapidGap, QUICK_AFTER_RETURN_MS, RAPID_GAP_POINTS } from "@/lib/results/timing";

const T0 = Date.parse("2026-11-10T10:00:00.000Z");
const at = (s: number) => new Date(T0 + s * 1000).toISOString();
const answered = (s: number, index: number, stepId = "quick") => ({ kind: "answered_item", at: at(s + 0.05), payload: { stepId, index, at: at(s) } });
const left = (s: number) => ({ kind: "left_window", at: at(s), payload: {} });
const back = (s: number, awayMs?: number) => ({ kind: "returned_to_window", at: at(s), payload: awayMs === undefined ? {} : { awayMs } });
const titles = { quick: "Rapid checks", other: "Second round" };

describe("answersSoonAfterReturn", () => {
  it("uses a 2 s window", () => {
    expect(QUICK_AFTER_RETURN_MS).toBe(2_000);
  });

  it("lists rapid answers given within 2 s of returning to the window, with how long the candidate was away", () => {
    const rows = answersSoonAfterReturn([answered(11.2, 1)], [left(4), back(10, 6_000)], titles);
    expect(rows).toEqual([
      { stepId: "quick", stepTitle: "Rapid checks", index: 1, answeredAt: at(11.2), returnedAt: at(10), afterMs: 1_200, awayMs: 6_000 },
    ]);
  });

  it("counts exactly 2 s, but not later", () => {
    expect(answersSoonAfterReturn([answered(12, 0)], [back(10, 1)], titles)).toHaveLength(1);
    expect(answersSoonAfterReturn([answered(12.001, 0)], [back(10, 1)], titles)).toHaveLength(0);
  });

  it("uses the latest return before the answer, and ignores returns after it", () => {
    const rows = answersSoonAfterReturn([answered(21, 2)], [back(5, 1_000), back(20, 3_000), back(21.5, 500)], titles);
    expect(rows).toMatchObject([{ returnedAt: at(20), afterMs: 1_000, awayMs: 3_000 }]);
    expect(answersSoonAfterReturn([answered(10, 0)], [back(10.5, 1_000)], titles)).toEqual([]);
  });

  it("times the answer by the server time in its payload", () => {
    const event = { kind: "answered_item", at: at(30), payload: { stepId: "quick", index: 0, at: at(11) } };
    expect(answersSoonAfterReturn([event], [back(10)], titles)).toMatchObject([{ answeredAt: at(11), afterMs: 1_000, awayMs: null }]);
  });

  it("ignores other kinds and malformed events, and sorts by time", () => {
    const actions = [
      answered(41, 3, "other"),
      { kind: "saved_step", at: at(11), payload: { stepId: "quick" } },
      { kind: "answered_item", at: at(11), payload: { stepId: "quick" } },
      { kind: "answered_item", at: at(11), payload: null },
      answered(11, 0),
    ];
    const integrity = [back(10), left(10.5), { kind: "returned_to_window", at: "not a date", payload: {} }, back(40, 2_000)];
    const rows = answersSoonAfterReturn(actions, integrity, titles);
    expect(rows.map((r) => [r.stepTitle, r.index])).toEqual([
      ["Rapid checks", 0],
      ["Second round", 3],
    ]);
  });

  it("names an unknown step by its id", () => {
    expect(answersSoonAfterReturn([answered(11, 0, "gone")], [back(10)], titles)[0].stepTitle).toBe("gone");
  });
});

describe("rapidGap", () => {
  const rapid = (points: number, maxPoints: number) => ({ type: "rapid_round", score: { points, maxPoints, items: [] } });
  const step = (points: number, maxPoints: number, extra: object = {}) => ({ type: "numeric", score: { points, maxPoints, items: [], ...extra } });

  it("is large from 30 points apart, in either direction", () => {
    expect(RAPID_GAP_POINTS).toBe(30);
    expect(rapidGap([rapid(9, 10), step(3, 10)])).toEqual({ rapidPercent: 90, otherPercent: 30, gap: 60, large: true });
    expect(rapidGap([rapid(2, 10), step(8, 10)])).toEqual({ rapidPercent: 20, otherPercent: 80, gap: -60, large: true });
    expect(rapidGap([rapid(6, 10), step(3, 10)])).toMatchObject({ gap: 30, large: true });
    expect(rapidGap([rapid(8, 10), step(6, 10)])).toMatchObject({ gap: 20, large: false });
  });

  it("pools points across steps on each side", () => {
    expect(rapidGap([rapid(1, 2), rapid(2, 2), step(1, 4), step(0, 4)])).toMatchObject({ rapidPercent: 75, otherPercent: 12.5 });
  });

  it("leaves out replies waiting for review, but counts reviewed ones", () => {
    const waiting = { type: "inbox_reply", score: { points: 0, maxPoints: 10, items: [], needsReview: true } };
    const reviewed = { type: "inbox_reply", score: { points: 10, maxPoints: 10, items: [], needsReview: true, review: { by: "u", at: at(0) } } };
    expect(rapidGap([rapid(5, 10), step(5, 10), waiting])).toMatchObject({ otherPercent: 50 });
    expect(rapidGap([rapid(5, 10), step(5, 10), reviewed])).toMatchObject({ otherPercent: 75 });
  });

  it("is null without a scored rapid round or another scored task", () => {
    expect(rapidGap([step(1, 2)])).toBeNull();
    expect(rapidGap([rapid(1, 2)])).toBeNull();
    expect(rapidGap([{ type: "rapid_round", score: null }, step(1, 2)])).toBeNull();
    expect(rapidGap([rapid(1, 2), { type: "numeric", score: null }])).toBeNull();
    expect(rapidGap([rapid(0, 0), step(1, 2)])).toBeNull();
  });
});
