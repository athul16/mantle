import { describe, expect, it } from "vitest";
import { MONITORING_CONSENT_VERSION, monitoringNotice } from "@/lib/proctoring/config";

describe("monitoring notice retention line", () => {
  it("states the org's media and results periods", () => {
    const text = monitoringNotice({ camera: true, screen: false, mediaRetentionDays: 60, resultsRetentionDays: 200 }, "Acme").join("\n");
    expect(text).toContain("photos and screenshots are kept for 60 days after your assessment ends");
    expect(text).toContain("answers, results and the hiring team's notes are kept for 200 days");
    expect(text).not.toMatch(/kept with your application and deleted when/);
  });

  it("falls back to the default periods when none are given", () => {
    const text = monitoringNotice({ camera: true, screen: true }, "Acme").join("\n");
    expect(text).toContain("kept for 90 days");
    expect(text).toContain("kept for 365 days");
  });

  it("has a new consent version for the two-period wording", () => {
    expect(MONITORING_CONSENT_VERSION).not.toBe("2026-11-10.retention");
  });
});
