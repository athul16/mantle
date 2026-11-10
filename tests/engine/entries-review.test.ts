import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { demoEntriesReview } = await import("@/lib/engine/scenarios/demo-entries-review");
const { renderAttemptForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");

type KeyLine = { accounts: string[]; side: "debit" | "credit"; amount: number };
type JeKey = { entries: Record<string, { lines: KeyLine[] }> };
type ReviewKey = { findings: Record<string, { targets: string[]; reasons: string[] }>; decision: string[] };

const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const parseMoney = (s: string) => Math.round(Number(s.replace(/[$,]/g, "")) * 100);

/** The answer a strong candidate gives from what's on screen. */
function perfectAnswers(seed: string) {
  const v = demoEntriesReview.generate(seed).values as Record<string, number | string>;
  const d = (cents: number | string) => Number(cents) / 100;
  const e = (drAcct: string, crAcct: string, amount: number) => ({
    memo: "",
    lines: [
      { account: drAcct, debit: amount, credit: null },
      { account: crAcct, debit: null, credit: amount },
    ],
  });
  const view = renderAttemptForCandidate(demoEntriesReview, seed, 60);
  const invoice = view.steps.find((s) => s.id === "invoice-review")!.config as {
    document: { rows: { id: string; cells: string[] }[] };
  };
  const wrong = invoice.document.rows.find((r) => Number(r.cells[1]) * parseMoney(r.cells[2]) !== parseMoney(r.cells[3]))!;
  return {
    "rec-entries": {
      entries: [
        e("6200", "1010", d(v.fee)),
        e("1200", "1010", d(v.nsf)),
        e("1010", "7100", d(v.interest)),
        e("5100", "1010", Math.round(Number(v.chk_cleared) - Number(v.chk_booked)) / 100),
      ],
    },
    "invoice-review": {
      flags: [
        { target: wrong.id, reason: "math", note: "qty × price is less" },
        { target: "invoice_no", reason: "duplicate", note: "paid in Sept" },
      ],
      decision: "reject",
    },
  };
}

describe("demo-entries-review generator", () => {
  it("is deterministic per seed and varies across seeds", () => {
    for (const seed of SEEDS.slice(0, 20)) expect(demoEntriesReview.generate(seed)).toEqual(demoEntriesReview.generate(seed));
    expect(new Set(SEEDS.map((s) => JSON.stringify(demoEntriesReview.generate(s).values))).size).toBe(SEEDS.length);
  });

  it("produces keys that agree with the material", () => {
    const wrongRows = new Set<string>();
    for (const seed of SEEDS) {
      const { values: v, keys } = demoEntriesReview.generate(seed) as { values: Record<string, number | string>; keys: Record<string, unknown> };
      const je = keys["rec-entries"] as JeKey;
      expect(je.entries.fee.lines[0].amount * 100).toBeCloseTo(Number(v.fee));
      expect(je.entries.nsf.lines[1].amount * 100).toBeCloseTo(Number(v.nsf));
      // Transposition: positive, a multiple of $90, and the booked amount has the same digits.
      const fix = je.entries.transposition.lines[0].amount;
      expect(fix).toBeGreaterThan(0);
      expect(fix % 90).toBe(0);
      expect([...String(v.chk_booked)].sort().join("")).toBe([...String(v.chk_cleared)].sort().join(""));

      const review = keys["invoice-review"] as ReviewKey;
      const [row] = review.findings["line-math"].targets;
      wrongRows.add(row);
      const qty = Number(v[`${row}_qty`]);
      const price = Number(v[`${row}_price`]);
      expect(Number(v[`${row}_amount`])).toBeGreaterThan(qty * price);
      for (const other of ["mulch", "straw", "rock"].filter((r) => r !== row)) {
        expect(Number(v[`${other}_amount`])).toBe(Number(v[`${other}_qty`]) * Number(v[`${other}_price`]));
      }
      expect(Number(v.total)).toBe(["mulch", "straw", "rock"].reduce((s, r) => s + Number(v[`${r}_amount`]), 0));
      expect([v.paid_1, v.paid_2]).toContain(v.inv_no);
    }
    expect(wrongRows.size).toBe(3);
  });

  it("delivers the invoice task at minute 8", () => {
    expect(renderAttemptForCandidate(demoEntriesReview, "abc", 0).steps.map((s) => s.id)).toEqual(["rec-entries"]);
    expect(renderAttemptForCandidate(demoEntriesReview, "abc", 8).steps.map((s) => s.id)).toEqual(["rec-entries", "invoice-review"]);
  });
});

describe("demo-entries-review scoring", () => {
  it("a strong candidate gets full marks on every seed", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const s = scoreAttempt(demoEntriesReview, seed, perfectAnswers(seed));
      expect(s.points, seed).toBe(s.maxPoints);
    }
    expect(scoreAttempt(demoEntriesReview, "abc", {})).toMatchObject({ points: 0, maxPoints: 17 });
  });

  it("another seed's answer doesn't score well (anti-leak)", () => {
    const s = scoreAttempt(demoEntriesReview, "attempt-0001", perfectAnswers("attempt-0000"));
    expect(s.points).toBeLessThan(s.maxPoints);
  });

  it("accepts Accounts payable for the transposition fix", () => {
    const a = perfectAnswers("abc");
    a["rec-entries"].entries[3].lines[0].account = "2000";
    const s = scoreAttempt(demoEntriesReview, "abc", a);
    expect(s.steps["rec-entries"].points).toBe(12);
  });

  it("scores a malformed saved answer as 0 instead of failing the attempt", () => {
    const s = scoreAttempt(demoEntriesReview, "abc", {
      "rec-entries": { entries: "nope" },
      "invoice-review": { flags: [{ target: "x" }, { target: "x" }] },
    });
    expect(s.points).toBe(0);
    expect(s.steps["invoice-review"].items[0].note).toBe("Saved answer was not in a valid format.");
  });
});
