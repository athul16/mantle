import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETENTION_DAYS,
  MAX_RETENTION_DAYS,
  MIN_RETENTION_DAYS,
  isPastRetention,
  parseRetentionDays,
  readRetentionDays,
  retainedUntil,
  retentionAnchor,
} from "@/lib/retention/policy";

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);

describe("retention days setting", () => {
  it("has a 180-day default inside 30..730", () => {
    expect(DEFAULT_RETENTION_DAYS).toBe(180);
    expect(MIN_RETENTION_DAYS).toBe(30);
    expect(MAX_RETENTION_DAYS).toBe(730);
  });

  it("reads the org setting, falling back to the default", () => {
    expect(readRetentionDays({ retention_days: 90 })).toBe(90);
    expect(readRetentionDays({})).toBe(180);
    expect(readRetentionDays(null)).toBe(180);
    expect(readRetentionDays({ retention_days: "90" })).toBe(180);
    expect(readRetentionDays({ retention_days: 5 })).toBe(180);
  });

  it("parses form input and rejects values out of range", () => {
    expect(parseRetentionDays("90")).toEqual({ ok: true, days: 90 });
    expect(parseRetentionDays(" 30 ")).toEqual({ ok: true, days: 30 });
    expect(parseRetentionDays("730")).toEqual({ ok: true, days: 730 });
    for (const bad of ["29", "731", "", "abc", "90.5", "-1", null]) {
      const r = parseRetentionDays(bad);
      expect(r.ok, String(bad)).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/30.*730/);
    }
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
