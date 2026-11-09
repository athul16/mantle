import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { createRng } = await import("@/lib/engine/server/rng");

const sample = (seed: string, n = 20) => {
  const rng = createRng(seed);
  return Array.from({ length: n }, () => rng.next());
};

describe("createRng", () => {
  it("is deterministic for the same seed", () => {
    expect(sample("attempt-123")).toEqual(sample("attempt-123"));
  });

  it("gives different sequences for different seeds, even similar ones", () => {
    expect(sample("attempt-123")).not.toEqual(sample("attempt-124"));
    expect(sample("a")).not.toEqual(sample("b"));
  });

  it("returns floats in [0, 1)", () => {
    for (const x of sample("range", 5000)) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
  });

  it("int() stays inside inclusive bounds and hits both ends", () => {
    const rng = createRng("ints");
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++) {
      const v = rng.int(3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
      seen.add(v);
    }
    expect([...seen].sort()).toEqual([3, 4, 5, 6, 7]);
  });

  it("int() rejects bad ranges", () => {
    const rng = createRng("bad");
    expect(() => rng.int(5, 4)).toThrow(RangeError);
    expect(() => rng.int(0.5, 4)).toThrow(RangeError);
  });

  it("pick() and shuffle() behave", () => {
    const rng = createRng("collections");
    const items = ["a", "b", "c", "d", "e"];
    expect(items).toContain(rng.pick(items));
    expect(() => rng.pick([])).toThrow(RangeError);

    const shuffled = rng.shuffle(items);
    expect([...shuffled].sort()).toEqual(items);
    expect(items).toEqual(["a", "b", "c", "d", "e"]); // input untouched
  });

  it("cents() returns whole cents inside the dollar range", () => {
    const rng = createRng("money");
    for (let i = 0; i < 500; i++) {
      const c = rng.cents(8, 60);
      expect(Number.isInteger(c)).toBe(true);
      expect(c).toBeGreaterThanOrEqual(800);
      expect(c).toBeLessThanOrEqual(6000);
    }
  });
});
