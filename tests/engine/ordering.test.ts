import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { orderingServer } = await import("@/lib/engine/step-types/ordering/server");
const { orderingAnswerSchemaFor } = await import("@/lib/engine/step-types/ordering/public");
const { getServerStepType } = await import("@/lib/engine/server/registry");
const { hasStepComponent, stepBrief } = await import("@/lib/engine/client/registry");

// Shown in this (scrambled) order; the key says a..f.
const ITEMS = [
  { id: "c", label: "Orthopedic consult" },
  { id: "a", label: "ER visit at {{hospital}}", detail: "Day of the crash" },
  { id: "f", label: "Discharge from therapy" },
  { id: "b", label: "Primary care follow-up" },
  { id: "e", label: "Physical therapy, week 6" },
  { id: "d", label: "MRI of the lumbar spine" },
];
const RIGHT = ["a", "b", "c", "d", "e", "f"];
const both = orderingServer.configSchema.parse({ prompt: "Put the visits in date order.", items: ITEMS, positionPoints: 3, pairwisePoints: 3 });
const variant = { values: { hospital: "Mercy General" }, keys: {} };
const fill = (t: string) => t.replaceAll("{{hospital}}", "Mercy General");
const key = orderingServer.keySchema.parse({ order: RIGHT });
const score = (order?: string[], config = both) =>
  orderingServer.score({ config, key, variant, answer: order && orderingServer.parseAnswer({ order }) });

describe("ordering registration", () => {
  it("is registered on the server and in the browser", () => {
    expect(getServerStepType("ordering")).toBe(orderingServer);
    expect(hasStepComponent("ordering")).toBe(true);
  });

  it("shows its prompt in the brief column", () => {
    expect(stepBrief({ type: "ordering", config: { prompt: "Put the visits in date order." } })).toBe("Put the visits in date order.");
  });
});

describe("ordering config and key", () => {
  it("defaults each scoring part to 0 points", () => {
    const c = orderingServer.configSchema.parse({ prompt: "Q", items: ITEMS, pairwisePoints: 2 });
    expect(c).toMatchObject({ positionPoints: 0, pairwisePoints: 2 });
  });

  it.each([
    ["fewer than 6 items", { prompt: "Q", items: ITEMS.slice(0, 5), pairwisePoints: 1 }],
    ["more than 12 items", { prompt: "Q", items: Array.from({ length: 13 }, (_, i) => ({ id: `i${i}`, label: `Item ${i}` })), pairwisePoints: 1 }],
    ["duplicate item ids", { prompt: "Q", items: [...ITEMS.slice(0, 5), { id: "a", label: "Again" }], pairwisePoints: 1 }],
    ["a bad item id", { prompt: "Q", items: [{ id: "A!", label: "x" }, ...ITEMS.slice(1)], pairwisePoints: 1 }],
    ["an empty label", { prompt: "Q", items: [{ id: "z", label: "" }, ...ITEMS.slice(1)], pairwisePoints: 1 }],
    ["no points at all", { prompt: "Q", items: ITEMS }],
    ["negative points", { prompt: "Q", items: ITEMS, positionPoints: -1, pairwisePoints: 2 }],
    ["an empty prompt", { prompt: "", items: ITEMS, pairwisePoints: 1 }],
  ])("rejects %s", (_, raw) => {
    expect(() => orderingServer.configSchema.parse(raw)).toThrow();
  });

  it("throws when the key doesn't fit the config", () => {
    const run = (order: string[]) => () => orderingServer.score({ config: both, key: orderingServer.keySchema.parse({ order }), variant, answer: undefined });
    expect(run(["a", "b", "c", "d", "e", "zz"])).toThrow(/unknown item "zz"/);
    expect(run(["a", "b", "c", "d", "e", "e"])).toThrow(/every item exactly once/);
    expect(run(RIGHT)).not.toThrow();
  });
});

describe("ordering public config", () => {
  it("fills templates, keeps the authored order and carries no key or points", () => {
    const pub = orderingServer.toPublic(both, { variant, fill });
    expect(pub).toEqual({
      prompt: "Put the visits in date order.",
      items: [ITEMS[0], { id: "a", label: "ER visit at Mercy General", detail: "Day of the crash" }, ...ITEMS.slice(2)],
    });
    expect(JSON.stringify(pub)).not.toMatch(/order"|points|pairwise|position/i);
  });
});

describe("ordering answers", () => {
  it("parseAnswer accepts a list of item ids", () => {
    expect(orderingServer.parseAnswer({ order: RIGHT })).toEqual({ order: RIGHT });
  });

  it.each([
    ["a missing list", {}],
    ["a number", { order: [1] }],
    ["a bad id", { order: ["A!"] }],
    ["the same item twice", { order: ["a", "a"] }],
    ["too many items", { order: Array.from({ length: 13 }, (_, i) => `i${i}`) }],
    ["an extra field", { order: RIGHT, score: 6 }],
  ])("parseAnswer rejects %s", (_, raw) => {
    expect(() => orderingServer.parseAnswer(raw)).toThrow();
  });

  it("the schema for a step's items accepts exactly those items once each", () => {
    const schema = orderingAnswerSchemaFor(ITEMS.map((i) => i.id));
    expect(schema.parse({ order: ["f", "e", "d", "c", "b", "a"] })).toEqual({ order: ["f", "e", "d", "c", "b", "a"] });
    expect(() => schema.parse({ order: ["a", "b", "c", "d", "e", "zz"] })).toThrow(); // unknown id
    expect(() => schema.parse({ order: ["a", "b", "c", "d", "e", "e"] })).toThrow(); // duplicate
    expect(() => schema.parse({ order: ["a", "b", "c", "d", "e"] })).toThrow(); // missing one
  });
});

describe("ordering scoring", () => {
  it("full points for the right order", () => {
    const s = score(RIGHT);
    expect(s).toMatchObject({ points: 6, maxPoints: 6 });
    expect(s.items).toEqual([
      { id: "positions", label: "Items in the right position", earned: 3, max: 3, note: "6 of 6 items in the right position." },
      { id: "pairs", label: "Pairs in the right order", earned: 3, max: 3, note: "15 of 15 pairs in the right relative order." },
    ]);
  });

  it("nothing for the reverse order", () => {
    const s = score([...RIGHT].reverse());
    expect(s.points).toBe(0);
    expect(s.items.map((i) => i.earned)).toEqual([0, 0]);
    expect(s.items[0].note).toContain("Expected: ER visit at Mercy General → Primary care follow-up → Orthopedic consult");
  });

  it("one swap of neighbours costs two positions and one pair", () => {
    const s = score(["b", "a", "c", "d", "e", "f"]);
    expect(s.items.map((i) => i.earned)).toEqual([2, 2.8]);
    expect(s.points).toBe(4.8);
    expect(s.items[1].note).toMatch(/^14 of 15 pairs in the right relative order\./);
  });

  it("partial credit when part of the order is wrong", () => {
    // d, e, f reversed: e stays in place, 3 pairs are out of order.
    expect(score(["a", "b", "c", "f", "e", "d"]).items.map((i) => i.earned)).toEqual([2, 2.4]);
    // first and last swapped: 4 in place, 9 pairs out of order.
    expect(score(["f", "b", "c", "d", "e", "a"]).items.map((i) => i.earned)).toEqual([2, 1.2]);
  });

  it("scores only the parts that carry points", () => {
    const pairsOnly = orderingServer.configSchema.parse({ prompt: "Q", items: ITEMS, pairwisePoints: 2 });
    const s = score(["b", "a", "c", "d", "e", "f"], pairsOnly);
    expect(s.items.map((i) => i.id)).toEqual(["pairs"]);
    expect(s).toMatchObject({ points: 1.87, maxPoints: 2 });

    const positionsOnly = orderingServer.configSchema.parse({ prompt: "Q", items: ITEMS, positionPoints: 1 });
    expect(score(["b", "a", "c", "d", "e", "f"], positionsOnly)).toMatchObject({ points: 0.67, maxPoints: 1 });
  });

  it("nothing when not answered", () => {
    const s = score(undefined);
    expect(s).toMatchObject({ points: 0, maxPoints: 6 });
    expect(s.items.map((i) => i.earned)).toEqual([0, 0]);
    expect(s.items[0].note).toMatch(/^Not answered\. Expected: /);
  });

  it("nothing for an order that isn't every item exactly once", () => {
    for (const order of [["a", "b", "c", "d", "e"], ["a", "b", "c", "d", "e", "zz"]]) {
      const s = score(order);
      expect(s.points).toBe(0);
      expect(s.items[0].note).toMatch(/^The answer didn't list every item exactly once\./);
    }
  });
});
