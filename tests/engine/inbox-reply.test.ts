import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { inboxReplyServer, rubricRequest } = await import("@/lib/engine/step-types/inbox_reply/server");
const { applyRubricResults } = await import("@/lib/engine/step-types/inbox_reply/rubric");

const config = inboxReplyServer.configSchema.parse({
  prompt: "Reply to {{name}}.",
  to: "{{name}}",
  subject: "Re: balance",
  criteria: [
    { id: "timing", label: "Timing", maxPoints: 3, guidance: "Explains timing items." },
    { id: "fee", label: "Fee", maxPoints: 2, guidance: "Mentions the {{fee|money}} fee." },
  ],
});
const variant = { values: { name: "Marcus", fee: 3500 }, keys: {} };
const key = inboxReplyServer.keySchema.parse({ notes: { timing: "DIT $1,000.00" } });
const fill = (t: string) => t.replace("{{name}}", "Marcus");

describe("inbox_reply config", () => {
  it("defaults maxChars and rejects duplicate or missing criteria", () => {
    expect(config.maxChars).toBe(5000);
    expect(() =>
      inboxReplyServer.configSchema.parse({
        prompt: "x",
        criteria: [
          { id: "a", label: "A", maxPoints: 1, guidance: "g" },
          { id: "a", label: "B", maxPoints: 1, guidance: "g" },
        ],
      }),
    ).toThrow(/unique/);
    expect(() => inboxReplyServer.configSchema.parse({ prompt: "x", criteria: [] })).toThrow();
    expect(() => inboxReplyServer.configSchema.parse({ prompt: "x", maxChars: 50_000, criteria: config.criteria })).toThrow();
  });

  it("key is optional", () => {
    expect(inboxReplyServer.keySchema.parse(undefined)).toEqual({ notes: {} });
  });
});

describe("inbox_reply public config", () => {
  it("never carries the rubric", () => {
    const pub = inboxReplyServer.toPublic(config, { variant, fill });
    expect(Object.keys(pub).sort()).toEqual(["maxChars", "prompt", "subject", "to"]);
    expect(pub).toMatchObject({ prompt: "Reply to Marcus.", to: "Marcus", maxChars: 5000 });
    const json = JSON.stringify(pub);
    for (const c of config.criteria) {
      expect(json).not.toContain(c.guidance);
      expect(json).not.toContain(c.label);
    }
  });
});

describe("inbox_reply parseAnswer", () => {
  it("accepts a body, including an empty one", () => {
    expect(inboxReplyServer.parseAnswer({ body: "Hi Marcus" })).toEqual({ body: "Hi Marcus" });
    expect(inboxReplyServer.parseAnswer({ body: "" })).toEqual({ body: "" });
  });

  it.each([
    ["a number body", { body: 12 }],
    ["missing body", {}],
    ["extra keys", { body: "hi", score: 9 }],
    ["an overlong body", { body: "x".repeat(20_001) }],
    ["a string", "hi"],
    ["null", null],
  ])("rejects %s", (_, raw) => {
    expect(() => inboxReplyServer.parseAnswer(raw)).toThrow();
  });
});

describe("inbox_reply score", () => {
  it("marks a written reply for review with 0 provisional points and one item per criterion", () => {
    const s = inboxReplyServer.score({ config, key, variant, answer: { body: "Hi Marcus, the difference is timing." } });
    expect(s).toMatchObject({ points: 0, maxPoints: 5, needsReview: true });
    expect(s.items.map((i) => [i.id, i.earned, i.max])).toEqual([
      ["timing", 0, 3],
      ["fee", 0, 2],
    ]);
    expect(s.items[0].note).toContain("Reference: DIT $1,000.00");
    expect(s.items[1].note).toContain("Mentions the $35.00 fee."); // guidance filled from the variant
  });

  it("scores blank or missing replies as a final 0", () => {
    for (const answer of [undefined, { body: "   \n " }]) {
      const s = inboxReplyServer.score({ config, key, variant, answer });
      expect(s).toMatchObject({ points: 0, maxPoints: 5, needsReview: false });
      expect(s.items.every((i) => i.note === "Not answered.")).toBe(true);
    }
  });

  it("rejects key notes for unknown criteria", () => {
    const bad = inboxReplyServer.keySchema.parse({ notes: { nope: "x" } });
    expect(() => inboxReplyServer.score({ config, key: bad, variant, answer: { body: "hi" } })).toThrow(/unknown criterion/);
  });
});

describe("rubric scorer seam", () => {
  const request = rubricRequest(config, key, variant.values, { body: "Hello" });

  it("builds a request with filled prompt and guidance", () => {
    expect(request.prompt).toBe("Reply to Marcus.");
    expect(request.reply).toBe("Hello");
    expect(request.criteria.map((c) => c.id)).toEqual(["timing", "fee"]);
    expect(request.criteria[0].reference).toBe("DIT $1,000.00");
  });

  it("applies scorer results with clamping and still needs review", () => {
    const s = applyRubricResults(request.criteria, [
      { id: "timing", earned: 7, reasoning: "Clear." },
      { id: "fee", earned: -1, reasoning: "Missing." },
    ]);
    expect(s).toMatchObject({ points: 3, maxPoints: 5, needsReview: true });
    expect(s.items.map((i) => i.earned)).toEqual([3, 0]);
  });

  it("scores skipped criteria 0 and rejects unknown ones", () => {
    const s = applyRubricResults(request.criteria, [{ id: "fee", earned: 1.5, reasoning: "Partly." }]);
    expect(s.points).toBe(1.5);
    expect(s.items[0].note).toMatch(/not scored/i);
    expect(() => applyRubricResults(request.criteria, [{ id: "nope", earned: 1, reasoning: "" }])).toThrow(/unknown criterion/);
  });
});
