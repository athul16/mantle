import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { multipleChoiceServer } = await import("@/lib/engine/step-types/multiple_choice/server");
const { getServerStepType } = await import("@/lib/engine/server/registry");
const { hasStepComponent, stepBrief } = await import("@/lib/engine/client/registry");
const { STEP_LABELS } = await import("@/app/app/[orgSlug]/jobs/format");

const OPTIONS = [
  { id: "cash", label: "Cash" },
  { id: "ar", label: "Accounts receivable" },
  { id: "ap", label: "Accounts payable" },
  { id: "rev", label: "Revenue of {{client}}" },
];
const single = multipleChoiceServer.configSchema.parse({ prompt: "Which account does {{client}} debit?", options: OPTIONS, points: 2 });
const multi = multipleChoiceServer.configSchema.parse({ prompt: "Which are assets?", options: OPTIONS, select: "multi", points: 3 });
const variant = { values: { client: "Harbor Lane" }, keys: {} };
const fill = (t: string) => t.replaceAll("{{client}}", "Harbor Lane");

const singleKey = multipleChoiceServer.keySchema.parse({ correct: ["ar"] });
const multiKey = multipleChoiceServer.keySchema.parse({ correct: ["cash", "ar"] });
const scoreSingle = (selected?: string[]) =>
  multipleChoiceServer.score({ config: single, key: singleKey, variant, answer: selected && multipleChoiceServer.parseAnswer({ selected }) });
const scoreMulti = (selected?: string[]) =>
  multipleChoiceServer.score({ config: multi, key: multiKey, variant, answer: selected && multipleChoiceServer.parseAnswer({ selected }) });

describe("multiple_choice registration", () => {
  it("is registered on the server and in the browser, with a library label", () => {
    expect(getServerStepType("multiple_choice")).toBe(multipleChoiceServer);
    expect(hasStepComponent("multiple_choice")).toBe(true);
    expect(STEP_LABELS.multiple_choice).toBe("Multiple choice");
  });

  it("keeps its prompt on its own card (the prompt is the question)", () => {
    expect(stepBrief({ type: "multiple_choice", config: { prompt: "Which?" } })).toBeNull();
  });
});

describe("multiple_choice config and key", () => {
  it("defaults to single select and 1 point", () => {
    const c = multipleChoiceServer.configSchema.parse({ prompt: "Q", options: OPTIONS.slice(0, 2) });
    expect(c).toMatchObject({ select: "single", points: 1 });
  });

  it.each([
    ["one option", { prompt: "Q", options: [OPTIONS[0]] }],
    ["duplicate option ids", { prompt: "Q", options: [OPTIONS[0], OPTIONS[0]] }],
    ["a bad option id", { prompt: "Q", options: [{ id: "Cash!", label: "Cash" }, OPTIONS[1]] }],
    ["an unknown select mode", { prompt: "Q", options: OPTIONS, select: "some" }],
    ["an empty prompt", { prompt: "", options: OPTIONS }],
  ])("rejects %s", (_, raw) => {
    expect(() => multipleChoiceServer.configSchema.parse(raw)).toThrow();
  });

  it("throws when the key doesn't fit the config", () => {
    const run = (config: typeof single, k: unknown) => () =>
      multipleChoiceServer.score({ config, key: multipleChoiceServer.keySchema.parse(k), variant, answer: undefined });
    expect(run(single, { correct: ["nope"] })).toThrow(/unknown option "nope"/);
    expect(run(single, { correct: ["cash", "ar"] })).toThrow(/exactly one correct option/);
    expect(run(multi, { correct: ["cash", "cash"] })).toThrow(/unique/);
    expect(() => multipleChoiceServer.keySchema.parse({ correct: [] })).toThrow();
  });
});

describe("multiple_choice public config", () => {
  it("fills templates and carries no key or points", () => {
    const pub = multipleChoiceServer.toPublic(single, { variant, fill });
    expect(pub).toEqual({
      prompt: "Which account does Harbor Lane debit?",
      options: [...OPTIONS.slice(0, 3), { id: "rev", label: "Revenue of Harbor Lane" }],
      select: "single",
    });
    expect(JSON.stringify(pub)).not.toMatch(/correct|points/);
  });
});

describe("multiple_choice parseAnswer", () => {
  it("accepts a list of option ids", () => {
    expect(multipleChoiceServer.parseAnswer({ selected: ["cash", "ar"] })).toEqual({ selected: ["cash", "ar"] });
    expect(multipleChoiceServer.parseAnswer({ selected: [] })).toEqual({ selected: [] });
  });

  it.each([
    ["a missing list", {}],
    ["a number", { selected: [1] }],
    ["a bad id", { selected: ["Cash!"] }],
    ["the same option twice", { selected: ["cash", "cash"] }],
    ["too many picks", { selected: Array.from({ length: 21 }, (_, i) => `o${i}`) }],
    ["an extra field", { selected: [], score: 1 }],
  ])("rejects %s", (_, raw) => {
    expect(() => multipleChoiceServer.parseAnswer(raw)).toThrow();
  });
});

describe("multiple_choice scoring, single select", () => {
  it("full points for the right option", () => {
    const s = scoreSingle(["ar"]);
    expect(s).toMatchObject({ points: 2, maxPoints: 2 });
    expect(s.items).toEqual([{ id: "answer", label: "Answer", earned: 2, max: 2, note: 'Chose "Accounts receivable".' }]);
  });

  it("nothing for a wrong option, with what was expected", () => {
    const s = scoreSingle(["cash"]);
    expect(s.points).toBe(0);
    expect(s.items[0].note).toBe('Chose "Cash". Expected "Accounts receivable".');
  });

  it("nothing for no answer or an empty pick", () => {
    expect(scoreSingle(undefined).items[0]).toMatchObject({ earned: 0, note: 'Not answered. Expected "Accounts receivable".' });
    expect(scoreSingle([]).items[0]).toMatchObject({ earned: 0, note: 'Not answered. Expected "Accounts receivable".' });
  });

  it("exact only: the right option plus another earns nothing", () => {
    expect(scoreSingle(["ar", "cash"]).points).toBe(0);
  });

  it("ignores ids that aren't options", () => {
    expect(scoreSingle(["ar", "zzz"]).points).toBe(2);
  });
});

describe("multiple_choice scoring, multi select", () => {
  it("full points for exactly the right options, in any order", () => {
    expect(scoreMulti(["ar", "cash"])).toMatchObject({ points: 3, maxPoints: 3 });
    expect(scoreMulti(["ar", "cash"]).items[0].note).toBe("All 2 right options, no wrong picks.");
  });

  it("per-option credit for some of the right options", () => {
    const s = scoreMulti(["cash"]);
    expect(s.points).toBe(1.5);
    expect(s.items[0].note).toBe('1 of 2 right options, no wrong picks. Expected "Cash", "Accounts receivable".');
  });

  it("each wrong pick costs a share of the points", () => {
    // 2 right options earn 1/2 each, 2 wrong options cost 1/2 each.
    expect(scoreMulti(["cash", "ar", "ap"]).points).toBe(1.5);
    expect(scoreMulti(["cash", "ar", "ap"]).items[0].note).toBe(
      '2 of 2 right options, 1 wrong pick ("Accounts payable"). Expected "Cash", "Accounts receivable".',
    );
    expect(scoreMulti(["cash", "ap"]).points).toBe(0);
  });

  it("picking everything earns nothing, and the score never goes below 0", () => {
    expect(scoreMulti(["cash", "ar", "ap", "rev"]).points).toBe(0);
    const s = scoreMulti(["ap", "rev"]);
    expect(s.points).toBe(0);
    expect(s.items[0].earned).toBe(0);
  });

  it("no answer earns nothing", () => {
    expect(scoreMulti(undefined).items[0]).toMatchObject({ earned: 0, note: 'Not answered. Expected "Cash", "Accounts receivable".' });
  });

  it("when every option is right, there is nothing to cost", () => {
    const all = multipleChoiceServer.configSchema.parse({ prompt: "Q", options: OPTIONS.slice(0, 2), select: "multi", points: 2 });
    const k = multipleChoiceServer.keySchema.parse({ correct: ["cash", "ar"] });
    expect(multipleChoiceServer.score({ config: all, key: k, variant, answer: { selected: ["cash"] } }).points).toBe(1);
  });

  it("rounds to cents of a point", () => {
    const three = multipleChoiceServer.keySchema.parse({ correct: ["cash", "ar", "rev"] });
    const s = multipleChoiceServer.score({ config: { ...multi, points: 1 }, key: three, variant, answer: { selected: ["cash"] } });
    expect(s.points).toBe(0.33);
    expect(s.items[0].earned).toBe(0.33);
  });
});
