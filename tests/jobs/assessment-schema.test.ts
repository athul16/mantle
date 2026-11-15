import { describe, expect, it } from "vitest";
import * as z from "zod";
import { MONITORING_NEEDS_SOURCE, accommodationsSchema, createAssessmentSchema, readProctoring, updateAssessmentSchema } from "@/lib/jobs/schemas";

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

  it("accepts Monitored with only the microphone", () => {
    expect(createAssessmentSchema.parse({ ...base, monitoring: "monitored", microphone: "on" })).toMatchObject({
      camera: false,
      screen: false,
      microphone: true,
    });
  });

  it("does not count full screen or gaze alone as monitored", () => {
    expect(errorsOf({ ...base, monitoring: "monitored", fullscreen: "on" })?.monitoring).toEqual([MONITORING_NEEDS_SOURCE]);
    expect(errorsOf({ ...base, monitoring: "monitored", gaze: "on" })?.monitoring).toEqual([MONITORING_NEEDS_SOURCE]);
    expect(MONITORING_NEEDS_SOURCE).toBe("Pick camera snapshots, screen share, microphone or more.");
  });

  it("reads full screen, microphone and gaze, and drops gaze without the camera", () => {
    expect(
      createAssessmentSchema.parse({ ...base, monitoring: "monitored", camera: "on", fullscreen: "on", microphone: "on", gaze: "on" }),
    ).toMatchObject({ camera: true, screen: false, fullscreen: true, microphone: true, gaze: true });
    expect(createAssessmentSchema.parse({ ...base, monitoring: "monitored", screen: "on", gaze: "on" })).toMatchObject({
      screen: true,
      gaze: false,
    });
  });

  it("turns everything off for Not monitored", () => {
    expect(
      createAssessmentSchema.parse({
        ...base,
        monitoring: "not_monitored",
        camera: "on",
        screen: "on",
        fullscreen: "on",
        microphone: "on",
        gaze: "on",
      }),
    ).toMatchObject({ camera: false, screen: false, fullscreen: false, microphone: false, gaze: false });
  });

  it("reads stored settings with the new fields, defaulting to off", () => {
    expect(readProctoring({ camera: true, screen: true })).toEqual({ camera: true, screen: true, fullscreen: false, microphone: false, gaze: false });
    expect(readProctoring({ screen: true, gaze: true, microphone: true })).toEqual({
      camera: false,
      screen: true,
      fullscreen: false,
      microphone: true,
      gaze: false,
    });
  });

  it("applies the same rules when editing", () => {
    const edit = { orgId: ORG, assessmentId: SCENARIO, title: "AP screen", timeLimitMinutes: "45", passScore: "" };
    expect(updateAssessmentSchema.safeParse(edit).success).toBe(false);
    expect(updateAssessmentSchema.parse({ ...edit, monitoring: "not_monitored", camera: "on" })).toMatchObject({ camera: false, screen: false });
  });
});

describe("accommodations form", () => {
  it("reads the full screen and microphone waivers", () => {
    const form = { orgId: ORG, inviteId: SCENARIO, extraTimePercent: "0" };
    expect(accommodationsSchema.parse(form)).toMatchObject({ waiveFullscreen: false, waiveMicrophone: false });
    expect(accommodationsSchema.parse({ ...form, waiveFullscreen: "on", waiveMicrophone: "on" })).toMatchObject({
      waiveFullscreen: true,
      waiveMicrophone: true,
    });
  });
});
