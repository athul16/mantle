import { describe, expect, it } from "vitest";
import { monitoringNotice } from "@/lib/proctoring/config";

describe("monitoring notice retention line", () => {
  it("says how many days the org keeps the data", () => {
    const text = monitoringNotice({ camera: true, screen: false, retentionDays: 90 }, "Acme").join("\n");
    expect(text).toContain("kept for 90 days");
    expect(text).not.toMatch(/kept with your application and deleted when/);
  });

  it("falls back to the default retention when none is given", () => {
    const text = monitoringNotice({ camera: true, screen: true }, "Acme").join("\n");
    expect(text).toContain("kept for 180 days");
  });
});
