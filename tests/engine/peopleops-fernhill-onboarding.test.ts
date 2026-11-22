import { describe, expect, it, vi } from "vitest";
import type { RapidChoiceField, RapidItem } from "@/lib/engine/step-types/rapid_round/public";
import type { PublicCell, SpreadsheetPublicConfig } from "@/lib/engine/step-types/spreadsheet/public";

vi.mock("server-only", () => ({}));

const { peopleopsFernhillOnboarding } = await import("@/lib/engine/scenarios/peopleops-fernhill-onboarding");
const { getScenario, listScenarios } = await import("@/lib/engine/scenarios");
const { renderAttemptForCandidate, renderFlowForCandidate } = await import("@/lib/engine/server/render");
const { scoreAttempt } = await import("@/lib/engine/server/score");
const { resolveFlow, visibleMessageIds, validateSections } = await import("@/lib/engine/server/flow");
const { rapidRoundServer } = await import("@/lib/engine/step-types/rapid_round/server");
const { fillTemplate, templateValues } = await import("@/lib/engine/server/template");
const { courtDaysAfter } = await import("@/lib/engine/scenarios/legal/dates");

/**
 * HR / people operations coordinator at Fernhill Outdoor Co. Three rapid
 * rounds (onboarding dates, policy calls, screening) and three work sections
 * (onboarding file audit, pay changes, a one-screen-at-a-time desk with an
 * offer letter check, hiring metrics and five judgment calls), 50 minutes,
 * 100 points. Every task is solved here from what the candidate sees, with an
 * independent reading of Fernhill's cards, then compared with the server key.
 */

const scenario = peopleopsFernhillOnboarding;
const SLUG = "peopleops-fernhill-onboarding";
const SEEDS = Array.from({ length: 200 }, (_, i) => `attempt-${i.toString(16).padStart(4, "0")}`);
const END = scenario.timeLimitMinutes;
const MAX = 100;
const LONG = 180_000;
const RAPID_STEPS = ["rapid-dates", "rapid-policy", "rapid-screening"] as const;
type RapidStepId = (typeof RAPID_STEPS)[number];
const REVIEW_STEPS = ["onboarding-audit", "offer-check"] as const;
type ReviewStepId = (typeof REVIEW_STEPS)[number];
const SHEET_STEPS = ["pay-changes", "hiring-metrics"] as const;
type SheetStepId = (typeof SHEET_STEPS)[number];
const VALUES_STEPS = ["values-client-care", "values-integrity", "values-candor", "values-in-lane", "values-quality"] as const;
type ValuesStepId = (typeof VALUES_STEPS)[number];

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
type SheetKey = { tolerance?: number; cells: Record<string, { value: number; tolerance?: number }> };
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
  const mc = (id: ValuesStepId) => step(id).config as Mc;
  const sheet = (id: SheetStepId) => step(id).config as SpreadsheetPublicConfig;
  return { view, step, msg, doc, mc, sheet };
}
type Screen = ReturnType<typeof screen>;

const field = (doc: Doc, id: string) => {
  const f = [...doc.document.fields, ...doc.document.totals].find((x) => x.id === id);
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
const DATE = /\w{3}, \w{3} \d{1,2}, \d{4}/;
/** "Mon, Mar 2, 2026" → epoch day (UTC); also checks the weekday printed matches the date. */
function day(label: string): number {
  const m = label.trim().match(/^(\w{3}), (\w{3}) (\d{1,2}), (\d{4})$/);
  expect(m, `date "${label}"`).not.toBeNull();
  const t = Date.UTC(Number(m![4]), MONTHS.indexOf(m![2]), Number(m![3]));
  expect(WEEKDAYS[new Date(t).getUTCDay()], `weekday of ${label}`).toBe(m![1]);
  return t / 86_400_000;
}
const dow = (d: number) => new Date(d * 86_400_000).getUTCDay();
const weekend = (d: number) => [0, 6].includes(dow(d));
const iso = (d: number) => new Date(d * 86_400_000).toISOString().slice(0, 10);
const ymd = (d: number) => {
  const t = new Date(d * 86_400_000);
  return [t.getUTCFullYear(), t.getUTCMonth(), t.getUTCDate()];
};
const firstOfNextMonth = (d: number) => {
  const [y, m] = ymd(d);
  return Date.UTC(y, m + 1, 1) / 86_400_000;
};
const isLastOfMonth = (d: number) => ymd(d + 1)[2] === 1;
const num = (s: string) => {
  expect(s, `number "${s}"`).toMatch(/^\d{1,3}(,\d{3})*$/);
  return Number(s.replace(/,/g, ""));
};
/** "$1,234.56" → cents. */
const cents = (s: string) => {
  expect(s, `money "${s}"`).toMatch(/^\$\d{1,3}(,\d{3})*\.\d{2}$/);
  return Math.round(Number(s.slice(1).replace(/,/g, "")) * 100);
};
/** "Mon, Jan 18, 2027 (Birthday of Martin Luther King, Jr.); …" → epoch days. */
const holidayList = (s: string) => [...s.matchAll(new RegExp(`(${DATE.source}) \\(`, "g"))].map((m) => day(m[1]));
/** n business days after `from` (Mon–Fri, not a listed closure). */
function businessAfter(from: number, n: number, closed: number[]) {
  let d = from;
  for (let left = n; left > 0; ) {
    d++;
    if (!weekend(d) && !closed.includes(d)) left--;
  }
  return d;
}
const hoursLabel = (n: number) => (n === 1 ? "1 hour" : `${n} hours`);
/** "Mon 9 · Tue 10 · Wed 8" → [9, 10, 8]. */
const dailyHours = (s: string) => {
  if (/^no hours$/i.test(s.trim())) return [];
  return s.split(/ · |, /).map((x) => {
    const m = x.trim().match(/^(Sun|Mon|Tue|Wed|Thu|Fri|Sat) (\d+)$/);
    expect(m, `hours "${x}" in "${s}"`).not.toBeNull();
    return Number(m![2]);
  });
};
const sum = (xs: number[]) => xs.reduce((s, x) => s + x, 0);

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
type Solved = { values: Record<string, string>; kind: string };

const choiceField = (item: RapidItem) => {
  const f = item.fields.find((x) => x.id === "answer") as RapidChoiceField | undefined;
  expect(f, `${item.id} answer field`).toBeDefined();
  expect(f!.options.length).toBe(4);
  expect(new Set(f!.options.map((o) => o.label)).size, `${item.id} four different options`).toBe(4);
  return f!;
};
const optionId = (item: RapidItem, label: RegExp | string) => {
  const opts = choiceField(item).options.filter((o) => (typeof label === "string" ? o.label === label : label.test(o.label)));
  expect(opts.length, `${item.id}: one option like ${label} in ${JSON.stringify(choiceField(item).options)}`).toBe(1);
  return opts[0].id;
};
const exRow = (item: RapidItem, label: string | RegExp) =>
  item.exhibit?.rows?.find((x) => (typeof label === "string" ? x.label === label : label.test(x.label)))?.value;
const mustRow = (item: RapidItem, label: string | RegExp) => {
  const v = exRow(item, label);
  expect(v, `${item.id} row ${label}`).toBeDefined();
  return v!;
};
const pickDate = (item: RapidItem, d: number) => {
  const f = choiceField(item);
  expect(new Set(f.options.map((o) => day(o.label))).size, `${item.id} four different dates`).toBe(4);
  const right = f.options.filter((o) => day(o.label) === d);
  expect(right.length, `${item.id} one right date ${iso(d)}`).toBe(1);
  return right[0].id;
};

/** Onboarding dates: Section 2, benefits start, handbook acknowledgement, PTO balance, FMLA eligibility. */
function solveDates(item: RapidItem): Solved {
  if (exRow(item, "HR office closed") !== undefined) {
    const start = day(mustRow(item, "First day of work"));
    expect(weekend(start)).toBe(false);
    expect(mustRow(item, "Rule")).toMatch(/within 3 business days of the first day of work/);
    const closed = holidayList(mustRow(item, "HR office closed"));
    const due = businessAfter(start, 3, closed);
    expect(courtDaysAfter(iso(start), 3), "Fernhill closes on the federal holidays").toBe(iso(due));
    const kind = closed.some((h) => h > start && h <= due) ? "s2-holiday" : "s2";
    return { kind, values: { answer: pickDate(item, due) } };
  }
  if (exRow(item, "Example") !== undefined) {
    const start = day(mustRow(item, "First day of work"));
    expect(mustRow(item, "Rule")).toMatch(/1st of the month after the employee completes 30 days of employment\. The first day of work is day 1\./);
    const due = firstOfNextMonth(start + 29);
    return { kind: isLastOfMonth(start) ? "benefits-eom" : "benefits", values: { answer: pickDate(item, due) } };
  }
  if (exRow(item, "Received") !== undefined) {
    const start = day(mustRow(item, "First day of work"));
    const n = Number(mustRow(item, "Rule").match(/due (\d+) calendar days after the first day of work \(the first day is day 0\)/)![1]);
    return { kind: "ack", values: { answer: pickDate(item, start + n) } };
  }
  if (exRow(item, "Accrual") !== undefined) {
    const rate = mustRow(item, "Accrual").match(/^(\d+\.\d{2}) hours per biweekly pay period$/)!;
    expect(rate, `${item.id} accrual`).not.toBeNull();
    const periods = Number(mustRow(item, "Pay periods completed since hire"));
    const used = Number(mustRow(item, "PTO used so far").match(/^(\d+) hours$/)![1]);
    const hundredths = Math.round(Number(rate[1]) * 100) * periods - used * 100;
    for (const o of choiceField(item).options) expect(o.label).toMatch(/^\d+\.\d{2} hours$/);
    return { kind: "pto", values: { answer: optionId(item, `${(hundredths / 100).toFixed(2)} hours`) } };
  }
  if (exRow(item, "Hired") !== undefined) {
    expect(item.prompt).toMatch(/at least 12 months of service, at least 1,250 hours worked in the 12 months before the leave, and at least 50 employees within 75 miles/);
    const hired = day(mustRow(item, "Hired"));
    const leave = day(mustRow(item, "Leave starts"));
    const [y, m, d] = ymd(hired);
    const anniversary = Date.UTC(y + 1, m, d) / 86_400_000;
    const hours = num(mustRow(item, "Hours worked, last 12 months"));
    const nearby = num(mustRow(item, "Employees within 75 miles of the worksite"));
    const fails = [leave < anniversary && "service", hours < 1250 && "hours", nearby < 50 && "nearby"].filter(Boolean);
    expect(fails.length, `${item.id} at most one condition fails`).toBeLessThanOrEqual(1);
    const label = { service: /^Not eligible: under 12 months/, hours: /^Not eligible: under 1,250 hours/, nearby: /^Not eligible: under 50 employees/ }[fails[0] as string] ?? /^Eligible$/;
    return { kind: "fmla", values: { answer: optionId(item, label) } };
  }
  throw new Error(`unknown dates item: ${JSON.stringify(item)}`);
}

/** Policy calls: overtime hours, approvals, which leave applies. */
function solvePolicy(item: RapidItem): Solved {
  const rule = exRow(item, "Rule");
  if (rule !== undefined) {
    expect(rule).toMatch(/over 40 in (the|a) workweek/);
    expect(rule).toMatch(/no daily overtime/);
    for (const o of choiceField(item).options) expect(o.label).toMatch(/^\d+ hours?$/);
    const employee = mustRow(item, "Employee");
    const twoWeeks = exRow(item, "Week 1 hours worked");
    if (twoWeeks !== undefined) {
      expect(employee).toMatch(/non-exempt, hourly/);
      const ot = [twoWeeks, mustRow(item, "Week 2 hours worked")].map((w) => Math.max(0, sum(dailyHours(w)) - 40));
      return { kind: "workweek", values: { answer: optionId(item, hoursLabel(sum(ot))) } };
    }
    const worked = sum(dailyHours(mustRow(item, "Hours worked")));
    const paid = mustRow(item, "Paid time off this week");
    if (/exempt, salaried/.test(employee) && !/non-exempt/.test(employee)) {
      expect(worked).toBeGreaterThan(40);
      return { kind: "exempt", values: { answer: optionId(item, hoursLabel(0)) } };
    }
    expect(employee).toMatch(/non-exempt, hourly/);
    expect(rule).toMatch(/Holiday and PTO hours are paid but are not hours worked/);
    const kind = /holiday/.test(paid) ? "holiday-week" : "ot";
    return { kind, values: { answer: optionId(item, hoursLabel(Math.max(0, worked - 40))) } };
  }
  const upTo = item.exhibit?.rows?.find((r) => /^PTO, up to \d+ days$/.test(r.label));
  if (upTo) {
    const k = Number(upTo.label.match(/(\d+)/)![1]);
    const row = (re: RegExp) => item.exhibit!.rows!.find((r) => re.test(r.label))!.value;
    let right: string;
    const pto = item.prompt.match(/asks for (\d+) days? of PTO/);
    if (pto) right = Number(pto[1]) <= k ? upTo.value : row(/^PTO, more than \d+ days$/);
    else if (/overtime/i.test(item.prompt)) right = row(/^Overtime, before it's worked$/);
    else if (/unpaid personal leave/.test(item.prompt)) right = row(/^Unpaid personal leave$/);
    else throw new Error(`unknown approval prompt ${item.prompt}`);
    return { kind: "approver", values: { answer: optionId(item, right) } };
  }
  const bereavement = exRow(item, "Bereavement leave");
  if (bereavement !== undefined) {
    const family = bereavement.match(/immediate family member: (.+)$/)![1].split(", ");
    let right: string;
    const death = item.prompt.match(/the death of their (.+?)\./);
    if (death) right = family.includes(death[1]) ? "Bereavement leave" : "PTO";
    else if (/jury summons/.test(item.prompt)) right = "Jury duty leave";
    else if (/surgery|birth of their child|serious health condition/.test(item.prompt)) {
      expect(mustRow(item, "Employee")).toMatch(/FMLA-eligible: yes/);
      right = "FMLA leave";
    } else right = "PTO";
    return { kind: "leave", values: { answer: optionId(item, right) } };
  }
  throw new Error(`unknown policy item: ${JSON.stringify(item)}`);
}

const MEETS = "Meets the minimum qualifications";
const FAILS = "Does not meet the minimum qualifications";
const MORE = "Need more information";
const PROTECTED = /plan to start a family|mentioned they are \d+|gap in \d{4} for medical leave/;

/** Screening: each minimum qualification against the notes; anything not job-related is ignored. */
function solveScreening(item: RapidItem): Solved {
  const quals = mustRow(item, "Minimum qualifications").split("; ");
  expect(quals.length).toBe(3);
  const notes = [1, 2, 3, 4].map((i) => mustRow(item, `Note ${i}`));
  const find = (re: RegExp) => notes.map((n) => n.match(re)).find(Boolean) ?? null;
  const status = quals.map((q) => {
    const exp = q.match(/^At least (\d) years? of retail or customer-service experience$/);
    if (exp) {
      const m = find(/^Work history: (\d+) months of retail and customer-service experience in total$/);
      return m ? (Number(m[1]) >= 12 * Number(exp[1]) ? "met" : "failed") : "missing";
    }
    if (q === "Available to work weekends") {
      const m = find(/^Weekend availability: (yes|no)$/);
      return m ? (m[1] === "yes" ? "met" : "failed") : "missing";
    }
    if (q === "Current forklift operator certification") {
      const m = find(/^Forklift certification: (valid through|expired) /);
      return m ? (m[1] === "expired" ? "failed" : "met") : "missing";
    }
    if (q === "Valid driver's license") {
      const m = find(/^Driver's license: (valid|suspended)/);
      return m ? (m[1] === "valid" ? "met" : "failed") : "missing";
    }
    if (q === "High school diploma or GED") {
      const m = find(/^Education: (.+)$/);
      return m ? (/did not finish/.test(m[1]) ? "failed" : "met") : "missing";
    }
    if (q === "At least 6 months of cash-register experience") {
      const m = find(/^Cash register: (\d+) months?$/);
      return m ? (Number(m[1]) >= 6 ? "met" : "failed") : "missing";
    }
    throw new Error(`unknown qualification ${q}`);
  });
  const right = status.includes("failed") ? FAILS : status.includes("missing") ? MORE : MEETS;
  const labels = choiceField(item).options.map((o) => o.label);
  for (const generic of [MEETS, FAILS, MORE]) expect(labels).toContain(generic);
  const extra = labels.find((l) => ![MEETS, FAILS, MORE].includes(l))!;
  expect(extra, `${item.id} fourth option`).toMatch(/^Does not meet: /);
  const kind = notes.some((n) => PROTECTED.test(n)) ? "protected" : "screen";
  return { kind, values: { answer: optionId(item, right) } };
}

const SOLVERS: Record<RapidStepId, (item: RapidItem) => Solved> = {
  "rapid-dates": solveDates,
  "rapid-policy": solvePolicy,
  "rapid-screening": solveScreening,
};
const HARD_KINDS: Record<RapidStepId, string[]> = {
  "rapid-dates": ["s2-holiday", "benefits-eom", "fmla"],
  "rapid-policy": ["holiday-week", "exempt", "workweek"],
  "rapid-screening": ["protected"],
};
const solveRapid = (seed: string, stepId: RapidStepId) => rapidItems(seed, stepId).map((item) => ({ item, ...SOLVERS[stepId](item) }));

function rapidAnswers(seed: string) {
  return Object.fromEntries(
    RAPID_STEPS.map((id) => [id, { items: Object.fromEntries(solveRapid(seed, id).map((s) => [s.item.id, { values: s.values, ms: 7_000 }])) }]),
  ) as Record<RapidStepId, { items: Record<string, { values: Record<string, string>; ms: number }> }>;
}

// ---- Onboarding file audit ----

const LIST_A = ["U.S. passport", "Permanent Resident Card", "Employment Authorization Document"];
const LIST_B = ["Driver's license", "State ID card", "School ID card with photo", "Voter registration card"];
const LIST_C = ["Social Security card", "U.S. birth certificate (certified copy)"];

/** The recruiter's update: one hire's real first day, a week after the tracker's. */
function readMove(sc: Screen) {
  const m = sc.msg("m-move").body.match(new RegExp(`^(.+)'s start moved back a week: the first day was (${DATE.source}), not (${DATE.source})\\.`, "m"));
  expect(m, "recruiter's move message").not.toBeNull();
  expect(day(m![2]) - day(m![3])).toBe(7);
  return { name: m![1], actual: day(m![2]), tracker: day(m![3]) };
}

function readAudit(sc: Screen) {
  const doc = sc.doc("onboarding-audit");
  const today = day(field(doc, "today"));
  const closed = holidayList(field(doc, "closed"));
  const ackDays = Number(field(doc, "ack").match(/within (\d+) calendar days after the start date/)![1]);
  expect(field(doc, "i9")).toMatch(/Section 2: within 3 business days of the first day of work/);
  expect(field(doc, "bg")).toMatch(/on or before the start date/);
  expect(field(doc, "choice")).toMatch(/must not ask for or suggest specific documents/);
  const move = readMove(sc);
  const c = (re: RegExp) => col(doc, re);
  const [cName, cStart, cS1, cS2, cDocs, cBg, cAck, cNotes] = [/^Employee/, /^Start date/, /^Section 1/, /^Section 2/, /^Documents/, /^Background/, /^Handbook/, /^Notes/].map(c);
  const rows = doc.document.rows.map((r) => {
    const name = r.cells[cName];
    const tracker = day(r.cells[cStart]);
    const moved = name === move.name;
    if (moved) expect(tracker).toBe(move.tracker);
    const start = moved ? move.actual : tracker;
    const issues: string[] = [];
    if (day(r.cells[cS1]) > start) issues.push("s1_late");
    const s2 = day(r.cells[cS2]);
    expect(s2).toBeLessThanOrEqual(today);
    if (s2 > businessAfter(start, 3, closed)) issues.push("s2_late");
    const docs = r.cells[cDocs];
    const a = docs.match(/^List A: (.+)$/);
    const bc = docs.match(/^List B: (.+); List C: (.+)$/);
    expect(a || bc, `${r.id} documents "${docs}"`).toBeTruthy();
    if (a) expect(LIST_A).toContain(a[1]);
    else {
      expect(LIST_B).toContain(bc![1]);
      expect([...LIST_B, ...LIST_C]).toContain(bc![2]);
      if (!LIST_C.includes(bc![2])) issues.push("docs");
    }
    if (day(r.cells[cBg]) > start) issues.push("bg");
    const ack = r.cells[cAck];
    if (ack === "Not received") {
      if (today > start + ackDays) issues.push("ack");
    } else if (day(ack) > start + ackDays) issues.push("ack");
    if (/asked .+ to bring/.test(r.cells[cNotes])) issues.push("specified");
    return {
      id: r.id,
      name,
      moved,
      start,
      tracker,
      issues,
      s2,
      bgDay: day(r.cells[cBg]),
      ackPending: ack === "Not received",
      singleA: !!a,
      note: r.cells[cNotes],
      // What the row would show against the tracker date alone (for the moved hire's look-alike).
      trackerIssues: [s2 > businessAfter(tracker, 3, closed) && "s2_late", day(r.cells[cBg]) > tracker && "bg"].filter(Boolean) as string[],
    };
  });
  return { today, closed, ackDays, rows, move };
}

// ---- Pay changes ----

const text = (c: PublicCell) => (c.kind === "text" ? c.text : "");
const inputId = (c: PublicCell) => (c.kind === "input" ? c.id : null);

/** Every line's gross pay, in cents, from the sheet, the payroll emails and the recruiter's update. */
function readPay(sc: Screen) {
  const sheet = sc.sheet("pay-changes");
  expect(sheet.columns).toEqual(["Employee", "Pay", "Change this period", "Time this period", "Gross pay ($)"]);
  const p = sheet.prompt;
  const range = p.match(new RegExp(`pay period (${DATE.source}) – (${DATE.source})`))!;
  expect(range, "pay period").not.toBeNull();
  const [p0, pe] = [day(range[1]), day(range[2])];
  expect(pe - p0).toBe(13);
  expect(dow(p0)).toBe(0);
  const holiday = day(p.match(new RegExp(`Company holiday: (${DATE.source})`))![1]);
  const w = Number(p.match(/Working days for proration: (9|10)/)![1]);
  const holidayCounts = w === 10;
  expect(p).toMatch(holidayCounts ? /the holiday counts as a working day/ : /not counting the holiday/);
  const working = (d: number) => !weekend(d) && (holidayCounts || d !== holiday);
  const daysPaid = (from: number, to: number) => {
    let n = 0;
    for (let d = from; d <= to; d++) if (working(d)) n++;
    return n;
  };
  expect(daysPaid(p0, pe)).toBe(w);
  const move = readMove(sc);
  const fix = sc.msg("m-pay-fix").body.match(new RegExp(`Correction for (.+): the raise is effective (${DATE.source}), not (${DATE.source})\\.`));
  expect(fix, "payroll correction").not.toBeNull();

  const cells: Record<string, number> = {};
  const kinds: Record<string, string> = {};
  for (const r of sheet.rows) {
    const [name, pay, change, time] = r.slice(0, 4).map(text);
    const id = inputId(r[4])!;
    expect(id).toMatch(/^p\d$/);
    const salaried = pay.match(/^Salaried, exempt · (\$[\d,.]+) a year · (\$[\d,.]+) per period$/);
    const hourly = pay.match(/^Hourly, non-exempt · (\$[\d,.]+) an hour$/);
    expect(salaried || hourly, `${id} pay "${pay}"`).toBeTruthy();
    let c: number;
    let kind: string;
    if (salaried) {
      const per = cents(salaried[2]);
      expect(cents(salaried[1])).toBe(per * 26);
      expect(time).toMatch(/^Salaried: no timecard/);
      const start = change.match(new RegExp(`^New hire: first day (${DATE.source})`));
      const raise = change.match(new RegExp(`^Raise to (\\$[\\d,.]+) a year \\((\\$[\\d,.]+) per period\\): approved (${DATE.source}), effective (${DATE.source})$`));
      const unpaid = change.match(/^Unpaid FMLA leave: (\d) full days: (.+)$/);
      if (start) {
        let first = day(start[1]);
        if (name === move.name) {
          expect(first).toBe(move.tracker);
          first = move.actual;
        }
        expect(first).toBeGreaterThan(p0);
        expect(first).toBeLessThan(holiday);
        c = (per * daysPaid(first, pe)) / w;
        kind = "start";
      } else if (raise) {
        const newPer = cents(raise[2]);
        let eff = day(raise[4]);
        expect(fix![1]).toBe(name);
        expect(day(fix![3])).toBe(eff);
        eff = day(fix![2]);
        expect(day(raise[3])).toBeLessThan(eff);
        c = (per * daysPaid(p0, eff - 1) + newPer * daysPaid(eff, pe)) / w;
        kind = "raise";
      } else if (unpaid) {
        const days = unpaid[2].split("; ").map(day);
        expect(days.length).toBe(Number(unpaid[1]));
        for (const d of days) expect(working(d) && d >= p0 && d <= pe).toBe(true);
        c = (per * (w - days.length)) / w;
        kind = "unpaid";
      } else {
        expect(change).toMatch(/^Worked \d+ hours in week [12] for the inventory count; .+ asked about overtime$/);
        c = per;
        kind = "exempt";
      }
    } else {
      const rate = cents(hourly![1]);
      const m = time.match(/^Week 1: (.+) · Week 2: (.+) · Holiday pay: (0|8) h$/);
      expect(m, `${id} time "${time}"`).not.toBeNull();
      const weeks = [m![1], m![2]].map((x) => sum(dailyHours(x)));
      const hol = Number(m![3]);
      const ot = sum(weeks.map((h) => Math.max(0, h - 40)));
      c = rate * (sum(weeks) + hol) + 0.5 * rate * ot;
      kind = "hourly";
      const payout = change.match(/^Leaving: last day (.+); unused PTO to pay out: (\d+) hours$/);
      const retro = change.match(/^Raise to (\$[\d,.]+) an hour, effective .+, missed in last period's pay \((\d+) hours paid at (\$[\d,.]+)\)$/);
      if (payout) {
        expect(day(payout[1]) >= holiday).toBe(hol === 8);
        c += rate * Number(payout[2]);
        kind = "payout";
      } else if (retro) {
        expect(cents(retro[1])).toBe(rate);
        c += (rate - cents(retro[3])) * Number(retro[2]);
        kind = "retro";
      } else {
        expect(hol).toBe(8);
        kind = "overtime";
      }
    }
    cells[id] = Math.round(c) / 100;
    kinds[id] = kind;
  }
  return { cells, kinds, holidayCounts, w, p0, pe, holiday, move };
}

// ---- Offer letter ----

function readOffer(doc: Doc) {
  const band = field(doc, "band").match(/: (\$[\d,]+)–(\$[\d,]+) a year$/)!;
  expect(band, "pay band").not.toBeNull();
  const [lo, hi] = [band[1], band[2]].map((s) => num(s.slice(1)));
  const check = field(doc, "check").match(new RegExp(`ordered (${DATE.source}); the vendor needs up to (\\d) business days to clear it`))!;
  expect(check, "check field").not.toBeNull();
  const closed = holidayList(field(doc, "check"));
  const earliest = businessAfter(day(check[1]), Number(check[2]), closed);
  const pto = field(doc, "handbook").match(/PTO accrues (\d+\.\d{2}) hours per pay period/)![1];
  const [cTerm, cOffer, cAppr] = [/^Term/, /^Offer letter/, /^Approved/].map((re) => col(doc, re));
  const rows = doc.document.rows.map((r) => {
    const [term, offer, appr] = [r.cells[cTerm], r.cells[cOffer], r.cells[cAppr]];
    let issue: string | null = null;
    switch (term) {
      case "Base salary": {
        const o = num(offer.match(/^\$([\d,]+) a year$/)![1]);
        const a = num(appr.match(/^\$([\d,]+) a year$/)![1]);
        expect(o >= lo && o <= hi, "the offered salary is inside the band: only the approval shows it's wrong").toBe(true);
        if (o !== a) issue = "mismatch";
        break;
      }
      case "FLSA status": {
        const norm = (s: string) => (/^Non-exempt/.test(s) ? "non-exempt" : /^Exempt/.test(s) ? "exempt" : s);
        if (norm(offer) !== norm(appr)) issue = "mismatch";
        break;
      }
      case "Start date":
        expect(appr).toMatch(/after the background check clears/);
        if (day(offer) < earliest) issue = "too_early";
        break;
      case "Annual bonus": {
        const pct = (s: string) => (/Not eligible/.test(s) ? 0 : Number(s.match(/Target (\d+)% of base/)![1]));
        if (pct(offer) !== pct(appr)) issue = "mismatch";
        break;
      }
      case "PTO":
        expect(offer).toContain(pto);
        expect(appr).toContain(pto);
        break;
      case "Benefits":
        expect(offer).toMatch(/1st of the month after 30 days/);
        break;
      case "Position":
      case "Location":
      case "Reports to":
        expect(offer).toBe(appr);
        break;
      default:
        throw new Error(`unknown offer term ${term}`);
    }
    return { id: r.id, term, issue };
  });
  return { rows, earliest };
}

// ---- Hiring metrics ----

function readMetrics(sc: Screen) {
  const sheet = sc.sheet("hiring-metrics");
  expect(sheet.columns).toEqual(["Item", "Figure", "Your answer"]);
  const rows = sheet.rows.map((r) => ({ item: text(r[0]), figure: text(r[1]), input: inputId(r[2]) }));
  const fig = (re: RegExp) => rows.filter((r) => re.test(r.item)).map((r) => r.figure);
  const [h0, h1] = fig(/^Headcount on /).map(num);
  const seps = num(fig(/^Separations in the quarter/)[0]);
  const reqs = fig(/^Requisition /);
  expect(reqs.length).toBe(6);
  const filled = reqs
    .map((f) => f.match(new RegExp(`^Opened (${DATE.source}) · filled (${DATE.source})$`)))
    .filter(Boolean)
    .map((m) => day(m![2]) - day(m![1]));
  expect(filled.length, "one requisition is still open").toBe(5);
  const extended = num(fig(/^Offers extended/)[0]);
  const accepted = num(fig(/^Offers accepted/)[0]);
  const hires = num(fig(/^Hires in the quarter/)[0]);
  const costRows = rows.filter((r) => /^Cost: /.test(r.item));
  expect(costRows.length).toBe(5);
  const recruiting = sum(costRows.filter((r) => !/orientation/i.test(r.item)).map((r) => cents(r.figure)));
  const id = (re: RegExp) => rows.find((r) => re.test(r.item))!.input!;
  return {
    cells: {
      [id(/^Turnover rate/)]: Number(((100 * seps) / ((h0 + h1) / 2)).toFixed(1)),
      [id(/^Average days to fill/)]: Number((sum(filled) / filled.length).toFixed(1)),
      [id(/^Offer acceptance rate/)]: Number(((100 * accepted) / extended).toFixed(1)),
      [id(/^Cost per hire/)]: Math.round(recruiting / hires) / 100,
    } as Record<string, number>,
  };
}

// ---- Judgment calls ----

const RIGHT: Record<ValuesStepId, RegExp> = {
  "values-client-care": /^Tell .+ only that .+ is on approved leave/,
  "values-integrity": /^Don't backdate/,
  "values-candor": /^Own it/,
  "values-in-lane": /^Explain that you can't keep it secret/,
  "values-quality": /^Keep the start date until the check clears/,
};
function oneOption(cfg: { options: { id: string; label: string }[] }, re: RegExp) {
  const o = cfg.options.filter((x) => re.test(x.label));
  expect(o.length, `one option like ${re}`).toBe(1);
  return o[0].id;
}

// ---- A strong candidate's answers, built only from the screen ----

function perfectAnswers(seed: string) {
  const sc = screen(seed);
  const audit = readAudit(sc);
  const offer = readOffer(sc.doc("offer-check"));
  return {
    ...rapidAnswers(seed),
    "onboarding-audit": {
      flags: audit.rows.flatMap((r) => r.issues.map((reason) => ({ target: r.id, reason, note: "" }))),
      decision: oneOption(sc.doc("onboarding-audit").decision!, /^Send .+ the list today/),
    },
    "pay-changes": { cells: { ...readPay(sc).cells } as Record<string, number | null> },
    "offer-check": {
      flags: offer.rows.filter((r) => r.issue).map((r) => ({ target: r.id, reason: r.issue!, note: "" })),
      decision: oneOption(sc.doc("offer-check").decision!, /^Hold the letter/),
    },
    "hiring-metrics": { cells: { ...readMetrics(sc).cells } as Record<string, number | null> },
    ...Object.fromEntries(VALUES_STEPS.map((id) => [id, { selected: [oneOption(sc.mc(id), RIGHT[id])] }])),
  } as Record<string, unknown> & {
    "onboarding-audit": { flags: Flag[]; decision: string };
    "offer-check": { flags: Flag[]; decision: string };
    "pay-changes": { cells: Record<string, number | null> };
    "hiring-metrics": { cells: Record<string, number | null> };
  };
}

type Answers = ReturnType<typeof perfectAnswers>;
const clone = (a: Answers): Answers => JSON.parse(JSON.stringify(a));

describe(`${SLUG}: setup`, () => {
  it("is registered, version 1, hr, 50 minutes, and uses only allowed step types in section order", () => {
    expect(getScenario(SLUG, 1)).toBe(scenario);
    expect(listScenarios()).toContain(scenario);
    expect(scenario.slug).toBe(SLUG);
    expect(scenario.version).toBe(1);
    expect(scenario.timeLimitMinutes).toBe(50);
    expect(scenario.roleFamily).toBe("hr");
    expect(scenario.title).toBe("Fernhill: people operations coordinator");
    expect(scenario.definition.steps.map((s) => [s.id, s.type])).toEqual([
      ["rapid-dates", "rapid_round"],
      ["onboarding-audit", "document_review"],
      ["rapid-policy", "rapid_round"],
      ["pay-changes", "spreadsheet"],
      ["rapid-screening", "rapid_round"],
      ["offer-check", "document_review"],
      ["hiring-metrics", "spreadsheet"],
      ...VALUES_STEPS.map((id) => [id, "multiple_choice"]),
    ]);
    expect(scenario.definition.intro).toMatch(/Fernhill Outdoor Co\./);
    expect(scenario.definition.intro).toMatch(/federal overtime rule/);
    const titles = scenario.definition.steps.filter((s) => s.id.startsWith("values-")).map((s) => s.title);
    for (const t of titles) expect(t).toMatch(/^Judgment: /);
    expect(JSON.stringify(scenario.definition)).not.toMatch(/candidate|Question \d/i);
  });

  it("the definition is plain JSON", () => {
    expect(JSON.parse(JSON.stringify(scenario.definition))).toEqual(scenario.definition);
  });

  it(
    "renders for 200 seeds with no unfilled template, and every rapid item renders",
    () => {
      for (const seed of SEEDS) {
        for (const minute of [0, END]) {
          const view = renderAttemptForCandidate(scenario, seed, minute);
          expect(view.steps.length).toBeGreaterThanOrEqual(1);
          expect(JSON.stringify(view)).not.toContain("{{");
        }
        for (const id of RAPID_STEPS) expect(JSON.stringify(rapidItems(seed, id))).not.toContain("{{");
      }
    },
    LONG,
  );

  it("is deterministic per seed, and every value is a string or number", () => {
    for (const seed of SEEDS.slice(0, 20)) {
      expect(scenario.generate(seed)).toEqual(scenario.generate(seed));
      for (const v of Object.values(scenario.generate(seed).values)) expect(["string", "number"]).toContain(typeof v);
    }
  });

  it("keeps every date the candidate sees inside 2026 to 2028", () => {
    for (const seed of SEEDS.slice(0, 40)) {
      const view = JSON.stringify(renderAttemptForCandidate(scenario, seed, END));
      const items = RAPID_STEPS.map((id) => JSON.stringify(rapidItems(seed, id))).join();
      for (const m of `${view}${items}`.matchAll(new RegExp(DATE.source, "g"))) {
        const y = Number(m[0].slice(-4));
        expect(y >= 2026 && y <= 2028, `${seed} ${m[0]}`).toBe(true);
      }
    }
  });

  it("different seeds change names, numbers, dates and which row carries which trap", () => {
    expect(new Set(SEEDS.map((s) => JSON.stringify(scenario.generate(s).values))).size).toBe(SEEDS.length);
    const screens = SEEDS.slice(0, 60).map(screen);
    const audits = screens.map(readAudit);
    for (const issue of ["s1_late", "s2_late", "docs", "bg", "ack", "specified"]) {
      expect(new Set(audits.map((a) => a.rows.findIndex((r) => r.issues.includes(issue)))).size, issue).toBeGreaterThan(4);
    }
    const pays = screens.map(readPay);
    expect(new Set(pays.map((p) => p.kinds.p1)).size).toBeGreaterThan(4);
    expect(new Set(pays.map((p) => p.holidayCounts)).size).toBe(2);
    const offers = screens.map((s) => readOffer(s.doc("offer-check")));
    expect(new Set(offers.map((o) => o.rows.findIndex((r) => r.term === "Base salary"))).size).toBeGreaterThan(4);
  });
});

describe(`${SLUG}: onboarding file audit`, () => {
  it("twelve hires with exactly one row for each of the six problems, and clean look-alikes on every seed", () => {
    for (const seed of SEEDS) {
      const a = readAudit(screen(seed));
      expect(a.rows.length, seed).toBe(12);
      expect(a.rows.map((r) => r.issues.length).filter((n) => n > 1), seed).toEqual([]);
      expect(a.rows.flatMap((r) => r.issues).sort(), seed).toEqual(["ack", "bg", "docs", "s1_late", "s2_late", "specified"]);
      const clean = a.rows.filter((r) => !r.issues.length);
      // Section 2 exactly on the third business day, across a closure.
      expect(clean.some((r) => r.s2 === businessAfter(r.start, 3, a.closed) && a.closed.some((h) => h > r.start && h <= r.s2)), seed).toBe(true);
      // A single List A document; a check that cleared on the start date; an acknowledgement not yet due.
      expect(clean.some((r) => r.singleA), seed).toBe(true);
      expect(clean.some((r) => r.bgDay === r.start), seed).toBe(true);
      expect(clean.some((r) => r.ackPending), seed).toBe(true);
      // The recruiter sent the full list (fine), and the moved hire only looks late against the tracker's date.
      expect(clean.some((r) => /full list of acceptable documents/.test(r.note)), seed).toBe(true);
      const moved = a.rows.filter((r) => r.moved);
      expect(moved.length, seed).toBe(1);
      expect(moved[0].issues, seed).toEqual([]);
      expect(moved[0].trackerIssues.sort(), seed).toEqual(["bg", "s2_late"]);
      const starts = a.rows.map((r) => r.tracker);
      expect(starts, seed).toEqual([...starts].sort((x, y) => x - y));
    }
  });

  it("the key agrees with the file, and the decision is to report and correct forward", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const a = readAudit(sc);
      const k = scenario.generate(seed).keys["onboarding-audit"] as ReviewKey;
      for (const issue of ["s1_late", "s2_late", "docs", "bg", "ack", "specified"]) {
        const at = a.rows.find((r) => r.issues.includes(issue))!.id;
        expect(k.findings[issue], `${seed} ${issue}`).toMatchObject({ targets: [at], reasons: [issue] });
      }
      expect(sc.doc("onboarding-audit").decision!.options.find((o) => o.id === k.decision![0])!.label).toMatch(/^Send .+ the list today/);
    }
  });
});

describe(`${SLUG}: pay changes`, () => {
  it(
    "eight lines, one of each change; the key matches the sheet, the payroll correction and the recruiter's update, for 200 seeds",
    () => {
      for (const seed of SEEDS) {
        const sc = screen(seed);
        const pay = readPay(sc);
        expect(Object.values(pay.kinds).sort(), seed).toEqual(["exempt", "overtime", "overtime", "payout", "raise", "retro", "start", "unpaid"]);
        const key = scenario.generate(seed).keys["pay-changes"] as SheetKey;
        expect(Object.keys(key.cells).sort(), seed).toEqual(Object.keys(pay.cells).sort());
        for (const [id, value] of Object.entries(pay.cells)) {
          expect(Math.abs(key.cells[id].value - value), `${seed} ${id} ${pay.kinds[id]}: key ${key.cells[id].value}, screen ${value}`).toBeLessThan(0.005);
          expect(key.cells[id].tolerance ?? key.tolerance, `${seed} ${id} tolerance`).toBe(0.02);
        }
        // Continuity: the new hire on the pay sheet is the one whose start moved.
        const start = sc.sheet("pay-changes").rows.find((r) => /^New hire/.test(text(r[2])))!;
        expect(text(start[0])).toBe(pay.move.name);
      }
    },
    LONG,
  );

  it("each trap changes the answer: holiday proration, weekly (not daily) overtime, holiday hours, the corrected effective date", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const sc = screen(seed);
      const pay = readPay(sc);
      expect(pay.holiday > pay.p0 && pay.holiday < pay.pe).toBe(true);
      expect(weekend(pay.holiday)).toBe(false);
      const hw = pay.holiday - pay.p0 < 7 ? 0 : 1;
      const overtimeRows = sc
        .sheet("pay-changes")
        .rows.filter((r) => /^Hourly/.test(text(r[1])) && !/^(Leaving|Raise)/.test(text(r[2])))
        .map((r) => text(r[3]).match(/^Week 1: (.+) · Week 2: (.+) · Holiday pay/)!.slice(1, 3).map(dailyHours));
      expect(overtimeRows.length).toBe(2);
      const weekly = (w: number[][]) => sum(w.map((d) => Math.max(0, sum(d) - 40)));
      const daily = (w: number[][]) => sum(w.flat().map((h) => Math.max(0, h - 8)));
      const withHoliday = (w: number[][]) => sum(w.map((d, i) => Math.max(0, sum(d) + (i === hw ? 8 : 0) - 40)));
      // One timecard punishes daily overtime, the other punishes counting the holiday as hours worked.
      expect(overtimeRows.some((w) => daily(w) !== weekly(w)), seed).toBe(true);
      expect(overtimeRows.some((w) => withHoliday(w) !== weekly(w)), seed).toBe(true);
    }
  });

  it("is worth 2.5 a line: 20 in all", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.steps["pay-changes"].maxPoints).toBe(20);
  });
});

describe(`${SLUG}: offer letter check`, () => {
  it("nine terms: salary, FLSA status, start date and bonus wrong; the rest match", () => {
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const o = readOffer(sc.doc("offer-check"));
      expect(o.rows.length, seed).toBe(9);
      expect(o.rows.filter((r) => r.issue).map((r) => `${r.term}:${r.issue}`).sort(), seed).toEqual([
        "Annual bonus:mismatch",
        "Base salary:mismatch",
        "FLSA status:mismatch",
        "Start date:too_early",
      ]);
      const k = scenario.generate(seed).keys["offer-check"] as ReviewKey;
      const at = (t: string) => o.rows.find((r) => r.term === t)!.id;
      expect(k.findings.salary).toMatchObject({ targets: [at("Base salary")], reasons: ["mismatch"] });
      expect(k.findings.flsa).toMatchObject({ targets: [at("FLSA status")], reasons: ["mismatch"] });
      expect(k.findings.start).toMatchObject({ targets: [at("Start date")], reasons: ["too_early"] });
      expect(k.findings.bonus).toMatchObject({ targets: [at("Annual bonus")], reasons: ["mismatch"] });
      expect(sc.doc("offer-check").decision!.options.find((x) => x.id === k.decision![0])!.label).toMatch(/^Hold the letter/);
    }
  });
});

describe(`${SLUG}: hiring metrics`, () => {
  it("turnover, days to fill, acceptance rate and cost per hire match the key for 200 seeds", () => {
    for (const seed of SEEDS) {
      const m = readMetrics(screen(seed));
      const key = scenario.generate(seed).keys["hiring-metrics"] as SheetKey;
      expect(Object.keys(key.cells).sort()).toEqual(Object.keys(m.cells).sort());
      for (const [id, value] of Object.entries(m.cells)) expect(Math.abs(key.cells[id].value - value), `${seed} ${id}`).toBeLessThan(0.0001);
    }
  });
});

describe(`${SLUG}: judgment calls`, () => {
  it("five calls, 2 points each, four options with one right, the right one in a different place per seed", () => {
    const places = Object.fromEntries(VALUES_STEPS.map((id) => [id, new Set<string>()]));
    for (const seed of SEEDS) {
      const sc = screen(seed);
      const keys = scenario.generate(seed).keys;
      for (const id of VALUES_STEPS) {
        const cfg = sc.mc(id);
        expect(cfg.select).toBe("single");
        expect(cfg.options.map((o) => o.id)).toEqual(["a", "b", "c", "d"]);
        expect(new Set(cfg.options.map((o) => o.label)).size).toBe(4);
        const right = oneOption(cfg, RIGHT[id]);
        expect((keys[id] as McKey).correct, `${seed} ${id}`).toEqual([right]);
        places[id].add(right);
      }
      expect(sc.msg("m-integrity").body).toMatch(/Section 2/);
      expect(sc.msg("m-candor").body).toMatch(/salary/);
      expect(sc.msg("m-quality").body).toMatch(/background check/);
    }
    for (const id of VALUES_STEPS) expect(places[id].size, id).toBe(4);
    const blank = scoreAttempt(scenario, "abc", {});
    for (const id of VALUES_STEPS) expect(blank.steps[id].maxPoints).toBe(2);
  });

  it("each values call is delivered by a message from the cast, and the candor call reports the candidate's own mistake", () => {
    const def = scenario.definition;
    for (const id of VALUES_STEPS) expect(def.messages.filter((m) => m.stepId === id).length, id).toBe(1);
    const candor = screen("abc").msg("m-candor").body;
    expect(candor).toMatch(/you sent/i);
  });
});

describe(`${SLUG}: scoring`, () => {
  it("out of 100: rapid rounds 10 each, audit 20, pay changes 20, offer check 12, metrics 8, values 2 each", () => {
    const blank = scoreAttempt(scenario, "abc", {});
    expect(blank.points).toBe(0);
    expect(blank.maxPoints).toBe(MAX);
    const max = (id: string) => blank.steps[id].maxPoints;
    expect(RAPID_STEPS.map(max)).toEqual([10, 10, 10]);
    expect(max("onboarding-audit")).toBe(20);
    expect(max("pay-changes")).toBe(20);
    expect(max("offer-check")).toBe(12);
    expect(max("hiring-metrics")).toBe(8);
  });

  it("blank scores 0 and maxPoints is 100 for every seed", () => {
    for (const seed of SEEDS) {
      const s = scoreAttempt(scenario, seed, {});
      expect(s.points).toBe(0);
      expect(s.maxPoints).toBe(MAX);
    }
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

  it("another seed's perfect answer averages under 40 (answers can't be shared)", () => {
    let shared = 0;
    for (let i = 0; i < 40; i++) shared += scoreAttempt(scenario, SEEDS[i + 1], perfectAnswers(SEEDS[i])).points;
    expect(shared / 40).toBeLessThan(40);
  });

  describe("each trap answered wrongly costs exactly its points", () => {
    const seeds = SEEDS.slice(0, 40);
    const lost = (seed: string, mutate: (a: Answers) => void) => {
      const a = clone(perfectAnswers(seed));
      mutate(a);
      return scoreAttempt(scenario, seed, perfectAnswers(seed)).points - scoreAttempt(scenario, seed, a).points;
    };
    const dropFlag = (stepId: ReviewStepId, reason: string) => (a: Answers) => {
      const step = a[stepId];
      const target = step.flags.find((f) => f.reason === reason);
      expect(target).toBeDefined();
      step.flags = step.flags.filter((f) => f !== target);
    };
    const reReason = (stepId: ReviewStepId, reason: string, to: string) => (a: Answers) => {
      a[stepId].flags.find((x) => x.reason === reason)!.reason = to;
    };

    const cases: [string, ReviewStepId, string, number][] = [
      ["Section 1 after the first day", "onboarding-audit", "s1_late", 3],
      ["Section 2 after the third business day", "onboarding-audit", "s2_late", 3],
      ["two List B documents", "onboarding-audit", "docs", 3],
      ["started before the check cleared", "onboarding-audit", "bg", 3],
      ["acknowledgement overdue", "onboarding-audit", "ack", 3],
      ["recruiter named the documents", "onboarding-audit", "specified", 3],
      ["salary differs from the approval", "offer-check", "mismatch", 2.5],
      ["start before the check can clear", "offer-check", "too_early", 2.5],
    ];
    for (const [name, stepId, reason, points] of cases) {
      it(`${name} missed: loses ${points}; spotted with the wrong reason: loses half`, () => {
        for (const seed of seeds) {
          expect(lost(seed, dropFlag(stepId, reason)), `${seed} ${name}`).toBe(points);
          expect(lost(seed, reReason(stepId, reason, "other")), `${seed} ${name} wrong reason`).toBe(points / 2);
        }
      });
    }

    it("offer: FLSA status and bonus cost 2.5 each; calling the salary out of band earns half", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const o = readOffer(sc.doc("offer-check"));
        const id = (t: string) => o.rows.find((r) => r.term === t)!.id;
        const drop = (t: string) => (a: Answers) => (a["offer-check"].flags = a["offer-check"].flags.filter((f) => f.target !== id(t)));
        expect(lost(seed, drop("FLSA status"))).toBe(2.5);
        expect(lost(seed, drop("Annual bonus"))).toBe(2.5);
        expect(lost(seed, (a) => (a["offer-check"].flags.find((f) => f.target === id("Base salary"))!.reason = "out_of_band"))).toBe(1.25);
      }
    });

    it("the wrong decision costs 2: redating the forms, or sending the offer as it is", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const redate = oneOption(sc.doc("onboarding-audit").decision!, /^Redate/);
        const send = oneOption(sc.doc("offer-check").decision!, /^Send it today/);
        expect(lost(seed, (a) => (a["onboarding-audit"].decision = redate))).toBe(2);
        expect(lost(seed, (a) => (a["offer-check"].decision = send))).toBe(2);
      }
    });

    it("flagging a clean look-alike costs the false-flag penalty of 1", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const a = readAudit(sc);
        const moved = a.rows.find((r) => r.moved)!;
        expect(lost(seed, (x) => x["onboarding-audit"].flags.push({ target: moved.id, reason: "s2_late", note: "" }))).toBe(1);
        const sameDay = a.rows.find((r) => !r.issues.length && r.bgDay === r.start)!;
        expect(lost(seed, (x) => x["onboarding-audit"].flags.push({ target: sameDay.id, reason: "bg", note: "" }))).toBe(1);
        const o = readOffer(sc.doc("offer-check"));
        const fine = o.rows.find((r) => r.term === "PTO")!;
        expect(lost(seed, (x) => x["offer-check"].flags.push({ target: fine.id, reason: "other", note: "" }))).toBe(1);
      }
    });

    it("pay changes: each line is worth 2.5, and the tracker's start date or the uncorrected effective date loses it", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        const pay = readPay(sc);
        for (const id of Object.keys(pay.cells)) expect(lost(seed, (a) => (a["pay-changes"].cells[id] = pay.cells[id] + 1))).toBe(2.5);
      }
    });

    it("hiring metrics: each figure is worth 2; counting the open requisition or orientation costs are wrong", () => {
      for (const seed of seeds) {
        const m = readMetrics(screen(seed));
        for (const id of Object.keys(m.cells)) expect(lost(seed, (a) => (a["hiring-metrics"].cells[id] = m.cells[id] + 3))).toBe(2);
      }
    });

    it("values: each wrong pick costs the call's 2 points", () => {
      for (const seed of seeds) {
        const sc = screen(seed);
        for (const id of VALUES_STEPS) {
          const wrong = sc.mc(id).options.find((o) => !RIGHT[id].test(o.label))!.id;
          expect(lost(seed, (a) => (a[id] = { selected: [wrong] })), `${seed} ${id}`).toBe(2);
        }
      }
    });
  });
});

describe(`${SLUG}: nothing from the key reaches the candidate`, () => {
  it(
    "no reviewer note, key word or computed answer in any payload",
    () => {
      for (const seed of SEEDS) {
        const variant = scenario.generate(seed);
        const notes = REVIEW_STEPS.flatMap((id) => Object.values((variant.keys[id] as ReviewKey).findings).map((f) => f.note!));
        for (const n of notes) expect(n.length).toBeGreaterThan(10);
        const numbers = SHEET_STEPS.flatMap((id) => Object.values((variant.keys[id] as SheetKey).cells).map((c) => c.value));
        const items = RAPID_STEPS.map((id) => JSON.stringify(rapidItems(seed, id))).join("\n");
        for (const minute of [0, 20, END]) {
          const payload = JSON.stringify(renderAttemptForCandidate(scenario, seed, minute)) + items;
          expect(payload).not.toMatch(/"keys"|tolerance|"criteria"|"guidance"|"notes"|"points"|"expected"|"findings"|"clean":|"correct"/);
          for (const n of notes) expect(payload, seed).not.toContain(n);
          for (const c of numbers) {
            const forms = [JSON.stringify(c), c.toFixed(2), String(Math.round(c * 100)), c.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })];
            for (const f of [...new Set(forms)].filter((x) => !/^\d{1,3}$/.test(x))) {
              expect(payload, `${seed} ${f}`).not.toMatch(new RegExp(`(?<![\\d.,])${f.replace(/[.$]/g, "\\$&")}(?![\\d.]\\d)`));
            }
          }
        }
      }
    },
    LONG,
  );
});

describe(`${SLUG}: timed sections`, () => {
  const def = scenario.definition;
  const MIN = 60_000;
  const t0 = Date.parse("2026-11-16T09:00:00Z");
  const flowAt = (ms: number) => resolveFlow(def, { startedAt: t0, now: t0 + ms, extraTimePercent: 0, events: [] });
  const stepById = (id: string) => def.steps.find((s) => s.id === id)!;

  it("validateSections passes and the sections fill the time limit exactly", () => {
    expect(validateSections(def, scenario.timeLimitMinutes)).toEqual([]);
    expect(def.sections!.reduce((t, s) => t + s.minutes, 0)).toBe(scenario.timeLimitMinutes);
  });

  it("six sections with the shared ids and timings", () => {
    expect(def.sections!.map((s) => [s.id, s.minutes, s.stepIds, !!s.oneAtATime])).toEqual([
      ["s-rapid-a", 6, ["rapid-dates"], false],
      ["s-work-1", 10, ["onboarding-audit"], false],
      ["s-rapid-b", 6, ["rapid-policy"], false],
      ["s-work-2", 10, ["pay-changes"], false],
      ["s-rapid-c", 6, ["rapid-screening"], false],
      ["s-desk", 12, ["offer-check", "hiring-metrics", ...VALUES_STEPS], true],
    ]);
  });

  it("one-at-a-time screens add up to their section: offer 240 s, metrics 150 s, each call 66 s", () => {
    for (const sec of def.sections!.filter((s) => s.oneAtATime)) {
      expect(sec.stepIds.reduce((t, id) => t + stepById(id).seconds!, 0), sec.id).toBe(sec.minutes * 60);
    }
    expect(stepById("offer-check").seconds).toBe(240);
    expect(stepById("hiring-metrics").seconds).toBe(150);
    for (const id of VALUES_STEPS) expect(stepById(id).seconds).toBe(66);
  });

  it("each rapid round is 15 items x 20 seconds and fits its 6-minute section", () => {
    for (const id of RAPID_STEPS) {
      const config = rapidConfig(id);
      expect(config.items.length, id).toBe(15);
      expect(config.secondsPerItem).toBe(20);
      expect(config.items.length * config.secondsPerItem).toBeLessThanOrEqual(6 * 60);
    }
  });

  it("runs the sections back to back", () => {
    const at = (min: number) => flowAt(min * MIN);
    expect(at(0).visibleStepIds).toEqual(["rapid-dates"]);
    expect(at(6).visibleStepIds).toEqual(["onboarding-audit"]);
    expect(at(16).visibleStepIds).toEqual(["rapid-policy"]);
    expect(at(22).visibleStepIds).toEqual(["pay-changes"]);
    expect(at(32).visibleStepIds).toEqual(["rapid-screening"]);
    expect(at(38).visibleStepIds).toEqual(["offer-check"]);
    expect(at(END).done).toBe(true);
  });

  it("every message with a step points at a real step; briefs arrive when their section opens, updates at minute 4", () => {
    const ids = new Set(def.steps.map((s) => s.id));
    for (const m of def.messages) if (m.stepId) expect(ids.has(m.stepId), m.id).toBe(true);
    const at = (id: string) => def.messages.find((m) => m.id === id)!;
    expect([at("m-move").stepId, at("m-move").arriveAtMinute]).toEqual(["onboarding-audit", 4]);
    expect([at("m-pay-fix").stepId, at("m-pay-fix").arriveAtMinute]).toEqual(["pay-changes", 4]);
    const msgsAt = (min: number) => visibleMessageIds(def, flowAt(min * MIN), t0, t0 + min * MIN);
    expect(msgsAt(5)).toEqual(["m-welcome"]);
    expect(msgsAt(6)).toContain("m-audit");
    expect(msgsAt(6)).not.toContain("m-move");
    expect(msgsAt(10)).toContain("m-move");
    expect(msgsAt(22)).toContain("m-pay");
    expect(msgsAt(25)).not.toContain("m-pay-fix");
    expect(msgsAt(26)).toContain("m-pay-fix");
    expect(msgsAt(38)).toEqual(expect.arrayContaining(["m-offer", "m-metrics", "m-client-care", "m-integrity", "m-candor", "m-in-lane", "m-quality"]));
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

describe(`${SLUG}: rapid rounds`, () => {
  it(
    "every item over 200 seeds has one right answer, found from the exhibit alone, matching the key",
    () => {
      for (const seed of SEEDS) {
        const keys = scenario.generate(seed).keys;
        for (const id of RAPID_STEPS) {
          const key = keys[id] as RapidKey;
          const solved = solveRapid(seed, id);
          expect(Object.keys(key.items).sort()).toEqual(solved.map((s) => s.item.id).sort());
          for (const s of solved) {
            expect(s.item.fields.map((f) => f.id)).toEqual(["answer"]);
            expect(s.item.exhibit, `${s.item.id} has an exhibit`).toBeDefined();
            expect(key.items[s.item.id].answer.choice, `${seed} ${s.item.id} (${s.kind}: ${s.item.prompt})`).toBe(s.values.answer);
          }
        }
      }
    },
    LONG,
  );

  it("ten quick items worth half a point and five harder ones worth one, in every round: 10 a round", () => {
    for (const id of RAPID_STEPS) {
      const points = rapidConfig(id).items.map((i) => i.points);
      expect(points.filter((p) => p === 0.5).length, id).toBe(10);
      expect(points.filter((p) => p === 1).length, id).toBe(5);
      expect([2, 5, 8, 11, 14].map((i) => points[i])).toEqual([1, 1, 1, 1, 1]);
      for (const seed of SEEDS.slice(0, 50)) {
        solveRapid(seed, id).forEach((s, i) => {
          expect(HARD_KINDS[id].includes(s.kind), `${seed} ${id} item ${i} ${s.kind}`).toBe(points[i] === 1);
        });
      }
    }
  });

  it("dates round: the hard Section 2 items always cross a closure; benefits hard items start on a month's last day", () => {
    const kinds = new Map<string, number>();
    for (const seed of SEEDS.slice(0, 50)) for (const s of solveRapid(seed, "rapid-dates")) kinds.set(s.kind, (kinds.get(s.kind) ?? 0) + 1);
    expect([...kinds.keys()].sort()).toEqual(["ack", "benefits", "benefits-eom", "fmla", "pto", "s2", "s2-holiday"]);
    expect(kinds.get("s2-holiday")).toBe(100);
    expect(kinds.get("fmla")).toBe(100);
  });

  it("screening round: the right option never rests on a protected fact, and in hard items one wrong option does", () => {
    for (const seed of SEEDS.slice(0, 60)) {
      const keys = scenario.generate(seed).keys["rapid-screening"] as RapidKey;
      for (const s of solveRapid(seed, "rapid-screening")) {
        const opts = choiceField(s.item).options;
        const right = opts.find((o) => o.id === keys.items[s.item.id].answer.choice)!;
        expect([MEETS, FAILS, MORE]).toContain(right.label);
        if (s.kind === "protected") {
          const extra = opts.find((o) => ![MEETS, FAILS, MORE].includes(o.label))!;
          expect(extra.label, `${seed} ${s.item.id}`).toMatch(/family leave|retirement|medical-leave gap/);
        }
      }
    }
  });

  it("varies per seed: which item comes when and where the right option sits", () => {
    for (const id of RAPID_STEPS) {
      const firsts = SEEDS.slice(0, 60).map((seed) => solveRapid(seed, id)[0]);
      expect(new Set(firsts.map((s) => JSON.stringify(s.item))).size, id).toBeGreaterThan(30);
      expect(new Set(firsts.map((s) => JSON.stringify(s.values))).size, id).toBe(4);
    }
  });

  it("option ids are fixed per item, so an id can't hint at the answer", () => {
    for (const id of RAPID_STEPS) {
      const ids = (seed: string) => rapidItems(seed, id).map((i) => i.fields.map((f) => [f.id, (f as RapidChoiceField).options.map((o) => o.id)]));
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
