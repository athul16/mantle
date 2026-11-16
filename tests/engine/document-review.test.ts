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

describe('document_review "nothing wrong here"', () => {
  const withClean = documentReviewServer.configSchema.parse({ ...baseConfig, confirmClean: {} });
  const cleanKey = documentReviewServer.keySchema.parse({ findings: {}, clean: true, decision: ["approve"] });
  const scoreWith = (k: typeof key, flags: Flag[], clean: boolean | undefined, decision: string | null = null, cfg = withClean) =>
    documentReviewServer.score({
      config: cfg,
      key: k,
      variant,
      answer: documentReviewServer.parseAnswer({ flags, decision, ...(clean === undefined ? {} : { clean }) }),
    });

  describe("config, key and answer", () => {
    it("is off unless the config asks for it; its points default to the findings' total", () => {
      expect(config.confirmClean).toBeUndefined();
      expect(withClean.confirmClean).toEqual({ label: "Nothing wrong with this document", points: 5 });
      const custom = documentReviewServer.configSchema.parse({ ...baseConfig, confirmClean: { label: "Looks fine", points: 4 } });
      expect(custom.confirmClean).toEqual({ label: "Looks fine", points: 4 });
    });

    it("allows a config with no findings only when it can be confirmed clean", () => {
      expect(() => documentReviewServer.configSchema.parse({ ...baseConfig, findings: [] })).toThrow(/at least one finding/);
      const alwaysClean = documentReviewServer.configSchema.parse({ ...baseConfig, findings: [], confirmClean: {} });
      expect(alwaysClean.confirmClean?.points).toBe(2);
    });

    it("the key's clean flag is optional, so existing keys parse unchanged", () => {
      expect(key).not.toHaveProperty("clean");
      expect(cleanKey.clean).toBe(true);
    });

    it("throws when a clean key doesn't fit the config", () => {
      const run = (cfg: typeof config, k: unknown) => () =>
        documentReviewServer.score({ config: cfg, key: documentReviewServer.keySchema.parse(k), variant, answer: undefined });
      expect(run(config, { findings: {}, clean: true, decision: ["approve"] })).toThrow(/can't be confirmed clean/);
      expect(run(withClean, { findings: { dup: key.findings.dup }, clean: true, decision: ["approve"] })).toThrow(/clean document has no findings/);
      const alwaysClean = documentReviewServer.configSchema.parse({ ...baseConfig, findings: [], confirmClean: {} });
      expect(run(alwaysClean, { findings: {}, decision: ["approve"] })).toThrow(/no findings, so its key must say clean/);
    });

    it("parses saved answers with and without the confirm", () => {
      expect(documentReviewServer.parseAnswer({ flags: [], decision: null })).toEqual({ flags: [], decision: null });
      expect(documentReviewServer.parseAnswer({ flags: [], decision: null, clean: true })).toEqual({ flags: [], decision: null, clean: true });
      expect(() => documentReviewServer.parseAnswer({ flags: [], decision: null, clean: "yes" })).toThrow();
    });

    it("tells the candidate the confirm exists, with its label but not its points", () => {
      const pub = documentReviewServer.toPublic(
        documentReviewServer.configSchema.parse({ ...baseConfig, confirmClean: { label: "Nothing wrong with {{inv}}" } }),
        { variant, fill: (t) => t.replaceAll("{{inv}}", "GM-4417") },
      );
      expect(pub.confirmClean).toEqual({ label: "Nothing wrong with GM-4417" });
      expect(JSON.stringify(pub)).not.toMatch(/points|clean":/);
      expect(documentReviewServer.toPublic(config, { variant, fill: (t) => t })).not.toHaveProperty("confirmClean");
    });
  });

  describe("on a clean document", () => {
    it("confirming earns the confirm's points; the findings aren't scored", () => {
      const s = scoreWith(cleanKey, [], true, "approve");
      expect(s.items.map((i) => i.id)).toEqual(["clean", "decision"]);
      expect(byId(s).clean).toEqual({ id: "clean", label: "Nothing wrong", earned: 5, max: 5, note: "Confirmed that nothing is wrong." });
      expect(s).toMatchObject({ points: 6, maxPoints: 6 });
    });

    it("has the same maximum as a variant with issues, by default", () => {
      expect(scoreWith(cleanKey, [], false).maxPoints).toBe(scoreWith(key, [], false).maxPoints);
    });

    it("not confirming earns nothing for it", () => {
      const s = scoreWith(cleanKey, [], false, "approve");
      expect(byId(s).clean).toMatchObject({ earned: 0, note: "Not confirmed. The document has no issues." });
      expect(s.points).toBe(1);
      expect(scoreWith(cleanKey, [], undefined, "approve").points).toBe(1);
    });

    it("every flag is a false flag, capped as usual", () => {
      const s = scoreWith(cleanKey, [flag("mulch", "math")], true, "approve");
      expect(byId(s)["false-flags"]).toMatchObject({ earned: -1, note: '1 item flagged that isn\'t an issue: line "Mulch".' });
      expect(s.points).toBe(5);
      const noConfirm = scoreWith(cleanKey, [flag("mulch", "math"), flag("rock", "math")], false);
      expect(byId(noConfirm)["false-flags"].earned).toBe(0);
      expect(noConfirm.points).toBe(0);
    });
  });

  describe("on a document with issues", () => {
    it("confirming it clean costs like one false flag", () => {
      const s = scoreWith(key, [flag("mulch", "math")], true, "reject");
      expect(s.items.map((i) => i.id)).toEqual(["line-math", "dup", "decision", "false-flags"]);
      expect(byId(s)["false-flags"]).toMatchObject({ earned: -1, max: 0, note: "Confirmed that nothing is wrong, but the document has issues." });
      expect(s.points).toBe(2);
    });

    it("adds to the flags' deduction, still capped at the points earned", () => {
      const s = scoreWith(key, [flag("mulch", "other"), flag("straw", "math")], true);
      expect(byId(s)["false-flags"]).toMatchObject({ earned: -1 });
      expect(byId(s)["false-flags"].note).toBe(
        '1 item flagged that isn\'t an issue: line "Straw". Confirmed that nothing is wrong, but the document has issues. Deduction capped at the points earned.',
      );
      expect(s.points).toBe(0);
    });

    it("without the confirm in the config, a stray clean answer changes nothing", () => {
      const answer = { flags: [flag("mulch", "math"), flag("straw", "math")], decision: "reject" };
      const before = documentReviewServer.score({ config, key, variant, answer: documentReviewServer.parseAnswer(answer) });
      const after = documentReviewServer.score({ config, key, variant, answer: documentReviewServer.parseAnswer({ ...answer, clean: true }) });
      expect(after).toEqual(before);
      expect(before).toMatchObject({ points: 2, maxPoints: 6 });
    });

    it("not confirming scores exactly as before the feature", () => {
      const flags = [flag("mulch", "math"), flag("invoice_no", "other"), flag("date", "math")];
      const withFeature = scoreWith(key, flags, false, "ask");
      const without = documentReviewServer.score({ config, key, variant, answer: documentReviewServer.parseAnswer({ flags, decision: "ask" }) });
      expect(withFeature).toEqual(without);
    });
  });
});
