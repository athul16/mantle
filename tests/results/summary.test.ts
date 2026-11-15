/** Pure helpers behind the results table and candidate report (no database). */
import { describe, expect, it } from "vitest";
import { addNoteSchema, parseRubricForm } from "@/lib/results/schemas";
import {
  buildTimeline,
  defaultDir,
  durationSeconds,
  filterRows,
  formatDuration,
  formatOffset,
  readAttemptScore,
  scorePercent,
  sortRows,
  stepsNeedingReview,
  type ResultRow,
} from "@/lib/results/summary";

const row = (over: Partial<ResultRow>): ResultRow => ({
  inviteId: over.email ?? "id",
  email: "x@example.test",
  candidateName: null,
  status: "completed",
  needsReview: false,
  points: null,
  maxPoints: null,
  percent: null,
  timeTakenSeconds: null,
  submittedAt: null,
  invitedAt: "2026-11-01T00:00:00Z",
  ...over,
});

const ann = row({ email: "ann@example.test", candidateName: "Ann", percent: 80, timeTakenSeconds: 1200, submittedAt: "2026-11-02T10:00:00Z" });
const bob = row({ email: "bob@example.test", percent: 95, timeTakenSeconds: 1800, submittedAt: "2026-11-03T10:00:00Z", needsReview: true });
const cat = row({ email: "cat@example.test", candidateName: "Cat", status: "invited" });
const dan = row({ email: "dan@example.test", percent: 50, timeTakenSeconds: 600, submittedAt: "2026-11-01T10:00:00Z" });
const rows = [ann, bob, cat, dan];

describe("scores", () => {
  it("reads a stored score and rejects anything else", () => {
    expect(readAttemptScore({ points: 1, maxPoints: 2, steps: {} })).toEqual({ points: 1, maxPoints: 2, steps: {} });
    expect(readAttemptScore(null)).toBeNull();
    expect(readAttemptScore({ points: "1", maxPoints: 2, steps: {} })).toBeNull();
    expect(readAttemptScore({ points: 1, maxPoints: 2 })).toBeNull();
  });

  it("lists steps that still need review", () => {
    const score = readAttemptScore({
      points: 0,
      maxPoints: 3,
      steps: {
        a: { points: 0, maxPoints: 1, items: [], needsReview: true },
        b: { points: 1, maxPoints: 1, items: [] },
        c: { points: 1, maxPoints: 1, items: [], review: { by: "u", at: "t" } },
      },
    });
    expect(stepsNeedingReview(score)).toEqual(["a"]);
    expect(stepsNeedingReview(null)).toEqual([]);
  });

  it("rounds percentages to one decimal and survives a zero max", () => {
    expect(scorePercent(2, 3)).toBe(66.7);
    expect(scorePercent(5, 5)).toBe(100);
    expect(scorePercent(0, 0)).toBe(0);
  });
});

describe("durations", () => {
  it("measures start to submit in seconds", () => {
    expect(durationSeconds("2026-11-01T10:00:00Z", "2026-11-01T10:38:30Z")).toBe(2310);
    expect(durationSeconds(null, "2026-11-01T10:00:00Z")).toBeNull();
    expect(durationSeconds("2026-11-01T10:00:00Z", null)).toBeNull();
    expect(durationSeconds("2026-11-01T11:00:00Z", "2026-11-01T10:00:00Z")).toBeNull();
  });

  it("formats durations and offsets", () => {
    expect(formatDuration(null)).toBe("—");
    expect(formatDuration(45)).toBe("45 s");
    expect(formatDuration(2310)).toBe("39 min");
    expect(formatDuration(3900)).toBe("1 h 05 min");
    expect(formatOffset(0)).toBe("+0:00");
    expect(formatOffset(125)).toBe("+2:05");
    expect(formatOffset(3723)).toBe("+1:02:03");
    expect(formatOffset(-5)).toBe("+0:00");
  });
});

describe("sortRows", () => {
  it("sorts by score, best first by default, with unscored rows last", () => {
    expect(defaultDir("score")).toBe("desc");
    expect(sortRows(rows, "score", "desc").map((r) => r.email)).toEqual([bob.email, ann.email, dan.email, cat.email]);
    expect(sortRows(rows, "score", "asc").map((r) => r.email)).toEqual([dan.email, ann.email, bob.email, cat.email]);
  });

  it("sorts by candidate name (falling back to email), time and submit date", () => {
    expect(sortRows(rows, "candidate", "asc").map((r) => r.email)).toEqual([ann.email, bob.email, cat.email, dan.email]);
    expect(sortRows(rows, "time", "asc").map((r) => r.email)).toEqual([dan.email, ann.email, bob.email, cat.email]);
    expect(sortRows(rows, "submitted", "desc").map((r) => r.email)).toEqual([bob.email, ann.email, dan.email, cat.email]);
  });

  it("sorts by status in funnel order, needs review first within completed", () => {
    expect(sortRows(rows, "status", "asc").map((r) => r.email)).toEqual([bob.email, ann.email, dan.email, cat.email]);
  });

  it("does not modify the input", () => {
    const copy = [...rows];
    sortRows(rows, "score", "asc");
    expect(rows).toEqual(copy);
  });
});

describe("filterRows", () => {
  it("filters by status, needs review and search text", () => {
    expect(filterRows(rows, "all")).toHaveLength(4);
    expect(filterRows(rows, "invited").map((r) => r.email)).toEqual([cat.email]);
    expect(filterRows(rows, "needs_review").map((r) => r.email)).toEqual([bob.email]);
    expect(filterRows(rows, "all", "  CAT ").map((r) => r.email)).toEqual([cat.email]);
    expect(filterRows(rows, "all", "ann@").map((r) => r.email)).toEqual([ann.email]);
    expect(filterRows(rows, "completed", "cat")).toEqual([]);
  });
});

describe("buildTimeline", () => {
  const start = "2026-11-01T10:00:00Z";
  const at = (s: number) => new Date(Date.parse(start) + s * 1000).toISOString();
  const opts = { startedAt: start, stepTitles: { s1: "Reconcile", s2: "Reply" }, messageSubjects: { m1: "Urgent: cash count" } };

  it("names the full screen and microphone waivers on the start event", () => {
    const [first] = buildTimeline(
      [{ at: at(0), kind: "started_attempt", payload: { accommodations: { extraTimePercent: 0, waiveFullscreen: true, waiveMicrophone: true } } }],
      opts,
    );
    expect(first.text).toContain("full screen waived");
    expect(first.text).toContain("microphone waived");
  });

  it("labels events with the time since the start and collapses repeated saves", () => {
    const timeline = buildTimeline(
      [
        { at: at(0), kind: "started_attempt", payload: {} },
        { at: at(30), kind: "opened_message", payload: { messageId: "m1" } },
        { at: at(60), kind: "started_step", payload: { stepId: "s1" } },
        { at: at(90), kind: "saved_step", payload: { stepId: "s1" } },
        { at: at(95), kind: "saved_step", payload: { stepId: "s1" } },
        { at: at(99), kind: "saved_step", payload: { stepId: "s1" } },
        { at: at(120), kind: "saved_step", payload: { stepId: "s2" } },
        { at: at(2280), kind: "submitted_attempt", payload: { reason: "candidate" } },
      ],
      opts,
    );
    expect(timeline.map((t) => `${t.offset} ${t.text}`)).toEqual([
      "+0:00 Started the assessment",
      '+0:30 Opened message "Urgent: cash count"',
      '+1:00 Started "Reconcile"',
      '+1:30 Saved "Reconcile" (3 times)',
      '+2:00 Saved "Reply"',
      "+38:00 Submitted the assessment",
    ]);
  });

  it("sorts out-of-order events, explains timeouts and keeps unknown kinds readable", () => {
    const timeline = buildTimeline(
      [
        { at: at(900), kind: "submitted_attempt", payload: { reason: "timeout" } },
        { at: at(10), kind: "tab_hidden", payload: {} },
        { at: at(20), kind: "opened_message", payload: { messageId: "gone" } },
        { at: at(30), kind: "started_step", payload: {} },
      ],
      opts,
    );
    expect(timeline.map((t) => t.text)).toEqual([
      "tab hidden",
      'Opened message "gone"',
      "Started a task",
      "Time ran out; answers submitted automatically",
    ]);
  });
});

describe("form parsing", () => {
  const ids = { orgId: "00000000-0000-4000-8000-000000000001", attemptId: "00000000-0000-4000-8000-000000000002" };
  const form = (entries: Record<string, string>) => {
    const fd = new FormData();
    for (const [k, v] of Object.entries(entries)) fd.append(k, v);
    return fd;
  };

  it("reads rubric scores from score:<criterion> fields", () => {
    expect(parseRubricForm(form({ ...ids, stepId: "reply", "score:tone": "2.5", "score:facts": "0" }))).toEqual({
      ok: true,
      ...ids,
      stepId: "reply",
      scores: { tone: 2.5, facts: 0 },
    });
  });

  it("rejects blank or non-numeric scores per field, and missing ids", () => {
    expect(parseRubricForm(form({ ...ids, stepId: "reply", "score:tone": "", "score:facts": "abc" }))).toEqual({
      ok: false,
      fieldErrors: { "score:tone": ["Enter points."], "score:facts": ["Enter a number."] },
    });
    expect(parseRubricForm(form({ ...ids, stepId: "reply" }))).toEqual({ ok: false, error: "No scores entered." });
    expect(parseRubricForm(form({ orgId: "nope", attemptId: ids.attemptId, stepId: "reply", "score:a": "1" }))).toMatchObject({ ok: false });
    expect(parseRubricForm(form({ ...ids, stepId: "bad id!", "score:a": "1" }))).toMatchObject({ ok: false });
  });

  it("needs a note body or a vote", () => {
    expect(addNoteSchema.safeParse({ ...ids, body: "  Strong ", vote: "" }).data).toEqual({ ...ids, body: "Strong", vote: null });
    expect(addNoteSchema.safeParse({ ...ids, body: "", vote: "hire" }).data).toEqual({ ...ids, body: "", vote: "hire" });
    expect(addNoteSchema.safeParse({ ...ids, body: " ", vote: "" }).success).toBe(false);
    expect(addNoteSchema.safeParse({ ...ids, body: "x", vote: "maybe" }).success).toBe(false);
    expect(addNoteSchema.safeParse({ ...ids, body: "x".repeat(5001), vote: "" }).success).toBe(false);
  });
});
