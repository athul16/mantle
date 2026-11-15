import { describe, expect, it } from "vitest";
import * as z from "zod";
import { MONITORING_NEEDS_SOURCE, createAssessmentSchema, updateAssessmentSchema } from "@/lib/jobs/schemas";

// The proctoring choice is validated on the server, not only by the form's
// required radio: no choice is an error, and Not monitored turns both sources off.

const ORG = "11111111-1111-4111-8111-111111111111";
const SCENARIO = "22222222-2222-4222-8222-222222222222";
const base = { orgId: ORG, scenarioId: SCENARIO, title: "AP screen", timeLimitMinutes: "45", passScore: "" };

const errorsOf = (input: Record<string, string>) => {
  const r = createAssessmentSchema.safeParse(input);
  return r.success ? null : z.flattenError(r.error).fieldErrors;
};

describe("assessment proctoring choice", () => {
  it("rejects a missing choice", () => {
    expect(errorsOf(base)?.monitoring).toEqual(["Choose whether candidates are monitored."]);
    expect(errorsOf({ ...base, camera: "on", screen: "on" })?.monitoring).toEqual(["Choose whether candidates are monitored."]);
  });

  it("rejects an unknown choice", () => {
    expect(errorsOf({ ...base, monitoring: "yes" })?.monitoring).toEqual(["Choose whether candidates are monitored."]);
  });

  it("rejects Monitored with neither camera nor screen", () => {
    expect(errorsOf({ ...base, monitoring: "monitored" })?.monitoring).toEqual([MONITORING_NEEDS_SOURCE]);
  });

  it("accepts Monitored with camera, screen or both", () => {
    expect(createAssessmentSchema.parse({ ...base, monitoring: "monitored", camera: "on" })).toMatchObject({ camera: true, screen: false });
    expect(createAssessmentSchema.parse({ ...base, monitoring: "monitored", screen: "on" })).toMatchObject({ camera: false, screen: true });
    expect(createAssessmentSchema.parse({ ...base, monitoring: "monitored", camera: "on", screen: "on" })).toMatchObject({ camera: true, screen: true });
  });

  it("turns both sources off for Not monitored, whatever else was sent", () => {
    expect(createAssessmentSchema.parse({ ...base, monitoring: "not_monitored", camera: "on", screen: "on" })).toMatchObject({
      camera: false,
      screen: false,
    });
  });

  it("applies the same rules when editing", () => {
    const edit = { orgId: ORG, assessmentId: SCENARIO, title: "AP screen", timeLimitMinutes: "45", passScore: "" };
    expect(updateAssessmentSchema.safeParse(edit).success).toBe(false);
    expect(updateAssessmentSchema.parse({ ...edit, monitoring: "not_monitored", camera: "on" })).toMatchObject({ camera: false, screen: false });
  });
});
