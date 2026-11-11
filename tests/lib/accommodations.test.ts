import { describe, expect, it } from "vitest";
import {
  NO_ACCOMMODATIONS,
  applyWaivers,
  describeAccommodations,
  effectiveTimeLimitMinutes,
  hasAccommodations,
  readAccommodations,
} from "@/lib/accommodations";
import { parseContactEmail, readContactEmail } from "@/lib/org-settings";
import { accommodationLine, monitoringNotice } from "@/lib/proctoring/config";
import { buildTimeline } from "@/lib/results/summary";

describe("extra time", () => {
  it("adds the percent to the time limit, rounding up for the candidate", () => {
    expect(effectiveTimeLimitMinutes(30, 0)).toBe(30);
    expect(effectiveTimeLimitMinutes(30, 25)).toBe(38); // 37.5 → 38
    expect(effectiveTimeLimitMinutes(30, 50)).toBe(45);
    expect(effectiveTimeLimitMinutes(30, 100)).toBe(60);
    expect(effectiveTimeLimitMinutes(15, 25)).toBe(19); // 18.75 → 19
  });
});

describe("readAccommodations", () => {
  it("maps a row and treats a missing row as none", () => {
    expect(readAccommodations(null)).toEqual(NO_ACCOMMODATIONS);
    expect(readAccommodations({ extra_time_percent: 50, waive_camera: true, waive_screen: false })).toEqual({
      extraTimePercent: 50,
      waiveCamera: true,
      waiveScreen: false,
    });
  });

  it("ignores a percent outside the allowed set", () => {
    expect(readAccommodations({ extra_time_percent: 33, waive_camera: false, waive_screen: false }).extraTimePercent).toBe(0);
  });
});

describe("waivers", () => {
  it("turn off only the waived source, and never turn one on", () => {
    const a = { extraTimePercent: 0, waiveCamera: true, waiveScreen: false } as const;
    expect(applyWaivers({ camera: true, screen: true, retentionDays: 90 }, a)).toEqual({ camera: false, screen: true, retentionDays: 90 });
    expect(applyWaivers({ camera: false, screen: false }, NO_ACCOMMODATIONS)).toEqual({ camera: false, screen: false });
  });
});

describe("describeAccommodations", () => {
  it("lists what was granted", () => {
    expect(describeAccommodations(NO_ACCOMMODATIONS)).toEqual([]);
    expect(hasAccommodations(NO_ACCOMMODATIONS)).toBe(false);
    const a = { extraTimePercent: 50, waiveCamera: true, waiveScreen: true } as const;
    expect(hasAccommodations(a)).toBe(true);
    expect(describeAccommodations(a, 30)).toEqual(["+50% time (30 → 45 min)", "camera waived", "screen share waived"]);
    expect(describeAccommodations(a)).toEqual(["+50% time", "camera waived", "screen share waived"]);
  });
});

describe("contact email setting", () => {
  it("reads only a valid email", () => {
    expect(readContactEmail({ contact_email: "careers@acme.test" })).toBe("careers@acme.test");
    expect(readContactEmail({ contact_email: "nope" })).toBeNull();
    expect(readContactEmail({})).toBeNull();
    expect(readContactEmail(null)).toBeNull();
  });

  it("parses form input; blank clears it", () => {
    expect(parseContactEmail(" Careers@Acme.TEST ")).toEqual({ ok: true, email: "careers@acme.test" });
    expect(parseContactEmail("")).toEqual({ ok: true, email: null });
    expect(parseContactEmail("not an email")).toMatchObject({ ok: false });
    expect(parseContactEmail(`${"a".repeat(250)}@b.co`)).toMatchObject({ ok: false });
  });
});

describe("monitoring notice contact line", () => {
  it("names the contact email when the company set one", () => {
    const text = monitoringNotice({ camera: true, screen: true, contactEmail: "careers@acme.test" }, "Acme").join("\n");
    expect(text).toContain("Contact Acme at careers@acme.test before you start");
    expect(text).toMatch(/extra time/);
  });

  it("falls back to the hiring team without one", () => {
    expect(accommodationLine("Acme", null)).toContain("Contact Acme's hiring team before you start");
  });
});

describe("report timeline", () => {
  it("shows the accommodations applied when the attempt started", () => {
    const at = "2026-11-11T10:00:00.000Z";
    const [line] = buildTimeline(
      [
        {
          at,
          kind: "started_attempt",
          payload: { deadlineAt: at, accommodations: { extraTimePercent: 25, waiveCamera: false, waiveScreen: true } },
        },
      ],
      { startedAt: at, stepTitles: {}, messageSubjects: {} },
    );
    expect(line.text).toBe("Started the assessment with accommodations: +25% time, screen share waived");
  });
});
