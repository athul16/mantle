/** Display helpers for the jobs and assessments pages. No database. */
import { describe, expect, it, vi } from "vitest";
import { STEP_LABELS, roleFamilyLabel, simulationName } from "@/app/app/[orgSlug]/jobs/format";

vi.mock("server-only", () => ({}));

const { listServerStepTypes } = await import("@/lib/engine/server/registry");

describe("STEP_LABELS", () => {
  it("has a label for every registered step type", () => {
    for (const type of listServerStepTypes()) expect(STEP_LABELS[type], type).toBeTruthy();
  });

  it("calls ordering steps Ordering", () => {
    expect(STEP_LABELS.ordering).toBe("Ordering");
  });
});

describe("simulationName and roleFamilyLabel", () => {
  it("drop the version suffix and capitalize the family", () => {
    expect(simulationName("Diaz intake to demand (v1)")).toBe("Diaz intake to demand");
    expect(roleFamilyLabel("legal")).toBe("Legal");
  });
});
