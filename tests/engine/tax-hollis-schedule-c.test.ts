import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem, RapidNumberField } from "@/lib/engine/step-types/rapid_round/public";

vi.mock("server-only", () => ({}));

const { taxHollisScheduleC, TAX_YEAR, RATES } = await import("@/lib/engine/scenarios/tax-hollis-schedule-c");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, resolveItems, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");

/**
 * docs/07 Example 7: Hollis Tax & Accounting, tax intern, one client's
 * Schedule C in six timed sections. These tests solve every task from what the
 * candidate sees (the rendered documents, the organizer, the emails and each
 * rapid item) with the rule table from docs/07, then compare that with the
 * server key, so the material, the rules and the key can't drift apart.
 */

const scenario = taxHollisScheduleC;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const SORT_STEPS = ["sort-1", "sort-2", "sort-3"] as const;
const RAPID_STEPS = ["rapid-forms", "rapid-deduct", "rapid-calcs"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const RUBRIC_STEPS = ["vacation-reply", "late-reply", "elena-summary"] as const;
const AUTO_STEPS = [...RAPID_STEPS, ...SORT_STEPS, "deposits", "net-profit", "schedule-c"] as const;
const MAX = 100;
const SLOW = 120_000;

type Field = { id: string; label: string; value: string };
type Doc = {
  prompt: string;
  document: { title: string; fields: Field[]; columns: string[]; rows: { id: string; cells: string[] }[]; totals: Field[] };
  reasons: { id: string; label: string }[];
  decision?: { prompt: string; options: { id: string; label: string }[] };
};
type Cell = { kind: "text"; text: string } | { kind: "input"; id: string } | { kind: "empty" };
type Grid = { prompt: string; columns: string[]; rows: Cell[][] };
type ReviewKey = { findings: Record<string, { targets: string[]; reasons: string[]; note?: string }>; decision?: string[] };
type SheetKey = { tolerance: number; cells: Record<string, { value: number; tolerance?: number }> };
type ReplyKey = { notes: Record<string, string> };
type NumKey = { value: number; tolerance: number; partialTolerance?: number };
type RapidKey = { items: Record<string, Record<string, { choice?: string; value?: number; tolerance?: number }>> };

/** "$1,234.56" → 123456 (cents). */
const cents = (s: string) => {
  const m = s.match(/-?\$?\d[\d,]*(?:\.\d\d)?/);
  expect(m, `an amount in "${s}"`).not.toBeNull();
  const t = m![0].replace(/[$,]/g, "");
  return Math.round(Number(t) * 100);
};
/** IRS whole-dollar rounding: add the cents first, then 50 cents and up rounds up (epsilon for float noise in rates). */
const whole = (c: number) => Math.floor((c + 50) / 100 + 1e-9);
const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const text = (c: Cell | undefined) => (c && c.kind === "text" ? c.text : "");

/** Everything the candidate sees after the whole attempt. */
function screen(seed: string) {
  const view = renderAttemptForCandidate(scenario, seed, END);
  const step = (id: string) => {
    const s = view.steps.find((x) => x.id === id);
    expect(s, `step ${id}`).toBeDefined();
    return s!;
  };
  const msg = (id: string) => {
    const m = view.messages.find((x) => x.id === id);
    expect(m, `message ${id}`).toBeDefined();
    return m!;
  };
  return { view, step, msg };
}

// ---- Organize: the rule table for the client's documents (docs/07 Part 1) ----

type Category = "income" | "expense" | "asset" | "personal" | "info";
const CATEGORY_RULES: [RegExp, Category][] = [
  [/^Box 1 nonemployee compensation/, "income"],
  [/design software|liability insurance|hosting and domain|stock photo license|^Lunch with a client/i, "expense"],
  [/^Laptop/, "asset"],
  [/groceries|summer day camp|streaming plan|gym membership/i, "personal"],
  [/^Payment to |business and personal calls|no item details/i, "info"],
];

function readSort(doc: Doc) {
  const cols = doc.document.columns;
  expect(cols).toEqual(["Document", "From", "Date", "Details", "Amount"]);
  return doc.document.rows.map((r) => {
    const details = r.cells[3];
    const hits = CATEGORY_RULES.filter(([re]) => re.test(details));
    expect(hits.length, `one category for "${details}"`).toBe(1);
    return { id: r.id, doc: r.cells[0], from: r.cells[1], date: r.cells[2], details, amount: cents(r.cells[4]), category: hits[0][1] };
  });
}

/** Deposits by payer against the 1099-NECs in the folder. */
function readDeposits(doc: Doc) {
  const necs = doc.document.fields
    .filter((f) => /^1099-NEC in the folder/.test(f.label))
    .map((f) => {
      const m = f.value.match(/^(.+) · Box 1 (\$[\d,]+\.\d\d)$/);
      expect(m, f.value).not.toBeNull();
      return { payer: m![1], amount: cents(m![2]) };
    });
  const rows = doc.document.rows.map((r) => ({ id: r.id, payer: r.cells[0], count: Number(r.cells[1]), total: cents(r.cells[2]), small: /^Small clients/.test(r.cells[0]) }));
  const missing = rows.filter((r) => !r.small && !necs.some((n) => n.payer === r.payer));
  return { necs, rows, missing };
}

// ---- Schedule C: where each organizer item goes (docs/07 Part 3) ----

type Line = "l1" | "l8" | "l9" | "l13" | "l15" | "l17" | "l22" | "l24b" | "l27a" | "l30";
type Treatment = { line: Line | null; how?: "miles" | "half" | "sqft" };
const ORGANIZER_RULES: [RegExp, Treatment][] = [
  [/^1099-NEC: /, { line: "l1" }],
  [/^Payments from small clients/, { line: "l1" }],
  [/^Promoted posts/, { line: "l8" }],
  [/^Print ad/, { line: "l8" }],
  [/^Business miles/, { line: "l9", how: "miles" }],
  [/^Gas for the car/, { line: null }],
  [/^Laptop/, { line: "l13" }],
  [/^Business liability insurance/, { line: "l15" }],
  [/^Health insurance/, { line: null }],
  [/^Tax prep fee/, { line: "l17" }],
  [/^Printer ink/, { line: "l22" }],
  [/^Sketchbooks/, { line: "l22" }],
  [/^Client meals/, { line: "l24b", how: "half" }],
  [/^Design software/, { line: "l27a" }],
  [/^Professional association dues/, { line: "l27a" }],
  [/^Parking ticket/, { line: null }],
  [/^Family trip/, { line: null }],
  [/^Home office/, { line: "l30", how: "sqft" }],
];
const EXPENSE_LINES = ["l8", "l9", "l13", "l15", "l17", "l22", "l24b", "l27a"] as const;
const INPUT_ROWS: [string, string][] = [
  ["Line 1", "l1"],
  ["Line 8", "l8"],
  ["Line 9", "l9"],
  ["Line 13", "l13"],
  ["Line 15", "l15"],
  ["Line 17", "l17"],
  ["Line 22", "l22"],
  ["Line 24b", "l24b"],
  ["Line 27a", "l27a"],
  ["Line 28", "l28"],
  ["Line 29", "l29"],
  ["Line 30", "l30"],
  ["Line 31", "l31"],
];

/** The late 1099-NEC the client emails in the inbox section. */
function late1099(seed: string) {
  const body = screen(seed).msg("m6").body;
  const m = body.match(/a 1099-NEC for (\$[\d,]+\.\d\d)/);
  expect(m, body).not.toBeNull();
  return { amount: cents(m![1]), body };
}

/** The organizer read from the workbook and the Schedule C solved from it, plus the late 1099 when asked. */
function solveScheduleC(seed: string, { withLate = true } = {}) {
  const sheet = screen(seed).step("schedule-c").config as Grid;
  const start = sheet.rows.findIndex((r) => /^Client organizer/.test(text(r[0])));
  const inputStart = sheet.rows.findIndex((r) => /^Schedule C input/.test(text(r[0])));
  expect(start).toBeGreaterThanOrEqual(0);
  expect(inputStart).toBeGreaterThan(start);
  const items = sheet.rows
    .slice(start + 2, inputStart)
    .filter((r) => text(r[0]) !== "")
    .map((r) => ({ item: text(r[0]), note: text(r[1]), amount: text(r[2]) }));
  const lines: Record<Line, number> = { l1: 0, l8: 0, l9: 0, l13: 0, l15: 0, l17: 0, l22: 0, l24b: 0, l27a: 0, l30: 0 };
  const leftOff: { item: string; amount: number }[] = [];
  let miles = 0;
  let sqft = 0;
  for (const it of items) {
    const rules = ORGANIZER_RULES.filter(([re]) => re.test(it.item));
    expect(rules.length, `one rule for "${it.item}"`).toBe(1);
    const t = rules[0][1];
    if (t.how === "miles") {
      miles = Number(it.amount.replace(/[^\d]/g, ""));
      lines.l9 += miles * RATES.mileageCentsPerMile;
    } else if (t.how === "sqft") {
      sqft = Number(it.amount.replace(/[^\d]/g, ""));
      lines.l30 += Math.min(sqft, RATES.homeOfficeMaxSqFt) * RATES.homeOfficeDollarsPerSqFt * 100;
    } else if (t.how === "half") lines.l24b += cents(it.amount) * RATES.mealsShare;
    else if (t.line) lines[t.line] += cents(it.amount);
    else leftOff.push({ item: it.item, amount: cents(it.amount) });
  }
  const late = late1099(seed);
  if (withLate) lines.l1 += late.amount;
  const r = Object.fromEntries(Object.entries(lines).map(([k, c]) => [k, whole(c)])) as Record<Line, number>;
  const l28 = EXPENSE_LINES.reduce((t, k) => t + r[k], 0);
  const l29 = r.l1 - l28;
  const l31 = l29 - r.l30;
  return { sheet, items, leftOff, miles, sqft, late, cells: { ...r, l28, l29, l31 } as Record<string, number> };
}

/** Elena's draft numbers from her net-profit email. */
function elenaDraft(seed: string) {
  const body = screen(seed).msg("m5").body;
  const m = body.match(/gross receipts (\$[\d,]+\.\d\d), total expenses (\$[\d,]+\.\d\d), home office ([\d,]+) square feet/);
  expect(m, body).not.toBeNull();
  const gross = cents(m![1]);
  const expenses = cents(m![2]);
  const sqft = Number(m![3].replace(/,/g, ""));
  return { body, gross, expenses, sqft, net: whole(gross - expenses - sqft * 500) };
}

// ---- Rapid rounds: rendered one item at a time, exactly as the attempt flow does ----

const rapidConfig = (stepId: RapidStepId) => rapidRoundServer.configSchema.parse(scenario.definition.steps.find((s) => s.id === stepId)!.config);

function rapidItems(seed: string, stepId: RapidStepId): RapidItem[] {
  const variant = scenario.generate(seed);
  const values = templateValues(variant.values);
  const fill = (t: string) => fillTemplate(t, values);
  const config = rapidConfig(stepId);
  const seq = rapidRoundServer.sequence!;
  return Array.from({ length: seq.count(config) }, (_, i) => seq.renderItem(config, { variant, fill }, i) as RapidItem);
}

type Solved = { values: Record<string, string | number>; kind: string; exact?: number };

const choiceField = (item: RapidItem, id: string) => {
  const f = item.fields.find((x) => x.id === id) as RapidChoiceField | undefined;
  expect(f, `${item.id} field ${id}`).toBeDefined();
  expect(f!.options.length).toBeGreaterThanOrEqual(2);
  return f!;
};
const optionId = (item: RapidItem, fieldId: string, label: RegExp | string) => {
  const opts = choiceField(item, fieldId).options.filter((o) => (typeof label === "string" ? o.label === label : label.test(o.label)));
  expect(opts.length, `${item.id} ${fieldId}: one option like ${label}`).toBe(1);
  return opts[0].id;
};
const exhibitRow = (item: RapidItem, label: RegExp) => {
  const rows = item.exhibit?.rows?.filter((x) => label.test(x.label)) ?? [];
  expect(rows.length, `${item.id} one row like ${label}`).toBe(1);
  return rows[0].value;
};

/** Rapid A: where each box goes on a 2025 return (docs/07 form-to-line map). */
const FORM_TO_LINE: [form: RegExp, box: string, line: RegExp][] = [
  [/^Form W-2 /, "1", /^Form 1040, line 1a/],
  [/^Form W-2 /, "2", /^Form 1040, line 25a/],
  [/^Form 1099-NEC /, "1", /^Schedule C, line 1:/],
  [/^Form 1099-INT /, "1", /^Form 1040, line 2b/],
  [/^Form 1099-INT /, "3", /^Form 1040, line 2b/],
  [/^Form 1099-INT /, "8", /^Form 1040, line 2a/],
  [/^Form 1099-DIV /, "1a", /^Form 1040, line 3b/],
  [/^Form 1099-DIV /, "1b", /^Form 1040, line 3a/],
  [/^Form 1099-DIV /, "2a", /^Schedule D, line 13/],
  [/^Form 1098 /, "1", /^Schedule A, line 8a/],
];

function solveForm(item: RapidItem): Solved {
  const title = item.exhibit?.title ?? "";
  expect(item.exhibit?.rows?.length, `${item.id} six rows`).toBe(6);
  const ask = item.prompt.match(/^Where does Box (\w+) go on the return\?$/);
  if (ask) {
    const rules = FORM_TO_LINE.filter(([form, box]) => form.test(title) && box === ask[1]);
    expect(rules.length, `${item.id}: one line for ${title} box ${ask[1]}`).toBe(1);
    const kind = `${title.split(" (")[0]} box ${ask[1]}`;
    return { kind, values: { dest: optionId(item, "dest", rules[0][2]) } };
  }
  const box = (re: RegExp) => cents(exhibitRow(item, re));
  let exact: number;
  let kind: string;
  if (/^Two Forms 1099-NEC/.test(title)) {
    expect(item.prompt).toMatch(/Schedule C, line 1/);
    kind = "nec-two";
    exact = box(/^Form 1 · Box 1 /) + box(/^Form 2 · Box 1 /);
  } else if (/^Form W-2 /.test(title)) {
    expect(item.prompt).toMatch(/Form 1040, line 1a/);
    kind = "w2-wages";
    exact = box(/^Box 1 /);
    expect(box(/^Box 3 /), `${item.id} social security wages include the 401(k) deferral`).toBe(exact + box(/^Box 12a /));
  } else if (/^Form 1099-INT /.test(title)) {
    expect(item.prompt).toMatch(/line 2b/);
    kind = "int-total";
    exact = box(/^Box 1 /) + box(/^Box 3 /);
  } else if (/^Form 1099-DIV /.test(title)) {
    expect(item.prompt).toMatch(/line 3b/);
    kind = "div-ordinary";
    exact = box(/^Box 1a /);
    expect(box(/^Box 1b /)).toBeLessThan(exact);
  } else if (/^Form 1098 /.test(title)) {
    expect(item.prompt).toMatch(/Schedule A, line 8a/);
    kind = "mortgage-8a";
    exact = box(/^Box 1 /) + box(/^Box 6 /);
    expect(box(/^Box 6 /)).toBeGreaterThan(0);
  } else throw new Error(`${item.id}: unknown form ${title}`);
  expect(item.prompt).toMatch(/whole dollars/i);
  return { kind, exact, values: { amount: whole(exact) } };
}

/** Rapid B: the deductibility rule table from docs/07 (rule id, how the expense reads, expected treatment, tier). */
type Treat = "full" | "half" | "none" | "capitalize";
const DEDUCT_RULES: [id: string, re: RegExp, treat: Treat, tier: "easy" | "hard"][] = [
  ["software", /^Annual design software subscription/, "full", "easy"],
  ["insurance", /^Business liability insurance for the year/, "full", "easy"],
  ["stock", /^Stock photo license/, "full", "easy"],
  ["ads", /^Promoted posts/, "full", "easy"],
  ["supplies", /^Printer ink and paper/, "full", "easy"],
  ["hosting", /^Hosting and domain/, "full", "easy"],
  ["client-meal", /^Lunch with a client/, "half", "easy"],
  ["travel-meal", /^Dinner on an overnight trip/, "half", "easy"],
  ["parking-ticket", /^Parking ticket/, "none", "easy"],
  ["groceries", /^Groceries for the family/, "none", "easy"],
  ["income-tax", /federal estimated income tax payment/, "none", "easy"],
  ["streaming", /^Family streaming subscription/, "none", "easy"],
  ["laptop", /^New laptop for design work/, "capitalize", "hard"],
  ["monitor", /^New monitor for design work/, "full", "hard"],
  ["tickets", /^Tickets to take a client to a basketball game/, "none", "hard"],
  ["club", /^Country club dues/, "none", "hard"],
  ["penalty", /^IRS penalty for filing last year's return late/, "none", "hard"],
];
const TREAT_LABEL: Record<Treat, RegExp> = {
  full: /^Fully deductible$/,
  half: /^50% deductible$/,
  none: /^Not deductible$/,
  capitalize: /^Capitalize and depreciate/,
};

function solveDeduct(item: RapidItem): Solved {
  const rules = DEDUCT_RULES.filter(([, re]) => re.test(item.prompt));
  expect(rules.length, `${item.id}: one rule for "${item.prompt}"`).toBe(1);
  const [kind, , treat] = rules[0];
  const amount = cents(item.prompt);
  // The de minimis pair: the laptop is always over $2,500, the monitor never.
  if (kind === "laptop") expect(amount, item.prompt).toBeGreaterThan(RATES.deMinimisDollars * 100);
  if (kind === "monitor") expect(amount, item.prompt).toBeLessThanOrEqual(RATES.deMinimisDollars * 100);
  return { kind, values: { treatment: optionId(item, "treatment", TREAT_LABEL[treat]) } };
}

/** Rapid C: each quick calc, solved from the prompt with the 2025 rates. */
function solveCalc(item: RapidItem): Solved {
  const p = item.prompt;
  const amounts = [...p.matchAll(/\$[\d,]+\.\d\d/g)].map((m) => cents(m[0]));
  const num = (re: RegExp) => Number(p.match(re)![1].replace(/,/g, ""));
  let kind: string;
  let exact: number; // cents, before rounding
  if (/^Home office: /.test(p)) {
    const sqft = num(/^Home office: ([\d,]+) square feet/);
    kind = sqft > RATES.homeOfficeMaxSqFt ? "office-cap" : "office";
    exact = Math.min(sqft, RATES.homeOfficeMaxSqFt) * RATES.homeOfficeDollarsPerSqFt * 100;
  } else if (/business miles at the standard rate, plus/.test(p)) {
    kind = "miles-plus";
    exact = num(/^([\d,]+) business miles/) * RATES.mileageCentsPerMile + amounts[0] + amounts[1];
  } else if (/business miles in 2025/.test(p)) {
    kind = "miles";
    exact = num(/^([\d,]+) business miles/) * RATES.mileageCentsPerMile;
  } else if (/Net earnings from self-employment/.test(p)) {
    kind = "se-base";
    exact = amounts[0] * RATES.seEarningsShare;
  } else if (/Self-employment tax\?$/.test(p)) {
    kind = "se-tax";
    const base = whole(amounts[0] * RATES.seEarningsShare);
    // Schedule SE lines 10 and 11, each in whole dollars.
    exact = (whole(base * 100 * RATES.socialSecurityRate) + whole(base * 100 * RATES.medicareRate)) * 100;
  } else if (/^Client meals came to/.test(p)) {
    kind = "meals";
    exact = amounts[0] * RATES.mealsShare;
  } else if (/four equal estimated payments/.test(p)) {
    kind = "estimate";
    exact = amounts[0] / 4;
  } else if (/Deduction for half of it/.test(p)) {
    kind = "half-se";
    exact = amounts[0] / 2;
  } else if (/prior-year safe harbor/.test(p)) {
    kind = "safe-harbor";
    expect(p).toMatch(/AGI was over \$150,000/);
    exact = (amounts[0] * 1.1) / 4;
  } else throw new Error(`${item.id}: unknown calc "${p}"`);
  return { kind, exact, values: { amount: whole(exact) } };
}

const SOLVERS: Record<RapidStepId, (item: RapidItem) => Solved> = { "rapid-forms": solveForm, "rapid-deduct": solveDeduct, "rapid-calcs": solveCalc };
const solveRapid = (seed: string, stepId: RapidStepId) => rapidItems(seed, stepId).map((item) => ({ item, ...SOLVERS[stepId](item) }));

function rapidAnswers(seed: string) {
  return Object.fromEntries(
    RAPID_STEPS.map((id) => [id, { items: Object.fromEntries(solveRapid(seed, id).map((s) => [s.item.id, { values: s.values, ms: 7_000 }])) }]),
  ) as Record<RapidStepId, { items: Record<string, { values: Record<string, string | number>; ms: number }> }>;
}

/** A strong candidate's answers, built only from the screen. */
function perfectAnswers(seed: string) {
  const { step } = screen(seed);
  const sortAnswers = Object.fromEntries(
    SORT_STEPS.map((id) => [id, { flags: readSort(step(id).config as Doc).map((d) => ({ target: d.id, reason: d.category, note: "" })) }]),
  );
  const dep = readDeposits(step("deposits").config as Doc);
  const sc = solveScheduleC(seed);
  return {
    ...rapidAnswers(seed),
    ...sortAnswers,
    deposits: { flags: [{ target: dep.missing[0].id, reason: "missing", note: "" }], decision: "ask" },
    "vacation-reply": { body: "Hi, I'm sorry, but the trip isn't deductible. It was a family vacation, and checking email doesn't change that." },
    "net-profit": { value: elenaDraft(seed).net },
    "late-reply": { body: "Thanks for sending it. We'll add it: gross receipts and net profit go up by that amount, and so does your SE tax." },
    "schedule-c": { cells: { ...sc.cells } },
    "elena-summary": { body: `Net profit ${sc.cells.l31}. Left off the trip, gas, the ticket and health insurance.` },
  };
}

type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers & Record<string, unknown> => JSON.parse(JSON.stringify(a));

describe("tax-hollis-schedule-c: setup", () => {
  it("is registered, version 1, accounting, about 50 minutes, built from existing step types in section order", () => {
    expect(getScenario("tax-hollis-schedule-c", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.roleFamily).toBe("accounting");
    expect(scenario.timeLimitMinutes).toBe(52);
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["rapid-forms", "rapid_round"],
      ["sort-1", "document_review"],
      ["sort-2", "document_review"],
      ["sort-3", "document_review"],
      ["deposits", "document_review"],
      ["rapid-deduct", "rapid_round"],
      ["vacation-reply", "inbox_reply"],
      ["net-profit", "numeric"],
      ["late-reply", "inbox_reply"],
      ["rapid-calcs", "rapid_round"],
      ["schedule-c", "spreadsheet"],
      ["elena-summary", "inbox_reply"],
    ]);
    expect(scenario.definition.intro).toMatch(/Hollis Tax & Accounting/);
    expect(scenario.definition.intro).toMatch(/Elena/);
    expect(scenario.definition.intro).toMatch(/Schedule C/);
  });

  it("fixes the tax year and every rate in config, as listed in docs/07", () => {
    expect(TAX_YEAR).toBe(2025);
    expect(RATES).toEqual({
      mileageCentsPerMile: 70,
      homeOfficeDollarsPerSqFt: 5,
      homeOfficeMaxSqFt: 300,
      seEarningsShare: 0.9235,
      socialSecurityRate: 0.124,
      medicareRate: 0.029,
      socialSecurityWageBase: 176_100,
      mealsShare: 0.5,
      deMinimisDollars: 2_500,
      nec1099ThresholdDollars: 600,
      priorYearSafeHarborHighIncome: 1.1,
    });
  });

  it("renders for 200 seeds with no unfilled template, and every rapid item renders", () => {
    for (const seed of SEEDS) {
      for (const minute of [0, END]) {
        const view = renderAttemptForCandidate(scenario, seed, minute);
        expect(JSON.stringify(view)).not.toContain("{{");
      }
      for (const id of RAPID_STEPS) expect(JSON.stringify(rapidItems(seed, id))).not.toContain("{{");
    }
  }, SLOW);

  it("copy is plain: no em dashes anywhere the candidate reads", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(JSON.stringify(renderAttemptForCandidate(scenario, seed, END))).not.toMatch(/—/);
      for (const id of RAPID_STEPS) expect(JSON.stringify(rapidItems(seed, id))).not.toMatch(/—/);
    }
    for (const id of RAPID_STEPS) expect(rapidConfig(id).intro).not.toMatch(/—/);
  });
});

describe("tax-hollis-schedule-c: determinism", () => {
  it("the same seed always gives the same scenario", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(scenario.generate(seed)).toEqual(scenario.generate(seed));
      expect(renderAttemptForCandidate(scenario, seed, END)).toEqual(renderAttemptForCandidate(scenario, seed, END));
      for (const id of RAPID_STEPS) expect(rapidItems(seed, id)).toEqual(rapidItems(seed, id));
    }
  });

  it("different seeds change every amount and name: client, payers, 1099s, organizer, deposits and positions", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const some = SEEDS.slice(0, 60);
    const values = some.map((s) => scenario.generate(s).values);
    expect(new Set(values.map((v) => v.client)).size).toBeGreaterThanOrEqual(8);
    expect(new Set(values.map((v) => v.late_payer)).size).toBeGreaterThanOrEqual(8);
    const scs = some.map((s) => solveScheduleC(s));
    expect(new Set(scs.map((s) => s.late.amount)).size).toBeGreaterThan(55);
    expect(new Set(scs.map((s) => s.cells.l31)).size).toBeGreaterThan(55);
    expect(new Set(scs.map((s) => s.miles)).size).toBeGreaterThan(50);
    expect(new Set(scs.map((s) => s.sqft)).size).toBeGreaterThan(40);
    for (const label of [/^Laptop/, /^Client meals/, /^Gas/, /^Parking ticket/, /^Health insurance/]) {
      expect(new Set(scs.map((s) => s.items.find((i) => label.test(i.item))!.amount)).size, `${label}`).toBeGreaterThan(50);
    }
    // Which payer is missing, and where the deposits and documents sit, change too.
    const deps = some.map((s) => readDeposits(screen(s).step("deposits").config as Doc));
    expect(new Set(deps.map((d) => d.missing[0].id)).size).toBe(4);
    const infoAt = some.map((s) => {
      const { step } = screen(s);
      return SORT_STEPS.flatMap((id) => readSort(step(id).config as Doc).map((d) => `${id}:${d.id}:${d.category}`)).find((x) => x.endsWith(":info"));
    });
    expect(new Set(infoAt).size).toBeGreaterThanOrEqual(6);
  });
});

describe("tax-hollis-schedule-c: the key is internally consistent (200 seeds)", () => {
  it("organize: nine documents in the planned mix, and the key classifies each one by the rule table", () => {
    for (const seed of SEEDS) {
      const { step } = screen(seed);
      const docs = SORT_STEPS.flatMap((id) => readSort(step(id).config as Doc).map((d) => ({ ...d, stepId: id })));
      expect(docs.length).toBe(9);
      const count = (c: Category) => docs.filter((d) => d.category === c).length;
      expect([count("income"), count("expense"), count("asset"), count("personal"), count("info")], seed).toEqual([2, 3, 1, 2, 1]);
      expect(docs.find((d) => d.category === "asset")!.amount).toBeGreaterThan(RATES.deMinimisDollars * 100);
      const keys = scenario.generate(seed).keys;
      for (const id of SORT_STEPS) {
        const k = keys[id] as ReviewKey;
        const rows = readSort(step(id).config as Doc);
        expect(Object.keys(k.findings)).toEqual(["doc1", "doc2", "doc3"]);
        rows.forEach((d, j) => {
          const f = k.findings[`doc${j + 1}`];
          expect([f.targets, f.reasons], `${seed} ${id} ${d.details}`).toEqual([[d.id], [d.category]]);
        });
      }
    }
  }, SLOW);

  it("organize: every screen offers the same five categories, so the screen's shape gives nothing away", () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const { step } = screen(seed);
      const docs = SORT_STEPS.map((id) => step(id).config as Doc);
      for (const d of docs) expect(d.reasons.map((r) => r.id)).toEqual(["income", "expense", "asset", "personal", "info"]);
      expect(new Set(docs.map((d) => JSON.stringify([d.prompt, d.reasons, d.document.columns]))).size).toBe(1);
    }
  });

  it("deposits: exactly one payer has no 1099-NEC (the late one), the others agree, and the small clients are under $600", () => {
    for (const seed of SEEDS) {
      const { step } = screen(seed);
      const dep = readDeposits(step("deposits").config as Doc);
      expect(dep.necs.length).toBe(2);
      expect(dep.rows.length).toBe(4);
      expect(dep.missing.length, seed).toBe(1);
      for (const n of dep.necs) expect(dep.rows.find((r) => r.payer === n.payer)!.total, `${seed} ${n.payer}`).toBe(n.amount);
      const small = dep.rows.filter((r) => r.small);
      expect(small.length).toBe(1);
      expect(small[0].payer).toMatch(/each under \$600/);
      const missing = dep.missing[0];
      expect(missing.total).toBeGreaterThanOrEqual(1_800_00);
      expect(missing.total).toBeLessThanOrEqual(7_500_00);
      // The late 1099 is from the missing payer, for what was deposited.
      const late = late1099(seed);
      expect(late.body).toContain(missing.payer);
      expect(late.amount).toBe(missing.total);
      const k = scenario.generate(seed).keys.deposits as ReviewKey;
      expect(k.findings.missing.targets).toEqual([missing.id]);
      expect(k.findings.missing.reasons).toEqual(["missing"]);
      expect(k.decision).toEqual(["ask"]);
    }
  }, SLOW);

  it("the 1099-NECs agree everywhere: organize documents, deposits and the organizer", () => {
    for (const seed of SEEDS) {
      const { step } = screen(seed);
      const dep = readDeposits(step("deposits").config as Doc);
      const sortNecs = SORT_STEPS.flatMap((id) => readSort(step(id).config as Doc)).filter((d) => d.category === "income");
      const sc = solveScheduleC(seed);
      const organizerNecs = sc.items.filter((i) => /^1099-NEC: /.test(i.item));
      expect(organizerNecs.length).toBe(2);
      for (const n of dep.necs) {
        expect(sortNecs.find((d) => d.from === n.payer)?.amount, `${seed} ${n.payer}`).toBe(n.amount);
        expect(cents(organizerNecs.find((i) => i.item === `1099-NEC: ${n.payer}`)!.amount)).toBe(n.amount);
      }
      // The late payer is nowhere in the organizer: it only arrives by email.
      expect(sc.items.some((i) => i.item.includes(dep.missing[0].payer))).toBe(false);
    }
  }, SLOW);

  it("schedule C: totals tie, the key matches the sheet solved from the organizer, and every planted trap is present", () => {
    for (const seed of SEEDS) {
      const sc = solveScheduleC(seed);
      const key = (scenario.generate(seed).keys["schedule-c"] as SheetKey).cells;
      expect(Object.keys(key).sort()).toEqual(INPUT_ROWS.map(([, id]) => id).sort());
      for (const [, id] of INPUT_ROWS) expect(key[id].value, `${seed} ${id}`).toBe(sc.cells[id]);
      expect(key.l28.value).toBe(EXPENSE_LINES.reduce((t, k) => t + key[k].value, 0));
      expect(key.l29.value).toBe(key.l1.value - key.l28.value);
      expect(key.l31.value).toBe(key.l29.value - key.l30.value);
      expect(key.l31.value).toBeGreaterThan(0);
      expect(key.l31.value * RATES.seEarningsShare).toBeLessThan(RATES.socialSecurityWageBase);
      // Traps left off: gas, health insurance, the parking ticket and the family trip.
      expect(sc.leftOff.map((x) => x.item.split(" ")[0]).sort()).toEqual(["Family", "Gas", "Health", "Parking"]);
      for (const x of sc.leftOff) expect(x.amount, `${seed} ${x.item}`).toBeGreaterThan(30_00);
      expect(sc.sqft).toBeGreaterThanOrEqual(90);
      expect(sc.sqft).toBeLessThanOrEqual(RATES.homeOfficeMaxSqFt);
    }
  }, SLOW);

  it("schedule C: the input screen lists each line once, in order, with its input cell", () => {
    const sc = solveScheduleC("abc");
    const inputs = sc.sheet.rows
      .filter((r) => r.some((c) => c.kind === "input"))
      .map((r) => [text(r[0]), (r.find((c) => c.kind === "input") as { id: string }).id]);
    expect(inputs).toEqual(INPUT_ROWS);
  });

  it("the family trip in the organizer is the one the client asks about in the inbox", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const sc = solveScheduleC(seed);
      const trip = sc.leftOff.find((x) => /^Family trip/.test(x.item))!;
      const vac = screen(seed).msg("m4").body;
      expect(vac).toContain(money(trip.amount));
      expect(vac).toContain(trip.item.replace(/^Family trip to /, ""));
    }
  });

  it("Elena's net profit: her draft gross is the income before the late 1099, her expenses are line 28, and the key is net of the home office", () => {
    for (const seed of SEEDS) {
      const draft = elenaDraft(seed);
      const sc = solveScheduleC(seed);
      expect(draft.body).toMatch(/number only/i);
      expect(draft.gross).toBe((sc.cells.l1 - whole(sc.late.amount)) * 100);
      expect(draft.expenses).toBe(sc.cells.l28 * 100);
      expect(draft.sqft).toBe(sc.sqft);
      const k = scenario.generate(seed).keys["net-profit"] as NumKey;
      expect(k.value, seed).toBe(draft.net);
      expect(k.value).toBe(sc.cells.l31 - whole(sc.late.amount));
    }
  }, SLOW);

  it("every rapid item has exactly one correct answer, in its options, solved from the material alone", () => {
    for (const seed of SEEDS) {
      const keys = scenario.generate(seed).keys;
      for (const id of RAPID_STEPS) {
        const key = keys[id] as RapidKey;
        const solved = solveRapid(seed, id);
        expect(Object.keys(key.items).sort()).toEqual(solved.map((s) => s.item.id).sort());
        for (const s of solved) {
          const k = key.items[s.item.id];
          expect(Object.keys(k)).toEqual(s.item.fields.map((f) => f.id));
          for (const f of s.item.fields) {
            const want = k[f.id];
            if ("options" in f) {
              expect(f.options.filter((o) => o.id === want.choice).length, `${seed} ${s.item.id}`).toBe(1);
              expect(want.choice, `${seed} ${s.item.id} (${s.kind}: ${s.item.prompt})`).toBe(s.values[f.id]);
            } else {
              expect(want.value, `${seed} ${s.item.id} (${s.kind}: ${s.item.prompt})`).toBe(s.values[f.id]);
              expect(want.tolerance).toBe(1);
            }
          }
        }
      }
    }
  }, SLOW);

  it("gives reviewers this variant's facts for all three replies", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const keys = scenario.generate(seed).keys;
      const sc = solveScheduleC(seed);
      const { step } = screen(seed);
      const info = SORT_STEPS.flatMap((id) => readSort(step(id).config as Doc)).find((d) => d.category === "info")!;
      const late = (keys["late-reply"] as ReplyKey).notes;
      expect(late.changes).toContain(money(sc.late.amount));
      const summary = (keys["elena-summary"] as ReplyKey).notes;
      expect(summary.profit).toContain(`$${sc.cells.l31.toLocaleString("en-US")}`);
      expect(summary.docs).toContain(info.from);
      const vac = (keys["vacation-reply"] as ReplyKey).notes;
      expect(vac.answer).toMatch(/not deductible/i);
    }
  });
});

describe("tax-hollis-schedule-c: scoring", () => {
  it("out of 100: rapid rounds 10 each, organize 25, inbox 15, Schedule C 30", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect([...SORT_STEPS, "deposits"].map(max)).toEqual([6, 6, 6, 7]);
    expect([max("vacation-reply"), max("net-profit"), max("late-reply")]).toEqual([5, 4, 6]);
    expect([max("schedule-c"), max("elena-summary")]).toEqual([20, 10]);
    const sections = scenario.definition.sections!.map((s) => s.stepIds.reduce((t, id) => t + max(id), 0));
    expect(sections).toEqual([10, 25, 10, 15, 10, 30]);
    expect(sections.reduce((t, x) => t + x, 0)).toBe(MAX);
  });

  it("a blank attempt scores 0 for every seed, with nothing sent to review", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const s = scoreAttempt(scenario, seed, {});
      expect(s.points).toBe(0);
      for (const id of RUBRIC_STEPS) expect(s.steps[id].needsReview).toBeFalsy();
    }
  });

  it("a perfect answer earns every automatic point and the three replies go to review", () => {
    for (const seed of SEEDS) {
      const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
      for (const id of AUTO_STEPS) expect(s.steps[id].points, `${seed} ${id}`).toBe(s.steps[id].maxPoints);
      for (const id of RUBRIC_STEPS) expect(s.steps[id].needsReview, `${seed} ${id}`).toBe(true);
      expect(s.points).toBe(79);
    }
  }, SLOW);

  it("a perfect answer is 100 once a reviewer gives the three replies full marks", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
      const reviewed = s.points + RUBRIC_STEPS.reduce((t, id) => t + s.steps[id].maxPoints - s.steps[id].points, 0);
      expect(reviewed, seed).toBe(MAX);
    }
  });

  it("another seed's perfect answer doesn't score well (answers can't be shared)", () => {
    let shared = 0;
    for (let i = 0; i < 20; i++) shared += scoreAttempt(scenario, SEEDS[i + 1], perfectAnswers(SEEDS[i])).points;
    expect(shared / 20).toBeLessThan(30);
  });

  it("gives the reviewer the rubric for the three replies", () => {
    const r = scoreAttempt(scenario, "abc", perfectAnswers("abc"));
    expect(r.steps["vacation-reply"].items.map((i) => [i.id, i.max])).toEqual([
      ["answer", 2],
      ["why", 2],
      ["tone", 1],
    ]);
    expect(r.steps["late-reply"].items.map((i) => [i.id, i.max])).toEqual([
      ["thanks", 1],
      ["changes", 3],
      ["next", 2],
    ]);
    expect(r.steps["elena-summary"].items.map((i) => [i.id, i.max])).toEqual([
      ["profit", 3],
      ["open", 3],
      ["docs", 2],
      ["brevity", 2],
    ]);
  });

  describe("each planted trap answered the wrong way costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    const lost = (seed: string, mutate: (a: Answers & Record<string, unknown>) => void) => {
      const a = clone(perfectAnswers(seed));
      mutate(a);
      return scoreAttempt(scenario, seed, perfectAnswers(seed)).points - scoreAttempt(scenario, seed, a).points;
    };
    const cells = (a: Answers) => a["schedule-c"].cells as Record<string, number>;
    /** Puts `dollars` on one expense line and carries it through lines 28, 29 and 31, as a candidate's sheet would. */
    const addToLine = (a: Answers, line: string, dollars: number) => {
      const c = cells(a);
      c[line] += dollars;
      c.l28 += dollars;
      c.l29 -= dollars;
      c.l31 -= dollars;
    };
    const organizerAmount = (seed: string, re: RegExp) => cents(solveScheduleC(seed).items.find((i) => re.test(i.item))!.amount);

    it("deposits: missing 1099-NEC not flagged loses 4; flagged with another reason loses 2", () => {
      for (const seed of seeds) {
        expect(lost(seed, (a) => (a.deposits.flags = [])), seed).toBe(4);
        expect(lost(seed, (a) => (a.deposits.flags[0].reason = "mismatch")), seed).toBe(2);
      }
    });

    it("deposits: flagging the small-clients row as well costs the 1-point false flag", () => {
      for (const seed of seeds) {
        const small = readDeposits(screen(seed).step("deposits").config as Doc).rows.find((r) => r.small)!;
        expect(lost(seed, (a) => a.deposits.flags.push({ target: small.id, reason: "missing", note: "" })), seed).toBe(1);
      }
    });

    it("deposits: leaving the income off until the form arrives (or for good) loses the 3 decision points", () => {
      for (const seed of seeds) {
        expect(lost(seed, (a) => (a.deposits.decision = "wait"))).toBe(3);
        expect(lost(seed, (a) => (a.deposits.decision = "skip"))).toBe(3);
      }
    });

    it("organize: a document flagged with the wrong category loses 1; a document not flagged loses 2", () => {
      for (const seed of seeds) {
        for (const id of SORT_STEPS) {
          expect(
            lost(seed, (a) => {
              const f = (a[id] as { flags: { reason: string }[] }).flags[0];
              f.reason = f.reason === "personal" ? "expense" : "personal";
            }),
            `${seed} ${id}`,
          ).toBe(1);
          expect(lost(seed, (a) => (a[id] as { flags: unknown[] }).flags.splice(1, 1))).toBe(2);
        }
      }
    }, SLOW);

    it("organize: calling the laptop a deductible expense (it's over the de minimis limit) loses 1", () => {
      for (const seed of seeds) {
        expect(
          lost(seed, (a) => {
            for (const id of SORT_STEPS) for (const f of (a[id] as { flags: { reason: string }[] }).flags) if (f.reason === "asset") f.reason = "expense";
          }),
        ).toBe(1);
      }
    });

    it("schedule C: gas added to car expenses on top of the standard mileage rate loses 5.5", () => {
      for (const seed of seeds) expect(lost(seed, (a) => addToLine(a, "l9", whole(organizerAmount(seed, /^Gas/)))), seed).toBe(5.5);
    });

    it("schedule C: meals at 100% instead of 50% loses 5.5", () => {
      for (const seed of seeds) {
        const meals = organizerAmount(seed, /^Client meals/);
        expect(lost(seed, (a) => addToLine(a, "l24b", whole(meals) - whole(meals / 2))), seed).toBe(5.5);
      }
    });

    it("schedule C: self-employed health insurance put on line 15 loses 5.5", () => {
      for (const seed of seeds) expect(lost(seed, (a) => addToLine(a, "l15", whole(organizerAmount(seed, /^Health insurance/)))), seed).toBe(5.5);
    });

    it("schedule C: the parking ticket (a fine) on line 27a loses 5.5", () => {
      for (const seed of seeds) expect(lost(seed, (a) => addToLine(a, "l27a", whole(organizerAmount(seed, /^Parking ticket/)))), seed).toBe(5.5);
    });

    it("schedule C: the family trip on line 27a loses 5.5", () => {
      for (const seed of seeds) expect(lost(seed, (a) => addToLine(a, "l27a", whole(organizerAmount(seed, /^Family trip/)))), seed).toBe(5.5);
    });

    it("net profit: leaving out the home office, or adding the late 1099 to Elena's draft, loses the 4 points", () => {
      for (const seed of seeds) {
        const draft = elenaDraft(seed);
        expect(lost(seed, (a) => (a["net-profit"].value = whole(draft.gross - draft.expenses)))).toBe(4);
        expect(lost(seed, (a) => (a["net-profit"].value = draft.net + whole(solveScheduleC(seed).late.amount)))).toBe(4);
      }
    });

    it("a rapid item answered wrong or left to time out costs exactly its points (½ or 1)", () => {
      const seed = "abc";
      for (const id of RAPID_STEPS) {
        const solved = solveRapid(seed, id);
        const points = rapidConfig(id).items.map((i) => i.points);
        for (const i of [0, 2]) {
          const item = solved[i].item;
          const f = item.fields[0];
          const wrong = "options" in f ? f.options.find((o) => o.id !== solved[i].values[f.id])!.id : Number(solved[i].values[f.id]) + 50;
          expect(
            lost(seed, (a) => ((a[id] as RapidAnswersShape).items[item.id].values[f.id] = wrong)),
            `${id} item ${i + 1}`,
          ).toBe(points[i]);
          expect(lost(seed, (a) => delete (a[id] as RapidAnswersShape).items[item.id])).toBe(points[i]);
        }
      }
    });
  });
});

type RapidAnswersShape = { items: Record<string, { values: Record<string, string | number>; ms: number }> };

describe("tax-hollis-schedule-c: the late 1099 changes gross receipts", () => {
  it("the key's line 1 includes the late 1099; without it line 1 is short by exactly that amount", () => {
    for (const seed of SEEDS) {
      const withLate = solveScheduleC(seed);
      const without = solveScheduleC(seed, { withLate: false });
      const key = (scenario.generate(seed).keys["schedule-c"] as SheetKey).cells;
      expect(key.l1.value, seed).toBe(withLate.cells.l1);
      expect(key.l1.value - without.cells.l1).toBe(whole(withLate.late.amount));
      expect(key.l28.value).toBe(without.cells.l28);
      expect(key.l31.value - without.cells.l31).toBe(whole(withLate.late.amount));
    }
  }, SLOW);

  it("a sheet that ignores the late 1099 scores exactly 6 lower: line 1 (3), line 29 (1), line 31 (2)", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const a = clone(perfectAnswers(seed));
      a["schedule-c"].cells = { ...solveScheduleC(seed, { withLate: false }).cells };
      const perfect = scoreAttempt(scenario, seed, perfectAnswers(seed));
      const ignored = scoreAttempt(scenario, seed, a);
      expect(perfect.points - ignored.points, seed).toBe(6);
      const items = Object.fromEntries(ignored.steps["schedule-c"].items.map((i) => [i.id, i.earned]));
      expect([items.l1, items.l28, items.l29, items.l31]).toEqual([0, 1, 0, 0]);
    }
  });
});

describe("tax-hollis-schedule-c: deductibility rule table (one test per rule)", () => {
  const seen = new Map<string, { treatment: string; label: string; points: number }[]>();
  for (const seed of SEEDS.slice(0, 120)) {
    const key = scenario.generate(seed).keys["rapid-deduct"] as RapidKey;
    const points = rapidConfig("rapid-deduct").items.map((i) => i.points);
    rapidItems(seed, "rapid-deduct").forEach((item, i) => {
      const rule = DEDUCT_RULES.find(([, re]) => re.test(item.prompt));
      const id = rule?.[0] ?? `unknown: ${item.prompt}`;
      const choice = key.items[item.id].treatment.choice!;
      const label = choiceField(item, "treatment").options.find((o) => o.id === choice)!.label;
      seen.set(id, [...(seen.get(id) ?? []), { treatment: choice, label, points: points[i] }]);
    });
  }

  it("every expense shown is in the rule table", () => {
    expect([...seen.keys()].filter((k) => k.startsWith("unknown"))).toEqual([]);
  });

  for (const [id, , treat, tier] of DEDUCT_RULES) {
    it(`${id}: ${treat === "full" ? "fully deductible" : treat === "half" ? "50% deductible" : treat === "none" ? "not deductible" : "capitalize and depreciate"} (${tier === "hard" ? "1 point" : "½ point"})`, () => {
      const hits = seen.get(id) ?? [];
      expect(hits.length, `${id} shows up in 120 seeds`).toBeGreaterThan(tier === "hard" ? 100 : 50);
      for (const h of hits) {
        expect(h.label).toMatch(TREAT_LABEL[treat]);
        expect(h.points).toBe(tier === "hard" ? 1 : 0.5);
      }
    });
  }
});

describe("tax-hollis-schedule-c: whole dollars and the documented tolerance", () => {
  const seeds = SEEDS.slice(0, 40);
  const cells = (a: Answers) => a["schedule-c"].cells as Record<string, number>;

  it("every number in the key is whole dollars, rounded from the exact amount the IRS way", () => {
    for (const seed of seeds) {
      const keys = scenario.generate(seed).keys;
      for (const id of ["rapid-forms", "rapid-calcs"] as const) {
        for (const s of solveRapid(seed, id)) {
          if (s.exact === undefined) continue;
          const k = (keys[id] as RapidKey).items[s.item.id].amount;
          expect(Number.isInteger(k.value), `${seed} ${s.item.id}`).toBe(true);
          expect(k.value).toBe(Math.floor((s.exact + 50) / 100));
          const f = s.item.fields[0] as RapidNumberField;
          expect(f.decimals).toBe(0);
        }
      }
      for (const c of Object.values((keys["schedule-c"] as SheetKey).cells)) expect(Number.isInteger(c.value)).toBe(true);
      expect(Number.isInteger((keys["net-profit"] as NumKey).value)).toBe(true);
    }
  });

  it("the rounding matters: some exact amounts have cents of 50 or more, and they round up", () => {
    let up = 0;
    for (const seed of seeds) {
      for (const s of [...solveRapid(seed, "rapid-forms"), ...solveRapid(seed, "rapid-calcs")]) {
        if (s.exact === undefined) continue;
        const rest = s.exact - Math.floor(s.exact / 100) * 100;
        if (rest >= 50) {
          up++;
          expect(s.values.amount).toBe(Math.ceil(s.exact / 100));
        }
      }
    }
    expect(up).toBeGreaterThan(20);
  });

  it("rapid number items: ±$1 earns the item, ±$2 doesn't; truncating or typing the cents still counts", () => {
    for (const seed of seeds.slice(0, 10)) {
      for (const id of ["rapid-forms", "rapid-calcs"] as const) {
        const solved = solveRapid(seed, id).filter((s) => s.exact !== undefined);
        const points = new Map(rapidConfig(id).items.map((i) => [i.id, i.points]));
        for (const s of solved) {
          const at = (v: number) => {
            const r = scoreAttempt(scenario, seed, { [id]: { items: { [s.item.id]: { values: { amount: v }, ms: 5_000 } } } });
            return r.steps[id].items.find((i) => i.id === s.item.id)!.earned;
          };
          const k = Number(s.values.amount);
          const full = points.get(s.item.id)!;
          expect([at(k - 1), at(k), at(k + 1)], `${seed} ${s.item.id}`).toEqual([full, full, full]);
          expect([at(k - 2), at(k + 2)]).toEqual([0, 0]);
          expect(at(s.exact! / 100)).toBe(full);
          expect(at(Math.floor(s.exact! / 100))).toBe(full);
        }
      }
    }
  });

  it("net profit: ±$1 earns the 4 points, ±$2 earns nothing (no partial credit)", () => {
    for (const seed of seeds) {
      const k = elenaDraft(seed).net;
      const at = (v: number) => scoreAttempt(scenario, seed, { "net-profit": { value: v } }).steps["net-profit"].points;
      expect([at(k - 1), at(k), at(k + 1), at(k - 2), at(k + 2)], seed).toEqual([4, 4, 4, 0, 0]);
    }
  });

  it("schedule C: line 1, line 30 and each expense line accept ±$1; lines 28, 29 and 31 accept ±$3", () => {
    for (const seed of seeds.slice(0, 15)) {
      const sc = solveScheduleC(seed);
      const pts = new Map<string, number>();
      for (const [, id] of INPUT_ROWS) {
        const at = (d: number) => {
          const r = scoreAttempt(scenario, seed, { "schedule-c": { cells: { [id]: sc.cells[id] + d } } });
          return r.steps["schedule-c"].items.find((i) => i.id === id)!.earned;
        };
        const full = at(0);
        pts.set(id, full);
        const tol = ["l28", "l29", "l31"].includes(id) ? 3 : 1;
        expect([at(-tol), at(tol)], `${seed} ${id}`).toEqual([full, full]);
        expect([at(-tol - 1), at(tol + 1)], `${seed} ${id}`).toEqual([0, 0]);
      }
      expect(Object.fromEntries(pts)).toEqual({
        l1: 3,
        l8: 1.5,
        l9: 1.5,
        l13: 1.5,
        l15: 1.5,
        l17: 1.5,
        l22: 1.5,
        l24b: 1.5,
        l27a: 1.5,
        l28: 1,
        l29: 1,
        l30: 1,
        l31: 2,
      });
    }
  });

  it("schedule C: rounding once at the end instead of line by line still scores every total", () => {
    for (const seed of seeds) {
      const sc = solveScheduleC(seed);
      const { items } = sc;
      // Sum the exact expense cents across every line, then round once.
      let expenseCents = 0;
      for (const it of items) {
        const t = ORGANIZER_RULES.find(([re]) => re.test(it.item))![1];
        if (!t.line || t.line === "l1" || t.line === "l30") continue;
        if (t.how === "miles") expenseCents += sc.miles * RATES.mileageCentsPerMile;
        else if (t.how === "half") expenseCents += cents(it.amount) * RATES.mealsShare;
        else expenseCents += cents(it.amount);
      }
      const l28 = whole(expenseCents);
      const a = clone(perfectAnswers(seed));
      const c = cells(a);
      c.l28 = l28;
      c.l29 = c.l1 - l28;
      c.l31 = c.l29 - c.l30;
      expect(scoreAttempt(scenario, seed, a).steps["schedule-c"].points, seed).toBe(20);
    }
  });
});

describe("tax-hollis-schedule-c: timing", () => {
  const def = scenario.definition;
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-16T09:00:00Z");
  const flowAt = (ms: number, extraTimePercent = 0, events: Parameters<typeof resolveFlow>[1]["events"] = []) =>
    resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent, events });
  const stepById = (id: string) => def.steps.find((s) => s.id === id)!;

  it("validateSections passes and the six sections fill the 52 minutes", () => {
    expect(validateSections(def, scenario.timeLimitMinutes)).toEqual([]);
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-forms"], false],
      ["s-organize", 12, ["sort-1", "sort-2", "sort-3", "deposits"], true],
      ["s-rapid-b", 6, ["rapid-deduct"], false],
      ["s-inbox", 10, ["vacation-reply", "net-profit", "late-reply"], true],
      ["s-rapid-c", 6, ["rapid-calcs"], false],
      ["s-final", 12, ["schedule-c", "elena-summary"], false],
    ]);
    expect(def.sections!.reduce((t, s) => t + s.minutes, 0)).toBe(scenario.timeLimitMinutes);
  });

  it("one-at-a-time screens add up to their section: 4 × 3 minutes, then 3, 3 and 4", () => {
    expect(["sort-1", "sort-2", "sort-3", "deposits"].map((id) => stepById(id).seconds)).toEqual([180, 180, 180, 180]);
    expect(["vacation-reply", "net-profit", "late-reply"].map((id) => stepById(id).seconds)).toEqual([180, 180, 240]);
    for (const sec of def.sections!.filter((s) => s.oneAtATime)) {
      expect(sec.stepIds.reduce((t, id) => t + stepById(id).seconds!, 0), sec.id).toBe(sec.minutes * 60);
    }
  });

  it("each rapid round is 15 items × 20 seconds, ten worth ½ and five worth 1, inside its 6 minutes", () => {
    for (const id of RAPID_STEPS) {
      const config = rapidConfig(id);
      expect(config.items.length, id).toBe(15);
      expect(config.secondsPerItem).toBe(20);
      expect(config.items.map((i) => i.points)).toEqual([0.5, 0.5, 1, 0.5, 0.5, 1, 0.5, 0.5, 1, 0.5, 0.5, 1, 0.5, 0.5, 1]);
      const sec = def.sections!.find((s) => s.stepIds.includes(id))!;
      expect(config.items.length * config.secondsPerItem).toBeLessThanOrEqual(sec.minutes * 60);
    }
  });

  it("an unanswered rapid item scores 0 and says so; the rest of the round still counts", () => {
    for (const seed of SEEDS.slice(0, 10)) {
      const answers = rapidAnswers(seed);
      for (const id of RAPID_STEPS) {
        const first = Object.keys(answers[id].items)[0];
        delete answers[id].items[first];
        const s = scoreAttempt(scenario, seed, { [id]: answers[id] }).steps[id];
        const item = s.items.find((i) => i.id === first)!;
        expect(item.earned).toBe(0);
        expect(item.note).toMatch(/No answer/);
        expect(s.points).toBe(9.5);
        expect(s.items.find((i) => i.id === "timing")!.note).toMatch(/1 with no answer/);
      }
    }
  });

  for (const extra of [0, 25, 50, 100]) {
    it(`extra time ${extra}% stretches each rapid item's limit to ${20 * (1 + extra / 100)} s, and the round still fits its section`, () => {
      for (const id of RAPID_STEPS) {
        const secIndex = def.sections!.findIndex((s) => s.stepIds.includes(id));
        // Finish every earlier section straight away, so this one starts now.
        const events = def.sections!.slice(0, secIndex).map((s, i) => ({ kind: "advanced_section" as const, sectionId: s.id, at: t0 + i }));
        const flow = flowAt(secIndex + 1, extra, events);
        expect(flow.visibleStepIds).toEqual([id]);
        const sec = flow.section!;
        const config = rapidConfig(id);
        const items = (now: number, answeredAt: Record<number, number> = {}) =>
          resolveItems({ stepStartedAt: sec.startedAt, stepEndsAt: sec.endsAt, count: config.items.length, secondsPerItem: config.secondsPerItem, extraTimePercent: extra, answeredAt, now });
        const per = 20_000 * (1 + extra / 100);
        expect(items(sec.startedAt).endsAt - sec.startedAt, id).toBe(per);
        expect(items(sec.startedAt + per - 1).index).toBe(0);
        expect(items(sec.startedAt + per).index).toBe(1);
        expect(sec.endsAt - sec.startedAt).toBe(6 * MIN * (1 + extra / 100));
        expect(items(sec.startedAt + 15 * per - 1).index).toBe(14);
      }
    });
  }

  it("sections run back to back with no early finishes", () => {
    const at = (min: number) => flowAt(min * MIN);
    expect(at(0).visibleStepIds).toEqual(["rapid-forms"]);
    expect(at(6).visibleStepIds).toEqual(["sort-1"]);
    expect(at(15).visibleStepIds).toEqual(["deposits"]);
    expect(at(18).visibleStepIds).toEqual(["rapid-deduct"]);
    expect(at(24).visibleStepIds).toEqual(["vacation-reply"]);
    expect(at(30).visibleStepIds).toEqual(["late-reply"]);
    expect(at(34).visibleStepIds).toEqual(["rapid-calcs"]);
    expect(at(40).visibleStepIds).toEqual(["schedule-c", "elena-summary"]);
    expect(at(END).done).toBe(true);
  });

  it("messages linked to a step arrive when its section opens (the note to Elena a minute later)", () => {
    expect(def.messages.map((m) => [m.id, m.arriveAtMinute ?? 0, m.stepId])).toEqual([
      ["m1", 0, "rapid-forms"],
      ["m2", 0, "sort-1"],
      ["m3", 0, "rapid-deduct"],
      ["m4", 0, "vacation-reply"],
      ["m5", 0, "net-profit"],
      ["m6", 0, "late-reply"],
      ["m7", 0, "rapid-calcs"],
      ["m8", 0, "schedule-c"],
      ["m9", 1, "elena-summary"],
    ]);
    const msgsAt = (min: number) => visibleMessageIds(def, flowAt(min * MIN), t0, t0 + min * MIN);
    expect(msgsAt(0)).toEqual(["m1"]);
    expect(msgsAt(6)).toEqual(["m1", "m2"]);
    expect(msgsAt(24)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6"]);
    expect(msgsAt(40)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8"]);
    expect(msgsAt(41)).toEqual(["m1", "m2", "m3", "m4", "m5", "m6", "m7", "m8", "m9"]);
  });

  it("the flow renders each rapid item exactly as sequence.renderItem does, and nothing about the key", () => {
    for (const id of RAPID_STEPS) {
      const items = rapidItems("abc", id);
      for (const index of [0, 7, 14]) {
        const view = renderFlowForCandidate(scenario, "abc", {
          stepIds: [id],
          messages: [],
          sequences: { [id]: { index, count: 15, endsAt: "2026-11-16T09:00:20.000Z" } },
        });
        const cfg = view.steps[0].config as { itemCount: number; current: { item: RapidItem } };
        expect(cfg.itemCount).toBe(15);
        expect(cfg.current.item).toEqual(items[index]);
        expect(JSON.stringify(cfg)).not.toMatch(/"items"|choice"|tolerance|points/);
      }
    }
  });
});

describe("tax-hollis-schedule-c: rapid rounds", () => {
  it("form to field: every form and box kind shows up, picks in the easy slots, amounts in the hard ones", () => {
    const kinds = new Set<string>();
    for (const seed of SEEDS.slice(0, 40)) {
      solveRapid(seed, "rapid-forms").forEach((s, i) => {
        kinds.add(s.kind);
        expect("dest" in s.values, `${seed} item ${i + 1}`).toBe(i % 3 !== 2);
      });
    }
    expect([...kinds].sort()).toEqual(
      [
        "Form 1098 box 1",
        "Form 1099-DIV box 1a",
        "Form 1099-DIV box 1b",
        "Form 1099-DIV box 2a",
        "Form 1099-INT box 1",
        "Form 1099-INT box 3",
        "Form 1099-INT box 8",
        "Form 1099-NEC box 1",
        "Form W-2 box 1",
        "Form W-2 box 2",
        "div-ordinary",
        "int-total",
        "mortgage-8a",
        "nec-two",
        "w2-wages",
      ].sort(),
    );
  });

  it("quick calcs: every kind shows up, the harder ones in the 1-point slots", () => {
    const hard = new Set(["office-cap", "se-tax", "half-se", "safe-harbor", "miles-plus"]);
    const kinds = new Set<string>();
    for (const seed of SEEDS.slice(0, 40)) {
      solveRapid(seed, "rapid-calcs").forEach((s, i) => {
        kinds.add(s.kind);
        expect(hard.has(s.kind), `${seed} item ${i + 1} ${s.kind}`).toBe(i % 3 === 2);
      });
    }
    expect([...kinds].sort()).toEqual(["estimate", "half-se", "meals", "miles", "miles-plus", "office", "office-cap", "safe-harbor", "se-base", "se-tax"]);
  });

  it("deductible?: the harder rules sit in the 1-point slots", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      solveRapid(seed, "rapid-deduct").forEach((s, i) => {
        const tier = DEDUCT_RULES.find(([id]) => id === s.kind)![3];
        expect(tier === "hard", `${seed} item ${i + 1} ${s.kind}`).toBe(i % 3 === 2);
      });
    }
  });

  it("varies per seed: amounts, names and which item comes when", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBe(60);
      expect(new Set(firsts.map((s) => s.kind)).size, id).toBeGreaterThanOrEqual(3);
    }
  });

  it("option ids and labels are the same on every item and every seed, so they can't hint at the answer", () => {
    for (const id of ["rapid-forms", "rapid-deduct"] as const) {
      const sig = (seed: string) =>
        JSON.stringify(rapidItems(seed, id).map((i) => i.fields.filter((f) => "options" in f).map((f) => [f.id, (f as RapidChoiceField).options])));
      const first = sig(SEEDS[0]);
      for (const seed of SEEDS.slice(1, 30)) expect(sig(seed), `${id} ${seed}`).toBe(first);
    }
  });

  it("no rendered rapid item carries the key's fields or a reviewer note", () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const strings = JSON.stringify(scenario.generate(seed).keys);
      for (const id of RAPID_STEPS) {
        for (const item of rapidItems(seed, id)) {
          const json = JSON.stringify(item);
          expect(json).not.toMatch(/choice"|tolerance|points|"kind":"choice"/);
          for (const k of Object.keys(item)) expect(["id", "prompt", "exhibit", "fields"]).toContain(k);
        }
      }
      expect(strings.length).toBeGreaterThan(0);
    }
  });
});

describe("tax-hollis-schedule-c: nothing derived reaches the candidate", () => {
  const forms = (dollars: number) => [String(dollars), dollars.toLocaleString("en-US"), `${dollars.toLocaleString("en-US")}.00`];
  const contains = (payload: string, form: string) => new RegExp(`(?<![\\d.,])${form.replace(/[.$]/g, "\\$&")}(?![\\d.,]\\d)`).test(payload);

  it("no gross receipts with the late 1099, net profit or reviewer note in any payload", () => {
    for (const seed of SEEDS) {
      const variant = scenario.generate(seed);
      const sheet = (variant.keys["schedule-c"] as SheetKey).cells;
      const notes = RUBRIC_STEPS.flatMap((id) => Object.values((variant.keys[id] as ReplyKey).notes));
      for (const minute of [0, 24, END]) {
        const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
        expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"findings"/);
        for (const v of [sheet.l1.value, sheet.l29.value, sheet.l31.value, (variant.keys["net-profit"] as NumKey).value]) {
          for (const f of forms(v)) expect(contains(payload, f), `${seed} m${minute}: ${f}`).toBe(false);
        }
        for (const n of notes) expect(payload).not.toContain(n);
      }
    }
  }, SLOW);
});

describe("tax-hollis-schedule-c: messages", () => {
  it("Elena greets the candidate by first name; client messages are signed with the client's seeded name", () => {
    const view = (name?: string | null) => renderAttemptForCandidate(scenario, "abc", END, { name });
    expect(view("Sam Lee").messages.find((m) => m.id === "m1")!.body.split("\n")[0]).toBe("Hi Sam,");
    expect(view(null).messages.find((m) => m.id === "m1")!.body.split("\n")[0]).toBe("Hi there,");
    for (const seed of SEEDS.slice(0, 30)) {
      const { msg } = screen(seed);
      const client = String(scenario.generate(seed).values.client);
      for (const id of ["m4", "m6"]) {
        expect(msg(id).from).toBe("Client portal message");
        expect(msg(id).body).toContain(client.split(" ")[0]);
      }
      for (const id of ["m1", "m2", "m3", "m5", "m7", "m8", "m9"]) expect(msg(id).from).toMatch(/^Elena Vasquez/);
    }
  });

  it("Elena states the de minimis policy before the organize screens and the deductible round", () => {
    const { msg } = screen("abc");
    expect(msg("m2").body).toMatch(/de minimis/i);
    expect(rapidConfig("rapid-deduct").intro).toMatch(/\$2,500/);
  });

  it("the quick-calc round gives the 2025 rates and the rounding rule", () => {
    const intro = rapidConfig("rapid-calcs").intro;
    expect(intro).toMatch(/70 cents a mile/);
    expect(intro).toMatch(/\$5 a square foot/);
    expect(intro).toMatch(/300 square feet/);
    expect(intro).toMatch(/92\.35%/);
    expect(intro).toMatch(/15\.3%/);
    expect(intro).toMatch(/whole dollars/i);
  });

  it("the late 1099 and the vacation question come from the client; Elena asks for net profit as a number only on her draft", () => {
    for (const seed of SEEDS.slice(0, 30)) {
      const { msg } = screen(seed);
      expect(msg("m4").body).toMatch(/email/i);
      expect(msg("m6").body).toMatch(/1099-NEC/);
      expect(msg("m5").body).toMatch(/draft/i);
      expect(msg("m8").body).toMatch(/Section 179/);
      expect(msg("m9").body).toMatch(/open items/i);
    }
  });
});
