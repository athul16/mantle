import { describe, expect, it } from "vitest";
import { resolveSequence } from "@/lib/engine/sequence";

/** Timed sequences (sections, one-at-a-time screens, rapid items): pure clock math, server time in ms. */
describe("resolveSequence", () => {
  const start = 1_000_000;
  const durationsMs = [60_000, 30_000, 10_000];

  it("is on the first part until its time runs out", () => {
    expect(resolveSequence({ start, durationsMs, advancedAt: {}, now: start })).toEqual({
      index: 0,
      startedAt: start,
      endsAt: start + 60_000,
      done: false,
    });
    expect(resolveSequence({ start, durationsMs, advancedAt: {}, now: start + 59_999 }).index).toBe(0);
  });

  it("moves on by itself when a part times out, and the next part gets its full time", () => {
    expect(resolveSequence({ start, durationsMs, advancedAt: {}, now: start + 60_000 })).toEqual({
      index: 1,
      startedAt: start + 60_000,
      endsAt: start + 90_000,
      done: false,
    });
  });

  it("an early advance ends that part then and starts the next one at that moment", () => {
    const s = resolveSequence({ start, durationsMs, advancedAt: { 0: start + 5_000 }, now: start + 6_000 });
    expect(s).toEqual({ index: 1, startedAt: start + 5_000, endsAt: start + 35_000, done: false });
  });

  it("ignores an advance stamped outside the part's own window", () => {
    // Recorded for part 0 after part 0 had already timed out: no effect.
    const s = resolveSequence({ start, durationsMs, advancedAt: { 0: start + 70_000 }, now: start + 75_000 });
    expect(s.index).toBe(1);
    expect(s.startedAt).toBe(start + 60_000);
  });

  it("is done after the last part, with times at the end of the last part", () => {
    const s = resolveSequence({ start, durationsMs, advancedAt: { 2: start + 95_000 }, now: start + 200_000 });
    expect(s).toEqual({ index: 3, startedAt: start + 95_000, endsAt: start + 95_000, done: true });
  });

  it("an empty sequence is done at once", () => {
    expect(resolveSequence({ start, durationsMs: [], advancedAt: {}, now: start })).toMatchObject({ index: 0, done: true });
  });
});
