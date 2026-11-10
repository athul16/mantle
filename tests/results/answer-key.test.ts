/** Report rows (answer next to expected) for journal_entry and document_review. No database. */
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { describeStep } = await import("@/lib/results/answer-key");
const { journalEntryServer } = await import("@/lib/engine/step-types/journal_entry/server");
const { documentReviewServer } = await import("@/lib/engine/step-types/document_review/server");

const row = (rows: { id: string }[], id: string) => {
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
});
