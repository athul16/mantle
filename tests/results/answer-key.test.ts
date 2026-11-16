/** Report rows (answer next to expected) for journal_entry, document_review, multiple_choice and rapid_round. No database. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { describeStep } = await import("@/lib/results/answer-key");
const { journalEntryServer } = await import("@/lib/engine/step-types/journal_entry/server");
const { documentReviewServer } = await import("@/lib/engine/step-types/document_review/server");
const { multipleChoiceServer } = await import("@/lib/engine/step-types/multiple_choice/server");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");

const row = <R extends { id: string }>(rows: R[], id: string): R => {
  const r = rows.find((x) => x.id === id);
  if (!r) throw new Error(`no row "${id}" in ${rows.map((x) => x.id).join(", ")}`);
  return r;
};

describe("journal_entry report rows", () => {
  type Line = { account: string; debit: number | null; credit: number | null };
  const dr = (account: string, amount: number): Line => ({ account, debit: amount, credit: null });
  const cr = (account: string, amount: number): Line => ({ account, debit: null, credit: amount });
  const entry = (...lines: Line[]) => ({ memo: "", lines });

  const config = {
    prompt: "Book the adjustments.",
    accounts: [
      { code: "1010", name: "Cash" },
      { code: "1200", name: "Accounts Receivable" },
      { code: "2000", name: "Accounts Payable" },
      { code: "5100", name: "Cost of Goods Sold" },
      { code: "6200", name: "{{fee_account}}" },
      { code: "7100", name: "Interest Income" },
    ],
    expected: [
      { id: "fee", label: "Bank fee" },
      { id: "nsf", label: "NSF check", points: 4 },
      { id: "fix", label: "Transposition" },
    ],
  };
  const step = { id: "je", type: "journal_entry", title: "Book entries", config };
  const keyJe = {
    entries: {
      fee: { lines: [{ accounts: ["6200"], side: "debit", amount: 35 }, { accounts: ["1010"], side: "credit", amount: 35 }] },
      nsf: { lines: [{ accounts: ["1200"], side: "debit", amount: 480 }, { accounts: ["1010"], side: "credit", amount: 480 }] },
      fix: { lines: [{ accounts: ["5100", "2000"], side: "debit", amount: 450 }, { accounts: ["1010"], side: "credit", amount: 450 }] },
    },
  };
  const variant = { values: { fee_account: "Bank Service Charges" }, keys: { je: keyJe } };
  const scored = (entries: ReturnType<typeof entry>[]) =>
    journalEntryServer.score({
      config: journalEntryServer.configSchema.parse(config),
      key: journalEntryServer.keySchema.parse(keyJe),
      variant,
      answer: { entries },
    });
  const describeJe = (entries: ReturnType<typeof entry>[]) => describeStep(step, variant, { entries }, scored(entries));

  it("shows readable rows, not raw JSON", () => {
    const d = describeJe([entry(dr("6200", 35), cr("1010", 35))]);
    expect(d.answerText).toBeNull();
    expect(d.rows.map((r) => r.id)).toEqual(["fee", "nsf", "fix"]);
    expect(d.rows.some((r) => r.id === "__key")).toBe(false);
    expect(JSON.stringify(d.rows)).not.toContain("accounts");
  });

  it("puts the candidate's lines next to the expected lines, with each entry's points", () => {
    // Entries in a different order from the key, one with the wrong amount.
    const d = describeJe([entry(dr("1200", 480), cr("1010", 480)), entry(dr("6200", 30), cr("1010", 30))]);
    const nsf = row(d.rows, "nsf");
    expect(nsf).toMatchObject({ label: "NSF check", earned: 4, max: 4 });
    expect(nsf.answer).toBe("Dr 1200 Accounts Receivable 480.00; Cr 1010 Cash 480.00");
    expect(nsf.expected).toBe("Dr 1200 Accounts Receivable 480.00; Cr 1010 Cash 480.00");

    const fee = row(d.rows, "fee");
    expect(fee.answer).toBe("Dr 6200 Bank Service Charges 30.00; Cr 1010 Cash 30.00");
    expect(fee.expected).toBe("Dr 6200 Bank Service Charges 35.00; Cr 1010 Cash 35.00");
    expect(fee).toMatchObject({ earned: 1.5, max: 3 });
    expect(fee.note).toMatch(/amount 30\.00/);
  });

  it("lists every acceptable account and marks expected entries with no match", () => {
    const d = describeJe([entry(dr("6200", 35), cr("1010", 35))]);
    const fix = row(d.rows, "fix");
    expect(fix.expected).toBe("Dr 5100 Cost of Goods Sold or 2000 Accounts Payable 450.00; Cr 1010 Cash 450.00");
    expect(fix.answer).toBe("(no matching entry)");
    expect(fix).toMatchObject({ earned: 0, max: 3 });
  });

  it("adds an 'Entries not in the key' line with the entries that matched nothing", () => {
    const d = describeJe([
      entry(dr("6200", 35), cr("1010", 35)),
      entry(dr("1010", 12.5), cr("7100", 12.5)),
      { memo: "", lines: [{ account: "", debit: null, credit: null }] }, // blank entry: ignored
    ]);
    const extra = row(d.rows, "unmatched-entries");
    expect(extra.label).toBe("Entries not in the key");
    expect(extra.answer).toBe("Dr 1010 Cash 12.50; Cr 7100 Interest Income 12.50");
    expect(extra.expected).toBe("—");
    expect(extra).toMatchObject({ earned: 0, max: 0 });
    expect(extra.note).toMatch(/1 entry didn't match/);
  });

  it("handles an unanswered, unscored step", () => {
    const d = describeStep(step, variant, undefined, null);
    expect(d.answerText).toBeNull();
    expect(d.rows.map((r) => r.id)).toEqual(["fee", "nsf", "fix"]);
    expect(d.rows.every((r) => r.answer === "(not answered)")).toBe(true);
  });
});

describe("document_review report rows", () => {
  const config = {
    prompt: "Check this invoice.",
    document: {
      title: "Invoice",
      fields: [
        { id: "invoice_no", label: "Invoice #", value: "INV-{{inv}}" },
        { id: "terms", label: "Terms", value: "Net 30" },
      ],
      columns: ["Description", "Amount"],
      rows: [
        { id: "mulch", cells: ["Hardwood mulch", "100.00"] },
        { id: "straw", cells: ["Pine straw", "80.00"] },
        { id: "rock", cells: ["River rock", "300.00"] },
      ],
      totals: [{ id: "total", label: "Total", value: "480.00" }],
    },
    reasons: [
      { id: "qty", label: "Quantity doesn't match the PO" },
      { id: "dup", label: "Already paid (duplicate)" },
      { id: "math", label: "Math error" },
    ],
    findings: [
      { id: "overbill", label: "Over-billed quantity", points: 2 },
      { id: "duplicate", label: "Duplicate invoice", points: 2 },
      { id: "total-wrong", label: "Total doesn't add up", points: 2 },
    ],
    falseFlagPenalty: 1,
    decision: {
      prompt: "What should AP do?",
      options: [
        { id: "pay", label: "Pay it" },
        { id: "hold", label: "Hold and ask the vendor" },
      ],
    },
  };
  const step = { id: "dr", type: "document_review", title: "Review the invoice", config };
  const keyDr = {
    findings: {
      overbill: { targets: ["rock"], reasons: ["qty"] },
      duplicate: { targets: ["invoice_no"], reasons: ["dup"], note: "Paid on Oct 3." },
      "total-wrong": { targets: ["total"], reasons: ["math"] },
    },
    decision: ["hold"],
  };
  const variant = { values: { inv: "2231" }, keys: { dr: keyDr } };
  type Flag = { target: string; reason: string; note?: string };
  const answerOf = (flags: Flag[], decision: string | null) => ({ flags: flags.map((f) => ({ note: "", ...f })), decision });
  const describeDr = (flags: Flag[], decision: string | null) => {
    const answer = answerOf(flags, decision);
    const score = documentReviewServer.score({
      config: documentReviewServer.configSchema.parse(config),
      key: documentReviewServer.keySchema.parse(keyDr),
      variant,
      answer,
    });
    return describeStep(step, variant, answer, score);
  };

  it("shows readable rows, not raw JSON", () => {
    const d = describeDr([{ target: "rock", reason: "qty" }], "hold");
    expect(d.answerText).toBeNull();
    expect(d.rows.some((r) => r.id === "__key")).toBe(false);
    expect(d.rows.map((r) => r.id)).toEqual(["overbill", "duplicate", "total-wrong", "decision"]);
  });

  it("puts each flagged item and reason next to the expected finding", () => {
    const d = describeDr(
      [
        { target: "rock", reason: "qty", note: "PO says 4 tons" },
        { target: "invoice_no", reason: "math" },
      ],
      "hold",
    );
    const over = row(d.rows, "overbill");
    expect(over.label).toBe("Over-billed quantity");
    expect(over.answer).toBe('line "River rock": Quantity doesn\'t match the PO (note: "PO says 4 tons")');
    expect(over.expected).toBe('line "River rock": Quantity doesn\'t match the PO');
    expect(over).toMatchObject({ earned: 2, max: 2 });

    const dup = row(d.rows, "duplicate");
    expect(dup.answer).toBe("Invoice #: Math error");
    expect(dup.expected).toBe("Invoice #: Already paid (duplicate). Paid on Oct 3.");
    expect(dup).toMatchObject({ earned: 1, max: 2 });

    const total = row(d.rows, "total-wrong");
    expect(total.answer).toBe("(not flagged)");
    expect(total).toMatchObject({ earned: 0, max: 2 });
  });

  it("shows the decision next to the expected decision", () => {
    const d = describeDr([], "pay");
    expect(row(d.rows, "decision")).toMatchObject({ label: "Decision", answer: "Pay it", expected: "Hold and ask the vendor", earned: 0, max: 1 });
    expect(row(describeDr([], null).rows, "decision").answer).toBe("(not answered)");
  });

  it("adds a 'False flags' penalty line listing the items that aren't issues", () => {
    const d = describeDr(
      [
        { target: "rock", reason: "qty" },
        { target: "mulch", reason: "math" },
        { target: "terms", reason: "" },
      ],
      "hold",
    );
    const ff = row(d.rows, "false-flags");
    expect(ff.label).toBe("False flags");
    expect(ff.answer).toBe('line "Hardwood mulch": Math error; Terms: no reason');
    expect(ff.expected).toBe("None");
    expect(ff).toMatchObject({ earned: -2, max: 0 });
    expect(d.rows.at(-1)?.id).toBe("false-flags");
  });

  it("handles an unanswered, unscored step", () => {
    const d = describeStep(step, variant, undefined, null);
    expect(d.answerText).toBeNull();
    expect(d.rows.map((r) => r.id)).toEqual(["overbill", "duplicate", "total-wrong", "decision"]);
    expect(row(d.rows, "overbill").answer).toBe("(not flagged)");
  });

  describe('"nothing wrong here"', () => {
    const cleanConfig = { ...config, confirmClean: {} };
    const cleanStep = { ...step, config: cleanConfig };
    const describeClean = (k: unknown, flags: Flag[], clean: boolean, decision: string | null = "hold") => {
      const answer = { ...answerOf(flags, decision), clean };
      const v = { ...variant, keys: { dr: k } };
      const score = documentReviewServer.score({
        config: documentReviewServer.configSchema.parse(cleanConfig),
        key: documentReviewServer.keySchema.parse(k),
        variant: v,
        answer,
      });
      return describeStep(cleanStep, v, answer, score);
    };
    const cleanKey = { findings: {}, clean: true, decision: ["pay"] };

    it("on a clean document: one 'Nothing wrong' row instead of the findings", () => {
      const d = describeClean(cleanKey, [], true, "pay");
      expect(d.rows.map((r) => r.id)).toEqual(["clean", "decision"]);
      expect(row(d.rows, "clean")).toMatchObject({
        label: "Nothing wrong",
        answer: "Confirmed nothing wrong",
        expected: "Confirm nothing is wrong",
        earned: 6,
        max: 6,
      });
      expect(row(describeClean(cleanKey, [], false, "pay").rows, "clean")).toMatchObject({ answer: "(not confirmed)", earned: 0 });
    });

    it("on a clean document, flags are listed as false flags", () => {
      const d = describeClean(cleanKey, [{ target: "rock", reason: "qty" }], true, "pay");
      expect(row(d.rows, "false-flags")).toMatchObject({ answer: 'line "River rock": Quantity doesn\'t match the PO', earned: -1 });
    });

    it("on a document with issues, a wrong confirm is listed with the false flags", () => {
      const d = describeClean(keyDr, [{ target: "rock", reason: "qty" }], true);
      expect(d.rows.map((r) => r.id)).toEqual(["overbill", "duplicate", "total-wrong", "decision", "false-flags"]);
      expect(row(d.rows, "false-flags")).toMatchObject({ answer: "Confirmed nothing wrong", expected: "None", earned: -1 });
    });

    it("an old answer without the confirm shows the same rows as before", () => {
      const before = describeDr([{ target: "rock", reason: "qty" }], "hold");
      const answer = answerOf([{ target: "rock", reason: "qty" }], "hold");
      const score = documentReviewServer.score({
        config: documentReviewServer.configSchema.parse(cleanConfig),
        key: documentReviewServer.keySchema.parse(keyDr),
        variant,
        answer,
      });
      expect(describeStep(cleanStep, variant, answer, score).rows).toEqual(before.rows);
    });
  });
});

describe("multiple_choice report rows", () => {
  const config = {
    prompt: "Which are assets of {{client}}?",
    options: [
      { id: "cash", label: "Cash" },
      { id: "ar", label: "Accounts receivable" },
      { id: "ap", label: "Accounts payable" },
    ],
    select: "multi",
    points: 2,
  };
  const step = { id: "mc", type: "multiple_choice", title: "Assets", config };
  const variant = { values: { client: "Harbor Lane" }, keys: { mc: { correct: ["cash", "ar"] } } };

  it("puts the picked options next to the right ones, with the points", () => {
    const answer = { selected: ["cash", "ap"] };
    const score = multipleChoiceServer.score({
      config: multipleChoiceServer.configSchema.parse(config),
      key: multipleChoiceServer.keySchema.parse(variant.keys.mc),
      variant,
      answer,
    });
    const d = describeStep(step, variant, answer, score);
    expect(d.answerText).toBeNull();
    expect(d.rows).toEqual([
      {
        id: "answer",
        label: "Answer",
        prompt: "Which are assets of Harbor Lane?",
        answer: "Cash; Accounts payable",
        expected: "Cash; Accounts receivable",
        earned: 0,
        max: 2,
        note: expect.stringContaining("1 wrong pick"),
      },
    ]);
  });

  it("handles an unanswered, unscored step", () => {
    const d = describeStep(step, variant, undefined, null);
    expect(d.rows).toEqual([{ id: "answer", label: "Answer", prompt: "Which are assets of Harbor Lane?", answer: "(not answered)", expected: "Cash; Accounts receivable" }]);
  });
});

describe("rapid_round report rows", () => {
  const choices = [
    { id: "cash", label: "Cash" },
    { id: "rent_expense", label: "Rent expense" },
    { id: "supplies", label: "Supplies" },
  ];
  const config = {
    intro: "Quick checks.",
    secondsPerItem: 20,
    items: [
      {
        id: "rent",
        prompt: "Paid rent of {{rent|money}} by check.",
        fields: [
          { id: "debit", label: "Debit", kind: "choice", options: choices },
          { id: "credit", label: "Credit", kind: "choice", options: choices },
        ],
      },
      {
        id: "dep",
        prompt: "Monthly depreciation on {{equip|money}}?",
        fields: [{ id: "amount", label: "Amount", kind: "number", unit: "$", decimals: 2 }],
        points: 2,
      },
      {
        id: "count",
        prompt: "How many units?",
        fields: [{ id: "units", label: "Units", kind: "number", decimals: 0 }],
      },
    ],
  };
  const step = { id: "quick", type: "rapid_round", title: "Rapid checks", config };
  const key = {
    items: {
      rent: { debit: { choice: "rent_expense" }, credit: { choice: "cash" } },
      dep: { amount: { value: 1250.5, tolerance: 5 } },
      count: { units: { value: 12 } },
    },
  };
  const variant = { values: { rent: 250_000, equip: 1_200_000 }, keys: { quick: key } };
  const answer = {
    items: {
      rent: { values: { debit: "rent_expense", credit: "supplies" }, ms: 4_200 },
      dep: { values: { amount: 1250.5 }, ms: 6_000 },
    },
  };
  const scored = () =>
    rapidRoundServer.score({ config: rapidRoundServer.configSchema.parse(config), key: rapidRoundServer.keySchema.parse(key), variant, answer });

  it("one row per item: its prompt, the candidate's values, the right values and the response time", () => {
    const d = describeStep(step, variant, answer, scored());
    expect(d.answerText).toBeNull();
    expect(d.rows.some((r) => r.id === "__key")).toBe(false);
    expect(d.rows.map((r) => r.id)).toEqual(["rent", "dep", "count", "timing"]);
    expect(row(d.rows, "rent")).toMatchObject({
      label: "Item 1",
      prompt: "Paid rent of $2,500.00 by check.",
      answer: "Debit: Rent expense; Credit: Supplies",
      expected: "Debit: Rent expense; Credit: Cash",
      responseMs: 4_200,
      earned: 0.5,
      max: 1,
    });
    expect(row(d.rows, "dep")).toMatchObject({
      label: "Item 2",
      prompt: "Monthly depreciation on $12,000.00?",
      answer: "Amount: $1,250.50",
      expected: "Amount: $1,250.50 (± 5)",
      responseMs: 6_000,
      earned: 2,
      max: 2,
    });
    expect(row(d.rows, "count")).toMatchObject({ label: "Item 3", answer: "(not answered)", expected: "Units: 12", earned: 0, max: 1 });
    expect(row(d.rows, "count").responseMs).toBeUndefined();
  });

  it("ends with the response-time summary from the score, without points", () => {
    const timing = row(describeStep(step, variant, answer, scored()).rows, "timing");
    expect(timing).toEqual({ id: "timing", label: "Response time", answer: "Median response 5.1s over 2 answered; 1 with no answer.", expected: "—" });
  });

  it("handles an unanswered, unscored step", () => {
    const d = describeStep(step, variant, undefined, null);
    expect(d.rows.map((r) => r.id)).toEqual(["rent", "dep", "count"]);
    expect(row(d.rows, "rent")).toMatchObject({ answer: "(not answered)", expected: "Debit: Rent expense; Credit: Cash" });
  });

  it("without the seed, shows the prompts unfilled and no expected values", () => {
    const d = describeStep(step, null, answer, null);
    expect(row(d.rows, "rent")).toMatchObject({ prompt: "Paid rent of {{rent|money}} by check.", expected: "—" });
  });
});
