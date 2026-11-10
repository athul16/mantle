import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { journalEntryServer } = await import("@/lib/engine/step-types/journal_entry/server");
const { entryTotals, isBalanced } = await import("@/lib/engine/step-types/journal_entry/public");

type Line = { account: string; debit: number | null; credit: number | null };
const dr = (account: string, amount: number): Line => ({ account, debit: amount, credit: null });
const cr = (account: string, amount: number): Line => ({ account, debit: null, credit: amount });
const entry = (...lines: Line[]) => ({ memo: "", lines });

const config = journalEntryServer.configSchema.parse({
  prompt: "Book {{what}}.",
  accounts: [
    { code: "1010", name: "Cash" },
    { code: "1200", name: "Accounts Receivable" },
    { code: "2000", name: "Accounts Payable" },
    { code: "5100", name: "Cost of Goods Sold" },
    { code: "6200", name: "Bank Service Charges" },
  ],
  expected: [
    { id: "fee", label: "Bank fee" },
    { id: "nsf", label: "NSF check", points: 4 },
    { id: "fix", label: "Transposition" },
  ],
});
const variant = { values: { what: "the adjustments" }, keys: {} };
const key = journalEntryServer.keySchema.parse({
  entries: {
    fee: { lines: [{ accounts: ["6200"], side: "debit", amount: 35 }, { accounts: ["1010"], side: "credit", amount: 35 }] },
    nsf: { lines: [{ accounts: ["1200"], side: "debit", amount: 480 }, { accounts: ["1010"], side: "credit", amount: 480 }] },
    fix: {
      lines: [
        { accounts: ["5100", "2000"], side: "debit", amount: 450 },
        { accounts: ["1010"], side: "credit", amount: 450 },
      ],
    },
  },
});
const score = (entries?: ReturnType<typeof entry>[]) =>
  journalEntryServer.score({ config, key, variant, answer: entries === undefined ? undefined : { entries } });
const earned = (s: ReturnType<typeof score>) => Object.fromEntries(s.items.map((i) => [i.id, i.earned]));

const PERFECT = [
  entry(dr("6200", 35), cr("1010", 35)),
  entry(dr("1200", 480), cr("1010", 480)),
  entry(dr("5100", 450), cr("1010", 450)),
];

describe("journal_entry config and key", () => {
  it("rejects duplicate account codes and duplicate expected ids", () => {
    const base = { prompt: "x", expected: [{ id: "a", label: "A" }] };
    expect(() =>
      journalEntryServer.configSchema.parse({ ...base, accounts: [{ code: "1", name: "A" }, { code: "1", name: "B" }] }),
    ).toThrow(/unique/);
    expect(() =>
      journalEntryServer.configSchema.parse({
        ...base,
        accounts: [{ code: "1", name: "A" }, { code: "2", name: "B" }],
        expected: [{ id: "a", label: "A" }, { id: "a", label: "B" }],
      }),
    ).toThrow(/unique/);
  });

  it("rejects a key entry that doesn't balance", () => {
    expect(() =>
      journalEntryServer.keySchema.parse({
        entries: { a: { lines: [{ accounts: ["1"], side: "debit", amount: 10 }, { accounts: ["2"], side: "credit", amount: 9 }] } },
      }),
    ).toThrow(/doesn't balance/);
  });

  it("throws when the key and config disagree", () => {
    const { fix: _fix, ...missing } = key.entries;
    void _fix;
    expect(() => journalEntryServer.score({ config, key: { ...key, entries: missing }, variant, answer: undefined })).toThrow(
      /missing entry "fix"/,
    );
    expect(() =>
      journalEntryServer.score({ config, key: { ...key, entries: { ...key.entries, extra: key.entries.fee } }, variant, answer: undefined }),
    ).toThrow(/unknown entry/);
    const badAccount = { ...key, entries: { ...key.entries, fee: { lines: [{ ...key.entries.fee.lines[0], accounts: ["9999"] }, key.entries.fee.lines[1]] } } };
    expect(() => journalEntryServer.score({ config, key: badAccount, variant, answer: undefined })).toThrow(/unknown account/);
  });
});

describe("journal_entry public config", () => {
  it("has the prompt and chart of accounts, nothing from the key or points", () => {
    const pub = journalEntryServer.toPublic(config, { variant, fill: (t) => t.replace("{{what}}", "the adjustments") });
    expect(pub.prompt).toBe("Book the adjustments.");
    expect(pub.accounts.map((a) => a.code)).toEqual(["1010", "1200", "2000", "5100", "6200"]);
    expect(pub).toEqual({ prompt: pub.prompt, accounts: pub.accounts, maxEntries: 10, maxLines: 6 });
    expect(JSON.stringify(pub)).not.toMatch(/points|expected|Bank fee|Transposition|480|450/);
  });
});

describe("journal_entry parseAnswer", () => {
  it("accepts blank accounts and amounts and defaults the memo", () => {
    expect(journalEntryServer.parseAnswer({ entries: [{ lines: [{ account: "", debit: null, credit: null }] }] })).toEqual({
      entries: [{ memo: "", lines: [{ account: "", debit: null, credit: null }] }],
    });
  });

  it.each([
    ["a string amount", { entries: [{ lines: [{ account: "1010", debit: "35", credit: null }] }] }],
    ["a bad account code", { entries: [{ lines: [{ account: "10 10", debit: 1, credit: null }] }] }],
    ["an extra field", { entries: [{ lines: [], memo: "", total: 1 }] }],
    ["too many entries", { entries: Array.from({ length: 31 }, () => ({ lines: [] })) }],
    ["too many lines", { entries: [{ lines: Array.from({ length: 21 }, () => dr("1010", 1)) }] }],
    ["a long memo", { entries: [{ lines: [], memo: "x".repeat(501) }] }],
    ["missing entries", {}],
  ])("rejects %s", (_, raw) => {
    expect(() => journalEntryServer.parseAnswer(raw)).toThrow();
  });
});

describe("journal_entry totals", () => {
  it("adds debits and credits and needs a non-empty, equal entry to balance", () => {
    expect(entryTotals([dr("1", 10.1), cr("2", 10.1), { account: "", debit: null, credit: null }])).toEqual({ debit: 10.1, credit: 10.1 });
    expect(isBalanced({ debit: 0.1 + 0.2, credit: 0.3 })).toBe(true);
    expect(isBalanced({ debit: 0, credit: 0 })).toBe(false);
    expect(isBalanced({ debit: 10, credit: 10.01 })).toBe(false);
  });
});

describe("journal_entry scoring", () => {
  it("full marks for the right entries in any order, with accepted alternative accounts", () => {
    const s = score([PERFECT[2], PERFECT[0], entry(cr("1010", 480), dr("1200", 480))]);
    expect(s).toMatchObject({ points: 10, maxPoints: 10 });
    expect(s.items.map((i) => i.note)).toEqual(["Correct.", "Correct.", "Correct."]);
    expect(score([PERFECT[0], PERFECT[1], entry(dr("2000", 450), cr("1010", 450))]).points).toBe(10);
  });

  it("scores an unanswered or empty step as 0 with the expected entry in the note", () => {
    for (const s of [score(undefined), score([]), score([entry({ account: "", debit: null, credit: null })])]) {
      expect(s).toMatchObject({ points: 0, maxPoints: 10 });
      expect(s.items).toHaveLength(3);
      expect(s.items[0].note).toBe("No matching entry. Expected Dr 6200 Bank Service Charges 35.00, Cr 1010 Cash 35.00.");
      expect(s.items[2].note).toContain("Dr 5100 Cost of Goods Sold or 2000 Accounts Payable 450.00");
    }
  });

  it("gives half a line for the right account and side with a wrong amount; the entry is then unbalanced", () => {
    // Debit right (1) + credit amount wrong (0.5) = 0.75, capped at 0.5 because it doesn't balance.
    const s = score([entry(dr("6200", 35), cr("1010", 53))]);
    expect(earned(s).fee).toBe(1.5);
    expect(s.items[0].note).toBe("Cr 1010 Cash 35.00: amount 53.00; out of balance (debits 35.00, credits 53.00).");
  });

  it("gives half credit per line when both amounts are wrong but balanced", () => {
    const s = score([entry(dr("6200", 53), cr("1010", 53))]);
    expect(earned(s).fee).toBe(1.5);
    expect(s.items[0].note).toMatch(/Dr 6200 .* amount 53\.00; Cr 1010 .* amount 53\.00\./);
  });

  it("gives no credit for a reversed entry (sides swapped)", () => {
    expect(earned(score([entry(dr("1010", 35), cr("6200", 35))])).fee).toBe(0);
  });

  it("gives credit for the lines it gets right when an account is wrong", () => {
    // Debit right (1), credit to the wrong account is an extra line (-0.5): 0.5 / 2 lines.
    const s = score([entry(dr("6200", 35), cr("1200", 35))]);
    expect(earned(s).fee).toBe(0.75);
    expect(s.items[0].note).toBe("Cr 1010 Cash 35.00: missing; 1 extra line.");
  });

  it("charges extra lines so listing every account can't buy credit", () => {
    const shotgun = entry(dr("6200", 35), dr("1200", 35), dr("5100", 35), dr("2000", 35), cr("1010", 140));
    // fee: debit ok (1) + credit 1010 wrong amount (0.5) - 3 extras (1.5) = 0 → 0
    expect(score([shotgun]).points).toBe(0);
    // Debit right (1), credit amount off (0.5), one extra line (-0.5): 1 / 2 lines.
    expect(earned(score([entry(dr("6200", 35), dr("5100", 10), cr("1010", 45))])).fee).toBe(1.5);
  });

  it("counts a line with both or neither amount as an extra line", () => {
    const both = { account: "6200", debit: 35, credit: 35 };
    const s = score([entry(both, cr("1010", 35))]);
    // Credit right (1), the both-amounts line is extra (-0.5): 0.5 / 2 lines = 0.25 of 3 points.
    expect(earned(s).fee).toBe(0.75);
  });

  it("accepts amounts within the key tolerance only", () => {
    expect(earned(score([entry(dr("6200", 35.004), cr("1010", 35.004))])).fee).toBe(3);
    expect(earned(score([entry(dr("6200", 35.01), cr("1010", 35.01))])).fee).toBe(1.5);
  });

  it("uses each candidate entry for at most one expected entry and picks the best overall match", () => {
    // One combined entry can't earn twice.
    const combined = entry(dr("6200", 35), dr("1200", 480), cr("1010", 515));
    const s = score([combined]);
    expect(s.items.filter((i) => i.earned > 0)).toHaveLength(1);
    // Matching in candidate order would give the half-right first entry to "fee"; the best assignment uses the second.
    const s2 = score([entry(dr("6200", 35), cr("1010", 99)), PERFECT[0]]);
    expect(earned(s2).fee).toBe(3);
  });

  it("lists unmatched candidate entries for the reviewer without penalising them", () => {
    const s = score([...PERFECT, entry(dr("1010", 300), cr("5100", 300))]);
    expect(s.points).toBe(10);
    expect(s.maxPoints).toBe(10);
    expect(s.items.at(-1)).toMatchObject({ id: "unmatched-entries", earned: 0, max: 0 });
  });

  it("rounds to cents and never goes negative", () => {
    const odd = journalEntryServer.configSchema.parse({ ...config, expected: [{ id: "fee", label: "Fee", points: 1 }] });
    const s = journalEntryServer.score({
      config: odd,
      key: { ...key, entries: { fee: key.entries.fee } },
      variant,
      answer: { entries: [entry(dr("6200", 35), cr("1010", 35), dr("5100", 1), cr("1200", 1))] },
    });
    expect(s.points).toBe(0.5); // (2 - 1) / 2
    expect(Number.isInteger(s.points * 100)).toBe(true);
  });
});
