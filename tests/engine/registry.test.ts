import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { getServerStepType, listServerStepTypes } = await import("@/lib/engine/server/registry");
const { clientStepTypes, hasStepComponent } = await import("@/lib/engine/client/registry");
const { listScenarios, getScenario } = await import("@/lib/engine/scenarios");

describe("step type registries", () => {
  it("looks up numeric on both sides", () => {
    expect(getServerStepType("numeric").type).toBe("numeric");
    expect(hasStepComponent("numeric")).toBe(true);
  });

  it("throws on unknown server types and reports missing client types", () => {
    expect(() => getServerStepType("nope")).toThrow(/unknown step type/);
    expect(hasStepComponent("nope")).toBe(false);
  });

  it("server and client registries list the same types", () => {
    expect(listServerStepTypes().sort()).toEqual(Object.keys(clientStepTypes).sort());
  });
});

describe("scenario registry", () => {
  it("finds scenarios by slug and version", () => {
    expect(getScenario("demo-petty-cash", 1).title).toMatch(/petty cash/i);
    expect(() => getScenario("demo-petty-cash", 99)).toThrow(/unknown scenario/);
  });

  for (const scenario of listScenarios()) {
    it(`${scenario.slug}@v${scenario.version} is internally consistent`, () => {
      const stepIds = new Set(scenario.definition.steps.map((s) => s.id));
      expect(stepIds.size).toBe(scenario.definition.steps.length);

      for (const m of scenario.definition.messages) {
        if (m.stepId) expect(stepIds.has(m.stepId), `message ${m.id} -> ${m.stepId}`).toBe(true);
      }

      const variant = scenario.generate("consistency-check");
      for (const step of scenario.definition.steps) {
        const stepType = getServerStepType(step.type);
        expect(hasStepComponent(step.type), `client component for ${step.type}`).toBe(true);
        expect(() => stepType.configSchema.parse(step.config), `config of ${step.id}`).not.toThrow();
        expect(() => stepType.keySchema.parse(variant.keys[step.id]), `key of ${step.id}`).not.toThrow();
      }
    });
  }
});
