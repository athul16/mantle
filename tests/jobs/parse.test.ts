import { describe, expect, it } from "vitest";
import { mergeRecipients, parseCsvEmails, parsePastedEmails } from "@/lib/jobs/emails";
import { displayStatus, inviteExpiry, isPast } from "@/lib/jobs/status";

describe("parsePastedEmails", () => {
  it("splits on newlines, commas, semicolons and spaces, lowercases and dedupes", () => {
    const r = parsePastedEmails("Jane@Example.com, sam@example.com;\n jane@example.com  <lee@example.com>\n\n");
    expect(r.recipients.map((x) => x.email)).toEqual(["jane@example.com", "sam@example.com", "lee@example.com"]);
    expect(r.duplicates).toEqual(["jane@example.com"]);
    expect(r.invalid).toEqual([]);
  });

  it("reports entries that aren't emails", () => {
    const r = parsePastedEmails("ok@example.com\nnot-an-email\nbad@\n");
    expect(r.recipients).toHaveLength(1);
    expect(r.invalid).toEqual(["not-an-email", "bad@"]);
  });
});

describe("parseCsvEmails", () => {
  it("uses the email and name columns from a header row", () => {
    const csv = '﻿Name,Email,School\r\n"Doe, Jane",JANE@example.com,State\r\nSam Lee,sam@example.com,Tech\r\n,,\r\n';
    const r = parseCsvEmails(csv);
    expect(r.recipients).toEqual([
      { email: "jane@example.com", name: "Doe, Jane" },
      { email: "sam@example.com", name: "Sam Lee" },
    ]);
  });

  it("without a header, takes the first cell with an @ per row", () => {
    const r = parseCsvEmails("Jane;jane@example.com\nSam;sam@example\nnobody;here\n");
    expect(r.recipients.map((x) => x.email)).toEqual(["jane@example.com"]);
    expect(r.invalid).toEqual(["sam@example"]);
  });

  it("supports semicolon and tab delimiters", () => {
    expect(parseCsvEmails("email\tname\na@example.com\tA\n").recipients).toEqual([{ email: "a@example.com", name: "A" }]);
  });
});

describe("mergeRecipients", () => {
  it("dedupes across paste and CSV", () => {
    const r = mergeRecipients(parsePastedEmails("a@example.com"), parseCsvEmails("email\nA@example.com\nb@example.com"));
    expect(r.recipients.map((x) => x.email)).toEqual(["a@example.com", "b@example.com"]);
    expect(r.duplicates).toEqual(["a@example.com"]);
  });
});

describe("invite status helpers", () => {
  const now = Date.parse("2026-11-09T12:00:00Z");
  it("shows an invited row past its expiry as expired", () => {
    expect(displayStatus("invited", "2026-11-09T11:00:00Z", now)).toBe("expired");
    expect(displayStatus("invited", "2026-11-10T11:00:00Z", now)).toBe("invited");
    expect(displayStatus("completed", "2026-11-09T11:00:00Z", now)).toBe("completed");
  });

  it("expires at the job deadline, or 14 days out", () => {
    expect(inviteExpiry("2026-12-01T00:00:00Z", now).toISOString()).toBe("2026-12-01T00:00:00.000Z");
    expect(inviteExpiry(null, now).toISOString()).toBe("2026-11-23T12:00:00.000Z");
    expect(isPast("2026-11-09T11:00:00Z", now)).toBe(true);
    expect(isPast(null, now)).toBe(false);
  });
});
