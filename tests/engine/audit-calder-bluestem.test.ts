import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { auditCalderBluestem } = await import("@/lib/engine/scenarios/audit-calder-bluestem");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");

/**
 * docs/07 Example 5: audit intern at Calder & Finch LLP, Bluestem
 * Manufacturing's December 31 year-end, phase A (no rapid rounds yet).
 * These tests vouch the sample from what the candidate sees (the rendered
 * documents and emails), then compare that with the server key, so the
 * material and the key can't drift apart.
 */

const scenario = auditCalderBluestem;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const PHASE_A_MAX = 70;
const RUBRIC_MAX = 5 + 8; // controller reply + summary to Marcus

const STEPS = [
  ["vouch-1", "document_review"],
  ["vouch-2", "document_review"],
  ["vouch-3", "document_review"],
  ["vouch-4", "document_review"],
  ["controller-reply", "inbox_reply"],
  ["exception-count", "numeric"],
  ["exception-total", "numeric"],
  ["bank-confirm", "document_review"],
  ["misstatement-summary", "spreadsheet"],
  ["proposed-aje", "journal_entry"],
  ["marcus-summary", "inbox_reply"],
] as const;
const MAX_BY_STEP: Record<string, number> = {
  "vouch-1": 5,
  "vouch-2": 5,
  "vouch-3": 5,
  "vouch-4": 10,
  "controller-reply": 5,
  "exception-count": 2,
  "exception-total": 3,
  "bank-confirm": 5,
  "misstatement-summary": 14,
  "proposed-aje": 8,
  "marcus-summary": 8,
};
const AUTO_STEPS = STEPS.map(([id]) => id).filter((id) => id !== "controller-reply" && id !== "marcus-summary");

/** Arrival minute of each message and the step it delivers. */
const TIMELINE: [string, number, string][] = [
  ["m1", 0, "vouch-1"],
  ["m2", 8, "controller-reply"],
  ["m3", 15, "exception-count"],
  ["m4", 16, "exception-total"],
  ["m5", 22, "bank-confirm"],
  ["m6", 28, "misstatement-summary"],
  ["m7", 30, "proposed-aje"],
  ["m8", 32, "marcus-summary"],
];

type Trap = "amount" | "cutoff" | "personal" | "support";
const TRAPS: Trap[] = ["amount", "cutoff", "personal", "support"];

type Row = { id: string; cells: string[] };
type Doc = { title: string; columns: string[]; rows: Row[]; totals: { id: string; label: string; value: string }[] };
type ReviewCfg = { prompt: string; document: Doc; reasons: { id: string }[]; decision?: { options: { id: string; label: string }[] } };
type SheetCell = { kind: "text"; text: string } | { kind: "input"; id: string } | { kind: "empty" };
type KeyLine = { accounts: string[]; side: "debit" | "credit"; amount: number };
type JeKey = { entries: Record<string, { lines: KeyLine[] }> };
type SheetKey = { cells: Record<string, { value: number }> };
type NumKey = { value: number };
type ReviewKey = { findings: Record<string, { targets: string[]; reasons: string[]; note?: string }>; decision?: string[] };
type ReplyKey = { notes: Record<string, string> };

const cents = (s: string) => {
  const t = s.trim();
  if (t === "" || t === "—") return null;
  const neg = /^\(.*\)$/.test(t) || t.startsWith("-");
  const n = Math.round(Number(t.replace(/[()$,\s-]/g, "")) * 100);
  return neg ? -n : n;
};
const dollars = (c: number) => c / 100;
const money = (c: number) => `$${dollars(c).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

type VouchId = "vouch-1" | "vouch-2" | "vouch-3" | "vouch-4";
type Flag = { target: string; reason: string; note: string };
type ReviewAnswer = { flags: Flag[]; decision: string | null };

type Item = {
  n: number;
  step: VouchId;
  gl: { ref: string; date: string; payee: string; desc: string; account: string; amount: number };
  doc: { source: string; ref: string; date: string; payee: string; desc: string; amount: number | null };
};

/** Everything the candidate sees at the end of the attempt, parsed. */
function screen(seed: string, minute = scenario.timeLimitMinutes) {
  const view = renderAttemptForCandidate(scenario, seed, minute);
  const step = (id: string) => view.steps.find((s) => s.id === id)!;
  const items: Item[] = [];
  for (let k = 1; k <= 4; k++) {
    const cfg = step(`vouch-${k}`).config as ReviewCfg;
    expect(cfg.document.columns).toEqual(["Item", "Source", "Ref", "Date", "Payee", "Description", "Account", "Amount"]);
    expect(cfg.document.rows.length).toBe(4);
    for (const n of [2 * k - 1, 2 * k]) {
      const gl = cfg.document.rows.find((r) => r.id === `i${n}-gl`)!.cells;
      const doc = cfg.document.rows.find((r) => r.id === `i${n}-doc`)!.cells;
      expect(gl[0]).toBe(`#${n}`);
      expect(gl[1]).toBe("GL detail");
      items.push({
        n,
        step: `vouch-${k}` as VouchId,
        gl: { ref: gl[2], date: gl[3], payee: gl[4], desc: gl[5], account: gl[6], amount: cents(gl[7])! },
        doc: { source: doc[1], ref: doc[2], date: doc[3], payee: doc[4], desc: doc[5], amount: cents(doc[7]) },
      });
    }
  }
  const msg = (id: string) => view.messages.find((m) => m.id === id)!;
  return { view, step, items, msg };
}

/** What a careful auditor concludes for one sampled item, from the screen alone. */
function classify(it: Item): Trap | "clean" {
  if (/^No support/i.test(it.doc.source)) return "support";
  if (/\/2026$/.test(it.doc.date)) return "cutoff";
  if (it.doc.amount !== it.gl.amount) return "amount";
  if (/^6300/.test(it.gl.account) && !/Attendees:/i.test(it.doc.desc)) return "personal";
  return "clean";
}

/** The vouching result and the final numbers, in cents, from the screen. */
function solve(seed: string) {
  const { items, msg, step } = screen(seed);
  const traps = Object.fromEntries(TRAPS.map((t) => [t, items.filter((i) => classify(i) === t)])) as Record<Trap, Item[]>;
  const clean = items.filter((i) => classify(i) === "clean");
  const misstatement = (it: Item) => (classify(it) === "amount" ? it.gl.amount - it.doc.amount! : it.gl.amount);
  const one = (t: Trap) => traps[t][0];
  const total = TRAPS.reduce((s, t) => s + (traps[t].length ? misstatement(one(t)) : 0), 0);
  const memo = msg("m6").body;
  const ct = cents(memo.match(/Clearly trivial threshold: (\$[\d,.]+)/)![1])!;
  const bank = step("bank-confirm").config as ReviewCfg;
  return { items, traps, clean, one, misstatement, total, ct, propose: total >= ct, bank };
}

const entry = (dr: string, cr: string, amount: number, memo = "") => ({
  memo,
  lines: [
    { account: dr, debit: amount, credit: null as number | null },
    { account: cr, debit: null as number | null, credit: amount },
  ],
});
const code = (account: string) => account.slice(0, 4);

type Answers = Record<VouchId | "bank-confirm", ReviewAnswer> & {
  "controller-reply": { body: string };
  "exception-count": { value: number };
  "exception-total": { value: number };
  "misstatement-summary": { cells: Record<string, number | null> };
  "proposed-aje": { entries: ReturnType<typeof entry>[] };
  "marcus-summary": { body: string };
};

/** A strong candidate's answers, built only from the screen. */
function perfectAnswers(seed: string): Answers {
  const s = solve(seed);
  const vouch = Object.fromEntries([1, 2, 3, 4].map((k) => [`vouch-${k}`, { flags: [], decision: null }])) as Record<VouchId, ReviewAnswer>;
  for (const t of TRAPS) {
    const it = s.one(t);
    vouch[it.step].flags.push({ target: `i${it.n}-gl`, reason: t, note: "" });
  }
  vouch["vouch-4"].decision = "propose";
  const cells: Record<string, number | null> = {};
  for (const it of s.items) cells[`mis_${it.n}`] = classify(it) === "clean" ? 0 : dollars(s.misstatement(it));
  cells.total = dollars(s.total);
  cells.propose = s.propose ? 1 : 0;
  const amt = s.one("amount");
  return {
    ...vouch,
    "controller-reply": { body: "Hi Renee, we can't skip or swap a sampled item. Could you send the contract or engagement letter instead? Thanks" },
    "exception-count": { value: 4 },
    "exception-total": { value: dollars(s.total) },
    "bank-confirm": { flags: [{ target: "confirm", reason: "disagree", note: "" }], decision: "reconcile" },
    "misstatement-summary": { cells },
    "proposed-aje": {
      entries: [
        entry("2000", code(amt.gl.account), dollars(s.misstatement(amt)), "Invoice amount"),
        entry("2000", code(s.one("cutoff").gl.account), dollars(s.one("cutoff").gl.amount), "Cutoff"),
        entry("1250", code(s.one("personal").gl.account), dollars(s.one("personal").gl.amount), "Personal"),
        entry("2100", code(s.one("support").gl.account), dollars(s.one("support").gl.amount), "Unsupported accrual"),
      ],
    },
    "marcus-summary": { body: `Hi Marcus, 4 exceptions, total ${money(s.total)}. Thanks` },
  };
}

const clone = (a: Answers): Answers => JSON.parse(JSON.stringify(a));
const autoPoints = (seed: string, a: unknown) => {
  const r = scoreAttempt(scenario, seed, a as Record<string, unknown>);
  return AUTO_STEPS.reduce((t, id) => t + r.steps[id].points, 0);
};

describe("audit-calder-bluestem: setup", () => {
  it("is registered as v1, 50 minutes, accounting, phase A only (no sections), built step types", () => {
    expect(getScenario("audit-calder-bluestem", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(50);
    expect(scenario.roleFamily).toBe("accounting");
    expect(scenario.definition).not.toHaveProperty("sections");
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual(STEPS.map(([id, type]) => [id, type]));
    expect(scenario.definition.intro).toMatch(/Calder & Finch LLP/);
    expect(scenario.definition.intro).toMatch(/Bluestem Manufacturing/);
    expect(scenario.definition.intro).toMatch(/Marcus/);
    expect(scenario.definition.intro).toMatch(/December 31/);
  });

  it("renders for 200 seeds at every point in the timeline", () => {
    for (const seed of SEEDS) {
      for (const minute of [0, 8, 15, 16, 22, 28, 30, 32, scenario.timeLimitMinutes]) {
        const view = renderAttemptForCandidate(scenario, seed, minute);
        expect(JSON.stringify(view)).not.toContain("{{");
      }
    }
  });

  it("same seed, same scenario; different seeds change amounts, names, dates and document numbers", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(scenario.generate(seed)).toEqual(scenario.generate(seed));
      expect(renderAttemptForCandidate(scenario, seed, 50)).toEqual(renderAttemptForCandidate(scenario, seed, 50));
    }
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const all = SEEDS.slice(0, 50).map((s) => solve(s));
    expect(new Set(all.map((s) => s.total)).size).toBeGreaterThan(45);
    expect(new Set(all.map((s) => s.one("personal").gl.payee)).size).toBeGreaterThan(1);
    expect(new Set(all.map((s) => s.one("support").gl.payee)).size).toBeGreaterThan(1);
    expect(new Set(all.map((s) => s.one("cutoff").gl.date)).size).toBeGreaterThan(1);
    expect(new Set(all.map((s) => s.one("amount").doc.ref)).size).toBeGreaterThan(40);
    expect(new Set(all.map((s) => s.one("cutoff").n)).size).toBeGreaterThan(4); // trap positions move too
  });
});

describe("audit-calder-bluestem: every variant is internally consistent", () => {
  it("plants every trap exactly once, one per pair, and four clean items", () => {
    for (const seed of SEEDS) {
      const s = solve(seed);
      for (const t of TRAPS) expect(s.traps[t].length, `${seed} ${t}`).toBe(1);
      expect(s.clean.length, seed).toBe(4);
      expect(new Set(TRAPS.map((t) => s.one(t).step)).size, seed).toBe(4);
      for (const it of s.items) {
        expect(it.gl.date, `${seed} #${it.n} booked in December`).toMatch(/^12\/\d\d\/2025$/);
        expect(it.gl.amount).toBeGreaterThan(0);
      }
      for (const it of s.clean) {
        expect(it.doc.amount, `${seed} #${it.n}`).toBe(it.gl.amount);
        expect(it.doc.date).toMatch(/^12\/\d\d\/2025$/);
        expect(it.doc.payee).toBe(it.gl.payee);
      }
    }
  });

  it("the cutoff trap is a January 3 invoice for January work, booked in late December", () => {
    for (const seed of SEEDS) {
      const it = solve(seed).one("cutoff");
      expect(it.doc.date, seed).toBe("01/03/2026");
      expect(it.doc.desc).toMatch(/January|Jan\b/);
      expect(Number(it.gl.date.slice(3, 5))).toBeGreaterThanOrEqual(28);
      expect(it.doc.amount).toBe(it.gl.amount);
    }
  });

  it("the personal trap is booked as client entertainment, and its receipt shows no business purpose", () => {
    for (const seed of SEEDS) {
      const it = solve(seed).one("personal");
      expect(it.gl.desc, seed).toMatch(/client entertainment/i);
      expect(it.gl.account).toMatch(/^6300 /);
      expect(it.doc.amount).toBe(it.gl.amount);
      expect(it.doc.desc).not.toMatch(/Attendees:/);
      expect(it.doc.desc).toMatch(/cardholder/i);
    }
  });

  it("the amount trap: GL above the invoice; the unsupported item: a manual accrual with nothing behind it", () => {
    for (const seed of SEEDS) {
      const s = solve(seed);
      const a = s.one("amount");
      expect(a.doc.amount, seed).not.toBeNull();
      expect(a.gl.amount).toBeGreaterThan(a.doc.amount!);
      const u = s.one("support");
      expect(u.gl.ref).toMatch(/^JE-/);
      expect(u.gl.desc).toMatch(/accrual/i);
      expect(u.doc.amount).toBeNull();
    }
  });

  it("the key: misstatement equals the sum of the planted errors, and every number agrees with the screen", () => {
    for (const seed of SEEDS) {
      const s = solve(seed);
      const keys = scenario.generate(seed).keys;
      const sheet = (keys["misstatement-summary"] as SheetKey).cells;
      const c = (id: string) => Math.round(sheet[id].value * 100);
      const planted = TRAPS.map((t) => s.misstatement(s.one(t)));
      expect(c("total"), seed).toBe(planted.reduce((a, b) => a + b, 0));
      expect(c("total")).toBe(s.total);
      for (const t of TRAPS) expect(c(`mis_${s.one(t).n}`), `${seed} ${t}`).toBe(s.misstatement(s.one(t)));
      for (const it of s.clean) expect(sheet).not.toHaveProperty(`mis_${it.n}`);
      expect(sheet.propose.value).toBe(s.propose ? 1 : 0);
      expect(Math.round((keys["exception-total"] as NumKey).value * 100)).toBe(s.total);
      expect((keys["exception-count"] as NumKey).value).toBe(4);
    }
  });

  it("the key: every adjusting entry balances and together they take the misstatement out of expenses", () => {
    for (const seed of SEEDS) {
      const s = solve(seed);
      const je = scenario.generate(seed).keys["proposed-aje"] as JeKey;
      expect(Object.keys(je.entries).sort()).toEqual([...TRAPS].sort());
      let expenseCredit = 0;
      for (const [id, e] of Object.entries(je.entries)) {
        const sum = (side: string) => e.lines.filter((l) => l.side === side).reduce((t, l) => t + Math.round(l.amount * 100), 0);
        expect(sum("debit"), `${seed} ${id} balances`).toBe(sum("credit"));
        const exp = e.lines.filter((l) => l.side === "credit" && l.accounts.every((a) => a.startsWith("6")));
        expect(exp.length, `${seed} ${id} credits an expense`).toBe(1);
        expect(exp[0].accounts).toEqual([code(s.one(id as Trap).gl.account)]);
        expenseCredit += Math.round(exp[0].amount * 100);
      }
      expect(expenseCredit, seed).toBe(s.total);
      expect(je.entries.personal.lines.find((l) => l.side === "debit")!.accounts).toEqual(["1250"]);
      expect(je.entries.support.lines.find((l) => l.side === "debit")!.accounts).toEqual(["2100"]);
    }
  });

  it("the key: each vouching step's finding is the planted trap in that pair", () => {
    for (const seed of SEEDS) {
      const s = solve(seed);
      const keys = scenario.generate(seed).keys;
      for (const t of TRAPS) {
        const it = s.one(t);
        const f = (keys[it.step] as ReviewKey).findings.exception;
        expect(f.targets, `${seed} ${t}`).toContain(`i${it.n}-gl`);
        expect(f.reasons).toEqual([t]);
      }
      expect((keys["vouch-4"] as ReviewKey).decision).toEqual(["propose"]);
    }
  });

  it("materiality: pass and propose both occur, the threshold is never equal to the total, and the memo figures agree", () => {
    let proposals = 0;
    for (const seed of SEEDS) {
      const s = solve(seed);
      if (s.propose) proposals++;
      expect(s.ct).not.toBe(s.total);
      const memo = screen(seed).msg("m6").body;
      const mat = cents(memo.match(/Overall materiality: (\$[\d,.]+)/)![1])!;
      const pm = cents(memo.match(/Performance materiality: (\$[\d,.]+)/)![1])!;
      expect(pm).toBe(Math.round(mat * 0.75));
      expect(s.ct).toBe(Math.round(mat * 0.05));
    }
    expect(proposals).toBeGreaterThan(SEEDS.length * 0.3);
    expect(proposals).toBeLessThan(SEEDS.length * 0.7);
  });

  it("the bank confirmation differs from the lead schedule by the amount Marcus quotes", () => {
    for (const seed of SEEDS) {
      const { bank } = solve(seed);
      const row = (id: string) => cents(bank.document.rows.find((r) => r.id === id)!.cells[1])!;
      const diff = row("confirm") - row("lead");
      expect(diff, seed).not.toBe(0);
      const shown = cents(bank.document.totals.find((t) => t.id === "difference")!.value)!;
      expect(Math.abs(shown)).toBe(Math.abs(diff));
      expect(screen(seed).msg("m5").body).toContain(money(Math.abs(diff)));
    }
  });
});

describe("audit-calder-bluestem: scoring", () => {
  it("is out of 70 in phase A, and a blank attempt scores 0", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(PHASE_A_MAX);
    for (const [id, max] of Object.entries(MAX_BY_STEP)) expect(blank.steps[id].maxPoints, id).toBe(max);
    const part = (ids: string[]) => ids.reduce((t, id) => t + MAX_BY_STEP[id], 0);
    expect(part(["vouch-1", "vouch-2", "vouch-3", "vouch-4"])).toBe(25);
    expect(part(["controller-reply", "exception-count", "exception-total", "bank-confirm"])).toBe(15);
    expect(part(["misstatement-summary", "proposed-aje", "marcus-summary"])).toBe(30);
  });

  it("a perfect answer earns every automatic point, and the replies go to review", () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const r = scoreAttempt(scenario, seed, perfectAnswers(seed));
      for (const id of AUTO_STEPS) expect(r.steps[id].points, `${seed} ${id}`).toBe(r.steps[id].maxPoints);
      expect(autoPoints(seed, perfectAnswers(seed))).toBeCloseTo(PHASE_A_MAX - RUBRIC_MAX, 9);
      expect(r.steps["controller-reply"].needsReview).toBe(true);
      expect(r.steps["marcus-summary"].needsReview).toBe(true);
    }
  });

  it("a perfect answer is the phase-A max once a reviewer gives both replies full marks", () => {
    const r = scoreAttempt(scenario, "abc", perfectAnswers("abc"));
    const reviewed = r.points + RUBRIC_MAX - r.steps["controller-reply"].points - r.steps["marcus-summary"].points;
    expect(reviewed).toBeCloseTo(PHASE_A_MAX, 9);
  });

  it("another seed's perfect answer doesn't score well (answers can't be shared)", () => {
    let total = 0;
    for (const seed of SEEDS.slice(1, 21)) total += autoPoints(seed, perfectAnswers(SEEDS[0]));
    expect(total / 20).toBeLessThan((PHASE_A_MAX - RUBRIC_MAX) * 0.6);
  });

  describe("each trap answered wrongly costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    const full = PHASE_A_MAX - RUBRIC_MAX;

    for (const t of TRAPS) {
      it(`vouching: missing the ${t} trap costs its 5 points`, () => {
        for (const seed of seeds) {
          const a = clone(perfectAnswers(seed));
          const it = solve(seed).one(t);
          a[it.step].flags = a[it.step].flags.filter((f) => f.target !== `i${it.n}-gl`);
          expect(autoPoints(seed, a), `${seed} ${t}`).toBeCloseTo(full - 5, 9);
        }
      });

      it(`vouching: the ${t} item flagged with the wrong reason gets half (2.5)`, () => {
        for (const seed of seeds) {
          const a = clone(perfectAnswers(seed));
          const it = solve(seed).one(t);
          a[it.step].flags.find((f) => f.target === `i${it.n}-gl`)!.reason = "other";
          expect(autoPoints(seed, a), `${seed} ${t}`).toBeCloseTo(full - 2.5, 9);
        }
      });

      it(`final: leaving the ${t} entry out of the adjusting entries costs its 2 points`, () => {
        const idx = TRAPS.indexOf(t);
        for (const seed of seeds) {
          const a = clone(perfectAnswers(seed));
          a["proposed-aje"].entries.splice(idx, 1);
          expect(autoPoints(seed, a), `${seed} ${t}`).toBeCloseTo(full - 2, 9);
        }
      });
    }

    it("cutoff trap: treating the January invoice as a December expense (no misstatement) costs its cell", () => {
      for (const seed of seeds) {
        const a = clone(perfectAnswers(seed));
        a["misstatement-summary"].cells[`mis_${solve(seed).one("cutoff").n}`] = 0;
        expect(autoPoints(seed, a), seed).toBeCloseTo(full - 2, 9);
      }
    });

    it("cutoff trap missed everywhere: lose the flag, the cell, the entry, both totals and maybe the pass/propose call", () => {
      for (const seed of seeds) {
        const s = solve(seed);
        const it = s.one("cutoff");
        const a = clone(perfectAnswers(seed));
        a[it.step].flags = a[it.step].flags.filter((f) => f.target !== `i${it.n}-gl`);
        const wrongTotal = s.total - it.gl.amount;
        const cells = a["misstatement-summary"].cells;
        cells[`mis_${it.n}`] = 0;
        cells.total = dollars(wrongTotal);
        cells.propose = wrongTotal >= s.ct ? 1 : 0;
        a["exception-count"].value = 3;
        a["exception-total"].value = dollars(wrongTotal);
        a["proposed-aje"].entries.splice(1, 1);
        const flipped = (wrongTotal >= s.ct) !== s.propose;
        expect(autoPoints(seed, a), seed).toBeCloseTo(full - 5 - 2 - 2 - 2 - 2 - 3 - (flipped ? 4 : 0), 9);
      }
    });

    it("personal trap: reclassing to another expense instead of the officer receivable earns half the entry", () => {
      for (const seed of seeds) {
        const a = clone(perfectAnswers(seed));
        a["proposed-aje"].entries[2].lines[0].account = "6600";
        // Credit line right, debit line wrong account: one of two lines, minus half a line for the leftover.
        expect(autoPoints(seed, a), seed).toBeCloseTo(full - 2 + 2 * ((1 - 0.5) / 2), 9);
      }
    });

    it("personal trap: accepting it as entertainment (no misstatement) costs its cell", () => {
      for (const seed of seeds) {
        const a = clone(perfectAnswers(seed));
        a["misstatement-summary"].cells[`mis_${solve(seed).one("personal").n}`] = 0;
        expect(autoPoints(seed, a), seed).toBeCloseTo(full - 2, 9);
      }
    });

    it("amount trap: taking the whole GL amount instead of the difference costs the cell", () => {
      for (const seed of seeds) {
        const a = clone(perfectAnswers(seed));
        const it = solve(seed).one("amount");
        a["misstatement-summary"].cells[`mis_${it.n}`] = dollars(it.gl.amount);
        expect(autoPoints(seed, a), seed).toBeCloseTo(full - 2, 9);
      }
    });

    it("the wrong pass/propose call costs 4", () => {
      for (const seed of seeds) {
        const a = clone(perfectAnswers(seed));
        a["misstatement-summary"].cells.propose = solve(seed).propose ? 0 : 1;
        expect(autoPoints(seed, a), seed).toBeCloseTo(full - 4, 9);
      }
    });

    it("the wrong sample conclusion costs 5; replacing the exception items is wrong", () => {
      for (const seed of seeds) {
        const a = clone(perfectAnswers(seed));
        a["vouch-4"].decision = "replace";
        expect(autoPoints(seed, a), seed).toBeCloseTo(full - 5, 9);
      }
    });

    it("flagging a clean item costs 1", () => {
      for (const seed of seeds) {
        const s = solve(seed);
        const a = clone(perfectAnswers(seed));
        const c = s.clean[0];
        a[c.step].flags.push({ target: `i${c.n}-gl`, reason: "amount", note: "" });
        expect(autoPoints(seed, a), seed).toBeCloseTo(full - 1, 9);
      }
    });

    it("bank confirmation: adjusting cash straight to the confirmed balance is wrong (3); not flagging it costs 2", () => {
      for (const seed of seeds) {
        const a = clone(perfectAnswers(seed));
        a["bank-confirm"].decision = "adjust";
        expect(autoPoints(seed, a), seed).toBeCloseTo(full - 3, 9);
        a["bank-confirm"].flags = [];
        expect(autoPoints(seed, a), seed).toBeCloseTo(full - 5, 9);
      }
    });

    it("Marcus's numbers: wrong count costs 2, wrong total costs 3", () => {
      for (const seed of seeds) {
        const a = clone(perfectAnswers(seed));
        a["exception-count"].value = 3;
        expect(autoPoints(seed, a), seed).toBeCloseTo(full - 2, 9);
        a["exception-total"].value = a["exception-total"].value + 100;
        expect(autoPoints(seed, a), seed).toBeCloseTo(full - 5, 9);
      }
    });
  });

  it("blank replies are final at 0 and aren't sent to review", () => {
    const a = clone(perfectAnswers("abc"));
    a["controller-reply"].body = " ";
    a["marcus-summary"].body = "";
    const r = scoreAttempt(scenario, "abc", a);
    for (const id of ["controller-reply", "marcus-summary"]) {
      expect(r.steps[id].points).toBe(0);
      expect(r.steps[id].needsReview).toBe(false);
    }
  });

  it("gives reviewers this variant's facts", () => {
    const s = solve("abc");
    const keys = scenario.generate("abc").keys;
    const summary = (keys["marcus-summary"] as ReplyKey).notes;
    const r = scoreAttempt(scenario, "abc", perfectAnswers("abc"));
    expect(r.steps["marcus-summary"].items.map((i) => [i.id, i.max])).toEqual([
      ["numbers", 3],
      ["exceptions", 3],
      ["clarity", 2],
    ]);
    expect(r.steps["controller-reply"].items.map((i) => [i.id, i.max])).toEqual([
      ["declines", 2],
      ["alternative", 2],
      ["courtesy", 1],
    ]);
    expect(summary.numbers).toContain(money(s.total));
    expect(summary.numbers).toContain(money(s.ct));
    expect(summary.numbers).toMatch(s.propose ? /propose/i : /pass/i);
    expect(summary.exceptions).toContain(s.one("cutoff").gl.payee);
    expect(summary.exceptions).toContain(s.one("personal").gl.payee);
    const controller = (keys["controller-reply"] as ReplyKey).notes;
    expect(controller.declines).toContain(s.one("support").gl.payee);
  });
});

describe("audit-calder-bluestem: nothing derived reaches the candidate", () => {
  const forms = (c: number) => {
    const d = dollars(Math.abs(c));
    return [d.toFixed(2), d.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), String(Math.abs(c))];
  };
  const contains = (payload: string, form: string) => new RegExp(`(?<![\\d.,])${form.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`).test(payload);

  it("no total misstatement, invoice difference or reviewer note in any payload", () => {
    for (const seed of SEEDS) {
      const s = solve(seed);
      const variant = scenario.generate(seed);
      const notes = Object.values(variant.keys).flatMap((k) => {
        const key = k as Partial<ReplyKey & ReviewKey>;
        return [...Object.values(key.notes ?? {}), ...Object.values(key.findings ?? {}).map((f) => f.note ?? "")].filter(Boolean);
      });
      expect(notes.length).toBeGreaterThan(4);
      for (const minute of [0, 16, 28, scenario.timeLimitMinutes]) {
        const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
        expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"/);
        for (const c of [s.total, s.misstatement(s.one("amount"))]) {
          for (const f of forms(c)) expect(contains(payload, f), `${seed} m${minute}: ${f}`).toBe(false);
        }
        for (const n of notes) expect(payload).not.toContain(n);
      }
    }
  });
});

describe("audit-calder-bluestem: timeline", () => {
  const msgs = scenario.definition.messages;

  it("messages arrive over the 50 minutes, each delivering its task", () => {
    expect(msgs.map((m) => [m.id, m.arriveAtMinute ?? 0, m.stepId])).toEqual(TIMELINE);
    for (const m of msgs) expect(m.arriveAtMinute ?? 0).toBeLessThan(scenario.timeLimitMinutes - 10);
    expect(msgs.find((m) => m.id === "m2")!.from).toMatch(/Controller, Bluestem Manufacturing/);
    for (const id of ["m1", "m3", "m4", "m5", "m6", "m7", "m8"]) expect(msgs.find((m) => m.id === id)!.from).toMatch(/^Marcus/);
  });

  it("the four vouching pairs are open from the start; every other task waits for its message", () => {
    for (const [, minute, stepId] of TIMELINE) {
      const before = renderAttemptForCandidate(scenario, "abc", minute - 0.5).steps.map((s) => s.id);
      const at = renderAttemptForCandidate(scenario, "abc", minute).steps.map((s) => s.id);
      if (minute > 0) expect(before).not.toContain(stepId);
      expect(at).toContain(stepId);
    }
    expect(renderAttemptForCandidate(scenario, "abc", 0).steps.map((s) => s.id)).toEqual(["vouch-1", "vouch-2", "vouch-3", "vouch-4"]);
    expect(renderAttemptForCandidate(scenario, "abc", 7).messages.map((m) => m.id)).toEqual(["m1"]);
  });

  it("Marcus greets the candidate by first name", () => {
    expect(renderAttemptForCandidate(scenario, "abc", 0, { name: "Priya Raman" }).messages[0].body).toMatch(/^Hi Priya,\n/);
    expect(renderAttemptForCandidate(scenario, "abc", 0).messages[0].body).toMatch(/^Hi there,\n/);
  });

  it("the controller asks to skip the unsupported item, and Marcus's messages carry this variant's figures", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const s = solve(seed);
      const { msg } = screen(seed);
      expect(msg("m2").body, seed).toContain(s.one("support").gl.payee);
      expect(msg("m2").body).toMatch(/skip/i);
      expect(msg("m3").body).toMatch(/how many/i);
      expect(msg("m6").body).toMatch(/Clearly trivial threshold/);
      expect(msg("m6").body).toMatch(/pass/i);
      expect(msg("m6").body).toMatch(/propose/i);
    }
  });
});
