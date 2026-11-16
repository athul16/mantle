// Timing rows for the company report (docs/06, "Report rows for timing").
// Evidence for a person to read next to the answers: nothing here changes the
// score, the integrity label or the flags (src/lib/proctoring/rules.ts).
// Pure functions, so the report query and the tests share them.

import { scorePercent, type StoredStepScore } from "./summary";

/** A rapid answer this soon after returning to the test window is listed. */
export const QUICK_AFTER_RETURN_MS = 2_000;
/** The rapid round vs other tasks row shows when the two differ by this many percentage points or more. */
export const RAPID_GAP_POINTS = 30;

type EventRow = { kind: string; at: string; payload: unknown };

export type QuickAnswer = {
  stepId: string;
  stepTitle: string;
  /** 0-based item index within the rapid round. */
  index: number;
  answeredAt: string;
  returnedAt: string;
  afterMs: number;
  /** How long the candidate was away before that return, when the browser reported it. */
  awayMs: number | null;
};

export type RapidGap = { rapidPercent: number; otherPercent: number; gap: number; large: boolean };

export type TimingReport = { quickAfterReturn: QuickAnswer[]; rapidGap: RapidGap | null };

/** Postgres returns "+00:00" timestamps; payloads hold ISO. Report both as ISO. */
const isoOrRaw = (at: string) => {
  const ms = Date.parse(at);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : at;
};

const obj = (x: unknown): Record<string, unknown> => (x && typeof x === "object" ? (x as Record<string, unknown>) : {});

/**
 * Joins server-written `answered_item` action events with `returned_to_window`
 * browser signals by time: each answer given within `windowMs` after the
 * latest return before it. Answer times come from the event payload (server
 * clock); return times are the browser's, so a small clock skew can move an
 * answer in or out of the window.
 */
export function answersSoonAfterReturn(
  actions: EventRow[],
  integrity: EventRow[],
  stepTitles: Record<string, string>,
  windowMs = QUICK_AFTER_RETURN_MS,
): QuickAnswer[] {
  const returns = integrity
    .filter((e) => e.kind === "returned_to_window")
    .map((e) => ({ at: isoOrRaw(e.at), ms: Date.parse(e.at), awayMs: typeof obj(e.payload).awayMs === "number" ? (obj(e.payload).awayMs as number) : null }))
    .filter((r) => Number.isFinite(r.ms))
    .sort((a, b) => a.ms - b.ms);

  const out: QuickAnswer[] = [];
  for (const e of actions) {
    if (e.kind !== "answered_item") continue;
    const p = obj(e.payload);
    if (typeof p.stepId !== "string" || typeof p.index !== "number") continue;
    const answeredAt = typeof p.at === "string" ? p.at : e.at;
    const ms = Date.parse(answeredAt);
    if (!Number.isFinite(ms)) continue;
    let last: (typeof returns)[number] | undefined;
    for (const r of returns) {
      if (r.ms > ms) break;
      last = r;
    }
    if (!last || ms - last.ms > windowMs) continue;
    out.push({
      stepId: p.stepId,
      stepTitle: stepTitles[p.stepId] ?? p.stepId,
      index: p.index,
      answeredAt: isoOrRaw(answeredAt),
      returnedAt: last.at,
      afterMs: ms - last.ms,
      awayMs: last.awayMs,
    });
  }
  return out.sort((a, b) => Date.parse(a.answeredAt) - Date.parse(b.answeredAt));
}

/**
 * Rapid-round score % against the other steps' score %, points pooled on each
 * side. Steps still waiting for a reviewer (provisional 0) are left out.
 * Null when either side has nothing scored.
 */
export function rapidGap(steps: { type: string; score: StoredStepScore | null }[], threshold = RAPID_GAP_POINTS): RapidGap | null {
  const sum = (rapid: boolean) => {
    let points = 0;
    let max = 0;
    for (const s of steps) {
      if ((s.type === "rapid_round") !== rapid || !s.score) continue;
      if (s.score.needsReview && !s.score.review) continue;
      points += s.score.points;
      max += s.score.maxPoints;
    }
    return max > 0 ? scorePercent(points, max) : null;
  };
  const rapidPercent = sum(true);
  const otherPercent = sum(false);
  if (rapidPercent === null || otherPercent === null) return null;
  const gap = Math.round((rapidPercent - otherPercent) * 10) / 10;
  return { rapidPercent, otherPercent, gap, large: Math.abs(gap) >= threshold };
}
