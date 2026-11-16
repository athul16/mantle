import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");

const config = rapidRoundServer.configSchema.parse({
  intro: "Pick the accounts.",
  secondsPerItem: 20,
  items: [
    {
      id: "je1",
      prompt: "Paid {{amount|money}} for 12 months of insurance.",
      fields: [
        { id: "debit", label: "Debit", kind: "choice", options: [{ id: "prepaid", label: "Prepaid insurance" }, { id: "cash", label: "Cash" }] },
        { id: "credit", label: "Credit", kind: "choice", options: [{ id: "prepaid", label: "Prepaid insurance" }, { id: "cash", label: "Cash" }] },
      ],
    },
    {
      id: "calc",
      prompt: "Monthly expense?",
      exhibit: { title: "Policy", rows: [{ label: "Premium", value: "{{amount|money}}" }] },
      fields: [{ id: "value", label: "Amount", kind: "number", unit: "$", decimals: 2 }],
      points: 2,
    },
    {
      id: "hold",
      prompt: "Pay or hold?",
      fields: [{ id: "decision", label: "Decision", kind: "choice", options: [{ id: "pay", label: "Pay" }, { id: "hold", label: "Hold" }] }],
    },
  ],
});
const key = rapidRoundServer.keySchema.parse({
  items: {
    je1: { debit: { choice: "prepaid" }, credit: { choice: "cash" } },
    calc: { value: { value: 100, tolerance: 0.01 } },
    hold: { decision: { choice: "hold" } },
  },
});
const variant = { values: { amount: 120000 }, keys: {} };
const ctx = { variant, fill: (s: string) => s.replace("{{amount|money}}", "$1,200.00") };
const seq = rapidRoundServer.sequence!;

describe("rapid_round: what the browser gets", () => {
  it("the step's public config has no items at all, only the count and timing", () => {
    const pub = rapidRoundServer.toPublic(config, ctx);
    expect(pub).toEqual({ intro: "Pick the accounts.", itemCount: 3, secondsPerItem: 20 });
  });

  it("renders exactly one item, filled, with no key", () => {
    const item = seq.renderItem(config, ctx, 1);
    expect(item).toEqual({
      id: "calc",
      prompt: "Monthly expense?",
      exhibit: { title: "Policy", rows: [{ label: "Premium", value: "$1,200.00" }] },
      fields: [{ id: "value", label: "Amount", kind: "number", unit: "$", decimals: 2 }],
    });
    expect(JSON.stringify(seq.renderItem(config, ctx, 0))).not.toMatch(/choice"|tolerance|points/);
  });

  it("knows its count and per-item seconds", () => {
    expect(seq.count(config)).toBe(3);
    expect(seq.secondsPerItem(config)).toBe(20);
  });
});

describe("rapid_round: recording an item answer", () => {
  it("adds the item's values and response time to the saved answer", () => {
    const a1 = seq.recordItem(config, undefined, 0, { index: 0, values: { debit: "prepaid", credit: "cash" } }, 4_200);
    const a2 = seq.recordItem(config, a1, 1, { index: 1, values: { value: 100 } }, 9_000);
    expect(a2).toEqual({
      items: {
        je1: { values: { debit: "prepaid", credit: "cash" }, ms: 4_200 },
        calc: { values: { value: 100 }, ms: 9_000 },
      },
    });
    expect(rapidRoundServer.parseAnswer(a2)).toEqual(a2);
  });

  it("rejects an answer for another item, unknown fields, unknown options and bad numbers", () => {
    expect(() => seq.recordItem(config, undefined, 0, { index: 1, values: {} }, 1)).toThrow();
    expect(() => seq.recordItem(config, undefined, 0, { index: 0, values: { nope: "x" } }, 1)).toThrow();
    expect(() => seq.recordItem(config, undefined, 0, { index: 0, values: { debit: "bank" } }, 1)).toThrow();
    expect(() => seq.recordItem(config, undefined, 1, { index: 1, values: { value: "100" } }, 1)).toThrow();
  });

  it("only the first answer to an item counts", () => {
    const a1 = seq.recordItem(config, undefined, 2, { index: 2, values: { decision: "pay" } }, 3_000);
    expect(() => seq.recordItem(config, a1, 2, { index: 2, values: { decision: "hold" } }, 4_000)).toThrow();
  });
});

describe("rapid_round: scoring", () => {
  const score = (answer: unknown) =>
    rapidRoundServer.score({ config, key, variant, answer: answer === undefined ? undefined : rapidRoundServer.parseAnswer(answer) });

  it("all correct scores full points (items carry their own weights)", () => {
    const s = score({
      items: {
        je1: { values: { debit: "prepaid", credit: "cash" }, ms: 4_000 },
        calc: { values: { value: 100.005 }, ms: 8_000 },
        hold: { values: { decision: "hold" }, ms: 6_000 },
      },
    });
    expect(s.points).toBe(4);
    expect(s.maxPoints).toBe(4);
  });

  it("blank scores 0 and says every item timed out", () => {
    const s = score(undefined);
    expect(s.points).toBe(0);
    expect(s.maxPoints).toBe(4);
    expect(s.items.filter((i) => i.note?.includes("No answer"))).toHaveLength(3);
  });

  it("gives credit per field: one of two fields right is half the item", () => {
    const s = score({ items: { je1: { values: { debit: "prepaid", credit: "prepaid" }, ms: 5_000 } } });
    expect(s.items.find((i) => i.id === "je1")).toMatchObject({ earned: 0.5, max: 1 });
  });

  it("adds a zero-point timing line: median response time and items with no answer", () => {
    const s = score({
      items: {
        je1: { values: { debit: "prepaid", credit: "cash" }, ms: 4_000 },
        calc: { values: { value: 1 }, ms: 10_000 },
      },
    });
    const timing = s.items.find((i) => i.id === "timing");
    expect(timing).toMatchObject({ earned: 0, max: 0 });
    expect(timing?.note).toBe("Median response 7.0s over 2 answered; 1 with no answer.");
    expect(s.points).toBe(1);
  });
});
