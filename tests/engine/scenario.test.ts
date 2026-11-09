import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { demoPettyCash } = await import("@/lib/engine/scenarios/demo-petty-cash");
const { renderAttemptForCandidate, renderStepForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt, parseAnswerForStep } = await import("@/lib/engine/server/score");
const { fillTemplate } = await import("@/lib/engine/server/template");

type NumKey = { value: number; tolerance: number; partialTolerance?: number };
const keysFor = (seed: string) => demoPettyCash.generate(seed).keys as Record<string, NumKey>;

const SEEDS = ["abc", "xyz", "attempt-0001", "attempt-0002", "9f86d081884c7d65", "seed with spaces"];

describe("demo scenario generator", () => {
  it("is deterministic per seed", () => {
    expect(demoPettyCash.generate("abc")).toEqual(demoPettyCash.generate("abc"));
  });

  it("gives different numbers for different seeds", () => {
    const distinct = new Set(SEEDS.map((s) => JSON.stringify(demoPettyCash.generate(s).values)));
    expect(distinct.size).toBe(SEEDS.length);
  });

  it("keys tie out to the generated numbers", () => {
    for (const seed of SEEDS) {
      const { values, keys } = demoPettyCash.generate(seed);
      const v = values as Record<string, number>;
      const expectedCents = v.fund - v.r1 - v.r2 - v.r3;
      const k = keys as Record<string, NumKey>;
      expect(Math.round(k["expected-cash"].value * 100)).toBe(expectedCents);
      expect(Math.round(k.shortage.value * 100)).toBe(expectedCents - v.counted);
      expect(k.shortage.value).toBeGreaterThan(0);
      expect(v.counted).toBeGreaterThan(0);
    }
  });
});

describe("what the candidate receives", () => {
  // Every form an answer could take in serialized output: 120.1 (JSON number), 120.10, 1,120.10, 12010 (cents).
  const leakPatterns = (value: number) => {
    const json = JSON.stringify(value);
    const fixed = value.toFixed(2);
    const cents = String(Math.round(value * 100));
    const money = value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return [...new Set([json, fixed, money, cents])].map(
      (s) => new RegExp(`(?<![\\d.,])${s.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`),
    );
  };

  for (const seed of SEEDS) {
    it(`contains no answer key for seed "${seed}" (full attempt at minute 60)`, () => {
      const payload = JSON.stringify(renderAttemptForCandidate(demoPettyCash, seed, 60));
      expect(payload).not.toMatch(/"keys"|"tolerance"|partialTolerance/);
      for (const [stepId, key] of Object.entries(keysFor(seed))) {
        for (const pattern of leakPatterns(key.value)) {
          expect(payload, `${stepId} key ${key.value} leaked as ${pattern}`).not.toMatch(pattern);
        }
      }
    });
  }

  it("fills variant values into prompts and messages", () => {
    const step = renderStepForCandidate(demoPettyCash, "shortage", "abc");
    const { values } = demoPettyCash.generate("abc");
    expect(JSON.stringify(step)).toContain(fillTemplate("{{counted|money}}", values));
    expect(JSON.stringify(step)).not.toContain("{{");
  });

  it("withholds the minute-5 message and its step until minute 5", () => {
    const early = renderAttemptForCandidate(demoPettyCash, "abc", 4.99);
    expect(early.messages.map((m) => m.id)).toEqual(["m1"]);
    expect(early.steps.map((s) => s.id)).toEqual(["expected-cash"]);
    expect(JSON.stringify(early)).not.toContain(fillTemplate("{{counted|money}}", demoPettyCash.generate("abc").values));

    const later = renderAttemptForCandidate(demoPettyCash, "abc", 5);
    expect(later.messages.map((m) => m.id)).toEqual(["m2", "m1"]); // newest first
    expect(later.steps.map((s) => s.id)).toEqual(["expected-cash", "shortage"]);
  });

  it("throws on an unknown step id", () => {
    expect(() => renderStepForCandidate(demoPettyCash, "nope", "abc")).toThrow(/no step/);
  });
});

describe("scoreAttempt", () => {
  const seed = "xyz";
  const k = keysFor(seed);

  it("gives full marks for correct answers", () => {
    const result = scoreAttempt(demoPettyCash, seed, {
      "expected-cash": { value: k["expected-cash"].value },
      shortage: { value: k.shortage.value },
    });
    expect(result).toMatchObject({ points: 4, maxPoints: 4 });
  });

  it("does not accept another seed's answers", () => {
    const other = keysFor("abc");
    const result = scoreAttempt(demoPettyCash, seed, {
      "expected-cash": { value: other["expected-cash"].value },
      shortage: { value: other.shortage.value },
    });
    expect(result.points).toBeLessThan(4);
  });

  it("mixes partial, unanswered and invalid answers without throwing", () => {
    const result = scoreAttempt(demoPettyCash, seed, {
      "expected-cash": { value: k["expected-cash"].value + 0.5 },
      shortage: { value: "lots" },
    });
    expect(result.steps["expected-cash"].points).toBe(1);
    expect(result.steps.shortage.points).toBe(0);
    expect(result.steps.shortage.items[0].note).toMatch(/not in a valid format/);
    expect(result).toMatchObject({ points: 1, maxPoints: 4 });

    expect(scoreAttempt(demoPettyCash, seed, {})).toMatchObject({ points: 0, maxPoints: 4 });
  });

  it("parseAnswerForStep validates per step type", () => {
    expect(parseAnswerForStep(demoPettyCash, "shortage", { value: 3 })).toEqual({ value: 3 });
    expect(() => parseAnswerForStep(demoPettyCash, "shortage", { value: "3" })).toThrow();
    expect(() => parseAnswerForStep(demoPettyCash, "nope", { value: 3 })).toThrow(/no step/);
  });
});

describe("fillTemplate", () => {
  it("formats money and rejects unknown names", () => {
    expect(fillTemplate("{{a|money}} / {{b}}", { a: 123456, b: "x" })).toBe("$1,234.56 / x");
    expect(fillTemplate("{{ a | money }}", { a: -5 })).toBe("-$0.05");
    expect(() => fillTemplate("{{missing}}", {})).toThrow(/unknown variant value/);
    expect(() => fillTemplate("{{a|bogus}}", { a: 1 })).toThrow(/unknown template format/);
  });
});
