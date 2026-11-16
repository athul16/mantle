import { describe, expect, it, vi } from "vitest";
import type { ScenarioDefinition } from "@/lib/engine/types";

vi.mock("server-only", () => ({}));
const { resolveFlow, resolveItems, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { listScenarios } = await import("@/lib/engine/scenarios");

const MIN = 60_000;
const t0 = Date.parse("2026-11-16T10:00:00Z");

/** Three sections: one open step, two one-at-a-time screens, one closing step. */
const def: ScenarioDefinition = {
  intro: "",
  steps: [
    { id: "a", type: "numeric", title: "A", config: {} },
    { id: "b", type: "numeric", title: "B", config: {}, seconds: 60 },
    { id: "c", type: "numeric", title: "C", config: {}, seconds: 60 },
    { id: "d", type: "numeric", title: "D", config: {} },
  ],
  messages: [
    { id: "m-start", from: "x", subject: "s", body: "b" },
    { id: "m-d", from: "x", subject: "s", body: "b", stepId: "d" },
    { id: "m-d-late", from: "x", subject: "s", body: "b", stepId: "d", arriveAtMinute: 0.5 },
  ],
  sections: [
    { id: "s1", title: "Quick", minutes: 2, stepIds: ["a"] },
    { id: "s2", title: "Screens", minutes: 3, stepIds: ["b", "c"], oneAtATime: true },
    { id: "s3", title: "Wrap up", minutes: 1, stepIds: ["d"] },
  ],
};

const flowAt = (ms: number, events: Parameters<typeof resolveFlow>[1]["events"] = [], extraTimePercent = 0) =>
  resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent, events });

describe("resolveFlow: timed sections", () => {
  it("starts in the first section with only its steps visible", () => {
    const f = flowAt(0);
    expect(f.done).toBe(false);
    expect(f.section).toEqual({ id: "s1", title: "Quick", index: 0, count: 3, startedAt: t0, endsAt: t0 + 2 * MIN });
    expect(f.visibleStepIds).toEqual(["a"]);
    expect(f.screen).toBeUndefined();
  });

  it("moves to the next section when time runs out; earlier steps are locked", () => {
    const f = flowAt(2 * MIN);
    expect(f.section?.id).toBe("s2");
    expect(f.visibleStepIds).not.toContain("a");
  });

  it("finishing a section early starts the next one then", () => {
    const f = flowAt(30_000, [{ kind: "advanced_section", sectionId: "s1", at: t0 + 20_000 }]);
    expect(f.section).toMatchObject({ id: "s2", startedAt: t0 + 20_000, endsAt: t0 + 20_000 + 3 * MIN });
  });

  it("one-at-a-time sections show a single screen with its own deadline", () => {
    const f = flowAt(2 * MIN + 10_000);
    expect(f.visibleStepIds).toEqual(["b"]);
    expect(f.screen).toEqual({ stepId: "b", index: 0, count: 2, startedAt: t0 + 2 * MIN, endsAt: t0 + 3 * MIN });
    const next = flowAt(3 * MIN + 1_000);
    expect(next.visibleStepIds).toEqual(["c"]);
    expect(next.screen?.index).toBe(1);
  });

  it("'next screen' moves on early", () => {
    const f = flowAt(2 * MIN + 10_000, [{ kind: "advanced_screen", stepId: "b", at: t0 + 2 * MIN + 5_000 }]);
    expect(f.screen).toMatchObject({ stepId: "c", startedAt: t0 + 2 * MIN + 5_000, endsAt: t0 + 3 * MIN + 5_000 });
  });

  it("a one-at-a-time section ends when its last screen ends, so nobody waits on an empty section", () => {
    // Section 2 starts at 2 min; its two 60s screens are over at 4 min, before its 3 minutes are up.
    const f = flowAt(4 * MIN + 1_000);
    expect(f.section).toMatchObject({ id: "s3", startedAt: t0 + 4 * MIN, endsAt: t0 + 5 * MIN });
  });

  it("screens are cut short when the section's own time runs out first", () => {
    const tight: ScenarioDefinition = { ...def, sections: def.sections!.map((s) => (s.id === "s2" ? { ...s, minutes: 1.5 } : s)) };
    const f = resolveFlow(tight, { startedAt: t0, now: t0 + 3 * MIN + 10_000, extraTimePercent: 0, events: [] });
    expect(f.screen).toMatchObject({ stepId: "c", endsAt: t0 + 3.5 * MIN });
  });

  it("is done after the last section", () => {
    const f = flowAt(6 * MIN);
    expect(f.done).toBe(true);
    expect(f.section).toBeUndefined();
    expect(f.visibleStepIds).toEqual([]);
    expect(f.startedSectionIds).toEqual(["s1", "s2", "s3"]);
  });

  it("extra time stretches every section and screen by the same percent", () => {
    const f = flowAt(2 * MIN + 10_000, [], 50);
    expect(f.section).toMatchObject({ id: "s1", endsAt: t0 + 3 * MIN });
    const s2 = flowAt(3 * MIN + 1_000, [], 50);
    expect(s2.screen).toMatchObject({ stepId: "b", endsAt: t0 + 3 * MIN + 90_000 });
  });

  it("ignores advance events for a section or screen that isn't current", () => {
    const f = flowAt(10_000, [
      { kind: "advanced_section", sectionId: "s2", at: t0 + 5_000 },
      { kind: "advanced_screen", stepId: "c", at: t0 + 5_000 },
    ]);
    expect(f.section?.id).toBe("s1");
  });

  it("without sections every step is visible (old behaviour)", () => {
    const plain = { ...def, sections: undefined };
    const f = resolveFlow(plain, { startedAt: t0, now: t0 + 99 * MIN, extraTimePercent: 0, events: [] });
    expect(f.done).toBe(false);
    expect(f.visibleStepIds).toEqual(["a", "b", "c", "d"]);
  });
});

describe("visibleMessageIds", () => {
  it("messages linked to a step arrive relative to that step's section start", () => {
    expect(visibleMessageIds(def, flowAt(0), t0, t0)).toEqual(["m-start"]);
    // Section 3 starts at 4 min (section 2's screens finish early).
    const inS3 = flowAt(4 * MIN + 10_000);
    expect(inS3.section?.id).toBe("s3");
    expect(visibleMessageIds(def, inS3, t0, t0 + 4 * MIN + 10_000)).toEqual(["m-start", "m-d"]);
    expect(visibleMessageIds(def, inS3, t0, t0 + 4 * MIN + 30_000)).toEqual(["m-start", "m-d", "m-d-late"]);
  });
});

describe("resolveItems: rapid items inside a step", () => {
  const base = { stepStartedAt: t0, stepEndsAt: t0 + 2 * MIN, count: 3, secondsPerItem: 20, extraTimePercent: 0 };

  it("one item at a time, each with its own deadline", () => {
    expect(resolveItems({ ...base, answeredAt: {}, now: t0 + 1_000 })).toEqual({ index: 0, startedAt: t0, endsAt: t0 + 20_000, done: false });
    expect(resolveItems({ ...base, answeredAt: {}, now: t0 + 21_000 }).index).toBe(1);
  });

  it("an answer moves straight on to the next item", () => {
    expect(resolveItems({ ...base, answeredAt: { 0: t0 + 4_000 }, now: t0 + 5_000 })).toEqual({
      index: 1,
      startedAt: t0 + 4_000,
      endsAt: t0 + 24_000,
      done: false,
    });
  });

  it("extra time stretches each item", () => {
    expect(resolveItems({ ...base, extraTimePercent: 25, answeredAt: {}, now: t0 }).endsAt).toBe(t0 + 25_000);
  });

  it("an item never outlives its step", () => {
    const r = resolveItems({ ...base, stepEndsAt: t0 + 30_000, answeredAt: { 0: t0 + 15_000 }, now: t0 + 16_000 });
    expect(r.endsAt).toBe(t0 + 30_000);
    expect(resolveItems({ ...base, stepEndsAt: t0 + 30_000, answeredAt: {}, now: t0 + 30_000 }).done).toBe(true);
  });
});

describe("validateSections", () => {
  it("accepts a well-formed definition", () => {
    expect(validateSections(def, 10)).toEqual([]);
  });

  it("reports steps outside or in two sections, overlong sections and missing screen limits", () => {
    const bad: ScenarioDefinition = {
      ...def,
      steps: [...def.steps.map((s) => (s.id === "c" ? { ...s, seconds: undefined } : s)), { id: "e", type: "numeric", title: "E", config: {} }],
      sections: [...def.sections!, { id: "s4", title: "Again", minutes: 9, stepIds: ["a"] }],
    };
    const errors = validateSections(bad, 10).join("\n");
    expect(errors).toMatch(/"e" is in no section/);
    expect(errors).toMatch(/"a" is in more than one section/);
    expect(errors).toMatch(/longer than the 10 minute limit/);
    expect(errors).toMatch(/"c" needs seconds/);
  });

  it("every code-defined scenario with sections is valid", () => {
    const withSections = listScenarios().filter((s) => s.definition.sections);
    expect(withSections.length).toBeGreaterThan(0);
    for (const s of withSections) expect(validateSections(s.definition, s.timeLimitMinutes), s.slug).toEqual([]);
  });
});
