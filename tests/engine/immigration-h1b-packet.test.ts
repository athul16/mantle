import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";

vi.mock("server-only", () => ({}));

const { immigrationH1bPacket } = await import("@/lib/engine/scenarios/immigration-h1b-packet");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");
const { isCourtDay } = await import("@/lib/engine/scenarios/legal");

/**
 * Immigration paralegal: an H-1B extension packet. Three rapid rounds (status
 * and date math, document and process terms, deadlines) and three work
 * sections (forms cross-check, packet checklist, inbox), 50 minutes, 100
 * points. Every task is solved here from what the candidate sees, with an
 * independent reading of the rules the exhibits state, then compared with the
 * server key, so the material and the key can't drift apart.
 */

const scenario = immigrationH1bPacket;
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const MAX = 100;
const LONG = 120_000;
const RAPID_STEPS = ["rapid-status", "rapid-terms", "rapid-deadlines"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const REVIEW_STEPS = ["forms-consistency", "packet-checklist"] as const;
type ReviewStepId = (typeof REVIEW_STEPS)[number];
const MC_STEPS = ["inbox-rfe", "inbox-backdate", "inbox-beneficiary"] as const;

type Field = { id: string; label: string; value: string };
type Doc = {
  prompt: string;
  document: { title: string; fields: Field[]; columns: string[]; rows: { id: string; cells: string[] }[]; totals: Field[]; footnote?: string };
  reasons: { id: string; label: string }[];
  decision?: { prompt: string; options: { id: string; label: string }[] };
};
type Mc = { prompt: string; options: { id: string; label: string }[]; select: "single" | "multi" };
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
  const doc = (id: ReviewStepId) => step(id).config as Doc;
  const mc = (id: (typeof MC_STEPS)[number]) => step(id).config as Mc;
  return { view, step, msg, doc, mc };
}

const field = (doc: Doc, id: string) => {
  const f = doc.document.fields.find((x) => x.id === id);
  expect(f, `field ${id}`).toBeDefined();
  return f!.value;
};
const col = (doc: Doc, name: RegExp) => {
  const i = doc.document.columns.findIndex((c) => name.test(c));
  expect(i, `column ${name}`).toBeGreaterThanOrEqual(0);
  return i;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
/** "Mon, Mar 2, 2026" → epoch day (UTC); also checks the weekday printed matches the date. */
function day(label: string): number {
  const m = label.trim().match(/^(\w{3}), (\w{3}) (\d{1,2}), (\d{4})$/);
  expect(m, `date "${label}"`).not.toBeNull();
  const t = Date.UTC(Number(m![4]), MONTHS.indexOf(m![2]), Number(m![3]));
  expect(WEEKDAYS[new Date(t).getUTCDay()], `weekday of ${label}`).toBe(m![1]);
  return t / 86_400_000;
}
/** "03/07/1994" (US form style, month first) → epoch day. */
function usDay(label: string): number {
  const m = label.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  expect(m, `US date "${label}"`).not.toBeNull();
  return Date.UTC(Number(m![3]), Number(m![1]) - 1, Number(m![2])) / 86_400_000;
}
/** "07 MAR 1994" (passport style, day first) → epoch day. */
function passportDay(label: string): number {
  const m = label.match(/^(\d{2}) ([A-Z]{3}) (\d{4})$/);
  expect(m, `passport date "${label}"`).not.toBeNull();
  const month = MONTHS.findIndex((x) => x.toUpperCase() === m![2]);
  expect(month).toBeGreaterThanOrEqual(0);
  return Date.UTC(Number(m![3]), month, Number(m![1])) / 86_400_000;
}
/** Same day of the month, `n` months later (negative for earlier). */
function addMonths(d: number, n: number): number {
  const t = new Date(d * 86_400_000);
  expect(t.getUTCDate(), "month math only on days 1-28").toBeLessThanOrEqual(28);
  return Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + n, t.getUTCDate()) / 86_400_000;
}
const weekend = (d: number) => [0, 6].includes(new Date(d * 86_400_000).getUTCDay());
const iso = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);

// ---- Section A: forms cross-check ----

type FormIssue = "identity" | "job" | "wage" | "dates" | "worksite";

/** The cross-check grid read the way a careful paralegal would: identity from the passport, job facts from the certified attestation. */
function readForms(doc: Doc) {
  const [cDetail, cPet, cPass, cLetter, cWa] = [col(doc, /^Detail/), col(doc, /^Form P-129/), col(doc, /^Passport/), col(doc, /^Job offer letter/), col(doc, /^Wage attestation/)];
  const byLabel = new Map(doc.document.rows.map((r) => [r.cells[cDetail], r]));
  const cell = (label: string, c: number) => {
    const r = byLabel.get(label);
    expect(r, `row ${label}`).toBeDefined();
    return r!.cells[c];
  };
  const idOf = (label: string) => byLabel.get(label)!.id;
  const issues = new Map<string, FormIssue>();
  const flag = (label: string, issue: FormIssue) => {
    expect(issues.has(idOf(label)), `one issue on ${label}`).toBe(false);
    issues.set(idOf(label), issue);
  };

  // Identity: the passport prints capitals and day-first dates; only a real difference counts.
  for (const label of ["Family name", "Given names", "Country of citizenship"]) {
    const pass = cell(label, cPass);
    expect(pass).toBe(pass.toUpperCase());
    if (cell(label, cPet).toUpperCase() !== pass) flag(label, "identity");
    const letter = cell(label, cLetter);
    if (letter !== "—") expect(letter.toUpperCase(), `${label} on the letter`).toBe(pass);
  }
  for (const label of ["Date of birth", "Passport expiry date"]) {
    if (usDay(cell(label, cPet)) !== passportDay(cell(label, cPass))) flag(label, "identity");
  }
  if (cell("Passport number", cPet) !== cell("Passport number", cPass)) flag("Passport number", "identity");

  // Job facts against the certified attestation.
  const wa = (label: string) => cell(label, cWa);
  for (const label of ["Job title", "Occupation code"]) {
    const others = [cell(label, cPet), cell(label, cLetter)].filter((x) => x !== "—");
    if (others.some((x) => x !== wa(label))) flag(label, "job");
  }
  for (const label of ["Wage level", "Annual wage"]) {
    const others = [cell(label, cPet), cell(label, cLetter)].filter((x) => x !== "—");
    if (others.some((x) => x !== wa(label))) flag(label, "wage");
  }
  const validFrom = day(wa("Employment start").replace(/^Valid from /, ""));
  const validTo = day(wa("Employment end").replace(/^Valid to /, ""));
  const start = day(cell("Employment start", cPet));
  const end = day(cell("Employment end", cPet));
  expect(day(cell("Employment start", cLetter)), "letter start = petition start").toBe(start);
  expect(end).toBeGreaterThan(start);
  if (start < validFrom) flag("Employment start", "dates");
  if (end > validTo) flag("Employment end", "dates");
  const sites = [cell("Worksite", cPet), cell("Worksite", cLetter)];
  if (sites.some((s) => s !== wa("Worksite"))) flag("Worksite", "worksite");
  const hours = [cell("Hours", cPet), cell("Hours", cLetter), wa("Hours")];
  expect(new Set(hours).size).toBe(1);
  return { issues, rows: doc.document.rows, cell, idOf };
}

// ---- Section B: packet checklist ----

type PacketIssue = "missing" | "unsigned" | "fee" | "translation" | "not_valid";

function readPacket(doc: Doc) {
  const [cItem, cReq, cIn] = [col(doc, /^Item/), col(doc, /^Checklist requirement/), col(doc, /^What's in the packet/)];
  const filing = day(field(doc, "filing_date"));
  const employees = Number(field(doc, "employees"));
  expect(employees).toBeGreaterThan(0);
  const issues = new Map<string, PacketIssue>();
  let feeRight = 0;
  for (const r of doc.document.rows) {
    const [item, req, inPacket] = [r.cells[cItem], r.cells[cReq], r.cells[cIn]];
    let issue: PacketIssue | null = null;
    if (inPacket === "Not in the packet") issue = "missing";
    else if (/blank|unsigned/i.test(inPacket)) issue = "unsigned";
    else if (/^Filing fees/.test(item)) {
      const m = req.match(/Base fee \$([\d,]+) \+ anti-fraud fee \$([\d,]+) \+ training fee \(\$([\d,]+) for (\d+) or fewer U\.S\. employees, \$([\d,]+) for (\d+) or more\)/);
      expect(m, `fee rule: ${req}`).not.toBeNull();
      const n = (s: string) => Number(s.replace(/,/g, ""));
      expect(n(m![6])).toBe(n(m![4]) + 1);
      feeRight = n(m![1]) + n(m![2]) + (employees <= n(m![4]) ? n(m![3]) : n(m![5]));
      const paid = inPacket.match(/^One check for \$([\d,]+)$/);
      expect(paid, `fee in packet: ${inPacket}`).not.toBeNull();
      if (n(paid![1]) !== feeRight) issue = "fee";
    } else if (/needs a certified English translation/.test(req)) {
      if (/; no translation$/.test(inPacket)) issue = "translation";
      else expect(inPacket).toMatch(/in English$|certified English translation attached$/);
    } else if (/^Wage attestation/.test(item)) {
      if (/certification pending/.test(inPacket)) issue = "not_valid";
      else expect(inPacket).toMatch(/^Certified on /);
    } else if (/^Beneficiary's passport/.test(item)) {
      const m = inPacket.match(/(expires|expired) (.+)$/);
      expect(m, `passport: ${inPacket}`).not.toBeNull();
      const exp = day(m![2]);
      expect(m![1] === "expired", "the wording agrees with the date").toBe(exp < filing);
      if (exp < filing) issue = "not_valid";
    }
    if (issue) issues.set(r.id, issue);
  }
  return { issues, feeRight, employees, filing };
}

// ---- Inbox ----

function oneOption(cfg: { options: { id: string; label: string }[] }, re: RegExp) {
  const o = cfg.options.filter((x) => re.test(x.label));
  expect(o.length, `one option like ${re}`).toBe(1);
  return o[0].id;
}

/** RFE items in the attorney's message, mapped to the document that answers each. */
const RFE_MAP: [RegExp, RegExp][] = [
  [/specialty occupation/, /^A detailed position description/],
  [/employer–employee relationship/, /^A signed letter from the supervisor/],
  [/foreign degree is equivalent/, /^The credential evaluation/],
  [/worksite exists/, /^The worksite lease/],
  [/kept status/, /^Pay statements and the arrival record/],
  [/ability to pay/, /^The employer's latest annual tax return/],
];

function solveRfe(sc: ReturnType<typeof screen>) {
  const cfg = sc.mc("inbox-rfe");
  const body = sc.msg("m3").body;
  const asked = body.split("\n").filter((l) => /^• Item \d: /.test(l));
  expect(asked.length).toBe(3);
  const right = [oneOption(cfg, /^A cover letter listing each item/), oneOption(cfg, /^A copy of the RFE notice/)];
  for (const line of asked) {
    const hits = RFE_MAP.filter(([re]) => re.test(line));
    expect(hits.length, line).toBe(1);
    right.push(oneOption(cfg, hits[0][1]));
  }
  return right.sort();
}
const solveBackdate = (sc: ReturnType<typeof screen>) => oneOption(sc.mc("inbox-backdate"), /^Don't prepare it/);
const solveBeneficiary = (sc: ReturnType<typeof screen>) => oneOption(sc.mc("inbox-beneficiary"), /can't give legal advice/);

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

type RapidKey = { items: Record<string, Record<string, { choice?: string; value?: number }>> };
type Solved = { values: Record<string, string | number>; kind: string };

const choiceField = (item: RapidItem, id: string) => {
  const f = item.fields.find((x) => x.id === id) as RapidChoiceField | undefined;
  expect(f, `${item.id} field ${id}`).toBeDefined();
  expect(f!.options.length).toBe(4);
  return f!;
};
const optionId = (item: RapidItem, fieldId: string, label: RegExp | string) => {
  const opts = choiceField(item, fieldId).options.filter((o) => (typeof label === "string" ? o.label === label : label.test(o.label)));
  expect(opts.length, `${item.id} ${fieldId}: one option like ${label}`).toBe(1);
  return opts[0].id;
};
const row = (item: RapidItem, label: string) => {
  const r = item.exhibit?.rows?.find((x) => x.label === label);
  expect(r, `${item.id} row ${label}`).toBeDefined();
  return r!.value;
};
/** The one option whose date is `d`, among four different dates. */
function pickDate(item: RapidItem, fieldId: string, d: number) {
  const f = choiceField(item, fieldId);
  expect(new Set(f.options.map((o) => day(o.label))).size, `${item.id} four different dates`).toBe(4);
  const right = f.options.filter((o) => day(o.label) === d);
  expect(right.length, `${item.id} one right date (${iso(d)})`).toBe(1);
  return right[0].id;
}
const num = (re: RegExp, text: string) => {
  const m = text.match(re);
  expect(m, `${re} in "${text}"`).not.toBeNull();
  return Number(m![1]);
};

/** Status and date math, from the rule the exhibit states. */
function solveStatus(item: RapidItem): Solved {
  const rule = row(item, "Rule");
  const p = item.prompt;
  if (/earliest date the petition can be filed/.test(p)) {
    const start = day(row(item, "Requested start date"));
    return { kind: "filing", values: { answer: pickDate(item, "answer", addMonths(start, -num(/no earlier than (\d+) months before/, rule))) } };
  }
  if (/Until what date does the arrival record run/.test(p)) {
    const end = day(row(item, "Approved end date"));
    const passport = day(row(item, "Passport expires"));
    const extra = end + num(/runs to (\d+) days after the approved end date, but never past the passport's expiry/, rule);
    return { kind: passport < extra ? "admit-passport" : "admit", values: { answer: pickDate(item, "answer", Math.min(extra, passport)) } };
  }
  if (/last day of the grace period/.test(p)) {
    const last = day(row(item, "Last day of employment"));
    const record = day(row(item, "Arrival record ends"));
    const grace = last + num(/status continues for (\d+) days or until the arrival record ends, whichever comes first/, rule);
    return { kind: record < grace ? "grace-capped" : "grace", values: { answer: pickDate(item, "answer", Math.min(grace, record)) } };
  }
  if (/last day the firm files the extension/.test(p)) {
    const record = day(row(item, "Arrival record ends"));
    return { kind: "ext", values: { answer: pickDate(item, "answer", record - num(/no later than (\d+) days before the arrival record ends/, rule)) } };
  }
  if (/When does the six-year limit end/.test(p)) {
    const first = day(row(item, "First H-1B start date"));
    const outside = num(/^(\d+) days$/, row(item, "Full days outside the country"));
    const years = num(/ends (\d+) years after the first H-1B start date .*plus one day for each full day spent outside/, rule);
    return { kind: "max", values: { answer: pickDate(item, "answer", addMonths(first, 12 * years) + outside) } };
  }
  expect(item.fields[0].kind).toBe("number");
  if (/How many whole years can the extension cover/.test(p)) {
    const cap = num(/up to (\d+) years at a time, and never past the six-year limit/, rule);
    const limit = day(row(item, "Six-year limit ends"));
    const start = day(row(item, "Extension starts"));
    let years = 0;
    while (years < cap && addMonths(start, 12 * (years + 1)) <= limit) years++;
    expect(years).toBeGreaterThanOrEqual(1);
    return { kind: "years", values: { answer: years } };
  }
  expect(p).toMatch(/How many days are recaptured/);
  expect(rule).toMatch(/neither the departure day nor the return day counts/);
  const trip = (label: string) => {
    const m = row(item, label).match(/^Left (.+), returned (.+)$/);
    expect(m).not.toBeNull();
    return day(m![2]) - day(m![1]) - 1;
  };
  const total = trip("Trip 1") + trip("Trip 2");
  expect(total).toBeGreaterThanOrEqual(1);
  expect(total).toBeLessThanOrEqual(9);
  return { kind: "recapture", values: { answer: total } };
}

/** Document and process terms: what an immigration paralegal knows, by question. */
const TERM_RULES: [string, RegExp, RegExp, "easy" | "hard"][] = [
  ["petitioner", /Who is the petitioner on Form P-129/, /^The employer filing the petition$/, "easy"],
  ["beneficiary", /Who is the beneficiary/, /^The foreign worker the petition is for$/, "easy"],
  ["receipt", /What does a receipt notice/, /^The agency received the petition and the fee$/, "easy"],
  ["rfe", /What does RFE stand for/, /^Request for Evidence$/, "easy"],
  ["translation", /What is a certified translation/, /^A complete English translation with the translator's statement of competence and accuracy$/, "easy"],
  ["evaluation", /What does a credential evaluation show/, /^The U\.S\. equivalent of a foreign degree$/, "easy"],
  ["prevailing", /What is the prevailing wage/, /^The average wage for the occupation in the area of employment$/, "easy"],
  ["a28", /What is Form A-28/, /^The attorney's notice of appearance$/, "easy"],
  ["ar94", /What does the arrival record \(AR-94\) show/, /^The date the authorized stay ends$/, "easy"],
  ["premium", /What is premium processing/, /^An extra fee for a decision within a set number of business days$/, "easy"],
  ["specialty", /A specialty occupation requires/, /^At least a bachelor's degree in a specific field, or its equivalent$/, "easy"],
  ["approval", /What does an approval notice \(Notice N-797A\) show/, /^That the petition was approved, and its validity dates$/, "easy"],
  ["consular", /What is consular processing/, /^Getting the visa at a consulate abroad after the petition is approved$/, "easy"],
  ["amended", /moves to a city outside the area on the wage attestation/, /^A new wage attestation and an amended petition$/, "hard"],
  ["public-file", /What is the public access file/, /^The employer's wage attestation records, open to public inspection$/, "hard"],
  ["extension", /What does an extension of stay mean/, /^Same status, more time$/, "hard"],
  ["passport-short", /passport expires before the requested end date/, /^The stay may be limited to the passport's expiry date$/, "hard"],
  ["cap", /What does it mean that a petition is cap-subject/, /^It counts against the annual numerical limit$/, "hard"],
  ["late-rfe", /The RFE response arrives late/, /^The agency can decide the case on the record it has$/, "hard"],
];

function solveTerm(item: RapidItem): Solved {
  const rules = TERM_RULES.filter(([, re]) => re.test(item.prompt));
  expect(rules.length, `${item.id}: one rule for "${item.prompt}"`).toBe(1);
  return { kind: rules[0][0], values: { answer: optionId(item, "answer", rules[0][2]) } };
}

/** Deadlines: count from the calendar entry with its rule and the holidays it lists. */
function solveDeadline(item: RapidItem): Solved {
  const from = day(row(item, "Date"));
  const rule = row(item, "Rule");
  const holidayText = row(item, "Federal holidays in the window");
  const holidays = holidayText === "None" ? [] : holidayText.split("; ").map((h) => day(h.replace(/ \(.+\)$/, "")));
  const open = (d: number) => !weekend(d) && !holidays.includes(d);
  const businessDays = (start: number, n: number, step: 1 | -1) => {
    let d = start;
    for (let left = n; left > 0; ) {
      d += step;
      if (open(d)) left--;
    }
    return d;
  };
  let due: number;
  let kind: string;
  if (/must arrive within (\d+) days after the notice date/.test(rule)) {
    expect(rule).toMatch(/does not move: the response must arrive by the last business day before it/);
    const end = from + num(/within (\d+) days after the notice date/, rule);
    due = end;
    while (!open(due)) due--;
    kind = open(end) ? "rfe-plain" : holidays.some((h) => h >= due && h <= end) ? "rfe-holiday" : "rfe-weekend";
    if (/mailed/.test(row(item, "Event"))) expect(rule).toMatch(/87 days/);
  } else if (/due (\d+) days after a mailed decision/.test(rule)) {
    expect(rule).toMatch(/moves to the next business day/);
    const end = from + num(/due (\d+) days after a mailed decision/, rule);
    due = end;
    while (!open(due)) due++;
    kind = open(end) ? "appeal-plain" : "appeal-roll";
  } else if (/stay posted for (\d+) business days; the day it goes up is business day 1/.test(rule)) {
    expect(open(from)).toBe(true);
    due = businessDays(from, num(/posted for (\d+) business days/, rule) - 1, 1);
    kind = holidays.some((h) => h > from && h < due) ? "posting-holiday" : "posting-plain";
  } else if (/acts within (\d+) business days after the receipt day/.test(rule)) {
    due = businessDays(from, num(/within (\d+) business days/, rule), 1);
    kind = "premium";
  } else {
    due = businessDays(from, num(/courier (\d+) business days before the due date/, rule), -1);
    kind = "courier";
  }
  // The shared calendar agrees with this reading of the listed holidays.
  expect(isCourtDay(iso(due)), `${item.id} lands on a business day`).toBe(true);
  return { kind, values: { due: pickDate(item, "due", due) } };
}

const SOLVERS: Record<RapidStepId, (item: RapidItem) => Solved> = {
  "rapid-status": solveStatus,
  "rapid-terms": solveTerm,
  "rapid-deadlines": solveDeadline,
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
  const forms = readForms(sc.doc("forms-consistency"));
  const packet = readPacket(sc.doc("packet-checklist"));
  return {
    ...rapidAnswers(seed),
    "forms-consistency": {
      flags: [...forms.issues].map(([target, reason]) => ({ target, reason, note: "" })),
      decision: oneOption(sc.doc("forms-consistency").decision!, /^Hold the filing/),
    },
    "packet-checklist": {
      flags: [...packet.issues].map(([target, reason]) => ({ target, reason, note: "" })),
      decision: oneOption(sc.doc("packet-checklist").decision!, /^Hold the packet/),
    },
    "inbox-rfe": { selected: solveRfe(sc) },
    "inbox-backdate": { selected: [solveBackdate(sc)] },
    "inbox-beneficiary": { selected: [solveBeneficiary(sc)] },
  };
}

type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers & Record<string, unknown> => JSON.parse(JSON.stringify(a));

describe("immigration-h1b-packet: setup", () => {
  it("is registered, version 1, legal, 50 minutes, and uses only built step types in section order", () => {
    expect(getScenario("immigration-h1b-packet", 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(50);
    expect(scenario.roleFamily).toBe("legal");
    expect(scenario.title).toMatch(/H-1B petition packet/);
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["rapid-status", "rapid_round"],
      ["forms-consistency", "document_review"],
      ["rapid-terms", "rapid_round"],
      ["packet-checklist", "document_review"],
      ["rapid-deadlines", "rapid_round"],
      ["inbox-rfe", "multiple_choice"],
      ["inbox-backdate", "multiple_choice"],
      ["inbox-beneficiary", "multiple_choice"],
    ]);
    expect(scenario.definition.intro).toMatch(/immigration paralegal/i);
    expect(scenario.definition.intro).toMatch(/fictional/);
    expect(scenario.definition.intro).not.toMatch(/USCIS|I-129|Department of Labor/);
  });

  it(
    "renders for 200 seeds with no unfilled template, and every rapid item renders",
    () => {
      for (const seed of SEEDS) {
        for (const minute of [0, END]) {
          const view = renderAttemptForCandidate(scenario, seed, minute);
          expect(view.steps.length).toBeGreaterThanOrEqual(1);
          const text = JSON.stringify(view);
          expect(text).not.toContain("{{");
          expect(text, "fictional form names only").not.toMatch(/USCIS|I-129|I-94|G-28|I-797|ETA-9035|Department of Labor/);
        }
        for (const id of RAPID_STEPS) expect(JSON.stringify(rapidItems(seed, id))).not.toContain("{{");
      }
    },
    LONG,
  );

  it("is deterministic per seed", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(scenario.generate(seed)).toEqual(scenario.generate(seed));
      expect(renderAttemptForCandidate(scenario, seed, END)).toEqual(renderAttemptForCandidate(scenario, seed, END));
    }
  });

  it("different seeds change names, numbers, dates and which row carries which trap", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const screens = SEEDS.slice(0, 60).map(screen);
    const forms = screens.map((s) => readForms(s.doc("forms-consistency")));
    expect(new Set(forms.map((f) => f.cell("Family name", 2))).size).toBeGreaterThan(10);
    const at = (f: ReturnType<typeof readForms>, issue: FormIssue) => [...f.issues].find(([, i]) => i === issue)![0];
    expect(new Set(forms.map((f) => at(f, "identity"))).size).toBe(5);
    expect(new Set(forms.map((f) => at(f, "job"))).size).toBe(2);
    expect(new Set(forms.map((f) => at(f, "wage"))).size).toBe(2);
    expect(new Set(forms.map((f) => at(f, "dates"))).size).toBe(2);
    const packets = screens.map((s) => ({ doc: s.doc("packet-checklist"), ...readPacket(s.doc("packet-checklist")) }));
    // Tabs are shuffled per seed, so count which checklist item carries each trap, and where the fee tab sits.
    const pAt = (p: (typeof packets)[number], issue: PacketIssue) => {
      const id = [...p.issues].find(([, i]) => i === issue)![0];
      return p.doc.document.rows.find((r) => r.id === id)!.cells[col(p.doc, /^Item/)];
    };
    expect(new Set(packets.map((p) => [...p.issues].find(([, i]) => i === "fee")![0])).size).toBeGreaterThan(6);
    expect(new Set(packets.map((p) => pAt(p, "missing"))).size).toBe(4);
    expect(new Set(packets.map((p) => pAt(p, "unsigned"))).size).toBe(3);
    expect(new Set(packets.map((p) => pAt(p, "translation"))).size).toBe(2);
    expect(new Set(packets.map((p) => pAt(p, "not_valid"))).size).toBe(2);
    expect(new Set(packets.map((p) => p.feeRight)).size).toBe(2);
    expect(new Set(screens.map((s) => solveRfe(s).join())).size).toBeGreaterThan(8);
  });
});

describe("immigration-h1b-packet: forms cross-check", () => {
  it("fourteen details with exactly one identity, job, wage, date and worksite discrepancy", () => {
    for (const seed of SEEDS) {
      const f = readForms(screen(seed).doc("forms-consistency"));
      expect(f.rows.length, seed).toBe(14);
      expect([...f.issues.values()].sort(), seed).toEqual(["dates", "identity", "job", "wage", "worksite"]);
    }
  });

  it("the key agrees with the grid", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const f = readForms(sc.doc("forms-consistency"));
      const k = scenario.generate(seed).keys["forms-consistency"] as ReviewKey;
      const at = (issue: FormIssue) => [...f.issues].find(([, i]) => i === issue)![0];
      for (const issue of ["identity", "job", "wage", "dates", "worksite"] as const) {
        expect(k.findings[issue], `${seed} ${issue}`).toMatchObject({ targets: [at(issue)], reasons: [issue] });
      }
      expect(sc.doc("forms-consistency").decision!.options.find((o) => o.id === k.decision![0])!.label).toMatch(/^Hold the filing/);
    }
  });

  it("the passport's capitals and day-first dates are look-alikes, not discrepancies", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const f = readForms(screen(seed).doc("forms-consistency"));
      expect(f.cell("Date of birth", 2)).toMatch(/^\d{2} [A-Z]{3} \d{4}$/);
      expect(f.cell("Date of birth", 1)).toMatch(/^\d{2}\/\d{2}\/\d{4}$/);
      expect(f.cell("Country of citizenship", 1)).not.toBe(f.cell("Country of citizenship", 2));
    }
  });
});

describe("immigration-h1b-packet: packet checklist", () => {
  it("twelve tabs with exactly one missing item, unsigned form, wrong fee, untranslated document and expired or pending item", () => {
    for (const seed of SEEDS) {
      const doc = screen(seed).doc("packet-checklist");
      const p = readPacket(doc);
      expect(doc.document.rows.length, seed).toBe(12);
      expect([...p.issues.values()].sort(), seed).toEqual(["fee", "missing", "not_valid", "translation", "unsigned"]);
    }
  });

  it("the key agrees with the checklist", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const p = readPacket(sc.doc("packet-checklist"));
      const k = scenario.generate(seed).keys["packet-checklist"] as ReviewKey;
      const at = (issue: PacketIssue) => [...p.issues].find(([, i]) => i === issue)![0];
      for (const issue of ["missing", "unsigned", "fee", "translation", "not_valid"] as const) {
        expect(k.findings[issue], `${seed} ${issue}`).toMatchObject({ targets: [at(issue)], reasons: [issue] });
      }
      expect(sc.doc("packet-checklist").decision!.options.find((o) => o.id === k.decision![0])!.label).toMatch(/^Hold the packet/);
    }
  });

  it("both fee tiers show up", () => {
    const small = SEEDS.filter((s) => readPacket(screen(s).doc("packet-checklist")).employees <= 25).length;
    expect(small).toBeGreaterThan(40);
    expect(small).toBeLessThan(160);
  });
});

describe("immigration-h1b-packet: inbox", () => {
  it("the RFE key is the cover letter, the notice and one document per item the RFE asks for", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      expect(sc.mc("inbox-rfe").select).toBe("multi");
      expect((scenario.generate(seed).keys["inbox-rfe"] as McKey).correct.slice().sort(), seed).toEqual(solveRfe(sc));
    }
  });

  it("backdating and the beneficiary's question: one right answer each, in a different place per seed", () => {
    const places = { bd: new Set<string>(), bn: new Set<string>() };
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const keys = scenario.generate(seed).keys;
      expect(sc.mc("inbox-backdate").select).toBe("single");
      expect(sc.mc("inbox-beneficiary").select).toBe("single");
      expect((keys["inbox-backdate"] as McKey).correct).toEqual([solveBackdate(sc)]);
      expect((keys["inbox-beneficiary"] as McKey).correct).toEqual([solveBeneficiary(sc)]);
      places.bd.add(solveBackdate(sc));
      places.bn.add(solveBeneficiary(sc));
      expect(sc.msg("m4").body).toMatch(/date/i);
      expect(sc.msg("m4").from).toMatch(/HR/);
    }
    expect(places.bd.size).toBe(4);
    expect(places.bn.size).toBe(4);
  });
});

describe("immigration-h1b-packet: scoring", () => {
  it("out of 100: rapid rounds 10 each, forms 20, packet 20, inbox 12 + 10 + 8", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect(REVIEW_STEPS.map(max)).toEqual([20, 20]);
    expect(MC_STEPS.map(max)).toEqual([12, 10, 8]);
  });

  it("blank scores 0 for every seed", () => {
    for (const seed of SEEDS.slice(0, 50)) expect(scoreAttempt(scenario, seed, {}).points).toBe(0);
  });

  it(
    "a perfect answer, built only from the screen, scores 100 for every seed with nothing left for review",
    () => {
      for (const seed of SEEDS) {
        const s = scoreAttempt(scenario, seed, perfectAnswers(seed));
        for (const [id, step] of Object.entries(s.steps)) {
          expect(step.points, `${seed} ${id}`).toBe(step.maxPoints);
          expect(step.needsReview, `${seed} ${id}`).toBeFalsy();
        }
        expect(s.points, seed).toBe(MAX);
      }
    },
    LONG,
  );

  it("another seed's perfect answer doesn't score well (answers can't be shared)", () => {
    let shared = 0;
    for (let i = 0; i < 20; i++) shared += scoreAttempt(scenario, SEEDS[i + 1], perfectAnswers(SEEDS[i])).points;
    expect(shared / 20).toBeLessThan(40);
  });

  describe("each trap answered wrongly costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    const lost = (seed: string, mutate: (a: Answers & Record<string, unknown>) => void) => {
      const a = clone(perfectAnswers(seed));
      mutate(a);
      return scoreAttempt(scenario, seed, perfectAnswers(seed)).points - scoreAttempt(scenario, seed, a).points;
    };
    const dropFlag = (stepId: ReviewStepId, reason: string) => (a: Answers & Record<string, unknown>) => {
      const step = a[stepId] as { flags: Flag[] };
      const before = step.flags.length;
      step.flags = step.flags.filter((f) => f.reason !== reason);
      expect(step.flags.length).toBe(before - 1);
    };
    const reReason = (stepId: ReviewStepId, reason: string, to: string) => (a: Answers & Record<string, unknown>) => {
      const f = (a[stepId] as { flags: Flag[] }).flags.find((x) => x.reason === reason)!;
      f.reason = to;
    };

    const cases: [string, ReviewStepId, string, number][] = [
      ["identity detail that doesn't match the passport", "forms-consistency", "identity", 4],
      ["job title or occupation code off the attestation", "forms-consistency", "job", 3],
      ["wage or wage level off the attestation", "forms-consistency", "wage", 4],
      ["employment dates outside the attestation", "forms-consistency", "dates", 3],
      ["worksite not on the attestation", "forms-consistency", "worksite", 4],
      ["missing document", "packet-checklist", "missing", 4],
      ["unsigned form", "packet-checklist", "unsigned", 4],
      ["wrong filing fee", "packet-checklist", "fee", 4],
      ["foreign-language document without translation", "packet-checklist", "translation", 3],
      ["expired passport or pending attestation", "packet-checklist", "not_valid", 3],
    ];
    for (const [name, stepId, reason, points] of cases) {
      it(`${name} missed: loses ${points}; spotted with the wrong reason: loses half`, () => {
        for (const seed of seeds) {
          expect(lost(seed, dropFlag(stepId, reason)), `${seed} ${name}`).toBe(points);
          expect(lost(seed, reReason(stepId, reason, "other")), `${seed} ${name} wrong reason`).toBe(points / 2);
        }
      });
    }

    it("filing the petition or the packet as is: each decision costs 2", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const fileForms = oneOption(sc.doc("forms-consistency").decision!, /^File the petition today/);
        const filePacket = oneOption(sc.doc("packet-checklist").decision!, /^File today/);
        expect(lost(seed, (a) => (a["forms-consistency"].decision = fileForms))).toBe(2);
        expect(lost(seed, (a) => (a["packet-checklist"].decision = filePacket))).toBe(2);
      }
    });

    it("flagging a look-alike (passport capitals, a clean tab) costs the false-flag penalty", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const f = readForms(sc.doc("forms-consistency"));
        const clean = f.rows.find((r) => !f.issues.has(r.id))!;
        expect(lost(seed, (a) => (a["forms-consistency"] as { flags: Flag[] }).flags.push({ target: clean.id, reason: "identity", note: "" }))).toBe(1);
        const p = readPacket(sc.doc("packet-checklist"));
        const ok = sc.doc("packet-checklist").document.rows.find((r) => !p.issues.has(r.id))!;
        expect(lost(seed, (a) => (a["packet-checklist"] as { flags: Flag[] }).flags.push({ target: ok.id, reason: "missing", note: "" }))).toBe(1);
      }
    });

    it("inbox: preparing the backdated letter costs all 10; advising the beneficiary costs all 8", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const prepare = oneOption(sc.mc("inbox-backdate"), /^Prepare it with the earlier date/);
        const advise = oneOption(sc.mc("inbox-beneficiary"), /^Give your best guess/);
        expect(lost(seed, (a) => (a["inbox-backdate"].selected = [prepare]))).toBe(10);
        expect(lost(seed, (a) => (a["inbox-beneficiary"].selected = [advise]))).toBe(8);
      }
    });

    it("RFE: the whole client file earns nothing; leaving out one right item loses its share", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const cfg = sc.mc("inbox-rfe");
        const right = solveRfe(sc);
        expect(lost(seed, (a) => (a["inbox-rfe"].selected = [oneOption(cfg, /^Every document in the client file/)]))).toBe(12);
        expect(lost(seed, (a) => (a["inbox-rfe"].selected = right.slice(1)))).toBeCloseTo(12 / right.length, 2);
      }
    });
  });
});

describe("immigration-h1b-packet: nothing from the key reaches the candidate", () => {
  it("no reviewer note, key word or option-revealing field in any payload", () => {
    for (const seed of SEEDS) {
      const variant = scenario.generate(seed);
      const notes = REVIEW_STEPS.flatMap((id) => Object.values((variant.keys[id] as ReviewKey).findings).map((f) => f.note!));
      for (const n of notes) expect(n.length).toBeGreaterThan(10);
      for (const minute of [0, 20, END]) {
        const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute));
        expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"|"clean":|"correct"/);
        for (const n of notes) expect(payload, seed).not.toContain(n);
      }
    }
  });
});

describe("immigration-h1b-packet: timed sections", () => {
  const def = scenario.definition;
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-16T09:00:00Z");
  const flowAt = (ms: number, events: Parameters<typeof resolveFlow>[1]["events"] = []) =>
    resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent: 0, events });
  const stepById = (id: string) => def.steps.find((s) => s.id === id)!;

  it("validateSections passes and the sections fill the time limit exactly", () => {
    expect(validateSections(def, scenario.timeLimitMinutes)).toEqual([]);
    expect(def.sections!.reduce((t, s) => t + s.minutes, 0)).toBe(scenario.timeLimitMinutes);
  });

  it("six sections: status math, forms, terms, packet, deadlines, inbox", () => {
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-status"], false],
      ["s-forms", 10, ["forms-consistency"], false],
      ["s-rapid-b", 6, ["rapid-terms"], false],
      ["s-packet", 10, ["packet-checklist"], false],
      ["s-rapid-c", 6, ["rapid-deadlines"], false],
      ["s-inbox", 12, [...MC_STEPS], true],
    ]);
  });

  it("one-at-a-time screens add up to their section", () => {
    for (const sec of def.sections!.filter((s) => s.oneAtATime)) {
      expect(sec.stepIds.reduce((t, id) => t + stepById(id).seconds!, 0), sec.id).toBe(sec.minutes * 60);
    }
    expect(MC_STEPS.map((id) => stepById(id).seconds)).toEqual([300, 210, 210]);
  });

  it("each rapid round is 15 items x 20 seconds and fits its 6-minute section", () => {
    for (const id of RAPID_STEPS) {
      const config = rapidConfig(id);
      expect(config.items.length, id).toBe(15);
      expect(config.secondsPerItem).toBe(20);
      const sec = def.sections!.find((s) => s.stepIds.includes(id))!;
      expect(config.items.length * config.secondsPerItem).toBeLessThanOrEqual(sec.minutes * 60);
    }
  });

  it("runs the sections back to back", () => {
    const at = (min: number) => flowAt(min * MIN);
    expect(at(0).visibleStepIds).toEqual(["rapid-status"]);
    expect(at(6).visibleStepIds).toEqual(["forms-consistency"]);
    expect(at(16).visibleStepIds).toEqual(["rapid-terms"]);
    expect(at(22).visibleStepIds).toEqual(["packet-checklist"]);
    expect(at(32).visibleStepIds).toEqual(["rapid-deadlines"]);
    expect(at(38).visibleStepIds).toEqual(["inbox-rfe"]);
    expect(at(43.1).visibleStepIds).toEqual(["inbox-backdate"]);
    expect(at(46.6).visibleStepIds).toEqual(["inbox-beneficiary"]);
    expect(at(END).done).toBe(true);
  });

  it("messages arrive when their section opens", () => {
    expect(def.messages.map((m) => [m.id, m.arriveAtMinute ?? 0, m.stepId])).toEqual([
      ["m1", 0, "forms-consistency"],
      ["m2", 0, "packet-checklist"],
      ["m3", 0, "inbox-rfe"],
      ["m4", 0, "inbox-backdate"],
      ["m5", 0, "inbox-beneficiary"],
    ]);
    const msgsAt = (min: number) => visibleMessageIds(def, flowAt(min * MIN), t0, t0 + min * MIN);
    expect(msgsAt(5)).toEqual([]);
    expect(msgsAt(6)).toEqual(["m1"]);
    expect(msgsAt(22)).toEqual(["m1", "m2"]);
    expect(msgsAt(38)).toEqual(["m1", "m2", "m3", "m4", "m5"]);
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
        const cfg = view.steps[0].config as { itemCount: number; current: { item: RapidItem } };
        expect(cfg.current.item).toEqual(items[index]);
        expect(JSON.stringify(cfg)).not.toMatch(/"items"|choice"|tolerance|points/);
      }
    }
  });
});

describe("immigration-h1b-packet: rapid rounds", () => {
  it(
    "every item over 200 seeds has one right answer per field, found from the material alone, matching the key",
    () => {
      for (const seed of SEEDS) {
        const keys = scenario.generate(seed).keys;
        for (const id of RAPID_STEPS) {
          const key = keys[id] as RapidKey;
          const solved = solveRapid(seed, id);
          expect(Object.keys(key.items).sort()).toEqual(solved.map((s) => s.item.id).sort());
          for (const s of solved) {
            const k = key.items[s.item.id];
            expect(Object.keys(k).sort(), `${seed} ${s.item.id}`).toEqual(s.item.fields.map((f) => f.id).sort());
            for (const f of s.item.fields) {
              if (f.kind === "number") expect(k[f.id].value, `${seed} ${s.item.id}`).toBe(s.values[f.id]);
              else expect(k[f.id].choice, `${seed} ${s.item.id} (${s.kind}: ${s.item.prompt})`).toBe(s.values[f.id]);
            }
          }
        }
      }
    },
    LONG,
  );

  it("ten quick items worth half a point and five harder ones worth one, in every round", () => {
    const hardKinds: Record<RapidStepId, string[]> = {
      "rapid-status": ["admit-passport", "grace-capped", "max", "years", "recapture"],
      "rapid-terms": TERM_RULES.filter((r) => r[3] === "hard").map((r) => r[0]),
      "rapid-deadlines": ["rfe-holiday", "appeal-roll", "posting-holiday", "premium", "courier"],
    };
    for (const id of RAPID_STEPS) {
      const points = rapidConfig(id).items.map((i) => i.points);
      expect(points.filter((p) => p === 0.5).length, id).toBe(10);
      expect(points.filter((p) => p === 1).length, id).toBe(5);
      for (const seed of SEEDS.slice(0, 50)) {
        solveRapid(seed, id).forEach((s, i) => {
          expect(hardKinds[id].includes(s.kind), `${seed} ${id} item ${i} ${s.kind}`).toBe(points[i] === 1);
        });
      }
    }
  });

  it("status math: every kind shows up, and the two number items sit in fixed slots", () => {
    const kinds = new Map<string, number>();
    for (const seed of SEEDS.slice(0, 50)) {
      const solved = solveRapid(seed, "rapid-status");
      for (const s of solved) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
      expect(solved.filter((s) => typeof s.values.answer === "number").map((s) => s.item.id)).toEqual(["sd-06", "sd-12"]);
      for (const s of solved) if (typeof s.values.answer === "number") expect(s.values.answer).toBeLessThanOrEqual(9);
    }
    expect([...kinds.keys()].sort()).toEqual(["admit", "admit-passport", "ext", "filing", "grace", "grace-capped", "max", "recapture", "years"]);
    expect(kinds.get("filing")).toBe(150);
  });

  it("deadlines: every kind shows up, with real holidays", () => {
    const kinds = new Map<string, number>();
    for (const seed of SEEDS.slice(0, 50)) for (const s of solveRapid(seed, "rapid-deadlines")) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
    expect([...kinds.keys()].sort()).toEqual([
      "appeal-plain",
      "appeal-roll",
      "courier",
      "posting-holiday",
      "posting-plain",
      "premium",
      "rfe-holiday",
      "rfe-plain",
      "rfe-weekend",
    ]);
    expect(kinds.get("rfe-weekend")).toBe(150);
    expect(kinds.get("rfe-holiday")).toBe(50);
  });

  it("varies per seed: which item comes when and where the right option sits", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBeGreaterThan(30);
      expect(new Set(firsts.map((s) => JSON.stringify(s.values))).size, id).toBeGreaterThanOrEqual(3);
    }
  });

  it("option ids are fixed per item, so an id can't hint at the answer", () => {
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
