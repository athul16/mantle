import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const { auditCalderBluestem } = await import("@/lib/engine/scenarios/audit-calder-bluestem");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { getServerStepType } = await import("@/lib/engine/server/registry");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";

/**
 * docs/07 Example 5: audit intern at Calder & Finch LLP, Bluestem
 * Manufacturing's December 31 year-end. Phase A (vouching, inbox, proposed
 * adjustment, 70 points) plus phase B (three rapid rounds, 30 points, and
 * timed sections). These tests solve the work from what the candidate sees
 * (the rendered documents, emails and rapid items), then compare that with
 * the server key, so the material and the key can't drift apart.
 */

const scenario = auditCalderBluestem;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const TOTAL_MAX = 100;
const RUBRIC_MAX = 5 + 8; // controller reply + summary to Marcus
const TIME_LIMIT = 52;

const STEPS = [
  ["rapid-tick", "rapid_round"],
  ["vouch-1", "document_review"],
  ["vouch-2", "document_review"],
  ["vouch-3", "document_review"],
  ["vouch-4", "document_review"],
  ["vouch-conclusion", "multiple_choice"],
  ["rapid-cutoff", "rapid_round"],
  ["controller-reply", "inbox_reply"],
  ["exception-count", "numeric"],
  ["exception-total", "numeric"],
  ["bank-confirm", "document_review"],
  ["rapid-sample", "rapid_round"],
  ["misstatement-summary", "spreadsheet"],
  ["pass-or-propose", "multiple_choice"],
  ["proposed-aje", "journal_entry"],
  ["marcus-summary", "inbox_reply"],
] as const;
const RAPID_STEPS = ["rapid-tick", "rapid-cutoff", "rapid-sample"] as const;
type RapidId = (typeof RAPID_STEPS)[number];

/** Section id, minutes, one at a time, steps (docs/07 Example 5, "Sections"). */
const SECTIONS: [string, number, boolean, string[]][] = [
  ["s-rapid-a", 6, false, ["rapid-tick"]],
  ["s-vouch", 12, true, ["vouch-1", "vouch-2", "vouch-3", "vouch-4", "vouch-conclusion"]],
  ["s-rapid-b", 6, false, ["rapid-cutoff"]],
  ["s-inbox", 10, true, ["controller-reply", "exception-count", "exception-total", "bank-confirm"]],
  ["s-rapid-c", 6, false, ["rapid-sample"]],
  ["s-wrap", 12, false, ["misstatement-summary", "pass-or-propose", "proposed-aje", "marcus-summary"]],
];

const MAX_BY_STEP: Record<string, number> = {
  "rapid-tick": 10,
  "rapid-cutoff": 10,
  "rapid-sample": 10,
  "vouch-1": 5,
  "vouch-2": 5,
  "vouch-3": 5,
  "vouch-4": 5,
  "vouch-conclusion": 5,
  "controller-reply": 5,
  "exception-count": 2,
  "exception-total": 3,
  "bank-confirm": 5,
  "misstatement-summary": 10,
  "pass-or-propose": 4,
  "proposed-aje": 8,
  "marcus-summary": 8,
};
const AUTO_STEPS: string[] = STEPS.map(([id]) => id).filter((id) => id !== "controller-reply" && id !== "marcus-summary");

/** Each message and the step it delivers; every one arrives when that step's section starts. */
const MESSAGES: [string, string][] = [
  ["m-tick", "rapid-tick"],
  ["m1", "vouch-1"],
  ["m-cutoff", "rapid-cutoff"],
  ["m2", "controller-reply"],
  ["m3", "exception-count"],
  ["m4", "exception-total"],
  ["m5", "bank-confirm"],
  ["m-sample", "rapid-sample"],
  ["m6", "misstatement-summary"],
  ["m7", "proposed-aje"],
  ["m8", "marcus-summary"],
];

type Trap = "amount" | "cutoff" | "personal" | "support";
const TRAPS: Trap[] = ["amount", "cutoff", "personal", "support"];

type Row = { id: string; cells: string[] };
type Doc = { title: string; columns: string[]; rows: Row[]; totals: { id: string; label: string; value: string }[] };
type ReviewCfg = { prompt: string; document: Doc; reasons: { id: string }[]; decision?: { options: { id: string; label: string }[] } };
type KeyLine = { accounts: string[]; side: "debit" | "credit"; amount: number };
type JeKey = { entries: Record<string, { lines: KeyLine[] }> };
type SheetKey = { cells: Record<string, { value: number }> };
type NumKey = { value: number };
type ReviewKey = { findings: Record<string, { targets: string[]; reasons: string[]; note?: string }>; decision?: string[] };
type ReplyKey = { notes: Record<string, string> };
type ChoiceCfg = { prompt: string; options: { id: string; label: string }[]; select: "single" | "multi" };
type ChoiceKey = { correct: string[] };

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

/* ---------- Rapid rounds: render each item as the candidate gets it, then solve it from the screen ---------- */

const RR = getServerStepType("rapid_round");

/** Every item of a rapid step, rendered one at a time through the step type's sequence hook. */
function rapidItems(seed: string, stepId: RapidId): RapidItem[] {
  const variant = scenario.generate(seed);
  const values = templateValues(variant.values);
  const fill = (t: string) => fillTemplate(t, values);
  const step = scenario.definition.steps.find((s) => s.id === stepId)!;
  const cfg = RR.configSchema.parse(step.config);
  const seq = RR.sequence!;
  return Array.from({ length: seq.count(cfg) }, (_, i) => seq.renderItem(cfg, { variant, fill }, i) as RapidItem);
}

const choiceFields = (item: RapidItem) => item.fields as RapidChoiceField[];
const field = (item: RapidItem, id: string) => choiceFields(item).find((f) => f.id === id)!;
const yearOf = (date: string) => Number(date.slice(-4));
const amountOf = (s: string) => cents(s)!;

/**
 * Tick and tie: schedule column against source-document column, rows
 * Reference / party / Date / figure. Returns the options a careful auditor
 * would pick, as a list, so a test can demand exactly one per field.
 */
function solveTick(item: RapidItem): Record<string, string[]> {
  const t = item.exhibit!.table!;
  expect(t.rows.length).toBe(4);
  if (/not on file/i.test(t.rows[0][2])) return { result: ["exception"], reason: ["no_support"] };
  const diffs = t.rows.map((r, i) => (r[1] !== r[2] ? i : -1)).filter((i) => i >= 0);
  if (diffs.length === 0) return { result: ["agrees"], reason: ["na"] };
  const reasons = diffs.map((i) => ({ 0: "ref", 1: "vendor", 2: "cutoff", 3: "amount" })[i]!);
  return { result: ["exception"], reason: reasons };
}

/** Cutoff: ownership passes at shipment (FOB shipping point) or delivery (FOB destination). */
function solveCutoff(item: RapidItem): Record<string, string[]> {
  const row = (label: string) => item.exhibit!.rows!.find((r) => r.label === label)!.value;
  const terms = row("Terms");
  expect(terms).toMatch(/^FOB (shipping point|destination)$/);
  const year = yearOf(terms === "FOB shipping point" ? row("Shipped") : row("Delivered"));
  return { year: [`y${year}`], recorded: [yearOf(row("Recorded in GL")) === year ? "yes" : "no"] };
}

/** Sample selection: which line the rule picks, how many it picks, or which check number is missing. */
function solveSample(item: RapidItem): Record<string, string[]> {
  const f = choiceFields(item)[0];
  const rows = item.exhibit!.table!.rows;
  if (f.id === "missing") {
    const nos = rows.map((r) => Number(r[0].replace("#", "")));
    const missing: number[] = [];
    for (let x = Math.min(...nos); x <= Math.max(...nos); x++) if (!nos.includes(x)) missing.push(x);
    expect(missing.length).toBe(1);
    return { missing: f.options.filter((o) => o.label === `#${missing[0]}`).map((o) => o.id) };
  }
  const thr = amountOf(item.prompt.match(/over (\$[\d,]+\.\d\d)/)![1]);
  const [, k, start] = item.prompt.match(/every (\d+)(?:st|nd|rd|th) item number starting at #(\d+)/)!.map(Number);
  const picked = rows.filter((r) => {
    const no = Number(r[1].replace("#", ""));
    return amountOf(r[2]) > thr || (no >= start && (no - start) % k === 0);
  });
  if (f.id === "line") return { line: picked.map((r) => r[0].toLowerCase()) };
  return { count: f.options.filter((o) => o.label === String(picked.length)).map((o) => o.id) };
}

const SOLVERS: Record<RapidId, (item: RapidItem) => Record<string, string[]>> = {
  "rapid-tick": solveTick,
  "rapid-cutoff": solveCutoff,
  "rapid-sample": solveSample,
};
type RapidKey = { items: Record<string, Record<string, { choice?: string; value?: number }>> };

/** The candidate's rapid answers, solved from the screen (each field must have exactly one right option). */
function rapidAnswers(seed: string, stepId: RapidId) {
  const items: Record<string, { values: Record<string, string>; ms: number }> = {};
  for (const item of rapidItems(seed, stepId)) {
    const solved = SOLVERS[stepId](item);
    const values: Record<string, string> = {};
    for (const [fid, opts] of Object.entries(solved)) {
      expect(opts.length, `${seed} ${item.id} ${fid}: ${opts}`).toBe(1);
      values[fid] = opts[0];
    }
    items[item.id] = { values, ms: 6_000 };
  }
  return { items };
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
  "vouch-conclusion": { selected: string[] };
  "pass-or-propose": { selected: string[] };
  "proposed-aje": { entries: ReturnType<typeof entry>[] };
  "marcus-summary": { body: string };
} & Record<RapidId, ReturnType<typeof rapidAnswers>>;

/** A strong candidate's answers, built only from the screen. */
function perfectAnswers(seed: string): Answers {
  const s = solve(seed);
  const blank = (): ReviewAnswer => ({ flags: [], decision: null });
  const vouch: Record<VouchId, ReviewAnswer> = { "vouch-1": blank(), "vouch-2": blank(), "vouch-3": blank(), "vouch-4": blank() };
  for (const t of TRAPS) {
    const it = s.one(t);
    vouch[it.step].flags.push({ target: `i${it.n}-gl`, reason: t, note: "" });
  }
  const cells: Record<string, number | null> = {};
  for (const it of s.items) cells[`mis_${it.n}`] = classify(it) === "clean" ? 0 : dollars(s.misstatement(it));
  cells.total = dollars(s.total);
  const amt = s.one("amount");
  return {
    ...vouch,
    "vouch-conclusion": { selected: ["propose"] },
    "pass-or-propose": { selected: [s.propose ? "propose" : "pass"] },
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
    "rapid-tick": rapidAnswers(seed, "rapid-tick"),
    "rapid-cutoff": rapidAnswers(seed, "rapid-cutoff"),
    "rapid-sample": rapidAnswers(seed, "rapid-sample"),
  };
}

const clone = (a: Answers): Answers => JSON.parse(JSON.stringify(a));
const autoPoints = (seed: string, a: unknown) => {
  const r = scoreAttempt(scenario, seed, a as Record<string, unknown>);
  return AUTO_STEPS.reduce((t, id) => t + r.steps[id].points, 0);
};

describe("audit-calder-bluestem: setup", () => {
  it("is registered as v1 (not yet published), 52 minutes, accounting, in timed sections", () => {
    expect(getScenario("audit-calder-bluestem", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(TIME_LIMIT);
    expect(scenario.roleFamily).toBe("accounting");
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual(STEPS.map(([id, type]) => [id, type]));
    expect(scenario.definition.intro).toMatch(/Calder & Finch LLP/);
    expect(scenario.definition.intro).toMatch(/Bluestem Manufacturing/);
    expect(scenario.definition.intro).toMatch(/Marcus/);
    expect(scenario.definition.intro).toMatch(/December 31/);
  });

  it("renders for 200 seeds at every point in the timeline", () => {
    for (const seed of SEEDS) {
      for (const minute of [0, scenario.timeLimitMinutes]) {
        const view = renderAttemptForCandidate(scenario, seed, minute);
        expect(JSON.stringify(view)).not.toContain("{{");
      }
    }
  });

  it("same seed, same scenario; different seeds change amounts, names, dates and document numbers", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(scenario.generate(seed)).toEqual(scenario.generate(seed));
      expect(renderAttemptForCandidate(scenario, seed, 50)).toEqual(renderAttemptForCandidate(scenario, seed, 50));
      for (const id of RAPID_STEPS) expect(rapidItems(seed, id)).toEqual(rapidItems(seed, id));
    }
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    for (const id of RAPID_STEPS) {
      expect(new Set(SEEDS.slice(0, 50).map((s) => JSON.stringify(rapidItems(s, id)))).size, id).toBe(50);
      expect(new Set(SEEDS.slice(0, 50).map((s) => JSON.stringify(scenario.generate(s).keys[id]))).size, id).toBe(50);
    }
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
      expect(sheet).not.toHaveProperty("propose");
      expect((keys["pass-or-propose"] as ChoiceKey).correct, seed).toEqual([s.propose ? "propose" : "pass"]);
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
      for (const k of [1, 2, 3, 4]) expect((keys[`vouch-${k}`] as ReviewKey).decision, `${seed} vouch-${k}`).toBeUndefined();
      expect((keys["vouch-conclusion"] as ChoiceKey).correct).toEqual(["propose"]);
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
  it("is out of 100 (70 phase A + 3 rapid rounds × 10), exactly, and a blank attempt scores 0", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(TOTAL_MAX);
    for (const [id, max] of Object.entries(MAX_BY_STEP)) expect(blank.steps[id].maxPoints, id).toBe(max);
    for (const id of RAPID_STEPS) expect(blank.steps[id].points).toBe(0);
    const part = (ids: string[]) => ids.reduce((t, id) => t + MAX_BY_STEP[id], 0);
    expect(part(["vouch-1", "vouch-2", "vouch-3", "vouch-4", "vouch-conclusion"])).toBe(25);
    expect(part(["controller-reply", "exception-count", "exception-total", "bank-confirm"])).toBe(15);
    expect(part(["misstatement-summary", "pass-or-propose", "proposed-aje", "marcus-summary"])).toBe(30);
    expect(part([...RAPID_STEPS])).toBe(30);
  });

  it("a perfect answer earns every automatic point, and the replies go to review", () => {
    for (const seed of SEEDS.slice(0, 100)) {
      const r = scoreAttempt(scenario, seed, perfectAnswers(seed));
      for (const id of AUTO_STEPS) expect(r.steps[id].points, `${seed} ${id}`).toBe(r.steps[id].maxPoints);
      expect(autoPoints(seed, perfectAnswers(seed))).toBeCloseTo(TOTAL_MAX - RUBRIC_MAX, 9);
      expect(r.steps["controller-reply"].needsReview).toBe(true);
      expect(r.steps["marcus-summary"].needsReview).toBe(true);
    }
  });

  it("a perfect answer is 100 once a reviewer gives both replies full marks", () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const r = scoreAttempt(scenario, seed, perfectAnswers(seed));
      const reviewed = r.points + RUBRIC_MAX - r.steps["controller-reply"].points - r.steps["marcus-summary"].points;
      expect(reviewed, seed).toBeCloseTo(TOTAL_MAX, 9);
    }
  });

  it("another seed's perfect answer doesn't score well (answers can't be shared)", () => {
    let total = 0;
    for (const seed of SEEDS.slice(1, 21)) total += autoPoints(seed, perfectAnswers(SEEDS[0]));
    expect(total / 20).toBeLessThan((TOTAL_MAX - RUBRIC_MAX) * 0.6);
    let rapid = 0;
    for (const seed of SEEDS.slice(1, 21)) {
      const r = scoreAttempt(scenario, seed, perfectAnswers(SEEDS[0]));
      rapid += RAPID_STEPS.reduce((t, id) => t + r.steps[id].points, 0);
    }
    expect(rapid / 20).toBeLessThan(30 * 0.7);
  });

  describe("rapid rounds: item weights and partial credit", () => {
    it("the first five items of each round are worth 0.5, the other ten 0.75 (10 per round, no rounding)", () => {
      const r = scoreAttempt(scenario, "abc", {});
      for (const id of RAPID_STEPS) {
        const items = r.steps[id].items.filter((i) => i.id !== "timing");
        expect(items.map((i) => i.max)).toEqual([...Array(5).fill(0.5), ...Array(10).fill(0.75)]);
        expect(items.every((i) => i.note?.includes("No answer"))).toBe(true);
      }
    });

    it("one wrong field costs half its item; an unanswered item costs all of it", () => {
      for (const seed of SEEDS.slice(0, 20)) {
        for (const id of RAPID_STEPS) {
          const a = clone(perfectAnswers(seed));
          const items = rapidItems(seed, id);
          const first = items[0];
          const f = choiceFields(first)[0];
          const right = a[id].items[first.id].values[f.id];
          a[id].items[first.id].values[f.id] = f.options.find((o) => o.id !== right)!.id;
          delete a[id].items[items[14].id];
          const fields = first.fields.length;
          expect(scoreAttempt(scenario, seed, a).steps[id].points, `${seed} ${id}`).toBe(10 - 0.5 / fields - 0.75);
        }
      }
    });
  });

  describe("each trap answered wrongly costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    const full = TOTAL_MAX - RUBRIC_MAX;

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
        a["pass-or-propose"].selected = [wrongTotal >= s.ct ? "propose" : "pass"];
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

    it("the wrong pass/propose call costs 4, and so does no call", () => {
      for (const seed of seeds) {
        const a = clone(perfectAnswers(seed));
        a["pass-or-propose"].selected = [solve(seed).propose ? "pass" : "propose"];
        expect(autoPoints(seed, a), seed).toBeCloseTo(full - 4, 9);
        a["pass-or-propose"].selected = [];
        expect(autoPoints(seed, a), seed).toBeCloseTo(full - 4, 9);
      }
    });

    it("the wrong sample conclusion costs 5; replacing the exception items is wrong", () => {
      for (const seed of seeds) {
        for (const wrong of ["replace", "no_exceptions", "client_fix"]) {
          const a = clone(perfectAnswers(seed));
          a["vouch-conclusion"].selected = [wrong];
          expect(autoPoints(seed, a), `${seed} ${wrong}`).toBeCloseTo(full - 5, 9);
        }
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

describe("audit-calder-bluestem: rapid rounds", () => {
  const keyFor = (seed: string, id: RapidId) => scenario.generate(seed).keys[id] as RapidKey;

  it("each round is 15 items × 20 seconds of choice fields, 10 points", () => {
    for (const id of RAPID_STEPS) {
      const step = scenario.definition.steps.find((s) => s.id === id)!;
      const cfg = RR.configSchema.parse(step.config) as { secondsPerItem: number; items: { points: number; fields: { kind: string }[] }[] };
      expect(cfg.secondsPerItem, id).toBe(20);
      expect(cfg.items.length, id).toBe(15);
      expect(cfg.items.reduce((t, i) => t + i.points, 0), id).toBe(10);
      for (const item of cfg.items) for (const f of item.fields) expect(f.kind).toBe("choice");
    }
  });

  it("over 200 seeds every item is consistent: each field has exactly one right option, it's in the options, and the key agrees", () => {
    for (const seed of SEEDS) {
      for (const id of RAPID_STEPS) {
        const key = keyFor(seed, id);
        const items = rapidItems(seed, id);
        expect(Object.keys(key.items).sort(), `${seed} ${id}`).toEqual(items.map((i) => i.id).sort());
        for (const item of items) {
          expect(JSON.stringify(item)).not.toContain("{{");
          const solved = SOLVERS[id](item);
          for (const f of choiceFields(item)) {
            const k = key.items[item.id][f.id];
            expect(k, `${seed} ${item.id} ${f.id}`).toBeDefined();
            expect(f.options.map((o) => o.id), `${seed} ${item.id} ${f.id}`).toContain(k.choice);
            expect(new Set(f.options.map((o) => o.label)).size, `${seed} ${item.id} labels unique`).toBe(f.options.length);
            expect(solved[f.id], `${seed} ${item.id} ${f.id}`).toEqual([k.choice]);
          }
          expect(Object.keys(key.items[item.id]).sort()).toEqual(item.fields.map((f) => f.id).sort());
        }
      }
    }
  });

  it("tick and tie: five items agree, ten are exceptions with one difference each, and every reason occurs", () => {
    for (const seed of SEEDS) {
      const items = rapidItems(seed, "rapid-tick");
      const solved = items.map(solveTick);
      expect(solved.filter((s) => s.result[0] === "agrees").length, seed).toBe(5);
      for (const r of ["amount", "cutoff", "vendor", "no_support"]) expect(solved.some((s) => s.reason[0] === r), `${seed} ${r}`).toBe(true);
      const docs = new Set(items.map((i) => i.exhibit!.table!.columns[2]));
      expect([...docs].sort(), seed).toEqual(["Bank confirmation", "Receiving report", "Vendor invoice"]);
      for (const item of items) {
        const [, , date, fig] = item.exhibit!.table!.rows;
        expect(yearOf(date[1]), `${seed} ${item.id} schedule date`).toBe(2025);
        const reason = solveTick(item).reason[0];
        if (reason === "cutoff") expect(yearOf(date[2])).toBe(2026);
        if (reason === "amount") expect(fig[1]).not.toBe(fig[2]);
      }
    }
  });

  it("cutoff: both years, both recorded outcomes and both FOB terms occur in every round; the invoice date sometimes misleads", () => {
    let misleading = 0;
    for (const seed of SEEDS) {
      const items = rapidItems(seed, "rapid-cutoff");
      const solved = items.map(solveCutoff);
      for (const y of ["y2025", "y2026"]) {
        for (const r of ["yes", "no"]) expect(solved.some((s) => s.year[0] === y && s.recorded[0] === r), `${seed} ${y} ${r}`).toBe(true);
      }
      const terms = new Set(items.map((i) => i.exhibit!.rows!.find((r) => r.label === "Terms")!.value));
      expect(terms.size, seed).toBe(2);
      for (const [i, item] of items.entries()) {
        const row = (label: string) => item.exhibit!.rows!.find((r) => r.label === label)!.value;
        for (const label of ["Shipped", "Delivered", "Invoice date", "Recorded in GL"]) {
          expect(row(label), `${seed} ${item.id} ${label}`).toMatch(/^(12\/(1\d|2\d|3[01])\/2025|01\/(0\d|1[0-5])\/2026)$/);
        }
        if (`y${yearOf(row("Invoice date"))}` !== solved[i].year[0]) misleading++;
      }
    }
    expect(misleading).toBeGreaterThan(SEEDS.length);
  });

  it("no field has the same right answer for every seed, and what a field offers doesn't depend on the seed except check numbers", () => {
    for (const id of RAPID_STEPS) {
      const base = rapidItems(SEEDS[0], id);
      const others = SEEDS.slice(1, 30).map((seed) => rapidItems(seed, id));
      for (const [i, item] of base.entries()) {
        for (const f of choiceFields(item)) {
          const answers = new Set(SEEDS.map((seed) => keyFor(seed, id).items[item.id][f.id].choice));
          expect(answers.size, `${id} ${item.id} ${f.id}`).toBeGreaterThan(1);
          for (const other of others) {
            const o = field(other[i], f.id);
            expect(o.options.map((x) => x.id)).toEqual(f.options.map((x) => x.id));
            if (f.id !== "missing") expect(o.options).toEqual(f.options);
          }
        }
      }
    }
  });

  it("50 seeds: no rendered rapid item holds a key value, key string or scoring word", () => {
    const PUBLIC_ID_FIELDS = new Set(["accounts", "side", "targets", "reasons", "decision", "choice"]);
    const leaves = (key: unknown, out: { numbers: number[]; strings: string[] } = { numbers: [], strings: [] }, f = "") => {
      if (PUBLIC_ID_FIELDS.has(f)) return out;
      if (typeof key === "number" && (f === "value" || f === "amount")) out.numbers.push(key);
      else if (typeof key === "string") out.strings.push(key);
      else if (key && typeof key === "object") for (const [k, v] of Object.entries(key)) leaves(v, out, k);
      return out;
    };
    const patterns = (value: number) =>
      [value.toFixed(2), value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }), String(Math.round(value * 100))]
        .filter((f) => !/^\d{1,3}$/.test(f))
        .map((s) => new RegExp(`(?<![\\d.,])${s.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`));
    let checked = 0;
    for (const seed of SEEDS.slice(0, 50)) {
      const variant = scenario.generate(seed);
      const shown = new Set(Object.values(variant.values).filter((x): x is number => typeof x === "number").map((c) => c / 100));
      const { numbers, strings } = leaves(variant.keys);
      const derived = numbers.filter((n) => n >= 1 && !shown.has(n));
      expect(derived.length).toBeGreaterThan(0);
      for (const id of RAPID_STEPS) {
        for (const item of rapidItems(seed, id)) {
          const payload = JSON.stringify(item);
          expect(payload).not.toMatch(/choice|tolerance|points|"key"|"notes"/);
          for (const n of derived) for (const p of patterns(n)) expect(payload, `${seed} ${item.id} leaks ${n}`).not.toMatch(p);
          for (const s of strings) expect(payload, `${seed} ${item.id} leaks a key string`).not.toContain(s);
          checked++;
        }
      }
    }
    expect(checked).toBe(50 * 45);
  });
});

describe("audit-calder-bluestem: the two calls are multiple choice", () => {
  const choice = (seed: string, id: string) => screen(seed).step(id).config as ChoiceCfg;

  it("pass or propose: one pick from two options, no number cell left in the summary", () => {
    const cfg = choice("abc", "pass-or-propose");
    expect(cfg.select).toBe("single");
    expect(cfg.options).toEqual([
      { id: "pass", label: "Pass: below clearly trivial" },
      { id: "propose", label: "Propose the adjustment" },
    ]);
    const sheet = JSON.stringify(screen("abc").step("misstatement-summary").config);
    expect(sheet).not.toMatch(/Propose \(1\)|pass \(0\)|"propose"/i);
  });

  it("the sample conclusion is its own screen after the last pair; no vouching pair asks for a decision", () => {
    const cfg = choice("abc", "vouch-conclusion");
    expect(cfg.select).toBe("single");
    expect(cfg.options.map((o) => o.id)).toEqual(["no_exceptions", "propose", "replace", "client_fix"]);
    expect(cfg.options.find((o) => o.id === "propose")!.label).toBe("Exceptions noted: document them and work out the adjustment");
    for (const k of [1, 2, 3, 4]) expect((screen("abc").step(`vouch-${k}`).config as ReviewCfg).decision, `vouch-${k}`).toBeUndefined();
  });

  it("each call scores right and wrong per seed: pass and propose both come up as the right answer", () => {
    const right = new Set<string>();
    for (const seed of SEEDS.slice(0, 60)) {
      const s = solve(seed);
      const call = s.propose ? "propose" : "pass";
      right.add(call);
      const score = (selected: string[]) => scoreAttempt(scenario, seed, { "pass-or-propose": { selected } }).steps["pass-or-propose"];
      expect(score([call]).points, seed).toBe(4);
      expect(score([call === "pass" ? "propose" : "pass"]).points, seed).toBe(0);
      expect(score([]).points).toBe(0);
      const concl = (selected: string[]) => scoreAttempt(scenario, seed, { "vouch-conclusion": { selected } }).steps["vouch-conclusion"].points;
      expect(concl(["propose"])).toBe(5);
      expect(concl(["replace"])).toBe(0);
    }
    expect([...right].sort()).toEqual(["pass", "propose"]);
  });

  it("what the candidate sees of either call is the same for every seed, so the right option can't leak", () => {
    const base = { pp: JSON.stringify(choice(SEEDS[0], "pass-or-propose")), vc: JSON.stringify(choice(SEEDS[0], "vouch-conclusion")) };
    for (const seed of SEEDS.slice(1, 60)) {
      expect(JSON.stringify(choice(seed, "pass-or-propose")), seed).toBe(base.pp);
      expect(JSON.stringify(choice(seed, "vouch-conclusion")), seed).toBe(base.vc);
    }
  });
});

describe("audit-calder-bluestem: sections and timeline", () => {
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-16T09:00:00Z");
  const flowAt = (ms: number) => resolveFlow(scenario.definition, { startedAt: t0, now: t0 + ms, extraTimePercent: 0, events: [] });
  const msgs = scenario.definition.messages;

  it("six sections, 52 minutes in all, matching the time limit; validateSections passes", () => {
    const sections = scenario.definition.sections!;
    expect(sections.map((s) => [s.id, s.minutes, Boolean(s.oneAtATime), s.stepIds])).toEqual(SECTIONS);
    expect(sections.reduce((t, s) => t + s.minutes, 0)).toBe(scenario.timeLimitMinutes);
    expect(validateSections(scenario.definition, scenario.timeLimitMinutes)).toEqual([]);
  });

  it("one-at-a-time screens fill their section; rapid rounds fit theirs", () => {
    for (const sec of scenario.definition.sections!) {
      const steps = sec.stepIds.map((id) => scenario.definition.steps.find((s) => s.id === id)!);
      if (sec.oneAtATime) expect(steps.reduce((t, s) => t + s.seconds!, 0), sec.id).toBe(sec.minutes * 60);
      for (const s of steps.filter((x) => x.type === "rapid_round")) expect(15 * 20, s.id).toBeLessThanOrEqual(sec.minutes * 60);
    }
    const seconds = Object.fromEntries(scenario.definition.steps.filter((s) => s.seconds).map((s) => [s.id, s.seconds]));
    expect(seconds).toEqual({
      "vouch-1": 165,
      "vouch-2": 165,
      "vouch-3": 165,
      "vouch-4": 165,
      "vouch-conclusion": 60,
      "controller-reply": 240,
      "exception-count": 90,
      "exception-total": 90,
      "bank-confirm": 180,
    });
  });

  it("every message is linked to a step and arrives as that step's section starts", () => {
    expect(msgs.map((m) => [m.id, m.stepId])).toEqual(MESSAGES);
    for (const m of msgs) expect(m.arriveAtMinute ?? 0, m.id).toBe(0);
    expect(msgs.find((m) => m.id === "m2")!.from).toMatch(/Controller, Bluestem Manufacturing/);
    for (const [id] of MESSAGES.filter(([id]) => id !== "m2")) expect(msgs.find((m) => m.id === id)!.from).toMatch(/^Marcus/);
  });

  it("left to run, each section opens on time with only its steps and brings its messages", () => {
    const sectionOf = (stepId: string) => SECTIONS.find(([, , , ids]) => ids.includes(stepId))![0];
    let start = 0;
    const seen: string[] = [];
    for (const [id, minutes, oneAtATime, stepIds] of SECTIONS) {
      const now = start * MIN + 1_000;
      const f = flowAt(now);
      expect(f.section?.id, `${id} at ${start}`).toBe(id);
      expect(f.visibleStepIds).toEqual(oneAtATime ? [stepIds[0]] : stepIds);
      const arrived = visibleMessageIds(scenario.definition, f, t0, t0 + now);
      const fresh = arrived.filter((m) => !seen.includes(m));
      expect(fresh.sort(), id).toEqual(
        MESSAGES.filter(([, step]) => sectionOf(step) === id)
          .map(([m]) => m)
          .sort(),
      );
      if (start > 0) {
        const before = visibleMessageIds(scenario.definition, flowAt(now - 2_000), t0, t0 + now - 2_000);
        for (const m of fresh) expect(before, `${m} before ${id}`).not.toContain(m);
      }
      seen.push(...fresh);
      start += minutes;
    }
    expect(flowAt(TIME_LIMIT * MIN).done).toBe(true);
    expect(seen.sort()).toEqual(MESSAGES.map(([m]) => m).sort());
  });

  it("the screens come one at a time: four vouching pairs and the conclusion, then controller, Marcus's two numbers and the bank confirmation", () => {
    const vouch = (min: number) => flowAt((6 + min) * MIN + 1_000).screen?.stepId;
    expect([vouch(0), vouch(2.75), vouch(5.5), vouch(8.25), vouch(11)]).toEqual(["vouch-1", "vouch-2", "vouch-3", "vouch-4", "vouch-conclusion"]);
    const inbox = (min: number) => flowAt((24 + min) * MIN + 1_000).screen?.stepId;
    expect([inbox(0), inbox(4), inbox(5.5), inbox(7)]).toEqual(["controller-reply", "exception-count", "exception-total", "bank-confirm"]);
  });

  it("Marcus greets the candidate by first name", () => {
    const view = renderAttemptForCandidate(scenario, "abc", 0, { name: "Priya Raman" });
    expect(view.messages.find((m) => m.id === "m1")!.body).toMatch(/^Hi Priya,\n/);
    expect(renderAttemptForCandidate(scenario, "abc", 0).messages.find((m) => m.id === "m1")!.body).toMatch(/^Hi there,\n/);
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
