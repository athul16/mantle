/**
 * Clock math for timed sequences: sections, one-at-a-time screens and rapid
 * items. Pure functions over server time in milliseconds; the browser only
 * ever displays the results.
 */

export interface SequenceState {
  /** The current part, or the part count when done. */
  index: number;
  startedAt: number;
  endsAt: number;
  done: boolean;
}

/**
 * Where a sequence of parts stands at `now`. Each part starts when the
 * previous one ended and runs for its full duration unless it was advanced
 * early. `advancedAt[i]` counts only if it falls inside part i's own window,
 * so a stale or late advance changes nothing.
 */
export function resolveSequence({
  start,
  durationsMs,
  advancedAt,
  now,
}: {
  start: number;
  durationsMs: number[];
  advancedAt: Record<number, number | undefined>;
  now: number;
}): SequenceState {
  let partStart = start;
  for (let i = 0; i < durationsMs.length; i++) {
    const end = partStart + durationsMs[i];
    const adv = advancedAt[i];
    const partEnd = adv !== undefined && adv >= partStart && adv < end ? adv : end;
    if (now < partEnd) return { index: i, startedAt: partStart, endsAt: end, done: false };
    partStart = partEnd;
  }
  return { index: durationsMs.length, startedAt: partStart, endsAt: partStart, done: true };
}

/** A time limit with extra time (an accommodation, D9) applied. */
export function stretch(ms: number, extraTimePercent: number): number {
  return Math.round(ms * (1 + (extraTimePercent || 0) / 100));
}
