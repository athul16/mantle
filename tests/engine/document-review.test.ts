import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { documentReviewServer } = await import("@/lib/engine/step-types/document_review/server");

const baseConfig = {
  prompt: "Review invoice {{inv}}.",
  document: {
    title: "Invoice {{inv}}",
    fields: [
      { id: "invoice_no", label: "Invoice #", value: "{{inv}}" },
      { id: "date", label: "Date", value: "Oct 24" },
    ],
    columns: ["Description", "Qty", "Price", "Amount"],
    rows: [
      { id: "mulch", cells: ["Mulch", "40", "$12.50", "$550.00"] },
      { id: "straw", cells: ["Straw", "10", "$5.00", "$50.00"] },
      { id: "rock", cells: ["Rock", "2", "$60.00", "$120.00"] },
    ],
    totals: [{ id: "total", label: "Amount due", value: "$720.00" }],
  },
  reasons: [
    { id: "math", label: "Math error" },
    { id: "duplicate", label: "Duplicate" },
    { id: "other", label: "Other" },
  ],
  findings: [
    { id: "line-math", label: "Mulch overbilled" },
    { id: "dup", label: "Already paid", points: 3 },
  ],
  decision: {
    prompt: "What now?",
    options: [
      { id: "approve", label: "Approve" },
      { id: "reject", label: "Reject" },
      { id: "ask", label: "Ask vendor" },
    ],
  },
};
const config = documentReviewServer.configSchema.parse(baseConfig);
const variant = { values: { inv: "GM-4417" }, keys: {} };
const key = documentReviewServer.keySchema.parse({
  findings: {
    "line-math": { targets: ["mulch", "total"], reasons: ["math"], note: "40 × $12.50 = $500.00, billed $550.00." },
    dup: { targets: ["invoice_no"], reasons: ["duplicate"] },
  },
  decision: ["reject", "ask"],
});

type Flag = { target: string; reason: string; note?: string };
const flag = (target: string, reason = ""): Flag => ({ target, reason, note: "" });
const score = (flags?: Flag[], decision: string | null = null) =>
  documentReviewServer.score({
    config,
    key,
    variant,
    answer: flags === undefined ? undefined : documentReviewServer.parseAnswer({ flags, decision }),
  });
const byId = (s: ReturnType<typeof score>) => Object.fromEntries(s.items.map((i) => [i.id, i]));

describe("document_review config and key", () => {
  it("rejects duplicate item ids, ragged rows and duplicate reasons", () => {
    const dupItem = { ...baseConfig, document: { ...baseConfig.document, totals: [{ id: "mulch", label: "x", value: "1" }] } };
    expect(() => documentReviewServer.configSchema.parse(dupItem)).toThrow(/document item ids must be unique/);
    const ragged = { ...baseConfig, document: { ...baseConfig.document, rows: [{ id: "r", cells: ["only"] }] } };
    expect(() => documentReviewServer.configSchema.parse(ragged)).toThrow(/expected 4/);
    const dupReason = { ...baseConfig, reasons: [baseConfig.reasons[0], baseConfig.reasons[0]] };
    expect(() => documentReviewServer.configSchema.parse(dupReason)).toThrow(/reason ids must be unique/);
  });

  it("throws when the key doesn't fit the config", () => {
    const run = (k: unknown) => () =>
      documentReviewServer.score({ config, key: documentReviewServer.keySchema.parse(k), variant, answer: undefined });
    expect(run({ findings: { dup: key.findings.dup }, decision: ["reject"] })).toThrow(/missing finding "line-math"/);
    expect(run({ ...key, findings: { ...key.findings, extra: key.findings.dup } })).toThrow(/unknown finding/);
    expect(run({ ...key, findings: { ...key.findings, dup: { targets: ["nope"], reasons: ["duplicate"] } } })).toThrow(/unknown item/);
    expect(run({ ...key, findings: { ...key.findings, dup: { targets: ["invoice_no"], reasons: ["nope"] } } })).toThrow(/unknown reason/);
    expect(run({ findings: key.findings })).toThrow(/needs a decision/);
    expect(run({ ...key, decision: ["pay"] })).toThrow(/unknown decision/);
  });
});

describe("document_review public config", () => {
  it("fills templates and carries no findings, key, points or penalty", () => {
    const pub = documentReviewServer.toPublic(config, { variant, fill: (t) => t.replaceAll("{{inv}}", "GM-4417") });
    expect(pub.prompt).toBe("Review invoice GM-4417.");
    expect(pub.document.fields[0]).toEqual({ id: "invoice_no", label: "Invoice #", value: "GM-4417" });
    expect(pub.document.rows.map((r) => r.id)).toEqual(["mulch", "straw", "rock"]);
    expect(pub.decision?.options.map((o) => o.id)).toEqual(["approve", "reject", "ask"]);
    expect(pub.maxFlags).toBe(10);
    expect(JSON.stringify(pub)).not.toMatch(/findings|points|Penalty|Mulch overbilled|Already paid|\$500\.00/);
  });

  it("omits the decision when the config has none", () => {
    const noDecision = documentReviewServer.configSchema.parse({ ...baseConfig, decision: undefined });
    expect(documentReviewServer.toPublic(noDecision, { variant, fill: (t) => t })).not.toHaveProperty("decision");
  });
});

describe("document_review parseAnswer", () => {
  it("defaults note and decision", () => {
    expect(documentReviewServer.parseAnswer({ flags: [{ target: "mulch", reason: "" }] })).toEqual({
      flags: [{ target: "mulch", reason: "", note: "" }],
      decision: null,
    });
  });

  it.each([
    ["two flags on one item", { flags: [flag("mulch", "math"), flag("mulch", "other")] }],
    ["a bad target id", { flags: [flag("Mulch!", "math")] }],
    ["a long note", { flags: [{ target: "mulch", reason: "math", note: "x".repeat(501) }] }],
    ["too many flags", { flags: Array.from({ length: 51 }, (_, i) => flag(`r${i}`)) }],
    ["a numeric decision", { flags: [], decision: 1 }],
    ["an extra field", { flags: [], decision: null, score: 10 }],
  ])("rejects %s", (_, raw) => {
    expect(() => documentReviewServer.parseAnswer(raw)).toThrow();
  });
});

describe("document_review scoring", () => {
  it("full marks for both findings with the right reasons and an accepted decision", () => {
    const s = score([flag("mulch", "math"), flag("invoice_no", "duplicate")], "ask");
    expect(s).toMatchObject({ points: 6, maxPoints: 6 });
    expect(byId(s).decision.note).toBe('Chose "Ask vendor".');
  });

  it("scores unanswered as 0 with what was expected", () => {
    const s = score(undefined);
    expect(s).toMatchObject({ points: 0, maxPoints: 6 });
    expect(byId(s)["line-math"].note).toBe(
      'Not flagged. Expected line "Mulch" or Amount due, reason: Math error. 40 × $12.50 = $500.00, billed $550.00.',
    );
    expect(byId(s).decision.note).toBe('No decision. Expected "Reject" or "Ask vendor".');
  });

  it("gives half for the right item with the wrong or no reason", () => {
    const s = score([flag("mulch", "other"), flag("invoice_no")]);
    expect(byId(s)["line-math"]).toMatchObject({ earned: 1, note: expect.stringContaining('with "Other"') });
    expect(byId(s).dup).toMatchObject({ earned: 1.5, note: expect.stringContaining("with no reason") });
  });

  it("accepts any of a finding's targets, and a second flag on another of them is not a false flag", () => {
    expect(byId(score([flag("total", "math")]))["line-math"].earned).toBe(2);
    const both = score([flag("total", "other"), flag("mulch", "math")]);
    expect(byId(both)["line-math"].earned).toBe(2); // the exact match wins over the earlier partial one
    expect(byId(both)["false-flags"]).toBeUndefined();
  });

  it("penalises flags on items that are fine", () => {
    const s = score([flag("mulch", "math"), flag("invoice_no", "duplicate"), flag("straw", "math"), flag("date", "other")], "reject");
    expect(byId(s)["false-flags"]).toMatchObject({ earned: -2, max: 0 });
    expect(byId(s)["false-flags"].note).toBe('2 items flagged that aren\'t issues: line "Straw", Date.');
    expect(s).toMatchObject({ points: 4, maxPoints: 6 });
    expect(s.points).toBe(s.items.reduce((sum, i) => sum + i.earned, 0));
  });

  it("caps the deduction at the points earned, so flagging everything can't go below 0", () => {
    const everything = ["invoice_no", "date", "mulch", "straw", "rock", "total"].map((t) => flag(t, "other"));
    const s = score(everything, "approve");
    // Half credit on both findings (1 + 1.5) and 3 false flags (date, straw, rock); total is a finding target.
    expect(byId(s)["false-flags"]).toMatchObject({ earned: -2.5 });
    expect(byId(s)["false-flags"].note).toMatch(/capped/);
    expect(s.points).toBe(0);

    const nothingRight = score([flag("straw", "math")]);
    expect(byId(nothingRight)["false-flags"].earned).toBe(0);
    expect(Object.is(byId(nothingRight)["false-flags"].earned, -0)).toBe(false);
    expect(nothingRight.points).toBe(0);
  });

  it("ignores flags on ids that aren't in the document", () => {
    const s = score([flag("mulch", "math"), flag("ghost", "math")]);
    expect(byId(s)["false-flags"]).toBeUndefined();
    expect(s.points).toBe(2);
  });

  it("uses the configured penalty, and none when it's 0", () => {
    const harsh = documentReviewServer.configSchema.parse({ ...baseConfig, falseFlagPenalty: 1.5 });
    const lenient = documentReviewServer.configSchema.parse({ ...baseConfig, falseFlagPenalty: 0 });
    const answer = documentReviewServer.parseAnswer({ flags: [flag("mulch", "math"), flag("rock", "math")], decision: null });
    expect(documentReviewServer.score({ config: harsh, key, variant, answer }).points).toBe(0.5);
    expect(documentReviewServer.score({ config: lenient, key, variant, answer }).points).toBe(2);
  });

  it("gives no decision points for a wrong decision", () => {
    const s = score([], "approve");
    expect(byId(s).decision).toMatchObject({ earned: 0, note: 'Chose "Approve". Expected "Reject" or "Ask vendor".' });
  });
});
