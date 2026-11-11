import { describe, expect, it } from "vitest";
import {
  DEFAULT_MEDIA_RETENTION_DAYS,
  DEFAULT_RESULTS_RETENTION_DAYS,
  MAX_MEDIA_RETENTION_DAYS,
  MAX_RESULTS_RETENTION_DAYS,
  MEDIA_LONGER_ERROR,
  MIN_MEDIA_RETENTION_DAYS,
  MIN_RESULTS_RETENTION_DAYS,
  isPastRetention,
  parseRetention,
  readRetention,
  retainedUntil,
  retentionAnchor,
} from "@/lib/retention/policy";

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);

describe("retention settings", () => {
  it("has a 90-day media and 365-day results default inside their ranges", () => {
    expect(DEFAULT_MEDIA_RETENTION_DAYS).toBe(90);
    expect([MIN_MEDIA_RETENTION_DAYS, MAX_MEDIA_RETENTION_DAYS]).toEqual([30, 365]);
    expect(DEFAULT_RESULTS_RETENTION_DAYS).toBe(365);
    expect([MIN_RESULTS_RETENTION_DAYS, MAX_RESULTS_RETENTION_DAYS]).toEqual([30, 730]);
  });

  it("reads the org settings, falling back to the defaults", () => {
    expect(readRetention({ media_retention_days: 60, results_retention_days: 200 })).toEqual({ mediaDays: 60, resultsDays: 200 });
    expect(readRetention({})).toEqual({ mediaDays: 90, resultsDays: 365 });
    expect(readRetention(null)).toEqual({ mediaDays: 90, resultsDays: 365 });
    expect(readRetention({ media_retention_days: "60" })).toEqual({ mediaDays: 90, resultsDays: 365 });
    expect(readRetention({ media_retention_days: 5, results_retention_days: 9000 })).toEqual({ mediaDays: 90, resultsDays: 365 });
    // The old single setting is ignored (the migration converted it).
    expect(readRetention({ retention_days: 180 })).toEqual({ mediaDays: 90, resultsDays: 365 });
  });

  it("never reads media as longer than results", () => {
    expect(readRetention({ results_retention_days: 60 })).toEqual({ mediaDays: 60, resultsDays: 60 });
  });

  it("parses form input", () => {
    expect(parseRetention("90", "365")).toEqual({ ok: true, mediaDays: 90, resultsDays: 365 });
    expect(parseRetention(" 30 ", "30")).toEqual({ ok: true, mediaDays: 30, resultsDays: 30 });
    expect(parseRetention("365", "730")).toEqual({ ok: true, mediaDays: 365, resultsDays: 730 });
  });

  it("rejects media out of range", () => {
    for (const bad of ["29", "366", "", "abc", "90.5", "-1", null]) {
      const r = parseRetention(bad, "365");
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) {
        expect(r.fieldErrors.mediaRetentionDays?.[0]).toMatch(/30 to 365/);
        expect(r.fieldErrors.resultsRetentionDays).toBeUndefined();
      }
    }
  });

  it("rejects results out of range", () => {
    for (const bad of ["29", "731", "", "x", null]) {
      const r = parseRetention("90", bad);
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(r.fieldErrors.resultsRetentionDays?.[0]).toMatch(/30 to 730/);
    }
  });

  it("rejects media kept longer than results", () => {
    expect(parseRetention("200", "100")).toEqual({ ok: false, fieldErrors: { mediaRetentionDays: [MEDIA_LONGER_ERROR] } });
  });
});

describe("retention clock", () => {
  const created = at("2026-01-01T00:00:00Z");
  const expires = at("2026-01-08T00:00:00Z");

  it("runs from the invite expiry when the candidate never started", () => {
    expect(retentionAnchor({ createdAt: created, expiresAt: expires })).toEqual(expires);
  });

  it("runs from the latest activity: submission or deadline after expiry", () => {
    const submitted = at("2026-01-20T10:00:00Z");
    expect(retentionAnchor({ createdAt: created, expiresAt: expires, submittedAt: submitted })).toEqual(submitted);
    const deadline = at("2026-01-09T00:00:00Z");
    expect(retentionAnchor({ createdAt: created, expiresAt: expires, deadlineAt: deadline, submittedAt: null })).toEqual(deadline);
  });

  it("adds whole days to the anchor", () => {
    expect(retainedUntil(expires, 30)).toEqual(new Date(expires.getTime() + 30 * DAY));
  });

  it("is past retention only after the full period", () => {
    const row = { createdAt: created, expiresAt: expires };
    const until = retainedUntil(expires, 30);
    expect(isPastRetention(row, 30, new Date(until.getTime() - 1))).toBe(false);
    expect(isPastRetention(row, 30, until)).toBe(false);
    expect(isPastRetention(row, 30, new Date(until.getTime() + 1))).toBe(true);
  });

  it("uses each org's own days", () => {
    const row = { createdAt: created, expiresAt: expires };
    const now = new Date(expires.getTime() + 40 * DAY);
    expect(isPastRetention(row, 30, now)).toBe(true);
    expect(isPastRetention(row, 90, now)).toBe(false);
  });
});
