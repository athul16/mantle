import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { numericServer } = await import("@/lib/engine/step-types/numeric/server");

const config = numericServer.configSchema.parse({ prompt: "How much?", decimals: 2, points: 2 });
const variant = { values: {}, keys: {} };
const score = (answer: { value: number | null } | undefined, key: object) =>
  numericServer.score({ config, key: numericServer.keySchema.parse(key), variant, answer });

describe("numeric parseAnswer", () => {
  it("accepts a number or null", () => {
    expect(numericServer.parseAnswer({ value: 12.5 })).toEqual({ value: 12.5 });
    expect(numericServer.parseAnswer({ value: null })).toEqual({ value: null });
  });

  it.each([
    ["a string", { value: "12" }],
    ["missing value", {}],
    ["NaN", { value: Number.NaN }],
    ["Infinity", { value: Number.POSITIVE_INFINITY }],
    ["extra keys", { value: 1, sneaky: true }],
    ["not an object", 12],
    ["null", null],
  ])("rejects %s", (_, raw) => {
    expect(() => numericServer.parseAnswer(raw)).toThrow();
  });
});

describe("numeric score", () => {
  it("gives full credit within tolerance", () => {
    expect(score({ value: 187.65 }, { value: 187.65, tolerance: 0.005 }).points).toBe(2);
    expect(score({ value: 187.654 }, { value: 187.65, tolerance: 0.005 }).points).toBe(2);
  });

  it("is not tripped by float noise", () => {
    expect(score({ value: 0.1 + 0.2 }, { value: 0.3 }).points).toBe(2);
  });

  it("gives half credit inside partialTolerance", () => {
    const s = score({ value: 187.15 }, { value: 187.65, tolerance: 0.005, partialTolerance: 1 });
    expect(s.points).toBe(1);
    expect(s.maxPoints).toBe(2);
    expect(s.items[0].note).toMatch(/half credit/i);
  });

  it("gives zero outside every tolerance, with the expected value in the note", () => {
    const s = score({ value: 150 }, { value: 187.65, tolerance: 0.005, partialTolerance: 1 });
    expect(s.points).toBe(0);
    expect(s.items[0].note).toContain("187.65");
  });

  it("scores unanswered and null as zero", () => {
    expect(score(undefined, { value: 5 }).points).toBe(0);
    expect(score({ value: null }, { value: 5 }).points).toBe(0);
  });

  it("rejects malformed keys", () => {
    expect(() => numericServer.keySchema.parse({ value: 5, tolerance: 1, partialTolerance: 0.5 })).toThrow();
    expect(() => numericServer.keySchema.parse({ tolerance: 1 })).toThrow();
  });

  it("public config never carries the key", () => {
    const pub = numericServer.toPublic(config, { variant, fill: (t: string) => t });
    expect(Object.keys(pub).sort()).toEqual(["decimals", "prompt", "unit"]);
  });
});
