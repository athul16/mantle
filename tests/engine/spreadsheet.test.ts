import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { spreadsheetServer } = await import("@/lib/engine/step-types/spreadsheet/server");
const { parseCellInput } = await import("@/lib/engine/step-types/spreadsheet/public");

const config = spreadsheetServer.configSchema.parse({
  prompt: "Reconcile.",
  columns: ["Item", "Amount"],
  rows: [
    ["Bank", { text: "{{bank}}", align: "right" }],
    ["Add: DIT", { input: "dit", label: "Deposits in transit" }],
    [{ text: "Adjusted", bold: true }, { input: "adj", label: "Adjusted", points: 2 }],
    ["Scratch", { input: "scratch" }],
    [null, null],
  ],
});
const variant = { values: { bank: "1,000.00" }, keys: {} };
const key = spreadsheetServer.keySchema.parse({
  tolerance: 0.005,
  cells: { dit: { value: 250 }, adj: { value: 1250, tolerance: 1 } },
});
const score = (cells: Record<string, number | null> | undefined) =>
  spreadsheetServer.score({ config, key, variant, answer: cells === undefined ? undefined : { cells } });

describe("spreadsheet config", () => {
  it("rejects ragged rows and duplicate input ids", () => {
    expect(() => spreadsheetServer.configSchema.parse({ prompt: "x", columns: ["a", "b"], rows: [["only one"]] })).toThrow(
      /expected 2/,
    );
    expect(() =>
      spreadsheetServer.configSchema.parse({ prompt: "x", columns: ["a"], rows: [[{ input: "a" }], [{ input: "a" }]] }),
    ).toThrow(/duplicate/);
  });
});

describe("spreadsheet public config", () => {
  it("fills read-only cells and exposes inputs without points, labels or keys", () => {
    const pub = spreadsheetServer.toPublic(config, { variant, fill: (t) => t.replace("{{bank}}", "1,000.00") });
    expect(pub.rows[0][1]).toEqual({ kind: "text", text: "1,000.00", bold: undefined, align: "right" });
    expect(pub.rows[1][1]).toEqual({ kind: "input", id: "dit", format: "money" });
    expect(pub.rows[4]).toEqual([{ kind: "empty" }, { kind: "empty" }]);
    const json = JSON.stringify(pub);
    expect(json).not.toMatch(/"points"|"label"|tolerance|"value"|Deposits in transit/);
  });
});

describe("spreadsheet parseAnswer", () => {
  it("accepts numbers and nulls per cell", () => {
    expect(spreadsheetServer.parseAnswer({ cells: { dit: 250, adj: null } })).toEqual({ cells: { dit: 250, adj: null } });
    expect(spreadsheetServer.parseAnswer({ cells: {} })).toEqual({ cells: {} });
  });

  it.each([
    ["a string value", { cells: { dit: "250" } }],
    ["NaN", { cells: { dit: Number.NaN } }],
    ["a bad cell id", { cells: { "DIT!": 1 } }],
    ["cells as an array", { cells: [1, 2] }],
    ["missing cells", {}],
    ["extra keys", { cells: {}, total: 3 }],
    ["too many cells", { cells: Object.fromEntries(Array.from({ length: 501 }, (_, i) => [`c${i}`, 1])) }],
    ["null", null],
  ])("rejects %s", (_, raw) => {
    expect(() => spreadsheetServer.parseAnswer(raw)).toThrow();
  });
});

describe("spreadsheet score", () => {
  it("gives full marks when every keyed cell is right", () => {
    expect(score({ dit: 250, adj: 1250 })).toMatchObject({ points: 3, maxPoints: 3 });
  });

  it("gives partial credit per cell, with expected values in the notes", () => {
    const s = score({ dit: 205, adj: 1250.6, scratch: 99 });
    expect(s).toMatchObject({ points: 2, maxPoints: 3 });
    expect(s.items.map((i) => [i.id, i.label, i.earned, i.max])).toEqual([
      ["dit", "Deposits in transit", 0, 1],
      ["adj", "Adjusted", 2, 2], // within its own 1.00 tolerance
    ]);
    expect(s.items[0].note).toBe("Answered 205.00, expected 250.00.");
  });

  it("uses the default tolerance and isn't tripped by float noise", () => {
    expect(score({ dit: 250.004, adj: 1250 }).points).toBe(3);
    expect(score({ dit: 250.01, adj: 1250 }).points).toBe(2);
    expect(
      spreadsheetServer.score({
        config,
        key: spreadsheetServer.keySchema.parse({ cells: { dit: { value: 0.3 } } }),
        variant,
        answer: { cells: { dit: 0.1 + 0.2 } },
      }).points,
    ).toBe(1);
  });

  it("scores unanswered and cleared cells as zero", () => {
    const s = score(undefined);
    expect(s).toMatchObject({ points: 0, maxPoints: 3 });
    expect(s.items[1].note).toBe("Not answered. Expected 1,250.00.");
    expect(score({ dit: null }).points).toBe(0);
  });

  it("throws when the key names a cell the grid doesn't have", () => {
    const bad = spreadsheetServer.keySchema.parse({ cells: { nope: { value: 1 } } });
    expect(() => spreadsheetServer.score({ config, key: bad, variant, answer: undefined })).toThrow(/unknown input cell/);
  });

  it("rejects empty or malformed keys", () => {
    expect(() => spreadsheetServer.keySchema.parse({ cells: {} })).toThrow();
    expect(() => spreadsheetServer.keySchema.parse({ cells: { dit: 250 } })).toThrow();
  });
});

describe("parseCellInput", () => {
  it.each([
    ["1,234.50", 1234.5],
    ["$ 1,234.50", 1234.5],
    ["(1,200.00)", -1200],
    ["-35", -35],
    [".5", 0.5],
    ["12.", 12],
    ["", null],
    ["  ", null],
    ["abc", null],
    ["1.2.3", null],
    ["(", null],
    ["-", null],
  ])("%j -> %j", (input, expected) => {
    expect(parseCellInput(input)).toBe(expected);
  });
});
