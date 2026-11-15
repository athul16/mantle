import { describe, expect, it } from "vitest";
import { MONITORING_CONSENT_VERSION, monitoringNotice } from "@/lib/proctoring/config";

const OFF = { camera: false, screen: false, fullscreen: false, microphone: false, gaze: false };

describe("monitoring notice retention line", () => {
  it("states the org's media and results periods", () => {
    const text = monitoringNotice({ ...OFF, camera: true, mediaRetentionDays: 60, resultsRetentionDays: 200 }, "Acme").join("\n");
    expect(text).toContain("photos and screenshots are kept for 60 days after your assessment ends");
    expect(text).toContain("answers, results and the hiring team's notes are kept for 200 days");
    expect(text).not.toMatch(/kept with your application and deleted when/);
  });

  it("names audio clips in the media period when the microphone is on", () => {
    const text = monitoringNotice({ ...OFF, microphone: true, mediaRetentionDays: 60 }, "Acme").join("\n");
    expect(text).toMatch(/audio clips are kept for 60 days after your assessment ends/);
  });

  it("falls back to the default periods when none are given", () => {
    const text = monitoringNotice({ ...OFF, camera: true, screen: true }, "Acme").join("\n");
    expect(text).toContain("kept for 90 days");
    expect(text).toContain("kept for 365 days");
  });

  it("has a new consent version for the two-period wording", () => {
    expect(MONITORING_CONSENT_VERSION).not.toBe("2026-11-10.retention");
  });
});
