import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";

vi.mock("server-only", () => ({}));

const { piDiazDemand } = await import("@/lib/engine/scenarios/pi-diaz-demand");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");

/**
 * Personal injury paralegal: Diaz, intake to demand. Three rapid rounds
 * (limitations and damages math, medical billing terms, intake and ethics) and
 * three work sections (medical chronology and treatment gaps, medical
 * specials, demand letter review and inbox), 50 minutes, 100 points. These
 * tests solve every task from what the candidate sees, with their own reading
 * of the rules, then compare with the server key.
 */

const scenario = piDiazDemand;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const MAX = 100;
const RAPID_STEPS = ["rapid-limitations", "rapid-billing", "rapid-intake"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const REVIEW_STEPS = ["treatment-gaps", "demand-review"] as const;
const MC_STEPS = ["inbox-conflict", "inbox-value"] as const;

type Field = { id: string; label: string; value: string };
type Doc = {
  prompt: string;
  document: { title: string; fields: Field[]; columns: string[]; rows: { id: string; cells: string[] }[]; totals: Field[]; footnote?: string };
  reasons: { id: string; label: string }[];
  decision?: { prompt: string; options: { id: string; label: string }[] };
};
type Mc = { prompt: string; options: { id: string; label: string }[]; select: "single" | "multi" };
type Ordering = { prompt: string; items: { id: string; label: string; detail?: string }[] };
type Cell = { kind: "text"; text: string } | { kind: "input"; id: string } | { kind: "empty" };
type Sheet = { prompt: string; columns: string[]; rows: Cell[][] };
type ReviewKey = { findings: Record<string, { targets: string[]; reasons: string[]; note?: string }>; decision?: string[] };
type McKey = { correct: string[] };
type Flag = { target: string; reason: string; note: string };

// ---- Reading the screen ----

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
  return {
    view,
    msg,
    doc: (id: (typeof REVIEW_STEPS)[number]) => step(id).config as Doc,
    mc: (id: (typeof MC_STEPS)[number]) => step(id).config as Mc,
    ordering: () => step("chronology").config as Ordering,
    sheet: () => step("specials").config as Sheet,
  };
}
type Screen = ReturnType<typeof screen>;

const field = (doc: Doc, id: string) => {
  const f = [...doc.document.fields, ...doc.document.totals].find((x) => x.id === id);
  expect(f, `field ${id}`).toBeDefined();
  return f!.value;
};

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
/** "Mon, Mar 2, 2026", "Monday, March 2, 2026" or "3/2/2026" → epoch day (UTC); checks a printed weekday. */
function day(label: string): number {
  const s = label.trim();
  let t: number;
  let wd: string | undefined;
  const numeric = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (numeric) t = Date.UTC(Number(numeric[3]), Number(numeric[1]) - 1, Number(numeric[2]));
  else {
    const m = s.match(/^(\w+), (\w+) (\d{1,2}), (\d{4})$/);
    expect(m, `date "${label}"`).not.toBeNull();
    const month = MONTHS.findIndex((x) => x === m![2] || x.slice(0, 3) === m![2]);
    expect(month, `month in "${label}"`).toBeGreaterThanOrEqual(0);
    t = Date.UTC(Number(m![4]), month, Number(m![3]));
    wd = m![1];
  }
  const w = WEEKDAYS[new Date(t).getUTCDay()];
  if (wd) expect([w, w.slice(0, 3)], `weekday of ${label}`).toContain(wd);
  return t / 86_400_000;
}
const weekend = (d: number) => [0, 6].includes(new Date(d * 86_400_000).getUTCDay());
const ymd = (d: number) => {
  const t = new Date(d * 86_400_000);
  return [t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()] as const;
};
const plusYears = (d: number, n: number) => {
  const [y, m, dd] = ymd(d);
  return Date.UTC(y + n, m, dd) / 86_400_000;
};
/** "$1,234.56" → cents. */
const cents = (s: string) => {
  const m = s.trim().match(/^-?\$([\d,]+)\.(\d{2})$/);
  expect(m, `money "${s}"`).not.toBeNull();
  return Number(m![1].replace(/,/g, "")) * 100 + Number(m![2]);
};

// ---- Section A: chronology and treatment gaps ----

/** The records, each with its date of service read from the detail line (not the date received). */
function readChronology(o: Ordering) {
  return o.items.map((i) => {
    const m = i.detail?.match(/^Received (.+) · Date of service (.+)$/);
    expect(m, `${i.id} detail "${i.detail}"`).not.toBeNull();
    return { id: i.id, label: i.label, received: day(m![1]), service: day(m![2]) };
  });
}
const solveChronology = (o: Ordering) => [...readChronology(o)].sort((a, b) => a.service - b.service).map((r) => r.id);

function readGaps(doc: Doc) {
  const dol = day(field(doc, "dol"));
  const rows = doc.document.rows.map((r) => ({ id: r.id, date: day(r.cells[0]), provider: r.cells[1], visit: r.cells[2] }));
  const pre = rows.filter((r) => r.date < dol);
  const after = rows.filter((r) => r.date >= dol);
  const gaps = after.slice(1).flatMap((r, i) => (r.date - after[i].date > 30 ? [{ id: r.id, prev: after[i].id, days: r.date - after[i].date }] : []));
  const near = after.slice(1).filter((r, i) => r.date - after[i].date >= 24 && r.date - after[i].date <= 30);
  return { dol, rows, pre, gaps, near };
}

// ---- Section B: specials worksheet ----

function readSheet(sh: Sheet) {
  const col = (name: RegExp) => {
    const i = sh.columns.findIndex((c) => name.test(c));
    expect(i, `column ${name}`).toBeGreaterThanOrEqual(0);
    return i;
  };
  const [cInv, cProv, cDate, cDesc, cBilled, cAdj, cPlan, cPat] = [/^Invoice/, /^Provider/, /^Date/, /^Description/, /^Billed/, /^Adjustment/, /^Plan paid/, /^Patient paid/].map(col);
  const text = (c: Cell | undefined) => (c && c.kind === "text" ? c.text : "");
  const invoices = sh.rows
    .filter((r) => /^[A-Z]{2,3}-\d{4}$/.test(text(r[cInv])))
    .map((r) => ({
      invoice: text(r[cInv]),
      provider: text(r[cProv]),
      date: day(text(r[cDate])),
      desc: text(r[cDesc]),
      billed: cents(text(r[cBilled])),
      adj: cents(text(r[cAdj])),
      plan: cents(text(r[cPlan])),
      patient: cents(text(r[cPat])),
    }));
  const inputs = sh.rows.flatMap((r) => r.filter((c): c is { kind: "input"; id: string } => c.kind === "input").map((c) => ({ id: c.id, label: r.map(text).join(" ") })));
  return { invoices, inputs };
}

function solveSpecials(sc: Screen) {
  const dol = day(field(sc.doc("treatment-gaps"), "dol"));
  const { invoices, inputs } = readSheet(sc.sheet());
  const seen = new Set<string>();
  const related = invoices.filter((i) => {
    if (i.date < dol || seen.has(i.invoice)) return false;
    seen.add(i.invoice);
    return true;
  });
  const sum = (f: (i: (typeof related)[number]) => number) => related.reduce((t, i) => t + f(i), 0);
  const specials = sum((i) => i.billed);
  const plan = sum((i) => i.plan);
  const lop = sum((i) => i.billed - i.adj - i.plan - i.patient);
  const oop = sum((i) => i.patient);
  const id = (re: RegExp) => {
    const x = inputs.filter((i) => re.test(i.label));
    expect(x.length, `input ${re}`).toBe(1);
    return x[0].id;
  };
  const cellsCents = {
    [id(/Medical specials/)]: specials,
    [id(/Health plan lien/)]: plan,
    [id(/letters of protection/)]: lop,
    [id(/Out of pocket/)]: oop,
    [id(/Total liens/)]: plan + lop,
  };
  return { invoices, related, cellsCents, specials, ids: { specials: id(/Medical specials/), plan: id(/Health plan lien/), lop: id(/letters of protection/), oop: id(/Out of pocket/), total: id(/Total liens/) } };
}
const toDollars = (c: Record<string, number>) => Object.fromEntries(Object.entries(c).map(([k, v]) => [k, v / 100]));

// ---- Section C: demand letter ----

function readDemand(sc: Screen) {
  const doc = sc.doc("demand-review");
  const intakeDol = day(sc.msg("m1").body.match(/Date of loss: (.+)$/m)![1]);
  const bills = [...doc.prompt.matchAll(/^• (.+): (\$[\d,]+\.\d{2})$/gm)].map((m) => ({ provider: m[1], billed: cents(m[2]) }));
  expect(bills.length).toBe(7);
  const rows = doc.document.rows.map((r) => ({ id: r.id, provider: r.cells[0], billed: cents(r.cells[2]) }));
  const enclosed = field(doc, "enclosures").replace(/^Records and bills from: /, "").split("; ");
  const issues = new Map<string, string>();
  if (day(field(doc, "dol")) !== intakeDol) issues.set("dol", "wrong_date");
  const listedSum = rows.reduce((t, r) => t + r.billed, 0);
  if (cents(field(doc, "specials_total")) !== listedSum) issues.set("specials_total", "math");
  if (bills.some((b) => !enclosed.includes(b.provider))) issues.set("enclosures", "missing");
  for (const r of rows) expect(bills.find((b) => b.provider === r.provider)?.billed, `${r.provider} amount`).toBe(r.billed);
  return { doc, intakeDol, bills, rows, enclosed, issues };
}

// ---- Inbox ----

function oneOption(cfg: { options: { id: string; label: string }[] }, re: RegExp) {
  const o = cfg.options.filter((x) => re.test(x.label));
  expect(o.length, `one option matching ${re}`).toBe(1);
  return o[0].id;
}
const solveConflict = (sc: Screen) => oneOption(sc.mc("inbox-conflict"), /^Stop and take the conflict/);
const solveValue = (sc: Screen) => oneOption(sc.mc("inbox-value"), /can't give a value/);

// ---- Rapid rounds ----

const rapidConfig = (stepId: RapidStepId) => rapidRoundServer.configSchema.parse(scenario.definition.steps.find((s) => s.id === stepId)!.config);

function rapidItems(seed: string, stepId: RapidStepId): RapidItem[] {
  const variant = scenario.generate(seed);
  const values = templateValues(variant.values);
  const fill = (t: string) => fillTemplate(t, values);
  const config = rapidConfig(stepId);
  const seq = rapidRoundServer.sequence!;
  return Array.from({ length: seq.count(config) }, (_, i) => seq.renderItem(config, { variant, fill }, i) as RapidItem);
}

type RapidKey = { items: Record<string, Record<string, { choice?: string; value?: number }>> };
type Solved = { values: Record<string, string | number>; kind: string };

const choiceField = (item: RapidItem, id: string) => {
  const f = item.fields.find((x) => x.id === id) as RapidChoiceField | undefined;
  expect(f, `${item.id} field ${id}`).toBeDefined();
  return f!;
};
const optionWith = (item: RapidItem, pred: (label: string) => boolean) => {
  const opts = choiceField(item, "answer").options.filter((o) => pred(o.label));
  expect(opts.length, `${item.id} (${item.prompt}): one option, got ${opts.map((o) => o.label).join(" | ")}`).toBe(1);
  return opts[0].id;
};
const exRow = (item: RapidItem, label: string) => {
  const r = item.exhibit?.rows?.find((x) => x.label === label);
  expect(r, `${item.id} row ${label}`).toBeDefined();
  return r!.value;
};
const money = (s: string) => Number(s.replace(/[$,]/g, ""));

/** Limitations dates from the Calloway rules in the round's intro, and the damages arithmetic. */
function solveLimitations(item: RapidItem): Solved {
  const f = item.fields[0];
  if (f.kind === "number") {
    const p = item.prompt;
    let c: number;
    let kind: string;
    let m: RegExpMatchArray | null;
    if ((m = p.match(/^Lost wages: (\$[\d,.]+) an hour, (\d+) hours a week, (\d+) weeks off work\./))) {
      kind = "wages";
      c = Math.round(money(m[1]) * 100) * Number(m[2]) * Number(m[3]);
    } else if ((m = p.match(/^Medical mileage: (\d+) round trips of (\d+) miles at (\$[\d.]+) a mile\./))) {
      kind = "mileage";
      c = Number(m[1]) * Number(m[2]) * Math.round(money(m[3]) * 100);
    } else if ((m = p.match(/^Three bills: (\$[\d,.]+), (\$[\d,.]+) and (\$[\d,.]+)\./))) {
      kind = "sum";
      c = [m[1], m[2], m[3]].reduce((t, x) => t + Math.round(money(x) * 100), 0);
    } else if ((m = p.match(/^The jury finds damages of (\$[\d,.]+) and finds the client (\d+)% at fault\./))) {
      kind = "fault";
      const pct = Number(m[2]);
      c = pct >= 51 ? 0 : (Math.round(money(m[1]) * 100) * (100 - pct)) / 100;
    } else if ((m = p.match(/^Settlement (\$[\d,.]+)\. Fee (\d+)% of the settlement, case costs (\$[\d,.]+), health plan lien (\$[\d,.]+)\./))) {
      kind = "net";
      const s = Math.round(money(m[1]) * 100);
      c = s - (s * Number(m[2])) / 100 - Math.round(money(m[3]) * 100) - Math.round(money(m[4]) * 100);
    } else throw new Error(`unknown money item: ${p}`);
    expect(Number.isInteger(c), p).toBe(true);
    return { values: { answer: c / 100 }, kind };
  }
  const injury = day(exRow(item, "Date of injury"));
  const born = day(exRow(item, "Client's date of birth"));
  const rule = exRow(item, "Limitations rule");
  const holidays = exRow(item, "Court holidays near the options");
  const hols = holidays === "None" ? [] : holidays.split("; ").map((h) => day(h.replace(/ \(.+\)$/, "")));
  const open = (d: number) => !weekend(d) && !hols.includes(d);
  const roll = (d: number) => {
    let x = d;
    while (!open(x)) x++;
    return x;
  };
  const minor = plusYears(born, 18) > injury;
  const start = minor ? plusYears(born, 18) : injury;
  let end: number;
  let kind: string;
  if (/^Claim against a public entity: 180 days/.test(rule)) {
    end = injury + 180;
    kind = "public";
  } else if (/^Injury to property: 3 years/.test(rule)) {
    end = plusYears(start, 3);
    kind = "property";
  } else if (/^Personal injury: 2 years/.test(rule)) {
    end = plusYears(start, 2);
    kind = minor ? "minor" : "pi";
  } else throw new Error(`unknown rule ${rule}`);
  const due = roll(end);
  if (kind === "pi" && due !== end) kind = hols.some((h) => h >= end && h <= due) ? "holiday" : "weekend";
  return { values: { answer: optionWith(item, (l) => day(l) === due) }, kind };
}

/** [kind, prompt pattern, right answer pattern, easy or hard] for the two choice rounds. */
const CHOICE_RULES: [string, RegExp, RegExp, "easy" | "hard"][] = [
  // Billing terms
  ["billed", /what are "billed charges"/, /^The full price the provider lists/, "easy"],
  ["adjustment", /"contractual adjustment"/, /^The amount written off under the provider's contract/, "easy"],
  ["eob", /What is an EOB/, /^An explanation of benefits/, "easy"],
  ["subrogation", /That right is called/, /^Subrogation/, "easy"],
  ["lop", /A letter of protection tells a provider/, /^It will be paid from the settlement/, "easy"],
  ["ledger", /Which record shows every charge/, /^An itemized ledger/, "easy"],
  ["hipaa", /HIPAA authorization signed by the client/, /^Request the client's medical records and bills/, "easy"],
  ["dos", /"Date of service" on a bill means/, /^The day the treatment was given/, "easy"],
  ["specials", /"Medical specials" in a demand are/, /^The medical bills: economic damages/, "easy"],
  ["balance-billing", /"Balance billing" means/, /^Billing the patient for what's left/, "easy"],
  ["medpay", /Med-pay coverage on the client's own auto policy/, /^The client's accident medical bills whatever the fault/, "easy"],
  ["custodian", /records custodian's affidavit/, /^Show the records are authentic business records/, "easy"],
  ["ub04", /Which form do hospitals usually bill/, /^UB-04/, "easy"],
  ["balance-math", /^Billed (\$[\d,.]+), contractual adjustment (\$[\d,.]+), plan paid (\$[\d,.]+), patient paid (\$[\d,.]+)\. What is the balance\?/, /.*/, "hard"],
  ["lien-math", /^The health plan paid (\$[\d,.]+) on accident bills and (\$[\d,.]+) on an unrelated checkup\./, /.*/, "hard"],
  ["collateral", /^Under Calloway's collateral source rule/, /.*/, "hard"],
  ["reduction", /"reduction requested"/, /^The attorney, with the client's consent/, "hard"],
  ["duplicate", /lists the same invoice twice/, /^Once$/, "hard"],
  ["pre-loss", /date of service before the date of loss/, /^Leave it out unless the attorney decides it's related/, "hard"],
  // Intake and ethics
  ["accept", /asks whether the firm will take the case/, /^No: only an attorney can accept a case/, "easy"],
  ["fee-agreement", /Who signs the fee agreement for the firm/, /^An attorney/, "easy"],
  ["sign-demand", /asks you to sign the demand letter/, /^No: the attorney signs it/, "easy"],
  ["recorded", /asks for a recorded statement from/, /^Decline and refer the adjuster to the attorney/, "easy"],
  ["represented", /The at-fault driver has a lawyer/, /^No: communicate through the driver's lawyer/, "easy"],
  ["provider-call", /calls to ask how the case is going/, /^Don't discuss it without the client's permission/, "easy"],
  ["social", /brings in screenshots of the other driver's posts/, /^Save them with the date and link/, "easy"],
  ["title", /What should your email signature show/, /^Your name and "Paralegal"/, "easy"],
  ["check", /settlement check arrives/, /^Log it and give it to the attorney for the client trust account/, "easy"],
  ["referral-fee", /offers the firm a fee for each client/, /^Decline and tell the attorney/, "easy"],
  ["intake-first", /What do you collect first at intake/, /^The date of loss, the people and insurers involved/, "easy"],
  ["same-crash", /driving the other car in the same crash/, /^Run a conflicts check before talking about the case/, "hard"],
  ["rent", /asks whether the firm can lend them rent money/, /^Only an attorney can answer/, "hard"],
  ["date-mismatch", /says the crash happened on a different day than the police report/, /^Note both dates and tell the attorney/, "hard"],
  ["omit-records", /asks you to leave an old back injury out/, /^Refuse: records go out complete/, "hard"],
  ["runner", /offers to send the firm crash victims from the hospital/, /^Refuse and tell the attorney: that's improper solicitation/, "hard"],
  ["adjuster-offer", /adjuster offers you a quick settlement/, /^Take a message: only the attorney can negotiate/, "hard"],
];

function solveChoice(item: RapidItem): Solved {
  const rules = CHOICE_RULES.filter(([, re]) => re.test(item.prompt));
  expect(rules.length, `one rule for: ${item.prompt}`).toBe(1);
  const [kind, prompt, right] = rules[0];
  const m = item.prompt.match(prompt)!;
  const amount = (s: string) => Math.round(money(s) * 100);
  const isAmount = (want: number) => (l: string) => /^\$[\d,]+\.\d{2}$/.test(l) && amount(l) === want;
  if (kind === "balance-math") return { values: { answer: optionWith(item, isAmount(amount(m[1]) - amount(m[2]) - amount(m[3]) - amount(m[4]))) }, kind };
  if (kind === "lien-math") return { values: { answer: optionWith(item, isAmount(amount(m[1]))) }, kind };
  if (kind === "collateral") {
    const billed = amount(item.prompt.match(/billed (\$[\d,.]+)/)![1]);
    return { values: { answer: optionWith(item, isAmount(billed)) }, kind };
  }
  return { values: { answer: optionWith(item, (l) => right.test(l)) }, kind };
}

const SOLVERS: Record<RapidStepId, (item: RapidItem) => Solved> = {
  "rapid-limitations": solveLimitations,
  "rapid-billing": solveChoice,
  "rapid-intake": solveChoice,
};
const solveRapid = (seed: string, stepId: RapidStepId) => rapidItems(seed, stepId).map((item) => ({ item, ...SOLVERS[stepId](item) }));

function rapidAnswers(seed: string) {
  return Object.fromEntries(
    RAPID_STEPS.map((id) => [id, { items: Object.fromEntries(solveRapid(seed, id).map((s) => [s.item.id, { values: s.values, ms: 7_000 }])) }]),
  ) as Record<RapidStepId, { items: Record<string, { values: Record<string, string | number>; ms: number }> }>;
}

// ---- A strong candidate's answers, built only from the screen ----

function perfectAnswers(seed: string) {
  const sc = screen(seed);
  const gaps = readGaps(sc.doc("treatment-gaps"));
  const demand = readDemand(sc);
  const decision = oneOption({ options: demand.doc.decision!.options }, /^Hold it: send/);
  return {
    ...rapidAnswers(seed),
    chronology: { order: solveChronology(sc.ordering()) },
    "treatment-gaps": {
      flags: [...gaps.gaps.map((g) => ({ target: g.id, reason: "gap", note: "" })), ...gaps.pre.map((r) => ({ target: r.id, reason: "pre_loss", note: "" }))] as Flag[],
      decision: null,
    },
    specials: { cells: toDollars(solveSpecials(sc).cellsCents) },
    "demand-review": { flags: [...demand.issues].map(([target, reason]) => ({ target, reason, note: "" })) as Flag[], decision },
    "inbox-conflict": { selected: [solveConflict(sc)] },
    "inbox-value": { selected: [solveValue(sc)] },
  };
}

type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers & Record<string, unknown> => JSON.parse(JSON.stringify(a));

describe("pi-diaz-demand: setup", () => {
  it("is registered, version 1, legal, 50 minutes, and uses only built step types in section order", () => {
    expect(getScenario("pi-diaz-demand", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(50);
    expect(scenario.roleFamily).toBe("legal");
    expect(scenario.title).toMatch(/Diaz/);
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["rapid-limitations", "rapid_round"],
      ["chronology", "ordering"],
      ["treatment-gaps", "document_review"],
      ["rapid-billing", "rapid_round"],
      ["specials", "spreadsheet"],
      ["rapid-intake", "rapid_round"],
      ["demand-review", "document_review"],
      ["inbox-conflict", "multiple_choice"],
      ["inbox-value", "multiple_choice"],
    ]);
    expect(scenario.definition.intro).toMatch(/personal injury paralegal/i);
    expect(scenario.definition.intro).toMatch(/fictional/);
  });

  it("renders for 200 seeds with no unfilled template, and every rapid item renders", () => {
    for (const seed of SEEDS) {
      for (const minute of [0, END]) expect(JSON.stringify(renderAttemptForCandidate(scenario, seed, minute))).not.toContain("{{");
      for (const id of RAPID_STEPS) expect(JSON.stringify(rapidItems(seed, id))).not.toContain("{{");
    }
  }, 60_000);

  it("is deterministic per seed", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(scenario.generate(seed)).toEqual(scenario.generate(seed));
      expect(renderAttemptForCandidate(scenario, seed, END)).toEqual(renderAttemptForCandidate(scenario, seed, END));
    }
  });

  it("different seeds change names, dates, amounts and which item carries which trap", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const screens = SEEDS.slice(0, 60).map(screen);
    expect(new Set(screens.map((s) => s.msg("m1").body.match(/Date of loss: (.+)$/m)![1])).size).toBeGreaterThan(40);
    expect(new Set(screens.map((s) => solveChronology(s.ordering()).join())).size).toBeGreaterThan(40);
    expect(new Set(screens.map((s) => readGaps(s.doc("treatment-gaps")).gaps[0].id)).size).toBeGreaterThan(4);
    expect(new Set(screens.map((s) => solveSpecials(s).specials)).size).toBe(60);
    expect(new Set(screens.map((s) => readDemand(s).bills.find((b) => !readDemand(s).enclosed.includes(b.provider))!.provider)).size).toBeGreaterThan(10);
  });
});

describe("pi-diaz-demand: medical chronology", () => {
  it("eight records with distinct dates of service; the order shown and the order received both differ from the right order", () => {
    let receivedRight = 0;
    let shownRight = 0;
    for (const seed of SEEDS) {
      const o = screen(seed).ordering();
      const recs = readChronology(o);
      expect(recs.length, seed).toBe(8);
      expect(new Set(recs.map((r) => r.service)).size, seed).toBe(8);
      for (const r of recs) expect(r.received, `${seed} ${r.id} received after service`).toBeGreaterThan(r.service);
      const right = solveChronology(o);
      if ([...recs].sort((a, b) => a.received - b.received).map((r) => r.id).join() === right.join()) receivedRight++;
      if (recs.map((r) => r.id).join() === right.join()) shownRight++;
      expect(o.prompt).toMatch(/date of service/);
    }
    expect(receivedRight).toBe(0);
    expect(shownRight).toBe(0);
  });

  it("the key is the date-of-service order, and the item ids are the same every seed", () => {
    for (const seed of SEEDS) {
      const o = screen(seed).ordering();
      expect(o.items.map((i) => i.id)).toEqual(["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8"]);
      expect((scenario.generate(seed).keys.chronology as { order: string[] }).order, seed).toEqual(solveChronology(o));
    }
  });

  it("the chronology agrees with the visit log", () => {
    for (const seed of SEEDS.slice(0, 50)) {
      const sc = screen(seed);
      const log = readGaps(sc.doc("treatment-gaps"));
      const recs = readChronology(sc.ordering());
      for (const r of recs) expect(log.rows.some((v) => v.date === r.service && r.label.startsWith(v.provider)), `${seed} ${r.label}`).toBe(true);
      expect(Math.min(...recs.map((r) => r.service))).toBe(log.dol);
    }
  });
});

describe("pi-diaz-demand: treatment gaps", () => {
  it("sixteen visits: one before the date of loss, exactly two gaps over 30 days, a near miss of 24 to 30 days, in date order", () => {
    let thirty = 0;
    for (const seed of SEEDS) {
      const g = readGaps(screen(seed).doc("treatment-gaps"));
      expect(g.rows.length, seed).toBe(16);
      expect(g.pre.length, seed).toBe(1);
      expect(g.gaps.length, seed).toBe(2);
      expect(g.near.length, seed).toBe(1);
      const i = g.rows.findIndex((r) => r.id === g.near[0]?.id);
      if (i > 0 && g.rows[i].date - g.rows[i - 1].date === 30) thirty++;
      const dates = g.rows.map((r) => r.date);
      expect(dates, seed).toEqual([...dates].sort((a, b) => a - b));
      // The two gaps don't share a visit.
      expect(new Set(g.gaps.flatMap((x) => [x.id, x.prev])).size, seed).toBe(4);
    }
    expect(thirty).toBeGreaterThan(3);
  });

  it("the key agrees with the log", () => {
    for (const seed of SEEDS) {
      const g = readGaps(screen(seed).doc("treatment-gaps"));
      const k = scenario.generate(seed).keys["treatment-gaps"] as ReviewKey;
      expect(k.findings.gap_1).toMatchObject({ targets: [g.gaps[0].id, g.gaps[0].prev], reasons: ["gap"] });
      expect(k.findings.gap_2).toMatchObject({ targets: [g.gaps[1].id, g.gaps[1].prev], reasons: ["gap"] });
      expect(k.findings.pre_loss).toMatchObject({ targets: [g.pre[0].id], reasons: ["pre_loss"] });
    }
  });
});

describe("pi-diaz-demand: medical specials", () => {
  it("ten invoices: eight for accident treatment, one from before the date of loss, one listed twice", () => {
    for (const seed of SEEDS) {
      const s = solveSpecials(screen(seed));
      expect(s.invoices.length, seed).toBe(10);
      expect(s.related.length, seed).toBe(8);
      expect(new Set(s.invoices.map((i) => i.invoice)).size, seed).toBe(9);
      for (const i of s.invoices) expect(i.billed - i.adj - i.plan - i.patient, `${seed} ${i.invoice}`).toBeGreaterThanOrEqual(0);
      // Some bills carry contractual adjustments, so billed and allowed differ.
      expect(s.related.some((i) => i.adj > 0)).toBe(true);
      // Two providers treat on a letter of protection: unpaid balances.
      expect(new Set(s.related.filter((i) => i.billed - i.adj - i.plan - i.patient > 0).map((i) => i.provider)).size, seed).toBe(2);
    }
  });

  it("the key matches the worksheet read with the Calloway rule (full billed amounts, each bill once, accident treatment only)", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      expect(sc.sheet().prompt).toMatch(/collateral source/);
      const k = scenario.generate(seed).keys.specials as { cells: Record<string, { value: number }> };
      const want = toDollars(solveSpecials(sc).cellsCents);
      expect(Object.fromEntries(Object.entries(k.cells).map(([id, c]) => [id, c.value])), seed).toEqual(want);
    }
  });
});

describe("pi-diaz-demand: demand letter", () => {
  it("one wrong date of loss, one total that doesn't add up, one provider left out, and the rest right", () => {
    for (const seed of SEEDS) {
      const d = readDemand(screen(seed));
      expect(d.rows.length, seed).toBe(6);
      expect([...d.issues.keys()].sort(), seed).toEqual(["dol", "enclosures", "specials_total"]);
      // The provider left out of the enclosures is also missing from the table.
      const missing = d.bills.filter((b) => !d.enclosed.includes(b.provider));
      expect(missing.length).toBe(1);
      expect(d.rows.map((r) => r.provider)).not.toContain(missing[0].provider);
      // The wrong date is close to the real one.
      expect(Math.abs(day(field(d.doc, "dol")) - d.intakeDol)).toBeLessThanOrEqual(40);
    }
  });

  it("the key agrees with the letter and the intake", () => {
    for (const seed of SEEDS) {
      const d = readDemand(screen(seed));
      const k = scenario.generate(seed).keys["demand-review"] as ReviewKey;
      expect(k.findings.dol).toMatchObject({ targets: ["dol"], reasons: ["wrong_date"] });
      expect(k.findings.total).toMatchObject({ targets: ["specials_total"], reasons: ["math"] });
      expect(k.findings.missing_provider).toMatchObject({ targets: ["enclosures"], reasons: ["missing"] });
      expect(d.doc.decision!.options.find((o) => o.id === k.decision![0])!.label).toMatch(/^Hold it: send/);
    }
  });
});

describe("pi-diaz-demand: inbox", () => {
  it("conflict check and the client's value question: one right answer each, in a different place per seed", () => {
    const places = { conflict: new Set<string>(), value: new Set<string>() };
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const keys = scenario.generate(seed).keys;
      expect(sc.mc("inbox-conflict").select).toBe("single");
      expect(sc.mc("inbox-value").select).toBe("single");
      expect((keys["inbox-conflict"] as McKey).correct).toEqual([solveConflict(sc)]);
      expect((keys["inbox-value"] as McKey).correct).toEqual([solveValue(sc)]);
      places.conflict.add(solveConflict(sc));
      places.value.add(solveValue(sc));
      // The conflict: the at-fault driver's insurer is a current firm client.
      const insurer = sc.msg("m1").body.match(/insured by (.+?) \(claim/)![1];
      expect(sc.msg("m4").body).toContain(insurer);
      expect(sc.msg("m4").body).toMatch(/current client of the firm/);
      expect(sc.msg("m5").body).toMatch(/worth/);
    }
    expect(places.conflict.size).toBe(4);
    expect(places.value.size).toBe(4);
  });
});

describe("pi-diaz-demand: scoring", () => {
  it("out of 100: rapid rounds 10 each, chronology 10, gaps 10, specials 20, demand letter 18, inbox 6 + 6", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect(["chronology", "treatment-gaps", "specials", "demand-review", ...MC_STEPS].map(max)).toEqual([10, 10, 20, 18, 6, 6]);
  });

  it("blank scores 0 for every seed", () => {
    for (const seed of SEEDS.slice(0, 50)) expect(scoreAttempt(scenario, seed, {}).points).toBe(0);
  });

  it("a perfect answer, built only from the screen, scores 100 for every seed with nothing left for review", () => {
    for (const seed of SEEDS) {
      const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
      for (const [id, step] of Object.entries(s.steps)) {
        expect(step.points, `${seed} ${id}`).toBe(step.maxPoints);
        expect(step.needsReview, `${seed} ${id}`).toBeFalsy();
      }
      expect(s.points, seed).toBe(MAX);
    }
  }, 60_000);

  it("another seed's perfect answer doesn't score well (answers can't be shared)", () => {
    let shared = 0;
    for (let i = 0; i < 20; i++) shared += scoreAttempt(scenario, SEEDS[i + 1], perfectAnswers(SEEDS[i])).points;
    expect(shared / 20).toBeLessThan(40);
  });

  describe("each trap answered wrongly costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    // The perfect answer and its score, once per seed: the trap tests mutate a copy many times.
    const base = new Map<string, { answers: Answers; points: number }>();
    const lost = (seed: string, mutate: (a: Answers & Record<string, unknown>) => void) => {
      if (!base.has(seed)) {
        const answers = perfectAnswers(seed);
        base.set(seed, { answers, points: scoreAttempt(scenario, seed, answers).points });
      }
      const { answers, points } = base.get(seed)!;
      const a = clone(answers);
      mutate(a);
      return points - scoreAttempt(scenario, seed, a).points;
    };
    type ReviewId = (typeof REVIEW_STEPS)[number];
    const flagsOf = (a: Answers & Record<string, unknown>, id: ReviewId) => (a[id] as { flags: Flag[] }).flags;

    it("treatment gaps: each missed gap costs 4, the pre-loss visit 2; the wrong reason costs half", () => {
      for (const seed of seeds) {
        const g = readGaps(screen(seed).doc("treatment-gaps"));
        for (const [id, pts] of [[g.gaps[0].id, 4], [g.gaps[1].id, 4], [g.pre[0].id, 2]] as const) {
          expect(lost(seed, (a) => ((a["treatment-gaps"] as { flags: Flag[] }).flags = flagsOf(a, "treatment-gaps").filter((f) => f.target !== id))), seed).toBe(pts);
          expect(lost(seed, (a) => (flagsOf(a, "treatment-gaps").find((f) => f.target === id)!.reason = "other")), seed).toBe(pts / 2);
        }
      }
    });

    it("treatment gaps: flagging the 24-to-30-day near miss or the first visit after the loss costs the false-flag penalty", () => {
      for (const seed of seeds) {
        const g = readGaps(screen(seed).doc("treatment-gaps"));
        const firstAfter = g.rows.find((r) => r.date >= g.dol)!;
        expect(lost(seed, (a) => flagsOf(a, "treatment-gaps").push({ target: g.near[0].id, reason: "gap", note: "" }))).toBe(1);
        expect(lost(seed, (a) => flagsOf(a, "treatment-gaps").push({ target: firstAfter.id, reason: "gap", note: "" }))).toBe(1);
      }
    });

    it("chronology sorted by date received loses points; one swap of neighbours costs a little", () => {
      for (const seed of seeds) {
        const o = screen(seed).ordering();
        const byReceived = [...readChronology(o)].sort((a, b) => a.received - b.received).map((r) => r.id);
        expect(lost(seed, (a) => (a.chronology.order = byReceived))).toBeGreaterThan(1);
        const swapped = [...a0(seed)];
        [swapped[3], swapped[4]] = [swapped[4], swapped[3]];
        // Two items out of place and one pair reversed: 5 × 2/8 + 5 × 1/28.
        expect(lost(seed, (a) => (a.chronology.order = swapped))).toBeCloseTo(1.25 + 0.18, 2);
      }
      function a0(seed: string) {
        return solveChronology(screen(seed).ordering());
      }
    });

    it("specials: the duplicate counted twice, the pre-loss bill included, or allowed amounts instead of billed each cost their cells", () => {
      for (const seed of seeds) {
        const s = solveSpecials(screen(seed));
        const dupInvoice = s.invoices.find((i, j) => s.invoices.findIndex((x) => x.invoice === i.invoice) < j)!;
        const pre = s.invoices.find((i) => !s.related.includes(i) && i !== dupInvoice && !s.related.some((r) => r.invoice === i.invoice))!;
        const set = (cells: Record<string, number>) => (a: Answers & Record<string, unknown>) => (a.specials = { cells: toDollars(cells) });
        // Counting the duplicate: specials, health plan lien and total liens are off (it was paid by the plan, no copay).
        expect(dupInvoice.plan).toBeGreaterThan(0);
        expect(dupInvoice.patient).toBe(0);
        expect(
          lost(seed, set({ ...s.cellsCents, [s.ids.specials]: s.specials + dupInvoice.billed, [s.ids.plan]: s.cellsCents[s.ids.plan] + dupInvoice.plan, [s.ids.total]: s.cellsCents[s.ids.total] + dupInvoice.plan })),
          `${seed} duplicate`,
        ).toBe(6 + 4 + 2);
        // Including the self-paid checkup from before the loss: specials and out of pocket are off.
        expect(pre.patient).toBe(pre.billed);
        expect(lost(seed, set({ ...s.cellsCents, [s.ids.specials]: s.specials + pre.billed, [s.ids.oop]: s.cellsCents[s.ids.oop] + pre.patient })), `${seed} pre-loss`).toBe(6 + 4);
        // Allowed amounts (billed minus adjustments) instead of the full billed amounts.
        const allowed = s.related.reduce((t, i) => t + i.billed - i.adj, 0);
        expect(lost(seed, set({ ...s.cellsCents, [s.ids.specials]: allowed })), `${seed} allowed`).toBe(6);
      }
    });

    it("demand letter: each missed problem costs 5, the wrong reason half; sending it as is costs the decision's 3", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        for (const target of ["dol", "specials_total", "enclosures"]) {
          expect(lost(seed, (a) => ((a["demand-review"] as { flags: Flag[] }).flags = flagsOf(a, "demand-review").filter((f) => f.target !== target))), `${seed} ${target}`).toBe(5);
          expect(lost(seed, (a) => (flagsOf(a, "demand-review").find((f) => f.target === target)!.reason = "other")), `${seed} ${target}`).toBe(2.5);
        }
        const send = oneOption({ options: sc.doc("demand-review").decision!.options }, /^Send it to the adjuster today/);
        expect(lost(seed, (a) => (a["demand-review"].decision = send))).toBe(3);
        // Flagging a right line costs the false-flag penalty.
        expect(lost(seed, (a) => flagsOf(a, "demand-review").push({ target: "wages", reason: "math", note: "" }))).toBe(1);
      }
    });

    it("inbox: ignoring the conflict, or giving the client a number, costs all 6", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const ignore = oneOption(sc.mc("inbox-conflict"), /isn't a named party/);
        const ballpark = oneOption(sc.mc("inbox-value"), /^Give a ballpark/);
        expect(lost(seed, (a) => (a["inbox-conflict"].selected = [ignore]))).toBe(6);
        expect(lost(seed, (a) => (a["inbox-value"].selected = [ballpark]))).toBe(6);
      }
    });
  });
});

describe("pi-diaz-demand: nothing from the key reaches the candidate", () => {
  it("no reviewer note, key word or option-revealing field in any payload", () => {
    for (const seed of SEEDS) {
      const variant = scenario.generate(seed);
      const notes = REVIEW_STEPS.flatMap((id) => Object.values((variant.keys[id] as ReviewKey).findings).map((f) => f.note!));
      for (const n of notes) expect(n.length).toBeGreaterThan(10);
      for (const minute of [0, 20, END]) {
        const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
        expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"|"clean":|"correct"|"order"/);
        for (const n of notes) expect(payload, seed).not.toContain(n);
      }
    }
  }, 60_000);
});

describe("pi-diaz-demand: timed sections", () => {
  const def = scenario.definition;
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-16T09:00:00Z");
  const flowAt = (ms: number) => resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent: 0, events: [] });
  const stepById = (id: string) => def.steps.find((s) => s.id === id)!;

  it("validateSections passes and the sections fill the time limit exactly", () => {
    expect(validateSections(def, scenario.timeLimitMinutes)).toEqual([]);
    expect(def.sections!.reduce((t, s) => t + s.minutes, 0)).toBe(scenario.timeLimitMinutes);
  });

  it("six sections: limitations, chronology, billing terms, specials, intake and ethics, demand and inbox", () => {
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-limitations"], false],
      ["s-chronology", 10, ["chronology", "treatment-gaps"], true],
      ["s-rapid-b", 6, ["rapid-billing"], false],
      ["s-specials", 11, ["specials"], false],
      ["s-rapid-c", 6, ["rapid-intake"], false],
      ["s-demand", 11, ["demand-review", ...MC_STEPS], true],
    ]);
  });

  it("one-at-a-time screens add up to their section", () => {
    for (const sec of def.sections!.filter((s) => s.oneAtATime)) {
      expect(sec.stepIds.reduce((t, id) => t + stepById(id).seconds!, 0), sec.id).toBe(sec.minutes * 60);
    }
  });

  it("each rapid round is 15 items x 20 seconds and fits its 6-minute section", () => {
    for (const id of RAPID_STEPS) {
      const config = rapidConfig(id);
      expect(config.items.length, id).toBe(15);
      expect(config.secondsPerItem).toBe(20);
    }
  });

  it("runs the sections back to back", () => {
    const at = (min: number) => flowAt(min * MIN);
    expect(at(0).visibleStepIds).toEqual(["rapid-limitations"]);
    expect(at(6).visibleStepIds).toEqual(["chronology"]);
    expect(at(16).visibleStepIds).toEqual(["rapid-billing"]);
    expect(at(22).visibleStepIds).toEqual(["specials"]);
    expect(at(33).visibleStepIds).toEqual(["rapid-intake"]);
    expect(at(39).visibleStepIds).toEqual(["demand-review"]);
    expect(at(END).done).toBe(true);
  });

  it("messages arrive when their section opens", () => {
    expect(def.messages.map((m) => [m.id, m.stepId])).toEqual([
      ["m1", "chronology"],
      ["m2", "specials"],
      ["m3", "demand-review"],
      ["m4", "inbox-conflict"],
      ["m5", "inbox-value"],
    ]);
    const msgsAt = (min: number) => visibleMessageIds(def, flowAt(min * MIN), t0, t0 + min * MIN);
    expect(msgsAt(5)).toEqual([]);
    expect(msgsAt(6)).toEqual(["m1"]);
    expect(msgsAt(22)).toEqual(["m1", "m2"]);
    expect(msgsAt(39)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
  });

  it("the flow renders each rapid item exactly as sequence.renderItem does", () => {
    for (const id of RAPID_STEPS) {
      const items = rapidItems("abc", id);
      for (const index of [0, 5, 14]) {
        const view = renderFlowForCandidate(scenario, "abc", {
          stepIds: [id],
          messages: [],
          sequences: { [id]: { index, count: 15, endsAt: "2026-11-16T09:00:20.000Z" } },
        });
        const cfg = view.steps[0].config as { current: { item: RapidItem } };
        expect(cfg.current.item).toEqual(items[index]);
        expect(JSON.stringify(cfg)).not.toMatch(/"items"|choice"|tolerance|points/);
      }
    }
  });
});

describe("pi-diaz-demand: rapid rounds", () => {
  it("every item over 200 seeds has one right answer, found from the material alone, matching the key", () => {
    for (const seed of SEEDS) {
      const keys = scenario.generate(seed).keys;
      for (const id of RAPID_STEPS) {
        const key = keys[id] as RapidKey;
        const solved = solveRapid(seed, id);
        expect(Object.keys(key.items).sort()).toEqual(solved.map((s) => s.item.id).sort());
        for (const s of solved) {
          const k = key.items[s.item.id].answer;
          if (typeof s.values.answer === "number") expect(k.value, `${seed} ${s.item.id} ${s.item.prompt}`).toBeCloseTo(s.values.answer, 6);
          else expect(k.choice, `${seed} ${s.item.id} (${s.kind}: ${s.item.prompt})`).toBe(s.values.answer);
        }
      }
    }
  }, 60_000);

  it("ten quick items worth half a point and five harder ones worth one, in every round", () => {
    const hardKinds: Record<RapidStepId, string[]> = {
      "rapid-limitations": ["minor", "public", "holiday", "fault", "net"],
      "rapid-billing": CHOICE_RULES.filter((r) => r[3] === "hard").map((r) => r[0]),
      "rapid-intake": CHOICE_RULES.filter((r) => r[3] === "hard").map((r) => r[0]),
    };
    for (const id of RAPID_STEPS) {
      const points = rapidConfig(id).items.map((i) => i.points);
      expect(points.filter((p) => p === 0.5).length, id).toBe(10);
      expect(points.filter((p) => p === 1).length, id).toBe(5);
      for (const seed of SEEDS.slice(0, 50)) {
        solveRapid(seed, id).forEach((s, i) => expect(hardKinds[id].includes(s.kind), `${seed} ${id} item ${i} ${s.kind}`).toBe(points[i] === 1));
      }
    }
  });

  it("limitations: every kind of date and damages item shows up, with minors, public entities and holidays", () => {
    const kinds = new Set<string>();
    for (const seed of SEEDS.slice(0, 50)) for (const s of solveRapid(seed, "rapid-limitations")) kinds.add(s.kind);
    expect([...kinds].sort()).toEqual(["fault", "holiday", "mileage", "minor", "net", "pi", "property", "public", "sum", "wages", "weekend"]);
  });

  it("varies per seed: which item comes when and where the right option sits", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBeGreaterThan(20);
      expect(new Set(firsts.map((s) => JSON.stringify(s.values))).size, id).toBeGreaterThanOrEqual(3);
    }
  });

  it("option ids and field kinds are fixed per item, so they can't hint at the answer", () => {
    for (const id of RAPID_STEPS) {
      const ids = (seed: string) => rapidItems(seed, id).map((i) => i.fields.map((f) => [f.id, f.kind ?? "choice", (f as RapidChoiceField).options?.map((o) => o.id)]));
      const first = JSON.stringify(ids(SEEDS[0]));
      for (const seed of SEEDS.slice(1, 30)) expect(JSON.stringify(ids(seed)), `${id} ${seed}`).toBe(first);
    }
  });

  it("a wrong item costs its points", () => {
    const seed = "abc";
    const perfect = scoreAttempt(scenario, seed, perfectAnswers(seed));
    for (const id of RAPID_STEPS) {
      const a = clone(perfectAnswers(seed)) as unknown as Record<string, { items: Record<string, unknown> }>;
      const hard = rapidConfig(id).items.findIndex((i) => i.points === 1);
      const easy = rapidConfig(id).items.findIndex((i) => i.points === 0.5);
      delete a[id].items[rapidConfig(id).items[hard].id];
      delete a[id].items[rapidConfig(id).items[easy].id];
      expect(perfect.steps[id].points - scoreAttempt(scenario, seed, a).steps[id].points, id).toBe(1.5);
    }
  });
});
