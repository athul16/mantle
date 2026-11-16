import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { demoMiniClose } = await import("@/lib/engine/scenarios/demo-mini-close");
const { listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt, parseAnswerForStep } = await import("@/lib/engine/server/score");
const { keyVariantScenario } = await import("./key-variants");

type SheetKey = { tolerance: number; cells: Record<string, { value: number }> };
type NumKey = { value: number };
type ReplyKey = { notes: Record<string, string> };
const keysFor = (seed: string) => {
  const k = demoMiniClose.generate(seed).keys;
  return { sheet: k["bank-rec"] as SheetKey, num: k["adjusted-balance"] as NumKey, reply: k["client-reply"] as ReplyKey };
};

const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);

describe("demo-mini-close generator", () => {
  it("is deterministic per seed", () => {
    for (const seed of SEEDS.slice(0, 20)) expect(demoMiniClose.generate(seed)).toEqual(demoMiniClose.generate(seed));
  });

  it("gives different numbers for different seeds", () => {
    const distinct = new Set(SEEDS.map((s) => JSON.stringify(demoMiniClose.generate(s).values)));
    expect(distinct.size).toBe(SEEDS.length);
  });

  it("always ties: both sides of the rec agree with the generated numbers", () => {
    for (const seed of SEEDS) {
      const v = demoMiniClose.generate(seed).values as Record<string, number | string>;
      const { sheet, num } = keysFor(seed);
      const c = Object.fromEntries(Object.entries(sheet.cells).map(([id, x]) => [id, Math.round(x.value * 100)]));
      const cleared = String(v.cleared_list);
      const outstanding = [1, 2, 3, 4]
        .filter((i) => !cleared.includes(`#${v[`chk${i}_no`]}`))
        .reduce((sum, i) => sum + Number(v[`chk${i}`]), 0);

      expect(c.dit).toBe(v.dit);
      expect(c.fee).toBe(v.fee);
      expect(c.oc_total).toBe(outstanding);
      expect(c.adj_bank).toBe(Number(v.bank) + c.dit - c.oc_total);
      expect(c.adj_book).toBe(Number(v.book) - c.fee);
      expect(c.adj_bank).toBe(c.adj_book);
      expect(Math.round(num.value * 100)).toBe(c.adj_bank);
      expect(c.adj_bank).toBeGreaterThan(0);
    }
  });
});

const PUBLIC_ID_FIELDS = new Set(["accounts", "side", "targets", "reasons", "decision", "choice", "correct"]);
/** Only id-shaped strings are skipped under those fields; a note or sentence there is still checked. */
const ID_LIKE = /^[A-Za-z0-9_.-]{1,64}$/;

describe("what the candidate receives (every scenario, many seeds)", () => {
  // Every form an amount could take in serialized output: 120.1, 120.10, 1,120.10, 12010 (cents).
  const leakPatterns = (value: number) => {
    const forms = [
      JSON.stringify(value),
      value.toFixed(2),
      String(Math.round(value * 100)),
      value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    ];
    // Bare 1-3 digit forms ("2" for $2.00) match ordinary text; the "2.00" form still covers them.
    return [...new Set(forms)]
      .filter((f) => !/^\d{1,3}$/.test(f))
      .map((s) => new RegExp(`(?<![\\d.,])${s.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`));
  };

  /**
   * Expected amounts (any `value` or `amount` field) and text notes inside a key, whatever its step type's shape.
   * Tolerances are skipped, and so are ids the material lists on purpose (account codes, flaggable items,
   * reasons, decision options, debit/credit side): they're in every candidate's choices, so they reveal nothing.
   */
  const keyLeaves = (
    key: unknown,
    out: { numbers: number[]; strings: string[] } = { numbers: [], strings: [] },
    field = "",
    publicIds = false,
  ): { numbers: number[]; strings: string[] } => {
    const ids = publicIds || PUBLIC_ID_FIELDS.has(field);
    if (typeof key === "number" && (field === "value" || field === "amount")) out.numbers.push(key);
    else if (typeof key === "string") {
      if (!(ids && ID_LIKE.test(key))) out.strings.push(key);
    } else if (Array.isArray(key)) for (const v of key) keyLeaves(v, out, field, ids);
    else if (key && typeof key === "object") for (const [k, v] of Object.entries(key)) keyLeaves(v, out, k, ids);
    return out;
  };

  it("skips public ids (multiple_choice's correct options among them) but still checks text under those fields", () => {
    expect(keyLeaves({ correct: ["ar", "cash"] }).strings).toEqual([]);
    expect(keyLeaves({ targets: ["invoice_no"], reasons: ["dup"], note: "Paid on Oct 3." }).strings).toEqual(["Paid on Oct 3."]);
    expect(keyLeaves({ correct: ["Paid on Oct 3."] }).strings).toEqual(["Paid on Oct 3."]);
    expect(keyLeaves({ decision: { note: "Hold: billed over the PO" } }).strings).toEqual(["Hold: billed over the PO"]);
    expect(keyLeaves({ correct: [{ value: 1234.5 }] }).numbers).toEqual([1234.5]);
  });

  it("multiple_choice and a clean document_review: the payload is the same whatever the key says", () => {
    const payloads = new Set<string>();
    const keys = new Set<string>();
    for (const seed of SEEDS.slice(0, 60)) {
      keys.add(JSON.stringify(keyVariantScenario.generate(seed).keys));
      payloads.add(JSON.stringify(renderAttemptForCandidate(keyVariantScenario, seed, 60)));
    }
    expect(keys.size).toBeGreaterThan(10);
    expect(payloads.size).toBe(1);
    const [payload] = payloads;
    expect(payload).toContain("Nothing wrong with this invoice");
    expect(payload).not.toMatch(/"correct"|"clean"|"points"|"findings"|Paid on Oct 3/);
  });

  for (const scenario of listScenarios()) {
    it(`${scenario.slug}: no derived key value, key note or rubric text in the payload`, () => {
      const rubricText = scenario.definition.steps.flatMap((s) => {
        const cfg = s.config as { criteria?: { label: string; guidance: string }[] };
        return (cfg.criteria ?? []).flatMap((c) => [c.label, c.guidance]);
      });
      let derivedChecked = 0;

      for (const seed of SEEDS) {
        const variant = scenario.generate(seed);
        const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, 24 * 60));
        expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"maxPoints"/);
        expect(payload).not.toContain("{{");
        for (const text of rubricText) expect(payload).not.toContain(text);

        // Amounts the material shows on purpose (e.g. the fee) are fine; anything derived must not appear.
        const shown = new Set(
          Object.values(variant.values)
            .filter((x): x is number => typeof x === "number")
            .map((cents) => cents / 100),
        );
        for (const [stepId, key] of Object.entries(variant.keys)) {
          const { numbers, strings } = keyLeaves(key);
          for (const n of numbers.filter((n) => n >= 1 && !shown.has(n))) {
            derivedChecked++;
            for (const p of leakPatterns(n)) expect(payload, `${seed} ${stepId} key ${n} leaked as ${p}`).not.toMatch(p);
          }
          for (const s of strings) expect(payload, `${seed} ${stepId} note leaked`).not.toContain(s);
        }
      }
      expect(derivedChecked).toBeGreaterThan(SEEDS.length);
    });
  }

  it("the leak check fires on a planted adjusted balance", () => {
    const adjusted = keysFor("abc").num.value;
    const money = adjusted.toLocaleString("en-US", { minimumFractionDigits: 2 });
    const planted = JSON.stringify({ body: "Adjusted: $" + money });
    expect(leakPatterns(adjusted).some((p) => p.test(planted))).toBe(true);
    expect(leakPatterns(adjusted).some((p) => p.test(JSON.stringify({ v: adjusted })))).toBe(true);
  });

  it("withholds scheduled messages and their steps until they arrive", () => {
    const ids = (m: number) => renderAttemptForCandidate(demoMiniClose, "abc", m);
    expect(ids(0).steps.map((s) => s.id)).toEqual(["bank-rec"]);
    expect(ids(5).steps.map((s) => s.id)).toEqual(["bank-rec", "adjusted-balance"]);
    expect(ids(10).messages.map((m) => m.id)).toEqual(["m3", "m2", "m1"]);
    expect(ids(10).steps.map((s) => s.type)).toEqual(["spreadsheet", "numeric", "inbox_reply"]);
  });
});

describe("scoring demo-mini-close", () => {
  const seed = "xyz";
  const { sheet, num } = keysFor(seed);
  const correctCells = Object.fromEntries(Object.entries(sheet.cells).map(([id, x]) => [id, x.value]));

  it("full marks on the auto-scored steps; the reply waits for review", () => {
    const result = scoreAttempt(demoMiniClose, seed, {
      "bank-rec": { cells: correctCells },
      "adjusted-balance": { value: num.value },
      "client-reply": { body: "Hi Marcus, the difference is timing." },
    });
    expect(result.steps["bank-rec"]).toMatchObject({ points: 8, maxPoints: 8 });
    expect(result.steps["adjusted-balance"]).toMatchObject({ points: 2, maxPoints: 2 });
    expect(result.steps["client-reply"]).toMatchObject({ points: 0, maxPoints: 9, needsReview: true });
    expect(result).toMatchObject({ points: 10, maxPoints: 19 });
  });

  it("partial credit per cell when the outstanding checks are wrong", () => {
    const result = scoreAttempt(demoMiniClose, seed, {
      "bank-rec": { cells: { ...correctCells, oc_total: correctCells.oc_total + 100, adj_bank: correctCells.adj_bank - 100 } },
    });
    const items = Object.fromEntries(result.steps["bank-rec"].items.map((i) => [i.id, i.earned]));
    expect(items).toEqual({ dit: 1, oc_total: 0, adj_bank: 0, fee: 1, adj_book: 2 });
    expect(result.steps["bank-rec"].points).toBe(4);
  });

  it("does not accept another seed's answers", () => {
    const other = keysFor("abc");
    const result = scoreAttempt(demoMiniClose, seed, {
      "bank-rec": { cells: Object.fromEntries(Object.entries(other.sheet.cells).map(([id, x]) => [id, x.value])) },
      "adjusted-balance": { value: other.num.value },
    });
    expect(result.steps["bank-rec"].points).toBe(0);
    expect(result.steps["adjusted-balance"].points).toBe(0);
  });

  it("scores empty and invalid attempts without throwing, for many seeds", () => {
    for (const s of SEEDS.slice(0, 50)) {
      expect(scoreAttempt(demoMiniClose, s, {})).toMatchObject({ points: 0, maxPoints: 19 });
    }
    const bad = scoreAttempt(demoMiniClose, seed, { "bank-rec": { cells: { dit: "lots" } }, "client-reply": { body: 5 } });
    expect(bad.points).toBe(0);
    expect(bad.steps["bank-rec"].items[0].note).toMatch(/not in a valid format/);
    expect(bad.steps["client-reply"].items[0].note).toMatch(/not in a valid format/);
  });

  it("parseAnswerForStep routes to the right step type", () => {
    expect(parseAnswerForStep(demoMiniClose, "bank-rec", { cells: { dit: 1 } })).toEqual({ cells: { dit: 1 } });
    expect(parseAnswerForStep(demoMiniClose, "client-reply", { body: "hi" })).toEqual({ body: "hi" });
    expect(() => parseAnswerForStep(demoMiniClose, "bank-rec", { body: "hi" })).toThrow();
    expect(() => parseAnswerForStep(demoMiniClose, "client-reply", { cells: {} })).toThrow();
  });
});
